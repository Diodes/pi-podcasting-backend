// resetPayouts.js
require('dotenv').config();
const db = require('./db'); // assumes your db.js exports the PG pool

async function resetPayoutTables() {
  try {
    await db.query('DELETE FROM payout_requests');
    await db.query('DELETE FROM payouts');
    console.log('✅ Cleared all payout requests and payout history.');
    process.exit();
  } catch (err) {
    console.error('❌ Error wiping payout data:', err);
    process.exit(1);
  }
}

resetPayoutTables();
