import { Hono } from 'hono';
import jwt from 'jsonwebtoken';
const { sign, verify } = jwt;
import bcryptPkg from 'bcryptjs';
const { hash, compare } = bcryptPkg;
import { connectDB } from '../config/db.js';
import {
  HARDCODED_ADMIN_PHONE,
  normalizePhoneNumber,
  isValidE164,
  maskPhoneNumber,
  cleanDigits,
  generateSecureOtp,
  generateOtp,
  getOtpRateLimitCooldown,
  savePasswordResetOtp,
  verifyPasswordResetOtp,
  consumePasswordResetOtp,
  dispatchOtp,
} from '../services/otp.service.js';
import { sendTraccarSms } from '../services/traccar.service.js';

const router = new Hono();

const DEFAULT_ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const JWT_SECRET = process.env.JWT_SECRET || 'saraswati_motors_fallback_secret_2026';

// ── GET /api/auth/info ──────────────────────────────────────────────────────────
// Returns public auth configuration metadata
router.get('/info', async (c) => {
  const normalizedPhone = normalizePhoneNumber(HARDCODED_ADMIN_PHONE);
  return c.json({
    adminUsername: DEFAULT_ADMIN_USERNAME,
    maskedPhone: maskPhoneNumber(normalizedPhone),
    phone: normalizedPhone,
  });
});

