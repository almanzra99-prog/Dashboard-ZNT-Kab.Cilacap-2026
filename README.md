# 🗺️ DASHBOARD ZNT KABUPATEN CILACAP 2026
**Dashboard Pemantauan Progres Survei, Capaian Titik Sampel & Analisis Spasial NOZN**

---

## 🚀 Cara Menjalankan Dashboard

1. **Jalankan Dashboard**:
   - Klik ganda (double-click) **`JALANKAN_DASHBOARD.bat`**.
   - Browser Anda (**Google Chrome / Microsoft Edge**) akan langsung terbuka otomatis di `http://localhost:8080/`.

---

## 📍 Hasil Spatial Join (Penarikan Koordinat ke Field NOZN)

Dari file survei `Data-Survey_Kabupaten Cilacap_...xlsx` yang berisi **1.653 titik survei**:
- **1.652 titik sampel** telah berhasil diidentifikasi posisi koordinatnya dan **dicocokkan secara spasial ke dalam poligon zona ZNT masing-masing**!
- File hasil Spatial Join telah disimpan di:
  - 📄 **`data/titik_sampel_with_nozn.csv`** (Dapat dibuka langsung di Microsoft Excel, lengkap dengan kolom `NOZN`, `HISTZONE`, `LUAS_ZONA_HA`, `TARGET_SAMPEL_ZONA`, dan `STATUS_ZONA`).
  - 🗺️ **`data/titik_sampel_with_nozn.geojson`** (Layer spasial titik untuk peta).

---

## 📊 Ringkasan Capaian Titik & Warna Wilayah per Surveyor

Setiap surveyor memiliki warna identitas resmi pada poligon zona dan titik sampel di peta:

| Nama Surveyor | Warna Identitas | Jumlah Zona | Titik Terkumpul | Capaian Aktual (Maks) |
| :--- | :---: | :---: | :---: | :---: |
| **Rizki Illahi** | 🟢 Emerald Green (`#10b981`) | **146 zona** | 348 titik | 303 / 448 pt (67,6%) |
| **Siti Delia Maryani** | 🟠 Amber Orange (`#f59e0b`) | **147 zona** | 332 titik | 290 / 454 pt (63,9%) |
| **Adzila Fauziah** | 🌸 Fuchsia Pink (`#ec4899`) | **148 zona** | 286 titik | 240 / 454 pt (52,9%) |
| **Rachmad Febrian Eja** | 🔵 Sky Blue (`#3b82f6`) | **145 zona** | 351 titik | 285 / 447 pt (63,8%) |
| **Uyat Hidayat** | 🟣 Violet Purple (`#8b5cf6`) | **146 zona** | 336 titik | 281 / 452 pt (62,2%) |
| **TOTAL** | — | **732 ZONA** | **1.653 titik** | **1.399 / 2.255 pt (62,0%)** |

### 🎨 Fitur Toggle Mode Pewarnaan Peta
Tersedia tombol palet warna (`🎨`) pada toolbar atas peta dan kartu legenda:
1. **Mode per Surveyor (Default)**:
   - Poligon diwarnai sesuai warna penanggung jawab surveyor masing-masing.
   - **Gradasi Opasitas**:
     - 🟩 **Pekat (Opasitas 65%)**: Target zona telah selesai terpenuhi ($\ge 3$ pt).
     - 🟨 **Sedang (Opasitas 38%)**: Sedang proses survei (1–2 pt).
     - ⬜ **Tipis (Opasitas 16%)**: Belum ada titik sampel diambil (0 pt).
2. **Mode Status Capaian**:
   - 🟢 **Hijau**: Target Selesai
   - 🟡 **Kuning**: Sedang Berjalan (Kurang Sampel)
   - 🔴 **Merah**: Belum Ada Sampel (0 Titik)

---

## 🎯 Logika Target Dinamis & Capaian Aktual
- **Aturan Luasan Zona**:
  - $< 900\text{ Ha}$: **3 Titik Sampel**
  - $900 - 1.250\text{ Ha}$: **4 Titik Sampel**
  - $\ge 1.250\text{ Ha}$: **5 Titik Sampel**
- **Logika Capped Aktual**: Kelebihan titik sampel di zona tertentu tidak dapat menutupi zona lain yang belum disurvei, sehingga capaian dihitung murni berdasarkan pemenuhan aktual di lapangan.

---

## 🔄 Cara Memperbarui Data di Masa Mendatang
Jika surveyor menambahkan titik-titik baru ke file Excel survei:
1. Simpan file Excel terbaru ke dalam folder `datazona_znt.geojson\`.
2. Klik ganda **`UPDATE_DATA_EXCEL.bat`**.
3. Sistem akan otomatis melakukan spatial join ulang dan memperbarui data dashboard!
