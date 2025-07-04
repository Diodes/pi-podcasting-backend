// alterTipsTable.js
const pool = require('./db');

async function runAlterations() {
  try {
    await pool.query(`
      ALTER TABLE tips 
      ADD COLUMN IF NOT EXISTS tipper_username TEXT,
      ADD COLUMN IF NOT EXISTS recipient_username TEXT;
    `);

    console.log("✅ Alterations applied successfully.");
  } catch (err) {
    console.error("❌ Error applying alterations:", err);
  } finally {
    pool.end();
  }
}

runAlterations();
