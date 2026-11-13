import 'dotenv/config';
import { connectDB, getDB } from './config/db.js';

const DEFAULT_ADMIN_USERNAME = process.env.ADMIN_USERNAME || 'admin';
const ADMIN_PHONE = process.env.ADMIN_PHONE || '+91 9811798761';

async function seed(shouldConnect = false) {
  if (shouldConnect) {
    await connectDB();
    console.log('[Seed] Connected to MongoDB');
  }

  const db = getDB();

  // ── Seed admin (No hardcoded password — password must be set via OTP) ─────────
  const admins = db.collection('admins');
  const existingAdmin = await admins.findOne({ username: DEFAULT_ADMIN_USERNAME });

  if (!existingAdmin) {
    await admins.insertOne({
      username: DEFAULT_ADMIN_USERNAME,
      password: null, // No hardcoded password; created on first login via SMS OTP
      phone: ADMIN_PHONE,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    console.log(`[Seed] ℹ️ Admin account initialized (username: ${DEFAULT_ADMIN_USERNAME}, phone: ${ADMIN_PHONE}). Password must be set via OTP.`);
  } else {
    // Keep registered phone in sync if configured in .env
    if (existingAdmin.phone !== ADMIN_PHONE) {
      await admins.updateOne(
        { _id: existingAdmin._id },
        { $set: { phone: ADMIN_PHONE, updatedAt: new Date() } }
      );
    }
    console.log(`[Seed] ℹ️ Admin account ready (username: ${DEFAULT_ADMIN_USERNAME}, phone: ${existingAdmin.phone || ADMIN_PHONE})`);
  }

  // ── Seed sample vehicles if empty ──────────────────────────────────────────
  const vehicles = db.collection('vehicles');
  const vehicleCount = await vehicles.countDocuments();
  if (vehicleCount === 0) {
    console.log('[Seed] Seeding sample vehicle showcase...');
    // Vehicles collection initialized
  }
}

export default seed;
