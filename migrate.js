const db = require('./db'); // uses the pool from your .env

async function migrate() {
  try {
    await db.query(`
      ALTER TABLE podcasts
      ADD COLUMN IF NOT EXISTS tags TEXT[],
      ADD COLUMN IF NOT EXISTS genre TEXT;
    `);
    console.log("✅ Migration successful: tags and genre added.");
  } catch (err) {
    console.error("❌ Migration failed:", err);
  } finally {
    await db.end();
  }
}

migrate();
