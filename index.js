const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const dotenv = require('dotenv');
dotenv.config(); // ✅ load .env FIRST
const fetch = require('node-fetch');
const multer = require('multer');
const multerS3 = require('multer-s3');
const db = require('./db'); // ✅ use this instead of redefining a new pool


const app = express();
const PORT = process.env.PORT || 5000;

const PI_API_KEY = process.env.PI_API_KEY;
if (!PI_API_KEY) {
  console.warn("⚠️ WARNING: PI_API_KEY not set in .env");
}

app.use(express.json());

app.use(cors({
  origin: [
    'https://pivocalcast.com',
    'https://pi://vocalcast',
    'https://vocalcast.minepi.com'
  ],
}));

app.get('/wallet-address/:username', async (req, res) => {
  const { username } = req.params;
  try {
    const result = await db.query(
      `SELECT wallet_address FROM users WHERE creator_pi_username = $1`,
      [username]
    );
    res.json({ walletAddress: result.rows[0]?.wallet_address || '' });
  } catch (err) {
    res.status(500).json({ error: 'Database error' });
  }
});

app.post('/wallet-address', async (req, res) => {
  const { username, walletAddress } = req.body;
  if (!username || !walletAddress) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  try {
    await db.query(
      `UPDATE users SET wallet_address = $1 WHERE creator_pi_username = $2`,
      [walletAddress, username]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error updating wallet:", err.message);
    res.status(500).json({ error: 'Database error' });
  }
});


// ✅ AWS S3 setup
const { S3Client } = require('@aws-sdk/client-s3');
const s3 = new S3Client({
  region: process.env.AWS_REGION || 'us-east-2',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
});

const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: process.env.S3_BUCKET_NAME,
    contentType: multerS3.AUTO_CONTENT_TYPE,
    key: function (req, file, cb) {
      const timestamp = Date.now();
      const folder = file.mimetype.startsWith('image/') ? 'screens' : 'uploads';
      const cleanName = file.originalname
        .normalize("NFD").replace(/[̀-ͯ]/g, "")
        .replace(/[^a-zA-Z0-9._-]/g, "_");
      cb(null, `${folder}/${timestamp}-${cleanName}`);
    }
  })
});

app.get("/ping", (req, res) => {
  res.send("pong");
});

// ✅ Root
app.get('/podcasts', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM podcasts ORDER BY uploaded_at DESC');
    res.json({ success: true, podcasts: result.rows });
  } catch (err) {
    console.error("❌ Error fetching podcasts:", err);
    res.status(500).json({ success: false, error: "Database query failed" });
  }
});

app.get('/total-tips/:username', async (req, res) => {
  const { username } = req.params;
  try {
    const result = await db.query(
      'SELECT COALESCE(SUM(amount), 0) AS total FROM tips WHERE recipient_username = $1',
      [username]
    );
    res.json({ total: result.rows[0].total });
  } catch (err) {
    console.error('Error fetching total tips:', err);
    res.status(500).json({ error: 'DB error' });
  }
});

app.get('/tips-since-last-payout/:username', async (req, res) => {
  const { username } = req.params;
  try {
    const lastPayoutResult = await db.query(
      'SELECT MAX(payout_date) as last_payout FROM payouts WHERE username = $1',
      [username]
    );
    const lastPayout = lastPayoutResult.rows[0].last_payout || '1970-01-01';

    const tipsResult = await db.query(
      'SELECT COALESCE(SUM(amount), 0) AS total FROM tips WHERE recipient_username = $1 AND created_at > $2',
      [username, lastPayout]
    );

    res.json({ totalSinceLastPayout: tipsResult.rows[0].total });
  } catch (err) {
    console.error('Error fetching tips since last payout:', err);
    res.status(500).json({ error: 'DB error' });
  }
});

