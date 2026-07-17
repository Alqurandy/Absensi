// ============================================================
//  ENDPOINT SINKRON ABSENSI -> NOTION  (1 file, self-discovery)
//  Deploy di Vercel bersama index.html (SAME ORIGIN -> tanpa CORS).
//  Endpoint: POST /api/absen  | Token via env NOTION_TOKEN.
// ============================================================

const NOTION_TOKEN = process.env.NOTION_TOKEN;
const NOTION_VERSION = "2025-09-03";
const API = "https://api.notion.com/v1";

// ID awal "Daftar Mahasiswa" (boleh ID database ATAU ID data source -
// kode akan menerjemahkannya otomatis).
const MAHASISWA_ID = "19e02d6ace40451e871dd10b2f303584";

// Nama matkul di web -> nama properti relasi di "Daftar Mahasiswa".
// ID tabel Absensi tiap matkul ditemukan OTOMATIS dari relasi ini.
const MATKUL_TO_REL = {
  "Ushul Fiqh":                    "Absensi Ushul Fiqh",
  "Pengembangan Kurikulum PAI":    "Absensi Kurikulum PAI",
  "Sejarah Pendidikan Islam":      "Absensi Sejarah",
  "Qowaidul Fiqih":                "Absensi Qowaidul Fiqih",
  "Pengembangan Profesi Keguruan": "Absensi Profesi Keguruan",
  "English For Spesific Purpose":  "Absensi English",
  "Filsafat Pendidikan Islam":     "Absensi Filsafat",
  "Teori Belajar & Pembelajaran":  "Absensi Teori Belajar",
  "Psikologi Belajar":             "Absensi Psikologi"
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

// Ambil objek data source "Daftar Mahasiswa", menerima ID database maupun ID data source.
let _mds = null;
async function mahasiswaDS() {
  if (_mds) return _mds;
  try {
    _mds = await notion(`/data_sources/${MAHASISWA_ID}`, "GET");
    return _mds;
  } catch (e1) {
    try {
      const db = await notion(`/databases/${MAHASISWA_ID}`, "GET");
      const list = db.data_sources || [];
      if (list.length) { _mds = await notion(`/data_sources/${list[0].id}`, "GET"); return _mds; }
    } catch (e2) { /* fallthrough */ }
    throw new Error("Tak bisa akses 'Daftar Mahasiswa'. Pastikan integration 'Absensi Sync' sudah di-Connect ke Deenamic Recap (izin), dan ID benar. Detail: " + e1.message);
  }
}

// Temukan data_source_id tabel Absensi matkul dari skema relasi Daftar Mahasiswa.
async function matkulDsId(matkul) {
  const rel = MATKUL_TO_REL[matkul];
  if (!rel) throw new Error("Mata kuliah tidak dikenal: " + matkul);
  const ds = await mahasiswaDS();
  const prop = (ds.properties || {})[rel];
  if (!prop || !prop.relation || !prop.relation.data_source_id)
    throw new Error("Relasi '" + rel + "' tak ditemukan di Daftar Mahasiswa.");
  return prop.relation.data_source_id;
}

// Peta { nama(lowercase) -> pageId } dari Daftar Mahasiswa (title = nama).
async function petaMahasiswa() {
  const ds = await mahasiswaDS();
  const map = {};
  let cursor;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const res = await notion(`/data_sources/${ds.id}/query`, "POST", body);
    for (const pg of res.results) {
      const tp = Object.values(pg.properties).find(p => p.type === "title");
      const nama = ((tp && tp.title) || []).map(t => t.plain_text).join("").trim().toLowerCase();
      if (nama) map[nama] = pg.id;
    }
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);
  return map;
}

function mapStatus(status, jam) {
  if (status === "Terlambat") return { status: "Hadir", ket: "Terlambat" + (jam ? " (" + jam + ")" : "") };
  if (["Hadir", "Izin", "Sakit", "Alfa"].includes(status)) return { status, ket: "" };
  return { status: "Alfa", ket: "" };
}
function hariDari(tanggal) {
  const d = new Date(tanggal + "T00:00:00");
  const nama = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"][d.getDay()];
  return ["Kamis","Jumat","Sabtu"].includes(nama) ? nama : null;
}
async function cariAbsensi(dsId, pageMhs, tanggal) {
  const body = { filter: { and: [
    { property: "Tanggal", date: { equals: tanggal } },
    { property: "Mahasiswa", relation: { contains: pageMhs } }
  ] }, page_size: 1 };
  const res = await notion(`/data_sources/${dsId}/query`, "POST", body);
  return res.results[0] ? res.results[0].id : null;
}

async function syncSesi(payload) {
  const dsId = await matkulDsId(payload.matkul);
  const peta = await petaMahasiswa();
  const hari = hariDari(payload.tanggal);
  const hasil = { matkul: payload.matkul, dibuat: 0, diperbarui: 0, gagal: [] };

  for (const a of payload.absensi) {
    try {
      const pageMhs = peta[(a.nama || "").trim().toLowerCase()];
      if (!pageMhs) { hasil.gagal.push(a.nama + " (tak ada di Daftar Mahasiswa)"); continue; }
      const m = mapStatus(a.status, a.jam);
      const props = {
        "Nama": { title: [{ text: { content: a.nama } }] },
        "Mahasiswa": { relation: [{ id: pageMhs }] },
        "Tanggal": { date: { start: payload.tanggal } },
        "Status Kehadiran": { status: { name: m.status } }
      };
      if (m.ket) props["Keterangan"] = { rich_text: [{ text: { content: m.ket } }] };
      if (hari) props["Hari"] = { select: { name: hari } };

      const existing = await cariAbsensi(dsId, pageMhs, payload.tanggal);
      if (existing) {
        await notion(`/pages/${existing}`, "PATCH", { properties: props });
        hasil.diperbarui++;
      } else {
        await notion(`/pages`, "POST", { parent: { type: "data_source_id", data_source_id: dsId }, properties: props });
        hasil.dibuat++;
      }
    } catch (e) {
      hasil.gagal.push(a.nama + ": " + e.message);
    }
  }
  return hasil;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method === "GET") return res.status(200).json({ ok: true, pesan: "Endpoint hidup. Gunakan POST untuk sinkron." });
  if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Gunakan POST" });
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    if (!body || !body.matkul || !Array.isArray(body.absensi))
      return res.status(400).json({ ok: false, error: "Payload tidak valid" });
    if (!NOTION_TOKEN)
      return res.status(500).json({ ok: false, error: "NOTION_TOKEN belum di-set di Vercel" });
    const hasil = await syncSesi(body);
    return res.status(200).json({ ok: true, hasil });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message });
  }
};
