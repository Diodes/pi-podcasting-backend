const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

// Basic test route
app.get('/', (req, res) => {
  res.send('Pi Podcasting Backend is running 🚀');
});

// Pi login verification
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

// Payment approval
app.post('/approve-payment', async (req, res) => {
  const { paymentId } = req.body;
  console.log(`✅ Received request to approve payment: ${paymentId}`);
  res.status(200).json({ success: true });
});

// Payment completion
app.post('/complete-payment', async (req, res) => {
  const { paymentId, txid } = req.body;
  console.log(`✅ Completing payment ${paymentId} with txid: ${txid}`);
  res.status(200).json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Server is listening on port ${PORT}`);
});

