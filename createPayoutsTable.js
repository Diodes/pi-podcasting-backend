// createPayoutsTable.js
require('dotenv').config();
const db = require('./db'); // assumes db.js exports your PG pool

async function createPayoutsTable() {
  try {
    await db.query(`
    CREATE TABLE IF NOT EXISTS payout_requests (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      fulfilled BOOLEAN DEFAULT false
    );

    `);

    console.log('✅ payouts table created successfully.');
    process.exit();
  } catch (err) {
    console.error('❌ Error creating payouts table:', err);
    process.exit(1);
  }
}

createPayoutsTable();
