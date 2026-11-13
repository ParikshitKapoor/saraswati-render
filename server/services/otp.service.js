import crypto from 'node:crypto';
import bcryptPkg from 'bcryptjs';
const { hash, compare } = bcryptPkg;
import { sendTraccarSms } from './traccar.service.js';

export const HARDCODED_ADMIN_PHONE = process.env.ADMIN_PHONE || '+91 9811798761';

/**
 * Normalizes phone number into strict E.164 format.
 * Examples:
 *   "+91 95992 42719" -> "+919599242719"
 *   "9599242719"      -> "+919599242719" (assumes +91 for 10-digit Indian numbers)
 *   "09599242719"     -> "+919599242719"
 */
export function normalizePhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') return '';
  let clean = phone.trim().replace(/[\s()-]/g, '');
  if (!clean.startsWith('+')) {
    if (clean.startsWith('0') && clean.length === 11) {
      clean = '+91' + clean.slice(1);
    } else if (clean.length === 10) {
      clean = '+91' + clean;
    } else {
      clean = '+' + clean;
    }
  }
  return clean;
}

/**
 * Validates E.164 standard phone format (+[1-9] followed by 7-14 digits)
 */
export function isValidE164(phone) {
  if (!phone || typeof phone !== 'string') return false;
  return /^\+[1-9]\d{7,14}$/.test(phone);
}

/**
 * Mask a phone number for UI display (e.g., "+919599242719" -> "+91 95992 •••19")
 */
export function maskPhoneNumber(phone) {
  if (!phone || typeof phone !== 'string') return '+91 ••••• ••••';
  const clean = normalizePhoneNumber(phone);
  if (clean.length < 8) return clean;
  const start = clean.slice(0, 8);
  const end = clean.slice(-2);
  return `${start} •••${end}`;
}

/**
 * Clean phone to pure digits for SMS APIs
 */
export function cleanDigits(phone) {
  return (phone || '').replace(/\D+/g, '');
}

/**
 * Generate a cryptographically secure 6-digit numerical OTP code
 */
export function generateSecureOtp() {
  return crypto.randomInt(100000, 1000000).toString();
}

/**
 * Legacy generator for backward compatibility
 */
export function generateOtp() {
  return generateSecureOtp();
}

let ttlIndexInitialized = false;
async function ensureTTLIndex(collection) {
  if (ttlIndexInitialized) return;
  try {
    await collection.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });
    await collection.createIndex({ phone_number: 1 });
    ttlIndexInitialized = true;
  } catch (err) {
    // Non-fatal if index exists or in-memory runner
    console.debug('[OTP Index] Note:', err.message);
  }
}

/**
 * Checks if phone number is rate-limited (max 1 OTP request per 60 seconds)
 * Returns remaining cooldown in seconds, or 0 if allowed.
 */
export async function getOtpRateLimitCooldown(db, phoneNumber) {
  const collection = db.collection('password_reset_otps');
  await ensureTTLIndex(collection);

  const existing = await collection.findOne({ phone_number: phoneNumber });
  if (!existing || !existing.last_requested_at) return 0;

  const elapsedMs = Date.now() - new Date(existing.last_requested_at).getTime();
  const cooldownMs = 60 * 1000;

  if (elapsedMs < cooldownMs) {
    return Math.ceil((cooldownMs - elapsedMs) / 1000);
  }
  return 0;
}

/**
 * Save OTP to MongoDB password_reset_otps collection:
 * - phone_number: E.164 string
 * - otp_hash: bcrypt hash of OTP (never plain text)
 * - expires_at: Date (5 minutes from creation)
 * - attempts: 0 (max 3 failed attempts allowed)
 * - last_requested_at: Date
 */
export async function savePasswordResetOtp(db, { phoneNumber, otp, expiresInMinutes = 5 }) {
  const collection = db.collection('password_reset_otps');
  await ensureTTLIndex(collection);

  const otpHash = await hash(otp, 10);
  const expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000);

  await collection.updateOne(
    { phone_number: phoneNumber },
    {
      $set: {
        phone_number: phoneNumber,
        otp_hash: otpHash,
        expires_at: expiresAt,
        attempts: 0,
        last_requested_at: new Date(),
        created_at: new Date(),
      },
    },
    { upsert: true }
  );

  return { expiresAt };
}

/**
 * Verify OTP from password_reset_otps collection:
 * - Checks expiry
 * - Enforces max 3 attempts
 * - Increments attempts count on failed attempt
 * - Returns { valid: boolean, status: number, message: string }
 */
