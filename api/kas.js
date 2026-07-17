// ============================================================
//  ENDPOINT SINKRON KAS -> NOTION
//  POST /api/kas  { tipe:"setoran", mingguan:[...] }  -> Kas Kelas (checkbox Minggu 1..16)
//  POST /api/kas  { tipe:"buku", transaksi:[...] }    -> Buku Kas (Transaksi)
//  Token via env NOTION_TOKEN. Integrasi 'Absensi Sync' harus Connect ke Deenamic Recap.
// ============================================================
​
const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_VERSION = "2025-09-03";
const API = "https://api.notion.com/v1";
​
function headers() {
  return {
    "Authorization": "Bearer " + NOTION_TOKEN,
    "Notion-Version": NOTION_VERSION,
    "Content-Type": "application/json"
  };
}
async function notion(path, method, body) {
  const r = await fetch(API + path, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
  const txt = await r.text();
  let j = {}; try { j = txt ? JSON.parse(txt) : {}; } catch (_) { j = { raw: txt }; }
  if (!r.ok) throw new Error("Notion " + r.status + ": " + (j && j.message ? j.message : JSON.stringify(j)));
  return j;
}
​
// Temukan data_source_id sebuah database dari judulnya (via /search).
const _dsCache = {};
async function resolveDsByTitle(title) {
  if (_dsCache[title]) return _dsCache[title];
  const res = await notion(`/search`, "POST", { query: title, filter: { property: "object", value: "database" }, page_size: 50 });
  const norm = x => (x || "").toLowerCase();
  let best = null;
  for (const r of (res.results || [])) {
    const t = ((r.title) || []).map(x => x.plain_text).join("");
    if (norm(t).includes(norm(title))) { best = r; break; }
  }
  if (!best) throw new Error("Database '" + title + "' tak ditemukan. Pastikan integrasi 'Absensi Sync' sudah di-Connect ke Deenamic Recap.");
  const db = await notion(`/databases/${best.id}`, "GET");
  if (!db.data_sources || !db.data_sources.length) throw new Error("Database '" + title + "' tanpa data source.");
  _dsCache[title] = db.data_sources[0].id;
  return _dsCache[title];
}
​
// Peta { nama(lowercase) -> pageId } dari sebuah data source (title = nama).
async function petaTitle(dsId) {
  const map = {};
  let cursor;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const res = await notion(`/data_sources/${dsId}/query`, "POST", body);
    for (const pg of res.results) {
      const tp = Object.values(pg.properties).find(p => p.type === "title");
      const nama = ((tp && tp.title) || []).map(t => t.plain_text).join("").trim().toLowerCase();
      if (nama) map[nama] = pg.id;
    }
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);
  return map;
}
​
async function syncSetoran(mingguan) {
  const dsId = await resolveDsByTitle("Kas Kelas");
  const peta = await petaTitle(dsId);
  const hasil = { dibuat: 0, diperbarui: 0, gagal: [] };
  for (const m of mingguan) {
    try {
      const props = {};
      for (let i = 1; i <= 16; i++) {
        const v = m.minggu && (m.minggu[i] || m.minggu[String(i)]);
        props["Minggu " + i] = { checkbox: !!v };
      }
      const pid = peta[(m.nama || "").trim().toLowerCase()];
      if (pid) {
        await notion(`/pages/${pid}`, "PATCH", { properties: props });
        hasil.diperbarui++;
      } else {
        props["Nama Mahasiswa"] = { title: [{ text: { content: m.nama || "" } }] };
        await notion(`/pages`, "POST", { parent: { type: "data_source_id", data_source_id: dsId }, properties: props });
        hasil.dibuat++;
      }
    } catch (e) {
      hasil.gagal.push((m.nama || "?") + ": " + e.message);
    }
  }
  return hasil;
}
​
async function syncBuku(transaksi) {
  const dsId = await resolveDsByTitle("Buku Kas");
  const hasil = { dibuat: 0, diperbarui: 0, gagal: [] };
  for (const t of transaksi) {
    try {
      const jumlah = Number(t.jumlah) || 0;
      // Dedup: tanggal + jumlah + keterangan sama -> lewati.
      let dup = false;
      if (t.tanggal) {
        const q = await notion(`/data_sources/${dsId}/query`, "POST", { filter: { and: [
          { property: "Tanggal", date: { equals: t.tanggal } },
          { property: "Jumlah (Rp)", number: { equals: jumlah } }
        ] }, page_size: 25 });
        dup = (q.results || []).some(pg => {
          const tp = Object.values(pg.properties).find(p => p.type === "title");
          const ket = ((tp && tp.title) || []).map(x => x.plain_text).join("").trim();
          return ket === (t.keterangan || "").trim();
        });
      }
      if (dup) { hasil.diperbarui++; continue; }
      const props = {
        "Keterangan": { title: [{ text: { content: t.keterangan || t.kategori || "Transaksi" } }] },
        "Jenis": { select: { name: t.jenis || "Pemasukan" } },
        "Jumlah (Rp)": { number: jumlah }
      };
      if (t.tanggal) props["Tanggal"] = { date: { start: t.tanggal } };
      if (t.kategori) props["Kategori"] = { select: { name: t.kategori } };
      await notion(`/pages`, "POST", { parent: { type: "data_source_id", data_source_id: dsId }, properties: props });
      hasil.dibuat++;
    } catch (e) {
      hasil.gagal.push("Transaksi " + (t.tanggal || "") + ": " + e.message);
    }
  }
  return hasil;
}
​
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method === "GET") return res.status(200).json({ ok: true, pesan: "Endpoint kas hidup. Gunakan POST." });
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Gunakan POST" });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    if (!NOTION_TOKEN) return res.status(500).json({ ok: false, error: "NOTION_TOKEN belum di-set di Vercel" });
    if (!body || !body.tipe) return res.status(400).json({ ok: false, error: "Payload tidak valid (tipe kosong)" });
    let hasil;
    if (body.tipe === "setoran" && Array.isArray(body.mingguan)) hasil = await syncSetoran(body.mingguan);
    else if (body.tipe === "buku" && Array.isArray(body.transaksi)) hasil = await syncBuku(body.transaksi);
    else return res.status(400).json({ ok: false, error: "Payload tidak valid" });
    return res.status(200).json({ ok: true, hasil });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
​
