require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }, // Required by Render
});

async function addWalletColumn() {
  try {
    console.log("🔧 Running migration: add wallet_address column");

    const result = await pool.query(`
      ALTER TABLE users
      ADD COLUMN IF NOT EXISTS wallet_address TEXT
    `);

    console.log("✅ Migration successful!");
  } catch (err) {
    console.error("❌ Migration failed:", err.message);
  } finally {
    await pool.end();
  }
}

addWalletColumn();
