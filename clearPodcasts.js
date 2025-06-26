require('dotenv').config(); // ✅ Load environment variables
const db = require('./db'); // Adjust if your DB pool is in a different file

async function clearPodcasts() {
  try {
    const result = await db.query("DELETE FROM podcasts");
    console.log("✅ All podcast records deleted.");
  } catch (err) {
    console.error("❌ Error deleting podcasts:", err);
  } finally {
    process.exit();
  }
}

clearPodcasts();