/*
app.post('/request-payout', async (req, res) => {
  const { creatorUsername, uid, txid } = req.body;

  if (!creatorUsername || !uid || !txid) {
    console.warn("⚠️ [request-payout] Missing required fields:", req.body);
    return res.status(400).json({
      success: false,
      error: "creatorUsername, uid, and txid are required for payout",
    });
  }

  try {
    console.log(`📥 [request-payout] Logging payout for: ${creatorUsername}`);

    // Get total unpaid tips
    const tipsRes = await db.query(`
      SELECT SUM(amount) AS total
      FROM tips
      WHERE recipient_username = $1 AND paid = false
    `, [creatorUsername]);

    const totalTips = parseFloat(tipsRes.rows[0].total || 0);

    if (totalTips < 3) {
      return res.status(403).json({
        success: false,
        error: `Minimum payout is 3 Pi. You have ${totalTips.toFixed(4)} Pi.`,
      });
    }

    // Calculate payout + fee
    const platformFee = parseFloat((totalTips * 0.10).toFixed(6));
    const payoutAmount = parseFloat((totalTips - platformFee).toFixed(6));

    // 🔍 Fetch wallet address
    const walletRes = await db.query(`
      SELECT wallet_address FROM users WHERE creator_pi_username = $1
    `, [creatorUsername]);

    const paidTo = walletRes.rows[0]?.wallet_address || null;

    if (!paidTo) {
      return res.status(400).json({
        success: false,
        error: "No wallet address on file for creator",
      });
    }

    // ✅ Insert payout record
    await db.query(`
      INSERT INTO payouts (creator_username, amount_paid, platform_fee, txid, paid_to, status)
      VALUES ($1, $2, $3, $4, $5, 'completed')
    `, [creatorUsername, payoutAmount, platformFee, txid, paidTo]);

    // ✅ Mark all unpaid tips as paid
    const updateRes = await db.query(`
      UPDATE tips
      SET paid = true
      WHERE recipient_username = $1 AND paid = false
    `, [creatorUsername]);

    console.log(`✅ [request-payout] Payout logged. Updated ${updateRes.rowCount} tips.`);

    return res.json({
      success: true,
      payoutAmount,
      platformFee,
      totalTips,
      paidTo,
      message: `✅ Logged payout of ${payoutAmount} Pi to ${creatorUsername}.`,
    });

  } catch (err) {
    console.error("🔥 [request-payout] Uncaught error during payout:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});
*/

const { sendPayoutRequestEmail } = require('./mailer');

app.post('/request-manual-payout', async (req, res) => {
  const { username } = req.body;

  if (!username) {
    return res.status(400).json({ success: false, error: "Missing username" });
  }

  try {
    // check if already requested
    const existing = await db.query(
      `SELECT * FROM payout_requests WHERE username = $1`,
      [username]
    );

    if (existing.rows.length > 0) {
      return res.json({ success: false, error: "Already requested" });
    }

    // fetch wallet address
    const walletRes = await db.query(
      `SELECT wallet_address FROM users WHERE creator_pi_username = $1`,
      [username]
    );

    const wallet = walletRes.rows[0]?.wallet_address;
    if (!wallet || wallet.length < 20) {
      return res.json({ success: false, error: "No valid wallet on file" });
    }

    // fetch tip amount since last payout
    const tipStats = await db.query(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM tips
      WHERE recipient_username = $1
        AND paid = false
    `, [username]);

    const amount = parseFloat(tipStats.rows[0]?.total || 0).toFixed(4);

    if (amount < 3) {
      return res.json({ success: false, error: "Below minimum payout" });
    }

    // insert request
    await db.query(
      `INSERT INTO payout_requests (username, requested_at) VALUES ($1, NOW())`,
      [username]
    );

    // send email to admin
    await sendPayoutRequestEmail(username, wallet, amount);

    res.json({ success: true });
  } catch (err) {
    console.error("🔥 Error in request-manual-payout:", err);
    res.status(500).json({ success: false, error: "Server error" });
  }
});


app.get('/admin/payout-requests', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        pr.id,
        pr.username,
        pr.requested_at,
        (
          SELECT COALESCE(SUM(amount), 0)
          FROM tips
          WHERE recipient_username = pr.username AND paid = false
        ) AS total_requested
      FROM payout_requests pr
      WHERE fulfilled = false
      ORDER BY pr.requested_at ASC
    `);
    res.json({ success: true, requests: result.rows });
  } catch (err) {
    console.error("❌ Error fetching payout requests:", err);
    res.status(500).json({ success: false, error: "DB error" });
  }
});



