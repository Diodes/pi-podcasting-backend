// addBannedColumn.js
const db = require('./db');

async function addBannedColumn() {
  try {
    console.log("🔧 Attempting to add 'banned' column to podcasts table...");

    await db.query(`
    ALTER TABLE podcasts
    ADD COLUMN IF NOT EXISTS creator_banned BOOLEAN DEFAULT false;

        `);

    console.log("✅ 'creator_banned' column added successfully.");
  } catch (err) {
    console.error("❌ Failed to add 'banned' column:", err.message);
  } finally {
    process.exit();
  }
}

addBannedColumn();
