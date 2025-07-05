const db = require('./db');
(async () => {
  const result = await db.query(`SELECT * FROM payouts WHERE username = 'eliask77' ORDER BY payout_date DESC`);
  console.log(result.rows);
  process.exit();
})();
