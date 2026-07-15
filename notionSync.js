// ================= SINKRON WEB -> NOTION (satu arah) =================
const cfg = require("./config");

const API = "https://api.notion.com/v1";
function headers() {
  return {
    "Authorization": "Bearer " + cfg.NOTION_TOKEN,
    "Notion-Version": cfg.NOTION_VERSION,
    "Content-Type": "application/json"
  };
}
async function notion(path, method, body) {
  const r = await fetch(API + path, { method, headers: headers(), body: body ? JSON.stringify(body) : undefined });
  const j = await r.json();
  if (!r.ok) throw new Error("Notion " + r.status + ": " + JSON.stringify(j));
  return j;
}

// Ambil peta { nama(lowercase) -> pageId } dari Daftar Mahasiswa (title = nama)
async function petaMahasiswa() {
  const map = {};
  let cursor;
  do {
    const body = { page_size: 100 };
    if (cursor) body.start_cursor = cursor;
    const res = await notion(`/data_sources/${cfg.MAHASISWA_DS}/query`, "POST", body);
    for (const pg of res.results) {
      const titleProp = Object.values(pg.properties).find(p => p.type === "title");
      const nama = (titleProp?.title || []).map(t => t.plain_text).join("").trim().toLowerCase();
      if (nama) map[nama] = pg.id;
    }
    cursor = res.has_more ? res.next_cursor : null;
  } while (cursor);
  return map;
}

// Terlambat -> Hadir + catatan (karena opsi status Notion: Hadir/Izin/Sakit/Alfa)
function mapStatus(status, jam) {
  if (status === "Terlambat") return { status: "Hadir", ket: "Terlambat" + (jam ? " (" + jam + ")" : "") };
  if (["Hadir", "Izin", "Sakit", "Alfa"].includes(status)) return { status, ket: "" };
  return { status: "Alfa", ket: "" };
}
function hariDari(tanggal) {
  const d = new Date(tanggal + "T00:00:00");
  const nama = ["Minggu","Senin","Selasa","Rabu","Kamis","Jumat","Sabtu"][d.getDay()];
  return ["Kamis","Jumat","Sabtu"].includes(nama) ? nama : null; // opsi select terbatas
}

// Cari halaman Absensi yang sudah ada (anti-duplikat): Tanggal sama + Mahasiswa sama
async function cariAbsensi(dsId, pageMhs, tanggal) {
  const body = { filter: { and: [
    { property: "Tanggal", date: { equals: tanggal } },
    { property: "Mahasiswa", relation: { contains: pageMhs } }
  ] }, page_size: 1 };
  const res = await notion(`/data_sources/${dsId}/query`, "POST", body);
  return res.results[0] ? res.results[0].id : null;
}

// Sinkron satu sesi: { matkul, tanggal, judul, absensi:[{nim,nama,status,jam}] }
async function syncSesi(payload) {
  const dsId = cfg.MATKUL_DS[payload.matkul];
  if (!dsId) throw new Error("Mata kuliah tidak dikenal: " + payload.matkul);

  const peta = await petaMahasiswa();
  const hari = hariDari(payload.tanggal);
  const hasil = { dibuat: 0, diperbarui: 0, gagal: [] };

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
        await notion(`/pages`, "POST", {
          parent: { type: "data_source_id", data_source_id: dsId },
          properties: props
        });
        hasil.dibuat++;
      }
    } catch (e) {
      hasil.gagal.push(a.nama + ": " + e.message);
    }
  }
  return hasil;
}

module.exports = { syncSesi };
