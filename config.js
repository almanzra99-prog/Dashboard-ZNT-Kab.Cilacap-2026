/**
 * =============================================================================
 * KONFIGURASI DASHBOARD ZNT KABUPATEN CILACAP 2026
 * =============================================================================
 */

const CONFIG = {
  // 1. Informasi Proyek
  projectTitle: "DASHBOARD ZNT CILACAP 2026",
  projectSubtitle: "Monitoring Pencapaian Titik Sampel Surveyor - Kab. Cilacap",
  defaultMapCenter: [-7.6500, 109.0500], // Pusat Kabupaten Cilacap
  defaultZoom: 11,

  // 2. Link File Data Survei (Lokal & Online)
  samplePointsGeoJson: "data/titik_sampel_with_nozn.geojson",
  samplePointsCsv: "data/titik_sampel_with_nozn.csv",
  googleSheetsCsvUrl: "",
  autoRefreshIntervalSeconds: 30,

  // 3. Aturan Target Titik Sampel Berdasarkan Luas (dalam Hektar)
  areaTargetRules: {
    bracket1: { maxHa: 900, target: 3 },               // < 900 Ha -> 3 sampel
    bracket2: { minHa: 900, maxHa: 1250, target: 4 },   // 900 - 1250 Ha -> 4 sampel
    bracket3: { minHa: 1250, target: 5 },              // >= 1250 Ha -> 5 sampel
  },

  // 4. File GeoJSON Utama Proyek Cilacap
  geojsonSearchPaths: [
    "data/APL_CILACAP.geojson",
    "datazona_znt.geojson/APL_CILACAP.geojson",
    "APL_CILACAP.geojson",
    "data/ZONA_CILACAP.geojson",
    "datazona_znt.geojson/ZONA_CILACAP.geojson",
    "ZONA_CILACAP.geojson"
  ],

  // 5. Daftar Surveyor Resmi Cilacap (Mencakup variasi penulisan nama di GeoJSON vs Excel)
  surveyors: [
    {
      id: "rizki",
      name: "Rizki Illahi",
      aliases: ["rizki ilahi", "rizki illahi", "rizki", "illahi", "ilahi"],
      color: "#10b981",     // Emerald Green
      accent: "#34d399"
    },
    {
      id: "siti",
      name: "Siti Delia Maryani",
      aliases: ["siti delia maryani", "siti delia", "siti", "delia", "maryani"],
      color: "#f59e0b",     // Amber Orange
      accent: "#fbbf24"
    },
    {
      id: "adzila",
      name: "Adzila Fauziah",
      aliases: ["adzila fauziah", "adzila", "fauziah"],
      color: "#ec4899",     // Pink Fuchsia
      accent: "#f472b6"
    },
    {
      id: "rachmad",
      name: "Rachmad Febrian Eja",
      aliases: ["rachmad febrian eja", "rachmad", "febrian", "eja"],
      color: "#3b82f6",     // Sky Blue
      accent: "#60a5fa"
    },
    {
      id: "uyat",
      name: "Uyat Hidayat",
      aliases: ["uyat hidayat", "uyat", "hidayat"],
      color: "#8b5cf6",     // Violet Purple
      accent: "#a78bfa"
    }
  ]
};