// ── POST /api/auth/login ───────────────────────────────────────────────────────
router.post('/login', async (c) => {
  try {
    const db = await connectDB();
    const body = await c.req.json().catch(() => ({}));
    const { username, password } = body;

    if (!username || !password || typeof username !== 'string' || typeof password !== 'string') {
      return c.json({ message: 'Username and password required' }, 400);
    }

    const cleanUsername = username.trim();
    const admins = db.collection('admins');
    let admin = await admins.findOne({ username: cleanUsername });

    // Initialize admin user if none exists (without hardcoded password)
    if (!admin && cleanUsername === DEFAULT_ADMIN_USERNAME) {
      console.log(`[Auth] Initializing admin user (${DEFAULT_ADMIN_USERNAME}). Password must be configured via SMS OTP...`);
      const normalizedPhone = normalizePhoneNumber(HARDCODED_ADMIN_PHONE);
      const result = await admins.insertOne({
        username: DEFAULT_ADMIN_USERNAME,
        password: null, // No password set initially
        phone: normalizedPhone,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      admin = await admins.findOne({ _id: result.insertedId });
    }

    if (!admin) {
      return c.json({ message: 'Invalid credentials' }, 401);
    }

    // First-time login: If no password has been configured yet via OTP
    if (!admin.password) {
      return c.json({
        message: 'No password has been set yet. Please use "Set / Reset Password via OTP" to configure your initial password.',
        needsSetup: true,
      }, 400);
    }

    // Compare with saved password hash
    const isMatch = await compare(password, admin.password);

    if (!isMatch) {
      return c.json({ message: 'Invalid credentials' }, 401);
    }

    const token = sign(
      { id: admin._id.toString(), username: admin.username },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    return c.json({
      token,
      username: admin.username,
      message: 'Login successful',
    });
  } catch (err) {
    console.error('[POST /auth/login] Error:', err.message || err);
    return c.json({ message: 'Server error occurred during login' }, 500);
  }
});

// ── POST /api/auth/request-otp ────────────────────────────────────────────────
// Request a secure 6-digit OTP dispatched to the single registered owner phone
router.post('/request-otp', async (c) => {
  try {
    const db = await connectDB();
    // Strictly lock OTP destination to the single registered owner phone
    const normalizedPhone = normalizePhoneNumber(HARDCODED_ADMIN_PHONE);

    // 1. Rate Limiting: Max 1 OTP request per 60 seconds per phone number
    const cooldown = await getOtpRateLimitCooldown(db, normalizedPhone);
    if (cooldown > 0) {
      return c.json({
        success: false,
        message: `Please wait ${cooldown} second(s) before requesting another OTP.`,
        retryAfter: cooldown,
      }, 429);
    }

    // 2. Ensure admin account exists with this phone number
    const admins = db.collection('admins');
    let adminUser = await admins.findOne({ username: DEFAULT_ADMIN_USERNAME });

    if (!adminUser) {
      const result = await admins.insertOne({
        username: DEFAULT_ADMIN_USERNAME,
        password: null, // Password will be set via OTP
        phone: normalizedPhone,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      adminUser = await admins.findOne({ _id: result.insertedId });
    } else if (adminUser.phone !== normalizedPhone) {
      await admins.updateOne(
        { _id: adminUser._id },
        { $set: { phone: normalizedPhone, updatedAt: new Date() } }
      );
    }

    // 3. Generate cryptographically secure 6-digit numeric OTP
    const otp = generateSecureOtp();

    // 4. Save hashed OTP and 5-minute expiry in database
    await savePasswordResetOtp(db, {
      phoneNumber: normalizedPhone,
      otp,
      expiresInMinutes: 5,
    });

    // 5. Send HTTP POST request to Traccar SMS Gateway
    try {
      await sendTraccarSms(normalizedPhone, otp);
    } catch (smsErr) {
      console.warn('[Traccar Dispatch Warning]:', smsErr.message);
      if (process.env.NODE_ENV === 'production') {
        return c.json({ success: false, message: 'Failed to dispatch SMS through gateway.' }, 502);
      }
    }

    const masked = maskPhoneNumber(normalizedPhone);

    return c.json({
      success: true,
      message: `OTP sent successfully to registered owner phone (${masked})`,
      phone_number: normalizedPhone,
      maskedPhone: masked,
      expiresInSeconds: 300,
    });
  } catch (err) {
    console.error('[POST /auth/request-otp] Error:', err.message || err);
    return c.json({ success: false, message: 'Failed to process OTP request' }, 500);
  }
});

// ── POST /api/auth/reset-password ──────────────────────────────────────────────
// Validates 6-digit otp for registered owner and updates the password
router.post('/reset-password', async (c) => {
  try {
    const db = await connectDB();
    const body = await c.req.json().catch(() => ({}));
    const { otp, new_password, newPassword } = body;
    const passwordToSet = new_password || newPassword;

    // Strictly lock OTP verification to the single registered owner phone
    const normalizedPhone = normalizePhoneNumber(HARDCODED_ADMIN_PHONE);

    if (!passwordToSet || typeof passwordToSet !== 'string' || passwordToSet.trim().length < 6) {
      return c.json({ success: false, message: 'New password must be at least 6 characters long' }, 400);
    }

    if (!otp || typeof otp !== 'string') {
      return c.json({ success: false, message: '6-digit OTP is required' }, 400);
    }

    // Verify OTP against stored hash (checks 5-minute expiry & max 3 failed attempts)
    const verification = await verifyPasswordResetOtp(db, {
      phoneNumber: normalizedPhone,
      otp,
    });

    if (!verification.valid) {
      return c.json({ success: false, message: verification.message }, verification.status || 400);
    }

    // Hash new password using bcrypt (12 salt rounds)
    const hashedPassword = await hash(passwordToSet.trim(), 12);
    const admins = db.collection('admins');

    await admins.updateOne(
      { username: DEFAULT_ADMIN_USERNAME },
      {
        $set: {
          password: hashedPassword,
          phone: normalizedPhone,
          updatedAt: new Date(),
        },
      },
      { upsert: true }
    );

    // Delete used OTP record so it cannot be reused
    await consumePasswordResetOtp(db, normalizedPhone);

    console.log(`[Auth] ✅ Password successfully configured for admin (${normalizedPhone})`);

    return c.json({
      success: true,
      message: 'Password set successfully! You can now login with your new password.',
    });
  } catch (err) {
    console.error('[POST /auth/reset-password] Error:', err.message || err);
    return c.json({ success: false, message: 'Failed to save password. Please try again.' }, 500);
  }
});

// ── Legacy Routes Compatibility ───────────────────────────────────────────────
// POST /api/auth/forgot-password -> maps to /request-otp
router.post('/forgot-password', async (c) => {
  return router.fetch(new Request(new URL('/request-otp', c.req.url).toString(), {
    method: 'POST',
    headers: c.req.raw.headers,
    body: await c.req.text(),
  }));
});

// POST /api/auth/verify-otp -> validates OTP and returns resetToken
router.post('/verify-otp', async (c) => {
  try {
    const db = await connectDB();
    const body = await c.req.json().catch(() => ({}));
    const rawPhone = body.phone_number || body.phone || HARDCODED_ADMIN_PHONE;
    const { otp } = body;

    const normalizedPhone = normalizePhoneNumber(rawPhone);
    const verification = await verifyPasswordResetOtp(db, {
      phoneNumber: normalizedPhone,
      otp,
    });

    if (!verification.valid) {
      return c.json({ success: false, message: verification.message }, verification.status || 400);
    }

    const resetToken = sign(
      { phone_number: normalizedPhone, purpose: 'admin_password_reset' },
      JWT_SECRET,
      { expiresIn: '15m' }
    );

    return c.json({
      success: true,
      message: 'OTP verified successfully',
      resetToken,
    });
  } catch (err) {
    console.error('[POST /auth/verify-otp] Error:', err.message || err);
    return c.json({ success: false, message: 'Failed to verify OTP' }, 500);
  }
});

export default router;
