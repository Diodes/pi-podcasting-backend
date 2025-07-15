// reset-payments.js
require('dotenv').config();
const { Pool } = require("pg");

// Replace with your real connection info if not using .env
const pool = new Pool({
  connectionString: process.env.DATABASE_URL, // or hardcode your Render DB URL here
  ssl: { rejectUnauthorized: false }
});

async function resetPayments() {
  try {
    console.log("⚠️ Clearing tips and payouts tables...");

    await pool.query("DELETE FROM tips");
    await pool.query("DELETE FROM payouts");

    // Optional: reset sequences if your tables use SERIAL id
    await pool.query("ALTER SEQUENCE tips_id_seq RESTART WITH 1");
    await pool.query("ALTER SEQUENCE payouts_id_seq RESTART WITH 1");

    console.log("✅ Database payment tables have been reset.");
  } catch (err) {
    console.error("❌ Error resetting database:", err);
  } finally {
    await pool.end();
  }
}

resetPayments();
