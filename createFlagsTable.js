// createFlagsTable.js
require('dotenv').config();
const { Pool } = require("pg");

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function addFlaggerColumn() {
  try {
    await pool.query(`
      ALTER TABLE flags
      ADD COLUMN flagger TEXT;
    `);
    console.log("✅ 'flagger' column added to 'flags' table.");
  } catch (err) {
    console.error("❌ Error adding 'flagger' column:", err);
  } finally {
    await pool.end();
  }
}

addFlaggerColumn();