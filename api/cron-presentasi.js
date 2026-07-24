// ============================================================
//  CRON PENGINGAT PRESENTASI  ->  GET /api/cron-presentasi
//  Dipanggil Vercel Cron:
//    ?slot=evening  (19:00 WIB / 12:00 UTC)  -> kirim H-7 & H-3
//    ?slot=morning  (08:00 WIB / 01:00 UTC)  -> kirim H-1
//  Narasi dibedakan: anggota kelompok (presentator) vs kelas.
//  Anti-dobel: kolom presentasi.reminders_sent text[] (mis. 'h7').
//  Env: sama seperti /api/notify.
// ============================================================

const webpush = require("web-push");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://fktjvxjerdjcwyzahgdq.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY;
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY;
const VAPID_SUBJECT = process.env.VAPID_SUBJECT || "mailto:hub@deenamic.app";
const CRON_SECRET = process.env.CRON_SECRET; // opsional, kalau di-set wajib cocok

function cfgVapid() {
  if (!VAPID_PUBLIC || !VAPID_PRIVATE) throw new Error("VAPID key belum di-set");
  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);
}
async function sbFetch(path, opts) {
  if (!SUPABASE_KEY) throw new Error("SUPABASE_ANON_KEY belum di-set");
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

// Tanggal WIB (UTC+7) dalam bentuk YYYY-MM-DD, plus offset hari.
function wibDateStr(offsetDays) {
  const now = new Date(Date.now() + 7 * 3600 * 1000 + (offsetDays || 0) * 86400000);
  return now.toISOString().slice(0, 10);
}

async function getSubs() {
  return (await sbFetch("push_subscriptions?select=*", { method: "GET" })) || [];
}
async function deleteSub(id) { try { await sbFetch("push_subscriptions?id=eq." + id, { method: "DELETE" }); } catch (_) {} }
async function markSent(id, tags) {
  await sbFetch("presentasi?id=eq." + id, {
    method: "PATCH",
    headers: { "Prefer": "return=minimal" },
    body: JSON.stringify({ reminders_sent: tags })
  });
}

async function sendOne(sub, payloadObj) {
  const s = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
  try { await webpush.sendNotification(s, JSON.stringify(payloadObj)); return "sent"; }
  catch (e) { const c = e && e.statusCode; if (c === 404 || c === 410) { await deleteSub(sub.id); return "gone"; } return "failed"; }
}

function labelHari(tag) { return tag === "h7" ? "7 hari lagi" : tag === "h3" ? "3 hari lagi" : "BESOK"; }

module.exports = async (req, res) => {
  try {
    // Verifikasi Vercel Cron (opsional): header Authorization: Bearer <CRON_SECRET>
    if (CRON_SECRET) {
      const auth = req.headers["authorization"] || "";
      if (auth !== "Bearer " + CRON_SECRET) return res.status(401).json({ ok: false, error: "unauthorized" });
    }
    cfgVapid();
    const slot = (req.query && req.query.slot) || "evening";
    // slot evening -> H-7 & H-3 ; morning -> H-1
    const targets = slot === "morning" ? [["h1", 1]] : [["h7", 7], ["h3", 3]];

    const subs = await getSubs();
    const ringkas = [];

    for (const [tag, off] of targets) {
      const tgl = wibDateStr(off);
      const rows = (await sbFetch("presentasi?select=*&tanggal=eq." + tgl, { method: "GET" })) || [];
      for (const p of rows) {
        const sent = Array.isArray(p.reminders_sent) ? p.reminders_sent : [];
        if (sent.includes(tag)) continue;
        if (p.status === "selesai") continue;
        const anggota = Array.isArray(p.anggota_arr) ? p.anggota_arr : [];
        const kel = (p.nomor_kelompok != null ? ("Kel. " + p.nomor_kelompok + " ") : "");
        const mk = p.matkul || "";
        const jd = p.judul || "";
        let ok = 0;
        for (const sub of subs) {
          const isPresenter = sub.nama && anggota.includes(sub.nama);
          const payload = isPresenter ? {
            title: "🎤 Presentasimu " + labelHari(tag) + "!",
            body: mk + (jd ? (" — " + jd) : "") + ". Siapkan materi & kelompokmu ya! 💪",
            url: "/?menu=presentasi", tag: "pres-" + p.id + "-" + tag
          } : {
            title: "📅 Presentasi " + labelHari(tag),
            body: kel + mk + (jd ? (" — " + jd) : "") + ". Yuk siapkan pertanyaan! 🙌",
            url: "/?menu=presentasi", tag: "pres-" + p.id + "-" + tag
          };
          const r = await sendOne(sub, payload);
          if (r === "sent") ok++;
        }
        await markSent(p.id, sent.concat([tag]));
        ringkas.push({ id: p.id, matkul: mk, tag, tanggal: tgl, terkirim: ok });
      }
    }
    return res.status(200).json({ ok: true, slot, diproses: ringkas.length, ringkas });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
