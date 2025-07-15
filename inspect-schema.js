require('dotenv').config();
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function inspectSchema() {
  try {
    const tables = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);

    for (const row of tables.rows) {
      const tableName = row.table_name;
      console.log(`\n📘 Table: ${tableName}`);

      const columns = await pool.query(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = $1;
      `, [tableName]);

      for (const col of columns.rows) {
        console.log(`   • ${col.column_name} (${col.data_type})`);
      }
    }

    console.log("\n✅ Done listing schema.");
  } catch (err) {
    console.error("❌ Error inspecting schema:", err.message);
  } finally {
    await pool.end();
  }
}

inspectSchema();
