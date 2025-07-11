// createPayoutsTable.js
require('dotenv').config();
const db = require('./db'); // assumes db.js exports your PG pool

async function createPayoutsTable() {
  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS payouts (
        id SERIAL PRIMARY KEY,
        creator_username TEXT NOT NULL,
        amount_paid NUMERIC NOT NULL,
        platform_fee NUMERIC NOT NULL,
        paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
