// ✅ addCreatedAtColumn.js

require('dotenv').config(); // Load .env first
const { Pool } = require('pg');

// Use same config as your backend
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false,
  },
});

async function addCreatedAtColumn() {
  try {
    const res = await pool.query(`
      ALTER TABLE tips 
      ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    `);

    console.log("✅ 'created_at' column added to tips table.");
  } catch (err) {
    if (err.code === '42701') {
      console.log("⚠️ Column 'created_at' already exists.");
    } else {
      console.error("❌ Failed to alter tips table:", err);
    }
  } finally {
    await pool.end();
  }
}

addCreatedAtColumn();
