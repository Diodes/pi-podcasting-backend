require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function createUsersTable() {
  try {
    console.log("🔧 Creating `users` table with wallet_address...");

    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        creator_pi_username TEXT PRIMARY KEY,
        wallet_address TEXT
      );
    `);

    console.log("✅ users table created!");
  } catch (err) {
    console.error("❌ Migration failed:", err.message);
  } finally {
    await pool.end();
  }
}

createUsersTable();
