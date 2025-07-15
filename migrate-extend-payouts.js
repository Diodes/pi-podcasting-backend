require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function extendPayoutsTable() {
  try {
    console.log("🔧 Extending 'payouts' table...");

    await pool.query(`
      ALTER TABLE payouts
      ADD COLUMN IF NOT EXISTS amount_paid NUMERIC,
      ADD COLUMN IF NOT EXISTS platform_fee NUMERIC,
      ADD COLUMN IF NOT EXISTS txid TEXT,
      ADD COLUMN IF NOT EXISTS paid_to TEXT,
      ADD COLUMN IF NOT EXISTS payout_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'completed';
    `);

    console.log("✅ Payouts table extended successfully.");
  } catch (err) {
    console.error("❌ Migration failed:", err.message);
  } finally {
    await pool.end();
  }
}

extendPayoutsTable();