app.post('/admin/manual-payout', async (req, res) => {
  const { creatorUsername, amount, reason } = req.body;

  if (!creatorUsername || !amount || isNaN(amount)) {
    return res.status(400).json({ success: false, error: "Missing or invalid parameters" });
  }

  try {
    // 🔍 Step 1: Fetch wallet address from `users` table
    const walletRes = await db.query(
      `SELECT wallet_address FROM users WHERE creator_pi_username = $1`,
      [creatorUsername]
    );

    const walletAddress = walletRes.rows[0]?.wallet_address;

    if (!walletAddress || walletAddress.length < 30) {
      return res.status(400).json({
        success: false,
        error: "User has not set a valid wallet address.",
      });
    }

    // 🧮 Step 2: Calculate payout
    const platformFee = parseFloat((amount * 0.10).toFixed(6));
    const payoutAmount = parseFloat((amount - platformFee).toFixed(6));
    
    // 💾 Step 3: Log to payouts table
    const adminUsername = "joeredrog"; // hardcoded for now
    const grossAmount = parseFloat(amount); // the original amount before fee

      await db.query(`
        INSERT INTO payouts (
          creator_username,
          amount,
          amount_paid,
          platform_fee,
          is_manual,
          reason,
          paid_to,
          username,
          status
        )
        VALUES ($1, $2, $3, $4, true, $5, $6, $7, 'completed')
      `, [
        creatorUsername,
        grossAmount,        // amount (original)
        payoutAmount,       // amount_paid (after 10% fee)
        platformFee,
        reason || null,
        walletAddress,
        adminUsername
      ]);


    res.json({
      success: true,
      message: `✅ Manual payout of ${payoutAmount} Pi to ${creatorUsername} logged.`,
      payoutAmount,
      platformFee,
      paidTo: walletAddress
    });

  } catch (err) {
    console.error("🔥 [manual-payout] Error:", err);
    res.status(500).json({ success: false, error: "Database error" });
  }
});


