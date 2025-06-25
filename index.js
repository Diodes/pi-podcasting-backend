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

app.use(cors({
  origin: [
    'https://vocal-nasturtium-3ab892.netlify.app',
    'https://pi://vocalcast',
    'https://vocalcast.minepi.com'
  ],
}));

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

app.post("/tip", async (req, res) => {
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
      "INSERT INTO tips (podcast_id, tipper_username, recipient_username, amount) VALUES ($1, $2, $3, $4)",
      [podcastId, tipper, recipient, amount]
    );

    console.log("✅ Tip logged to database!");
    res.json({ success: true });
  } catch (err) {
    console.error("❌ Database error:", err);
    res.status(500).json({ success: false, error: err.message });
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

  const metadata = {
    title: req.body.title,
    description: req.body.description,
    duration: req.body.duration,
    audioUrl: audioFile.location,
    screenshotUrl: imageFile?.location || null,
    uploadedAt: new Date().toISOString(),
    creatorPiUsername: req.body.creator_pi_username || null
  };

  console.log("🎙️ Uploading podcast from:", metadata.creatorPiUsername);

  try {
    const result = await db.query(
      'INSERT INTO podcasts (title, description, duration, audio_url, image_url, creator_pi_username) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *',
      [
        metadata.title,
        metadata.description,
        metadata.duration,
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


// ✅ Pi login verification
app.post('/verify-login', async (req, res) => {
  try {
    const { user, jwt, signature } = req.body;

    if (!user || !jwt || !signature) {
      return res.status(400).json({ error: 'Missing login data' });
    }

    const signedMessage = JSON.stringify({ user, jwt });
    const publicKey = '302a300506032b6570032100c7c716f5e3bbf579cc0fa7ff61d1b4f60e3546cfab580093df1fa3dc7f9ef6d6';

    const verify = crypto.createVerify('SHA256');
    verify.update(signedMessage);
    verify.end();

    const isValid = verify.verify(
      Buffer.from(publicKey, 'hex'),
      Buffer.from(signature, 'base64')
    );

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
