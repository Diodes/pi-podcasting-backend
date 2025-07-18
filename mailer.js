const nodemailer = require("nodemailer");
require("dotenv").config();

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.NOTIFY_EMAIL,
    pass: process.env.NOTIFY_PASS,
  },
});

async function sendPayoutRequestEmail(username, wallet, amount) {
  const mailOptions = {
    from: process.env.NOTIFY_EMAIL,
    to: process.env.NOTIFY_TO,
    subject: `📬 Payout Request from ${username}`,
    text: `
      🔔 A user has requested a payout.

      👤 Username: ${username}
      💰 Amount: ${amount} Pi
      🪙 Wallet Address: ${wallet}

      Please review and process this payout from the admin dashboard.
    `
  };

  try {
    await transporter.sendMail(mailOptions);
    console.log("✅ Payout request email sent.");
  } catch (err) {
    console.error("❌ Error sending payout request email:", err);
  }
}

module.exports = { sendPayoutRequestEmail };