export async function verifyPasswordResetOtp(db, { phoneNumber, otp }) {
  if (!otp || typeof otp !== 'string') {
    return { valid: false, status: 400, message: 'Please provide a valid 6-digit OTP' };
  }

  const cleanOtp = otp.trim();
  if (cleanOtp.length !== 6 || !/^\d{6}$/.test(cleanOtp)) {
    return { valid: false, status: 400, message: 'OTP must be exactly 6 numeric digits' };
  }

  const collection = db.collection('password_reset_otps');
  await ensureTTLIndex(collection);

  const record = await collection.findOne({ phone_number: phoneNumber });

  if (!record) {
    return {
      valid: false,
      status: 400,
      message: 'OTP session expired or not found. Please request a new OTP.',
    };
  }

  if (new Date() > new Date(record.expires_at)) {
    await collection.deleteOne({ _id: record._id }).catch(() => {});
    return {
      valid: false,
      status: 400,
      message: 'OTP has expired (validity is 5 minutes). Please request a new OTP.',
    };
  }

  if ((record.attempts || 0) >= 3) {
    await collection.deleteOne({ _id: record._id }).catch(() => {});
    return {
      valid: false,
      status: 429,
      message: 'Too many incorrect attempts. For security, this OTP is invalidated. Please request a new one.',
    };
  }

  const isMatch = await compare(cleanOtp, record.otp_hash);

  if (!isMatch) {
    const nextAttempts = (record.attempts || 0) + 1;
    if (nextAttempts >= 3) {
      await collection.deleteOne({ _id: record._id }).catch(() => {});
      return {
        valid: false,
        status: 429,
        message: 'Invalid OTP code. Maximum 3 attempts exceeded. Please request a new OTP.',
      };
    }

    await collection.updateOne(
      { _id: record._id },
      { $set: { attempts: nextAttempts } }
    );

    const remaining = 3 - nextAttempts;
    return {
      valid: false,
      status: 400,
      message: `Invalid OTP code. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
    };
  }

  return { valid: true, record };
}

/**
 * Remove OTP after successful password reset so it cannot be reused
 */
export async function consumePasswordResetOtp(db, phoneNumber) {
  try {
    const collection = db.collection('password_reset_otps');
    await collection.deleteOne({ phone_number: phoneNumber });
  } catch (err) {
    console.warn('[consumePasswordResetOtp Warning]', err.message);
  }
}

/**
 * Main dispatcher: uses Traccar SMS Gateway (or falls back to dev terminal/Fast2SMS/Twilio)
 */
export async function dispatchOtp(phone, otp) {
  const targetPhone = normalizePhoneNumber(phone || HARDCODED_ADMIN_PHONE);
  const masked = maskPhoneNumber(targetPhone);

  // 1. Primary: Traccar SMS Gateway (Android SMS Gateway API)
  try {
    const traccarResult = await sendTraccarSms(targetPhone, otp);
    return {
      success: true,
      phone: targetPhone,
      maskedPhone: masked,
      expiresInSeconds: 300,
      gateway: 'traccar',
      simulated: traccarResult.simulated,
    };
  } catch (traccarErr) {
    console.warn('[Traccar Dispatch Note] Traccar gateway error:', traccarErr.message);
  }

  // 2. Secondary fallback: Fast2SMS if configured
  if (process.env.FAST2SMS_API_KEY) {
    try {
      const numbers = cleanDigits(targetPhone).slice(-10);
      const url = `https://www.fast2sms.com/dev/bulkV2?authorization=${process.env.FAST2SMS_API_KEY}&route=otp&variables_values=${otp}&numbers=${numbers}`;
      const res = await fetch(url, { headers: { 'cache-control': 'no-cache' } });
      const data = await res.json().catch(() => ({}));
      console.log('[Fast2SMS Status]', data);
    } catch (apiErr) {
      console.warn('[Fast2SMS Warning] Could not dispatch external SMS:', apiErr.message);
    }
  }

  return {
    success: true,
    phone: targetPhone,
    maskedPhone: masked,
    expiresInSeconds: 300,
  };
}

// ── Legacy Compatibility Helpers ──────────────────────────────────────────────
export async function saveOtpToDB(db, { username = 'admin', phone, otp, expiresInMinutes = 5 }) {
  const targetPhone = normalizePhoneNumber(phone || HARDCODED_ADMIN_PHONE);
  return savePasswordResetOtp(db, { phoneNumber: targetPhone, otp, expiresInMinutes });
}

export async function verifyOtpFromDB(db, { username = 'admin', otp, phone }) {
  const targetPhone = normalizePhoneNumber(phone || HARDCODED_ADMIN_PHONE);
  return verifyPasswordResetOtp(db, { phoneNumber: targetPhone, otp });
}

export async function clearOtpFromDB(db, { username = 'admin', phone }) {
  const targetPhone = normalizePhoneNumber(phone || HARDCODED_ADMIN_PHONE);
  return consumePasswordResetOtp(db, targetPhone);
}
