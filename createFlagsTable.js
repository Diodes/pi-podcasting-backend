// createFlagsTable.js
require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false } // ✅ Render requires this
});

async function createFlagsTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS flags (
        id SERIAL PRIMARY KEY,
        podcast_id INTEGER NOT NULL REFERENCES podcasts(id) ON DELETE CASCADE,
        flagged_by TEXT NOT NULL,
        UNIQUE (podcast_id, flagged_by)
      );
    `);

    console.log("✅ flags table created or already exists.");
  } catch (err) {
    console.error("❌ Error creating flags table:", err);
  } finally {
    await pool.end();
    console.log("🛑 Connection closed.");
  }
}

createFlagsTable();
