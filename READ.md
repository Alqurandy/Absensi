# Sinkron Absensi Web -> Notion (Deenamic Recap)

Kode ini men-deploy sebuah endpoint `/api/absen` ke Vercel. Web absensimu memanggil
endpoint ini untuk menyalin data kehadiran ke tabel Absensi di Notion. **Satu arah: web -> Notion.**

## Isi folder
- `config.js`      — daftar UUID data source (mahasiswa + tiap mata kuliah). UUID sudah terisi.
- `notionSync.js`  — logika sinkron: cari mahasiswa, anti-duplikat, tulis/perbarui baris.
- `api/absen.js`   — endpoint serverless Vercel (POST).

## Langkah deploy (sekali saja, ~10 menit)

### 1. Buat Integration Token Notion
1. Buka https://www.notion.so/profile/integrations → **New integration**.
2. Beri nama (mis. `Absensi Sync`), pilih workspace-mu, **Submit**.
3. Salin **Internal Integration Secret** (mulai `ntn_...` / `secret_...`).
4. Buka hub **Deenamic Recap** di Notion → menu ··· → **Connections** → tambahkan integration `Absensi Sync`.
   (Wajib, agar integration boleh menulis ke tabel-tabel di dalamnya.)

### 2. Upload ke GitHub
1. Buat repo baru (mis. `absensi-notion-sync`).
2. Upload isi folder `notion-sync/` ini (file `config.js`, `notionSync.js`, folder `api/`, README).

### 3. Deploy di Vercel
1. Buka https://vercel.com → login → **Add New → Project** → import repo tadi.
2. Sebelum **Deploy**, buka **Environment Variables**, tambahkan:
   - Name: `NOTION_TOKEN`
   - Value: token `ntn_...` dari langkah 1.
3. Klik **Deploy**. Setelah selesai kamu dapat URL, mis. `https://absensi-notion-sync.vercel.app`.
4. Endpoint kamu = URL itu + `/api/absen`
   → `https://absensi-notion-sync.vercel.app/api/absen`

### 4. Sambungkan ke web absensi
Buka `index-supabase.html`, cari baris:
```js
const NOTION_SYNC_URL = "";
```
isi dengan endpoint tadi:
```js
const NOTION_SYNC_URL = "https://absensi-notion-sync.vercel.app/api/absen";
```
Simpan. Sekarang tombol **"Kirim ke Notion"** di menu Ekspor akan mengirim rekap sesi ke Deenamic Recap.

## Catatan
- Status **Terlambat** dari web dipetakan ke **Hadir** di Notion + catatan "Terlambat" di kolom Keterangan
  (karena opsi Status Kehadiran di Notion hanya Hadir/Izin/Sakit/Alfa).
- Anti-duplikat: jika baris Absensi untuk mahasiswa + tanggal yang sama sudah ada, baris itu **diperbarui**, bukan dibuat ganda.
- Pencocokan mahasiswa memakai **nama** (judul di Daftar Mahasiswa). Pastikan ejaan nama di web sama dengan di Notion.

## Untuk otomatis 24 jam
Endpoint ini aktif 24 jam setelah deploy. Tombol "Kirim ke Notion" dipicu manual oleh pengurus.
Kalau mau benar-benar otomatis tiap ada absensi masuk, langkah lanjut: panggil endpoint ini dari
Supabase Database Webhook / Edge Function saat ada baris baru di tabel `absensi` (opsional, bisa dibantu nanti).
