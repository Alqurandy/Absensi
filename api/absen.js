// Vercel Serverless Function: POST /api/absen
// Menerima data sesi dari web absensi dan menyinkronkannya ke Notion.
const { syncSesi } = require("../notionSync");

module.exports = async (req, res) => {
  // CORS (agar bisa dipanggil dari file HTML / domain lain)
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Gunakan POST" });

  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    if (!body || !body.matkul || !Array.isArray(body.absensi))
      return res.status(400).json({ error: "Payload tidak valid" });

    const hasil = await syncSesi(body);
    return res.status(200).json({ ok: true, hasil });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
