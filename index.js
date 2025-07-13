const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const dotenv = require('dotenv');
dotenv.config(); // ✅ load .env FIRST
const fetch = require('node-fetch');
const multer = require('multer');
const multerS3 = require('multer-s3');
const db = require('./db'); // ✅ use this instead of redefining a new pool
const [logMessage, setLogMessage] = useState("");


const app = express();
const PORT = process.env.PORT || 5000;

const PI_API_KEY = process.env.PI_API_KEY;
if (!PI_API_KEY) {
  console.warn("⚠️ WARNING: PI_API_KEY not set in .env");
}

app.use(cors({
  origin: [
    'https://pivocalcast.com',
    'https://pi://vocalcast',
    'https://vocalcast.minepi.com'
  ],
}));

/*// At top of your app (temporary test route)
app.get("/test-uid/:uid", async (req, res) => {
  const { uid } = req.params;

  try {
    const piRes = await fetch(`https://api.minepi.com/v2/users/${uid}`, {
      headers: {
        Authorization: `Key ${process.env.PI_API_KEY}`
      }
    });

    const data = await piRes.json();
    return res.json({ status: piRes.status, data });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
});
*/

app.use(express.json());

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

app.post('/request-payout', async (req, res) => {
  const { creatorUsername, uid } = req.body;

  if (!creatorUsername || !uid) {
    console.warn("⚠️ [request-payout] Missing creatorUsername or uid:", req.body);
    return res.status(400).json({
      success: false,
      error: "creatorUsername and uid are required for payout",
    });
  }

  try {
    console.log(`🔍 [request-payout] Received payout request for: ${creatorUsername} (UID: ${uid})`);

    // 1. Fetch total unpaid tips
    const tipsRes = await db.query(`
      SELECT SUM(amount) AS total
      FROM tips
      WHERE recipient_username = $1 AND paid = false
    `, [creatorUsername]);

    const totalTips = parseFloat(tipsRes.rows[0].total || 0);
    console.log(`💰 [request-payout] Total unpaid tips for ${creatorUsername}: ${totalTips} Pi`);

    if (totalTips < 3) {
      console.warn(`🚫 [request-payout] Insufficient tip balance: ${totalTips} Pi`);
      return res.status(403).json({
        success: false,
        error: `Minimum payout is 3 Pi. You have ${totalTips.toFixed(4)} Pi.`,
      });
    }

    // 2. Calculate payout and fee
    const platformFee = parseFloat((totalTips * 0.10).toFixed(6));
    const payoutAmount = parseFloat((totalTips - platformFee).toFixed(6));
    console.log(`💸 [request-payout] Payout: ${payoutAmount} Pi | Fee: ${platformFee} Pi`);

    // 3. Initiate payment with Pi API
    console.log(`📤 [request-payout] Sending payment initiation request...`);
    const paymentInitRes = await fetch("https://api.minepi.com/v2/payments", {
      method: "POST",
      headers: {
        Authorization: `Key ${process.env.PI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: payoutAmount.toFixed(4),
        memo: `Payout to ${creatorUsername} from Vocalcast`,
        metadata: { type: "creator_payout", creatorUsername },
        recipient_uid: uid,
      }),
    });

    const paymentInitData = await paymentInitRes.json();
    console.log("📦 [request-payout] Payment init response:", paymentInitData);

    if (!paymentInitRes.ok) {
      console.error("❌ [request-payout] Pi payment initiation failed:", paymentInitData);
      return res.status(500).json({ success: false, error: "Payment initiation failed" });
    }

    const paymentId = paymentInitData.identifier;
    console.log("✅ [request-payout] Created payment with ID:", paymentId);

    // 4. Approve payment
    console.log("🟢 [request-payout] Approving payment...");
    const approveRes = await fetch(`https://api.minepi.com/v2/payments/${paymentId}/approve`, {
      method: "POST",
      headers: {
        Authorization: `Key ${process.env.PI_API_KEY}`,
      },
    });

    if (!approveRes.ok) {
      const errText = await approveRes.text();
      console.error("❌ [request-payout] Payment approval failed:", errText);
      throw new Error("Approval failed: " + errText);
    }
    console.log("✅ [request-payout] Payment approved.");

    // 5. Complete payment
    console.log("🟢 [request-payout] Completing payment...");
    const txid = `manual_payout_${Date.now()}`;
    const completeRes = await fetch(`https://api.minepi.com/v2/payments/${paymentId}/complete`, {
      method: "POST",
      headers: {
        Authorization: `Key ${process.env.PI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ txid }),
    });

    if (!completeRes.ok) {
      const errText = await completeRes.text();
      console.error("❌ [request-payout] Payment completion failed:", errText);
      throw new Error("Completion failed: " + errText);
    }
    console.log("✅ [request-payout] Payment completed with txid:", txid);

    // 6. Log payout
    console.log("📝 [request-payout] Logging payout in DB...");
    await db.query(`
      INSERT INTO payouts (creator_username, amount_paid, platform_fee)
      VALUES ($1, $2, $3)
    `, [creatorUsername, payoutAmount, platformFee]);

    // 7. Mark tips as paid
    console.log("✅ [request-payout] Marking all unpaid tips as paid...");
    const updateRes = await db.query(`
      UPDATE tips
      SET paid = true
      WHERE recipient_username = $1 AND paid = false
    `, [creatorUsername]);

    console.log(`🎉 [request-payout] Payout finished. Updated ${updateRes.rowCount} tips.`);

    return res.json({
      success: true,
      payoutAmount,
      platformFee,
      totalTips,
      message: `✅ Sent ${payoutAmount} Pi to ${creatorUsername}. 10% fee retained.`,
    });

  } catch (err) {
    console.error("🔥 [request-payout] Uncaught error during payout:", err);
    res.status(500).json({ success: false, error: err.message });
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
  console.log("📥 Approve Payment HIT:", paymentId);

  if (!PI_API_KEY) {
    return res.status(500).json({ success: false, message: "Missing PI_API_KEY" });
  }

  const headers = {
    Authorization: `Key ${PI_API_KEY}`,
    "Content-Type": "application/json",
  };

  try {
    const fetchPayment = await fetch(`https://api.minepi.com/v2/payments/${paymentId}`, {
      method: "GET",
      headers,
    });

    const payment = await fetchPayment.json();

    if (!payment.status.developer_approved && !payment.status.cancelled) {
      const approve = await fetch(`https://api.minepi.com/v2/payments/${paymentId}/approve`, {
        method: "POST",
        headers,
      });

      if (!approve.ok) {
        const errText = await approve.text();
        throw new Error("Pi approval failed: " + errText);
      }

      console.log("✅ Payment approved on Pi Network");
      res.json({ success: true });
    } else {
      console.log("⚠️ Payment already approved or cancelled");
      res.json({ success: false, message: "Already approved or cancelled" });
    }
  } catch (err) {
    console.error("❌ Error approving payment:", err);
    res.status(500).json({ success: false, message: err.message });
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
