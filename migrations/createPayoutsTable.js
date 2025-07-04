const db = require('../db');

async function createPayoutsTable() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS payouts (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL,
        amount NUMERIC(10, 4) NOT NULL,
        payout_date TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
    console.log("✅ payouts table created or already exists.");
    process.exit(0);
  } catch (err) {
    console.error("❌ Error creating payouts table:", err);
    process.exit(1);
  }
}

createPayoutsTable();
