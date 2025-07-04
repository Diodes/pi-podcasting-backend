// migrate_add_sender_username.js
const db = require('./db');

async function addSenderUsernameColumn() {
  await db.query(`
    ALTER TABLE tips
    ADD COLUMN IF NOT EXISTS sender_username TEXT;
  `);
  console.log("✅ sender_username column added");
}

addSenderUsernameColumn().then(() => process.exit());