app.get('/admin/payouts', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT id, creator_username, amount_paid, paid_to, txid, payout_date, status, is_manual, reason
      FROM payouts
      ORDER BY payout_date DESC
      LIMIT 100
    `);
    res.json({ success: true, payouts: result.rows });
  } catch (err) {
    console.error("❌ Error fetching payouts:", err);
    res.status(500).json({ success: false, error: 'DB error' });
  }
});

app.patch('/admin/payouts/:id/txid', async (req, res) => {
  const { id } = req.params;
  const { txid } = req.body;

  if (!txid || txid.length < 10) {
    return res.status(400).json({ success: false, error: "Invalid txid" });
  }

  try {
    await db.query(
      `UPDATE payouts SET txid = $1, status = 'fulfilled' WHERE id = $2`,
      [txid, id]
    );

    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error saving txid:", err);
    res.status(500).json({ success: false, error: "Database error" });
  }
});


app.patch('/admin/payout-requests/:username/fulfill', async (req, res) => {
  const { username } = req.params;

  try {
    const result = await db.query(`
      UPDATE payout_requests
      SET fulfilled = true
      WHERE username = $1
      RETURNING *
    `, [username]);

    if (result.rowCount === 0) {
      return res.status(404).json({ success: false, error: "Request not found" });
    }

    res.json({ success: true, fulfilled: result.rows[0] });
  } catch (err) {
    console.error("❌ Error fulfilling payout request:", err);
    res.status(500).json({ success: false, error: "DB error" });
  }
});


app.patch('/admin/payouts/:id/fulfill', async (req, res) => {
  const { id } = req.params;
  try {
    const result = await db.query(
      `UPDATE payouts SET status = 'fulfilled' WHERE id = $1 RETURNING *`,
      [id]
    );
    res.json({ success: true, payout: result.rows[0] });
  } catch (err) {
    console.error("❌ Error marking payout fulfilled:", err);
    res.status(500).json({ success: false, error: 'DB error' });
  }
});


app.post('/report-podcast', async (req, res) => {
  const { podcastId, flagger } = req.body;

  if (!podcastId || !flagger) {
    return res.status(400).json({ success: false, error: "Missing podcast ID or flagger username" });
  }

  try {
    // 👮 Check if this user has already flagged this podcast
    const existingFlag = await db.query(
      `SELECT * FROM flags WHERE podcast_id = $1 AND flagged_by = $2`, // 🔧 fixed column name
      [podcastId, flagger]
    );

    if (existingFlag.rows.length > 0) {
      return res.status(409).json({ success: false, message: "You've already flagged this podcast." });
    }

    // 🪪 Insert new flag
    await db.query(
      `INSERT INTO flags (podcast_id, flagged_by) VALUES ($1, $2)`, // 🔧 fixed column name
      [podcastId, flagger]
    );

    // 🔢 Increment flag count on podcast
    const result = await db.query(`
      UPDATE podcasts
      SET flag_count = flag_count + 1
      WHERE id = $1
      RETURNING flag_count, creator_pi_username
    `, [podcastId]);

    const { flag_count, creator_pi_username } = result.rows[0];

    // 🚫 Hide if >= 5 flags
    if (flag_count >= 5) {
      await db.query(
        `UPDATE podcasts SET hidden_due_to_flags = true WHERE id = $1`,
        [podcastId]
      );

      // 🔍 Count hidden podcasts by creator
      const hiddenResult = await db.query(`
        SELECT COUNT(*) FROM podcasts 
        WHERE creator_pi_username = $1 AND hidden_due_to_flags = true
      `, [creator_pi_username]);

      const hiddenCount = parseInt(hiddenResult.rows[0].count);

      // ❌ Ban creator if 3 or more hidden
      if (hiddenCount >= 3) {
        await db.query(`
          UPDATE podcasts SET creator_banned = true 
          WHERE creator_pi_username = $1
        `, [creator_pi_username]);
      }
    }

    res.json({ success: true, message: "Podcast flagged successfully." });
  } catch (err) {
    console.error("❌ Error flagging podcast:", err);
    res.status(500).json({ success: false, error: "Database error" });
  }
});


app.post("/tip", async (req, res) => {
    console.log("🔥 /tip endpoint hit");
    const { podcastId, tipper, recipient, amount } = req.body;

    console.log("➡️ Incoming Tip Request:");
    console.log("Podcast ID:", podcastId);
    console.log("Tipper:", tipper);
    console.log("Recipient:", recipient);
    console.log("Amount:", amount);

  // Basic validation
  if (!podcastId || !tipper || !recipient || !amount) {
    console.error("❌ Missing required fields");
    return res.status(400).json({ success: false, error: "Missing fields" });
  }

  try {
    const result = await db.query(
      `INSERT INTO tips (podcast_id, tipper_username, recipient_username, sender_username, amount)
       VALUES ($1, $2, $3, $4, $5)`,
      [podcastId, tipper, recipient, tipper, amount] // 👈 Use tipper for sender_username too
    );

    console.log("✅ Tip logged to database!");
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Database error:", err);
    res.status(500).json({ success: false, error: err.message });
  }
});


// 📥 Get all tips for a specific creator
app.get("/tips/:username", async (req, res) => {
  const { username } = req.params;

  if (!username) {
    return res.status(400).json({ success: false, error: "Username is required" });
  }

  try {
    const result = await db.query(
      `SELECT podcast_id, tipper_username, recipient_username, amount, created_at
       FROM tips
       WHERE recipient_username = $1
       ORDER BY created_at DESC`,
      [username]
    );

    res.json({ success: true, tips: result.rows });
  } catch (err) {
    console.error("❌ Error fetching tips:", err);
    res.status(500).json({ success: false, error: "Database error" });
  }
});

app.post('/upload', upload.fields([
  { name: 'file', maxCount: 1 },
  { name: 'screenshot', maxCount: 1 }
]), async (req, res) => {
  if (!req.files || !req.files['file']) {
    return res.status(400).json({ error: 'No audio file uploaded' });
  }

  const audioFile = req.files['file'][0];
  const imageFile = req.files['screenshot']?.[0];
  const rawTags = req.body.tags || "";
  const tagsArray = rawTags
    .split(',')
    .map(t => t.trim())
    .filter(t => t.length > 0); // removes empty strings


  const metadata = {
    title: req.body.title,
    description: req.body.description,
    duration: req.body.duration,
    genre: req.body.genre || null,
    tags: tagsArray,  // ✅ Clean and accurate
    audioUrl: audioFile.location,
    screenshotUrl: imageFile?.location || null,
    uploadedAt: new Date().toISOString(),
    creatorPiUsername: req.body.creator_pi_username || null
  };


  console.log("🎙️ Uploading podcast from:", metadata.creatorPiUsername);

  try {
    const result = await db.query(
      `INSERT INTO podcasts 
        (title, description, duration, genre, tags, audio_url, image_url, creator_pi_username)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        metadata.title,
        metadata.description,
        metadata.duration,
        metadata.genre,
        metadata.tags,               // ✅ now using consistent metadata
        metadata.audioUrl,
        metadata.screenshotUrl,
        metadata.creatorPiUsername
      ]

    );

    console.log("✅ Podcast saved:", result.rows[0]);
    res.status(201).json({ success: true, podcast: result.rows[0] });
  } catch (err) {
    console.error("❌ DB error:", err);
    res.status(500).json({ success: false, error: 'Database error' });
  }
});


