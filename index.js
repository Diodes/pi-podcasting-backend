const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const dotenv = require('dotenv');
const fetch = require('node-fetch');
const multer = require('multer');
//const AWS = require('aws-sdk');
const multerS3 = require('multer-s3');

dotenv.config();

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
  'https://vocalcast.minepi.com' // optional if you publish to Pi Browser mainnet
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
    key: function (req, file, cb) {
      const timestamp = Date.now();
      const cleanName = file.originalname
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-zA-Z0-9._-]/g, "_");

      cb(null, `uploads/${timestamp}-${cleanName}`);
    }
  })
});



// ✅ Root
app.get('/', (req, res) => {
  res.send('🎙️ Vocalcast Backend is running 🚀');
});

// ✅ Upload Route
app.post('/upload', upload.single('file'), (req, res) => {
  if (!req.file) {
  return res.status(400).json({ error: 'No file uploaded' });
}


  // ✅ Logging file details for debugging
  console.log("🔍 Incoming file name:", req.file.originalname);
  console.log("📦 File type:", req.file.mimetype);
  console.log("📏 File size:", req.file.size, "bytes");
  console.log("✅ File uploaded to S3:", req.file.location);

  res.status(200).json({
    success: true,
    url: req.file.location
  });
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
