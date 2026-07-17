// ============================================================
//  ENDPOINT SINKRON TUGAS/PRESENTASI -> NOTION
//  POST /api/tugas  { matkul, tugas:[...] }  -> tabel 'Tugas' di halaman matkul terkait
//  Token via env NOTION_TOKEN. Integrasi 'Absensi Sync' harus Connect ke Deenamic Recap.
// ============================================================

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_VERSION = "2025-09-03";
const API = "https://api.notion.com/v1";

// Nama matkul di web -> judul halaman matkul di Notion.
const MATKUL_TO_PAGE = {
  "Ushul Fiqh":                    "Ushul Fiqh",
  "Filsafat Pendidikan Islam":     "Filsafat",
  "Sejarah Pendidikan Islam":      "Sejarah Pendidikan Islam",
  "Qowaidul Fiqih":                "Qowaidul Fiqih",
  "Teori Belajar & Pembelajaran":  "Teori Belajar",
  "Psikologi Belajar":             "Psikologi Belajar",
  "Pengembangan Kurikulum PAI":    "Pengembangan Kurikulum PAI",
  "Pengembangan Profesi Keguruan": "Pengembangan Profesi Keguruan",
  "English For Spesific Purpose":  "English"
};

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

// Cari pageId halaman matkul dari judulnya (via /search).
async function matkulPageId(matkul) {
  const title = MATKUL_TO_PAGE[matkul] || matkul;
  const res = await notion(`/search`, "POST", { query: title, filter: { property: "object", value: "page" }, page_size: 50 });
  const norm = x => (x || "").toLowerCase().trim();
  let exact = null, incl = null;
  for (const r of (res.results || [])) {
    const tp = Object.values(r.properties || {}).find(p => p.type === "title");
    const t = ((tp && tp.title) || []).map(x => x.plain_text).join("");
    if (norm(t) === norm(title)) { exact = r; break; }
    if (!incl && norm(t).includes(norm(title))) incl = r;
  }
  const pg = exact || incl;
  if (!pg) throw new Error("Halaman matkul '" + title + "' tak ditemukan (cek koneksi integrasi).");
  return pg.id;
}

// data_source_id tabel 'Tugas' di dalam halaman matkul.
const _tCache = {};
async function tugasDsId(matkul) {
  if (_tCache[matkul]) return _tCache[matkul];
  const pageId = await matkulPageId(matkul);
  let cursor, blk = null;
  do {
    const qs = cursor ? `?page_size=100&start_cursor=${cursor}` : `?page_size=100`;
    const res = await notion(`/blocks/${pageId}/children${qs}`, "GET");
    blk = (res.results || []).find(b => b.type === "child_database" && /tugas/i.test((b.child_database && b.child_database.title) || ""));
    cursor = (!blk && res.has_more) ? res.next_cursor : null;
  } while (cursor && !blk);
  if (!blk) throw new Error("Tabel 'Tugas' tak ditemukan di halaman " + matkul + ".");
  const tdb = await notion(`/databases/${blk.id}`, "GET");
  if (!tdb.data_sources || !tdb.data_sources.length) throw new Error("Tabel 'Tugas' tanpa data source.");
  _tCache[matkul] = tdb.data_sources[0].id;
  return _tCache[matkul];
}

async function petaJudul(dsId) {
  const map = {};
  let cursor;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const res = await notion(`/data_sources/${dsId}/query`, "POST", body);
    for (const pg of res.results) {
      const tp = Object.values(pg.properties).find(p => p.type === "title");
      const nm = ((tp && tp.title) || []).map(t => t.plain_text).join("").trim().toLowerCase();
      if (nm) map[nm] = pg.id;
    }
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);
  return map;
}

async function syncTugas(matkul, tugas) {
  const dsId = await tugasDsId(matkul);
  const peta = await petaJudul(dsId);
  const hasil = { matkul, dibuat: 0, diperbarui: 0, gagal: [] };
  for (const t of tugas) {
    try {
      const props = { "Nama Tugas": { title: [{ text: { content: t.nama_tugas || "Tugas" } }] } };
      if (t.jenis) props["Jenis Tugas"] = { select: { name: t.jenis } };
      if (t.nomor_kelompok !== null && t.nomor_kelompok !== undefined && t.nomor_kelompok !== "")
        props["Nomor Kelompok"] = { select: { name: String(t.nomor_kelompok) } };
      if (Array.isArray(t.anggota) && t.anggota.length)
        props["Anggota Kelompok"] = { multi_select: t.anggota.map(n => ({ name: n })) };
      if (t.tanggal_presentasi) props["Tanggal Presentasi"] = { date: { start: t.tanggal_presentasi } };
      if (t.deadline) props["Deadline"] = { date: { start: t.deadline } };
      if (t.keterangan) props["Keterangan"] = { rich_text: [{ text: { content: t.keterangan } }] };
      if (t.status) props["Status Pengumpulan"] = { status: { name: t.status } };
      if (t.file_url) props["File Pengiriman"] = { files: [{ type: "external", name: (t.file_nama || "Materi"), external: { url: t.file_url } }] };
      const key = (t.nama_tugas || "").trim().toLowerCase();
      const ex = key && peta[key];
      if (ex) {
        await notion(`/pages/${ex}`, "PATCH", { properties: props });
        hasil.diperbarui++;
      } else {
        await notion(`/pages`, "POST", { parent: { type: "data_source_id", data_source_id: dsId }, properties: props });
        hasil.dibuat++;
      }
    } catch (e) {
      hasil.gagal.push((t.nama_tugas || "?") + ": " + e.message);
    }
  }
  return hasil;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method === "GET") return res.status(200).json({ ok: true, pesan: "Endpoint tugas hidup. Gunakan POST." });
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Gunakan POST" });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    if (!NOTION_TOKEN) return res.status(500).json({ ok: false, error: "NOTION_TOKEN belum di-set di Vercel" });
    if (!body || !body.matkul || !Array.isArray(body.tugas)) return res.status(400).json({ ok: false, error: "Payload tidak valid" });
    const hasil = await syncTugas(body.matkul, body.tugas);
    return res.status(200).json({ ok: true, hasil });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