app.post('/podcasts', async (req, res) => {
  const { title, description, duration, audio_url, image_url } = req.body;

  if (!title || !audio_url) {
    return res.status(400).json({ success: false, error: 'Missing required fields' });
  }

  try {
    const result = await db.query(
      'INSERT INTO podcasts (title, description, duration, audio_url, image_url) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [title, description, duration, audio_url, image_url]
    );

    res.status(201).json({ success: true, podcast: result.rows[0] });
  } catch (err) {
    console.error("❌ Error inserting podcast:", err);
    res.status(500).json({ success: false, error: 'Database error' });
  }
});

// 🎙️ Get all podcasts uploaded by a specific creator
app.get("/my-podcasts/:username", async (req, res) => {
  const { username } = req.params;

  if (!username) {
    return res.status(400).json({ success: false, error: "Username is required" });
  }

  try {
    const result = await db.query(
      `SELECT * FROM podcasts WHERE creator_pi_username = $1 ORDER BY uploaded_at DESC`,
      [username]
    );
    res.json({ success: true, podcasts: result.rows });
  } catch (err) {
    console.error("❌ Error fetching creator podcasts:", err);
    res.status(500).json({ success: false, error: "Database query failed" });
  }
});

// ✅ Pi login verification
app.post('/verify-login', async (req, res) => {
  try {
    const { user, jwt, signature } = req.body;

    if (!user || !jwt || !signature) {
      return res.status(400).json({ error: 'Missing login data' });
    }

    const signedMessage = JSON.stringify({ user, jwt });

    const publicKey = `
-----BEGIN PUBLIC KEY-----
MFYwEAYHKoZIzj0CAQYFK4EEAAoDQgAEx8cW9u77V5zA+n/2HRtPYONUbPq1gAk9
8fo9x/nn21o=
-----END PUBLIC KEY-----
`;

    const verify = crypto.createVerify('SHA256');
    verify.update(signedMessage);
    verify.end();

    const isValid = verify.verify(publicKey, Buffer.from(signature, 'base64'));

    if (!isValid) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    res.status(200).json({
      success: true,
      username: user.username,
      uid: user.uid,
    });
  } catch (err) {
    console.error('Login verification error:', err);
    res.status(500).json({ error: 'Server error during verification' });
  }
});


// ✅ Payment Approval
app.post('/approve-payment', async (req, res) => {
  const { paymentId } = req.body;

  console.log("📬 [Backend] /approve-payment hit! Incoming payload:", req.body);  // ✅ ADD THIS

  if (!paymentId) {
    console.warn("⚠️ [approve-payment] Missing paymentId");
    return res.status(400).json({ success: false, error: "Missing paymentId" });
  }

  // existing code continues...

  try {
    console.log("🟢 [approve-payment] Approving payment ID:", paymentId);

    const approveRes = await fetch(`https://api.minepi.com/v2/payments/${paymentId}/approve`, {
      method: "POST",
      headers: {
        Authorization: `Key ${process.env.PI_API_KEY}`,
      },
    });

    if (!approveRes.ok) {
      const errorText = await approveRes.text();
      console.error("❌ [approve-payment] Approval failed:", errorText);
      return res.status(500).json({ success: false, error: "Approval failed" });
    }

    console.log("✅ [approve-payment] Payment approved successfully.");
    return res.json({ success: true });

  } catch (err) {
    console.error("🔥 [approve-payment] Error:", err);
    return res.status(500).json({ success: false, error: "Server error during approval" });
  }
});


// ✅ Payment Completion
app.post('/complete-payment', async (req, res) => {
  const { paymentId, txid } = req.body;
  console.log("📥 Complete Payment HIT:", paymentId, txid);

  if (!PI_API_KEY) {
    return res.status(500).json({ success: false, message: "Missing PI_API_KEY" });
  }

  const headers = {
    Authorization: `Key ${PI_API_KEY}`,
    "Content-Type": "application/json",
  };

  try {
    const complete = await fetch(`https://api.minepi.com/v2/payments/${paymentId}/complete`, {
      method: "POST",
      headers,
      body: JSON.stringify({ txid }),
    });

    if (!complete.ok) {
      const errText = await complete.text();
      throw new Error("Pi completion failed: " + errText);
    }

    console.log("✅ Payment completed on Pi Network");
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Error completing payment:", err);
    res.status(500).json({ success: false, message: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`🌍 Vocalcast server running on port ${PORT}`);
});
