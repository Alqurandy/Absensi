// ============================================================
//  WEB PUSH FAN-OUT  ->  POST /api/notify
//  Kirim notifikasi Web Push (luar aplikasi) ke subscriber.
//  Body JSON:
//   { title, body, url?, tag?, onlyNims?:[], excludeNims?:[] }
//  Env (set di Vercel):
//   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:...)
//   SUPABASE_URL, SUPABASE_ANON_KEY
// ============================================================

const webpush = require("web-push");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://fktjvxjerdjcwyzahgdq.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:hub@deenamic.app";

function cfgVapid() {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) throw new Error("VAPID key belum di-set di Vercel (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY)");
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}

async function sbFetch(path, opts) {
  if (!SUPABASE_KEY) throw new Error("SUPABASE_ANON_KEY belum di-set di Vercel");
  const r = await fetch(SUPABASE_URL + "/rest/v1/" + path, {
    ...opts,
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": "Bearer " + SUPABASE_KEY,
      "Content-Type": "application/json",
      ...(opts && opts.headers ? opts.headers : {})
    }
  });
  const txt = await r.text();
  let j = null; try { j = txt ? JSON.parse(txt) : null; } catch (_) { j = txt; }
  if (!r.ok) throw new Error("Supabase " + r.status + ": " + (j && j.message ? j.message : txt));
  return j;
}

async function getSubs() {
  return (await sbFetch("push_subscriptions?select=*", { method: "GET" })) || [];
}
async function deleteSub(id) {
  try { await sbFetch("push_subscriptions?id=eq." + id, { method: "DELETE" }); } catch (_) {}
}

// Kirim ke daftar subscription tertentu dengan payload sudah jadi.
async function sendTo(subs, payloadObj) {
  const payload = JSON.stringify(payloadObj);
  let sent = 0, gone = 0, failed = 0;
  await Promise.all(subs.map(async s => {
    const sub = { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } };
    try {
      await webpush.sendNotification(sub, payload);
      sent++;
    } catch (e) {
      const code = e && e.statusCode;
      if (code === 404 || code === 410) { gone++; await deleteSub(s.id); }
      else failed++;
    }
  }));
  return { sent, gone, failed };
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method === "GET") return res.status(200).json({ ok: true, pesan: "Endpoint notify hidup. Gunakan POST." });
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Gunakan POST" });
  try {
    cfgVapid();
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    if (!body || !body.title) return res.status(400).json({ ok: false, error: "title wajib" });

    let subs = await getSubs();
    const only = Array.isArray(body.onlyNims) ? body.onlyNims.map(String) : null;
    const excl = Array.isArray(body.excludeNims) ? body.excludeNims.map(String) : [];
    if (only) subs = subs.filter(s => only.includes(String(s.nim)));
    if (excl.length) subs = subs.filter(s => !excl.includes(String(s.nim)));

    const payloadObj = {
      title: body.title,
      body: body.body || "",
      url: body.url || "/",
      tag: body.tag || ("hub-" + Date.now())
    };
    const hasil = await sendTo(subs, payloadObj);
    return res.status(200).json({ ok: true, target: subs.length, hasil });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
