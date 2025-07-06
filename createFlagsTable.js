// createFlagsTable.js
const { Pool } = require('pg');

// ✅ Set up your DB connection (reuse your DATABASE_URL from .env)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'your-hardcoded-connection-string-if-needed'
});

async function createFlagsTable() {
  const query = `
    CREATE TABLE IF NOT EXISTS flags (
      id SERIAL PRIMARY KEY,
      podcast_id INTEGER NOT NULL,
      flagged_by TEXT NOT NULL,
      flagged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (podcast_id, flagged_by)
    );
  `;

  try {
    await pool.query(query);
    console.log("✅ flags table created (or already exists)");
  } catch (err) {
    console.error("❌ Error creating flags table:", err);
  } finally {
    await pool.end();
    console.log("🛑 Connection closed.");
  }
}

createFlagsTable();
