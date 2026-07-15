// ============================================================
// Konfigurasi Integrasi Notion — OPSI A
// Data absensi web -> tabel "Absensi" per mata kuliah di Deenamic Recap
// ============================================================

module.exports = {
  // Integration Token dari https://www.notion.so/my-integrations
  // JANGAN hardcode di sini untuk produksi. Pakai environment variable.
  NOTION_TOKEN: process.env.NOTION_TOKEN,

  // Versi API Notion yang mendukung Data Sources
  NOTION_VERSION: "2025-09-03",

  // Data source "Daftar Mahasiswa" (master nama + NIM)
  DAFTAR_MAHASISWA_DS: "19e02d6ace40451e871dd10b2f303584",

  // Data source "Absensi" untuk tiap mata kuliah (ID asli dari Deenamic Recap)
  MATKUL_DS: {
    "Ushul Fiqh":                     "8ff8270544d446d5a6444024d4fbb32e",
    "Pengembangan Kurikulum PAI":     "b648d4cc728c47648edbc00b8a3bc4c0",
    "Sejarah Pendidikan Islam":       "51e2d191003a4ae1bd146905fd9ea85c",
    "Qowaidul Fiqih":                 "d850ca260d344f90b9deefec63a70cf9",
    "Pengembangan Profesi Keguruan":  "8d82b0eb8c36400d9c6b038935dad47d",
    "English For Spesific Purpose":    "be6561f1bdea4f518b45923830394d6e",
    "Filsafat Pendidikan Islam":      "8b229292990a4266aa575e5cd7a2d1d5",
    "Teori Belajar & Pembelajaran":   "c1b705484ad843ea885ca1d80775b699",
    "Psikologi Belajar":              "f8c6ba8effea4839b128119fc33c1953"
  }
};
