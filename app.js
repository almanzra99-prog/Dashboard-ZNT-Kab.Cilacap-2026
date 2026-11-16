/**
 * =============================================================================
 * DASHBOARD ZNT CILACAP 2026 - MONITORING PENCAPAIAN TITIK SAMPEL SURVEYOR
 * =============================================================================
 * - Web GIS: Leaflet.js
 * - Charts: Chart.js
 * - Proyeksi: Proj4js (EPSG:23835 TM-3 Zone 49.1 -> WGS84)
 * - Peta Spasial: APL_CILACAP & ZONA_CILACAP (732 Poligon)
 * - Titik Sampel: titik_sampel_with_nozn.geojson (1.652 Titik)
 * - Logika Target Luas: <900 Ha (3 pt) | 900-1250 Ha (4 pt) | >=1250 Ha (5 pt)
 * - Logika Capaian Aktual: Dibatasi maksimal target per zona (min(sampel, target))
 */

// =============================================================================
// 1. PROJ4JS DEFINISI TM-3 ZONE 49.1 INDONESIA
// =============================================================================
if (typeof proj4 !== 'undefined') {
  proj4.defs(
    "EPSG:23835",
    "+proj=tmerc +lat_0=0 +lon_0=109.5 +k=0.9999 +x_0=200000 +y_0=1500000 +ellps=WGS84 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs"
  );
  proj4.defs(
    "EPSG:32749",
    "+proj=utm +zone=49 +south +datum=WGS84 +units=m +no_defs"
  );
}

function reprojectCoords(coords) {
  if (!Array.isArray(coords)) return coords;
  if (typeof coords[0] === 'number') {
    if (Math.abs(coords[0]) > 180 || Math.abs(coords[1]) > 90) {
      if (typeof proj4 !== 'undefined') {
        const p = proj4("EPSG:23835", "WGS84", [coords[0], coords[1]]);
        return [p[0], p[1]];
      }
    }
    return [coords[0], coords[1]];
  }
  return coords.map(reprojectCoords);
}

function normalizeToGeoJson(raw) {
  if (!raw) return null;
  if (raw.features && Array.isArray(raw.features) && raw.features.length > 0) {
    const first = raw.features[0];
    if (first.attributes || (first.geometry && (first.geometry.rings || first.geometry.paths || first.geometry.x !== undefined))) {
      const geoFeatures = [];
      raw.features.forEach(f => {
        const props = f.attributes || f.properties || {};
        let geom = null;
        if (f.geometry) {
          if (f.geometry.rings) {
            geom = { type: "Polygon", coordinates: reprojectCoords(f.geometry.rings) };
          } else if (f.geometry.paths) {
            geom = { type: "MultiLineString", coordinates: reprojectCoords(f.geometry.paths) };
          } else if (f.geometry.x !== undefined && f.geometry.y !== undefined) {
            geom = { type: "Point", coordinates: reprojectCoords([f.geometry.x, f.geometry.y]) };
          } else if (f.geometry.coordinates) {
            geom = { type: f.geometry.type || "Polygon", coordinates: reprojectCoords(f.geometry.coordinates) };
          }
        }
        if (geom) {
          geoFeatures.push({ type: "Feature", properties: props, attributes: props, geometry: geom });
        }
      });
      return { type: "FeatureCollection", features: geoFeatures };
    }
  }

  if (raw.features && Array.isArray(raw.features)) {
    raw.features.forEach(feature => {
      const p = feature.properties || feature.attributes || {};
      feature.properties = p;
      feature.attributes = p;
      if (feature.geometry && feature.geometry.coordinates) {
        feature.geometry.coordinates = reprojectCoords(feature.geometry.coordinates);
      }
    });
  }
  return raw;
}

// =============================================================================
// 2. STATE DATA GLOBAL & NORMALISASI NAMA SURVEYOR
// =============================================================================
let allZoneFeatures = [];         // 732 Poligon Zona
let allSamplePoints = [];         // Titik Sampel
let zonePointsCountMap = {};      // { "337": 3, "335": 3, ... }
let zonePointsDataMap = {};       // { "337": [ 350000, 400000, ... ] }
let polygonLayerGroup = null;
let pointsLayerGroup = null;
let aplLayerGroup = null;
let sampleMarkersMap = {};        // { "1245": marker, "01/2026/0075/1/1245": marker }
let searchPulseMarker = null;     // Marker efek pulsing titik sampel
let searchCoordMarker = null;     // Marker pin lokasi koordinat dicari
let activeFilterSurveyor = 'default';
let colorMode = 'surveyor';       // 'surveyor' (Pewarnaan per Surveyor) atau 'status' (Hijau/Kuning/Merah)

function getCanonicalSurveyorName(rawName) {
  if (!rawName) return "";
  const lower = rawName.toLowerCase().trim();
  if (CONFIG && CONFIG.surveyors) {
    for (const s of CONFIG.surveyors) {
      if (s.name.toLowerCase() === lower || (s.aliases && s.aliases.some(a => lower === a || lower.includes(a) || a.includes(lower)))) {
        return s.name;
      }
    }
  }
  return rawName.trim();
}

function matchSurveyor(name1, name2) {
  if (!name1 || !name2) return false;
  return getCanonicalSurveyorName(name1) === getCanonicalSurveyorName(name2);
}

function getSurveyorColor(name) {
  if (!name) return "#64748b"; // Warna abu netral untuk area tanpa surveyor
  const canon = getCanonicalSurveyorName(name);
  if (CONFIG && CONFIG.surveyors) {
    const s = CONFIG.surveyors.find(item => item.name === canon);
    if (s && s.color) return s.color;
  }
  return "#64748b";
}

// =============================================================================
// 3. LOGIKA TARGET LUASAN ZNT
// =============================================================================
function getTargetForFeature(feature) {
  const p = (feature && feature.properties) ? feature.properties : {};
  let luasHa = null;

  if (p.Luas_Ha !== undefined && !isNaN(parseFloat(p.Luas_Ha))) {
    luasHa = parseFloat(p.Luas_Ha);
  } else if (p.LUAS_HA !== undefined && !isNaN(parseFloat(p.LUAS_HA))) {
    luasHa = parseFloat(p.LUAS_HA);
  } else if (p.Luas_M2 !== undefined && !isNaN(parseFloat(p.Luas_M2))) {
    luasHa = parseFloat(p.Luas_M2) / 10000;
  } else if (p.Shape_Area !== undefined && !isNaN(parseFloat(p.Shape_Area))) {
    luasHa = parseFloat(p.Shape_Area) / 10000;
  }

  if (luasHa === null || isNaN(luasHa)) {
    return { target: 3, luasHa: 0, bracket: '< 900 Ha (Default)' };
  }

  if (luasHa >= 1250) {
    return { target: 5, luasHa: luasHa, bracket: '≥ 1.250 Ha' };
  } else if (luasHa >= 900) {
    return { target: 4, luasHa: luasHa, bracket: '900 - 1.250 Ha' };
  } else {
    return { target: 3, luasHa: luasHa, bracket: '< 900 Ha' };
  }
}

function calculateTargetForFeatures(features) {
  if (!features || features.length === 0) return 0;
  let total = 0;
  features.forEach(f => {
    total += getTargetForFeature(f).target;
  });
  return total;
}

// =============================================================================
// 4. INISIALISASI GRAFIK (CHART.JS)
// =============================================================================
let donutChart = null;
let barChart = null;

function initCharts() {
  const ctxDonut = document.getElementById('donutSampleChart');
  if (ctxDonut) {
    donutChart = new Chart(ctxDonut.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels: ['Capaian Aktual (Maks)', 'Sisa Target'],
        datasets: [{
          data: [1399, 856],
          backgroundColor: ['#10b981', '#1e293b'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '74%',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (context) => ` ${context.label}: ${context.parsed.toLocaleString('id-ID')} Titik`
            }
          }
        }
      }
    });
  }

  const ctxBar = document.getElementById('barDailyChart');
  if (ctxBar) {
    barChart = new Chart(ctxBar.getContext('2d'), {
      type: 'bar',
      data: {
        labels: [],
        datasets: [{
          label: 'Titik Sampel',
          data: [],
          backgroundColor: '#38bdf8',
          borderRadius: 4,
          maxBarThickness: 28,
          barPercentage: 0.6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: '#0f172a',
            titleColor: '#f8fafc',
            bodyColor: '#38bdf8',
            borderColor: 'rgba(255, 255, 255, 0.1)',
            borderWidth: 1,
            displayColors: false,
            callbacks: {
              label: (context) => ` ${context.parsed.y} Titik Sampel`
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: { color: '#94a3b8', font: { size: 9, weight: '600' } }
          },
          y: {
            grid: { color: 'rgba(255, 255, 255, 0.05)' },
            ticks: { color: '#94a3b8', font: { size: 9 }, precision: 0 },
            beginAtZero: true
          }
        }
      }
    });
  }
}

// =============================================================================
// 5. INISIALISASI PETA LEAFLET
// =============================================================================
let map = null;
let currentBasemap = null;
let basemaps = {};

function initLeafletMap() {
  const center = (CONFIG && CONFIG.defaultMapCenter) ? CONFIG.defaultMapCenter : [-7.6500, 109.0500];
  const zoom = (CONFIG && CONFIG.defaultZoom) ? CONFIG.defaultZoom : 11;

  map = L.map('leaflet-map', {
    center: center,
    zoom: zoom,
    zoomControl: false
  });

  L.control.zoom({ position: 'bottomleft' }).addTo(map);

  basemaps = {
    osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; OpenStreetMap'
    }),
    satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      maxZoom: 19,
      attribution: 'Tiles &copy; Esri'
    })
  };

  currentBasemap = basemaps.osm;
  currentBasemap.addTo(map);

  aplLayerGroup = L.layerGroup().addTo(map);
  polygonLayerGroup = L.layerGroup().addTo(map);
  pointsLayerGroup = L.layerGroup().addTo(map);
}

// =============================================================================
// 6. PEMUATAN DATA SPASIAL & TITIK SAMPEL
// =============================================================================
async function loadAllData() {
  console.log("📡 Memuat file GeoJSON poligon & titik sampel...");

  // 1. Muat Titik Sampel terlebih dahulu agar count per NOZN terisi
  await loadSamplePoints();

  // 2. Muat APL dan Poligon Zona ZNT Cilacap
  await loadZonesGeoJson();

  populateSurveyorDropdown();
  refreshDashboard(true);
}

async function loadSamplePoints() {
  const candidatePaths = [
    (CONFIG && CONFIG.samplePointsGeoJson) ? CONFIG.samplePointsGeoJson : "data/titik_sampel_with_nozn.geojson",
    "data/titik_sampel_with_nozn.geojson",
    "titik_sampel_with_nozn.geojson"
  ];

  for (const pointsPath of candidatePaths) {
    try {
      const resp = await fetch(pointsPath, { cache: "no-cache" });
      if (resp.ok) {
        const geojson = await resp.json();
        allSamplePoints = geojson.features || [];
        console.log(`✅ Berhasil memuat ${allSamplePoints.length} titik sampel dari: ${pointsPath}`);

        zonePointsCountMap = {};
        zonePointsDataMap = {};
        allSamplePoints.forEach(pt => {
          const p = pt.properties || pt.attributes || {};
          const nozn = `${p.NOZN}`.trim();
          if (nozn && nozn !== '') {
            zonePointsCountMap[nozn] = (zonePointsCountMap[nozn] || 0) + 1;
            if (!zonePointsDataMap[nozn]) zonePointsDataMap[nozn] = [];
            const val = Number(p.NilaiPerM2) || 0;
            if (val > 0) zonePointsDataMap[nozn].push(val);
          }
        });
        console.log(`📍 Pemetaan titik ke zona selesai: ${Object.keys(zonePointsCountMap).length} zona terisi sampel.`);
        return; // Berhasil muat dari candidate pertama
      }
    } catch (err) {
      console.warn(`Gagal memuat titik dari ${pointsPath}:`, err);
    }
  }
  console.warn("⚠️ Gagal memuat titik_sampel_with_nozn.geojson dari semua lokasi candidate.");
}

async function loadZonesGeoJson() {
  polygonLayerGroup.clearLayers();
  aplLayerGroup.clearLayers();
  allZoneFeatures = [];

  let loadedAPL = false;
  let loadedZones = false;

  const paths = (CONFIG && CONFIG.geojsonSearchPaths) ? CONFIG.geojsonSearchPaths : [];

  for (const path of paths) {
    const isAPL = path.toLowerCase().includes('apl');
    if (isAPL && loadedAPL) continue;
    if (!isAPL && loadedZones) continue;

    try {
      const resp = await fetch(path, { cache: "no-cache" });
      if (resp.ok) {
        let rawData = await resp.json();
        let geojson = normalizeToGeoJson(rawData);
        if (geojson && geojson.features && geojson.features.length > 0) {
          addGeoJsonToMap(geojson, path);
          if (isAPL) {
            loadedAPL = true;
            console.log(`✅ Berhasil memuat APL: ${path} (${geojson.features.length} fitur)`);
          } else {
            loadedZones = true;
            console.log(`✅ Berhasil memuat ZONA: ${path} (${geojson.features.length} fitur)`);
          }
        }
      }
    } catch (e) {
      console.warn(`Gagal memuat: ${path}`, e);
    }
  }
}

function addGeoJsonToMap(geojsonData, filename = '') {
  const isAPL = filename.toLowerCase().includes('apl');
  const features = geojsonData.features || [];

  if (isAPL) {
    const layer = L.geoJSON(geojsonData, {
      style: { color: '#ffffff', weight: 1.5, opacity: 0.85, fill: false }
    });
    aplLayerGroup.addLayer(layer);
  } else {
    allZoneFeatures.push(...features);
  }
}

// =============================================================================
// 7. HELPER QC CERDAS & RENDER POLIGON ZONA PADA PETA
// =============================================================================
function getZoneQcInfo(props, nozn) {
  let statusQc = (props.Status_QC || props.status_qc || '').trim();
  let rataNilai = (props.Rata_Nilai !== undefined && props.Rata_Nilai !== null) ? Number(props.Rata_Nilai) : 0;
  let rsd = (props.RSD_Persen !== undefined && props.RSD_Persen !== null) ? Number(props.RSD_Persen) : null;
  let jmlTitik = (props.Jml_Titik_QC !== undefined && props.Jml_Titik_QC !== null) ? Number(props.Jml_Titik_QC) : 0;

  const pointsInZone = zonePointsCountMap[nozn] || 0;
  const pointValues = zonePointsDataMap[nozn] || [];

  // SMART QC FALLBACK:
  // Jika di file poligon statusnya masih 'Belum Disurvey' atau rataNilai 0,
  // tetapi di lapangan surveyor sudah mengambil titik (misal Zona 145 ada 4 titik):
  if ((!statusQc || statusQc.includes('Belum Disurvey') || rataNilai === 0) && pointsInZone > 0) {
    jmlTitik = pointsInZone;
    if (pointValues.length > 0) {
      const sum = pointValues.reduce((a, b) => a + b, 0);
      rataNilai = sum / pointValues.length;

      if (pointValues.length > 1) {
        const sumSq = pointValues.reduce((acc, v) => acc + Math.pow(v - rataNilai, 2), 0);
        const sd = Math.sqrt(sumSq / (pointValues.length - 1));
        rsd = rataNilai > 0 ? (sd / rataNilai) * 100 : 0;
      } else {
        rsd = 0;
      }
    }

    if (pointsInZone >= 3) {
      if (rsd > 0 && rsd <= 30.0) {
        statusQc = 'Lengkap & Valid';
      } else {
        statusQc = 'Perlu Revisi (RSD)';
      }
    } else {
      statusQc = 'Kurang Lengkap';
    }
  }

  return { statusQc, rataNilai, rsd, jmlTitik };
}

function renderZonesOnMap(zonesToRender, shouldFitBounds = true) {
  polygonLayerGroup.clearLayers();

  const layer = L.geoJSON({ type: "FeatureCollection", features: zonesToRender }, {
    style: function (feature) {
      const props = feature.properties || {};
      const nozn = `${props.NOZN}`.trim();
      const pointsInZone = zonePointsCountMap[nozn] || 0;
      const targetInfo = getTargetForFeature(feature);
      const rawSurv = props.Surveyor || props.Nama || props.SURV || '';
      const survColor = getSurveyorColor(rawSurv);

      if (colorMode === 'surveyor') {
        // MODE 1: PEWARNAAN PER SURVEYOR
        // Warna poligon = warna identitas surveyor penanggung jawab zona
        let fillOpacity = 0.16;
        let weight = 1.1;
        let strokeColor = '#0f172a';
        let dashArray = '3, 3';

        if (pointsInZone >= targetInfo.target) {
          // Target terpenuhi: Warna pekat, border solid
          fillOpacity = 0.65;
          weight = 1.6;
          dashArray = null;
          strokeColor = '#090d16';
        } else if (pointsInZone > 0) {
          // Sedang proses: Warna sedang, border putus-putus
          fillOpacity = 0.38;
          weight = 1.3;
          dashArray = '4, 3';
          strokeColor = '#090d16';
        }

        return {
          color: strokeColor,
          weight: weight,
          opacity: 0.95,
          fillColor: survColor,
          fillOpacity: fillOpacity,
          dashArray: dashArray
        };
      } else if (colorMode === 'qc') {
        // MODE 3: STATUS QUALITY CONTROL (QC SIPENTA)
        const qcInfo = getZoneQcInfo(props, nozn);
        const rawQc = qcInfo.statusQc;
        let fillColor = '#475569'; // Abu-abu gelap (Belum Disurvey / default)
        let fillOpacity = 0.35;
        let weight = 1.1;

        if (rawQc.includes('Lengkap & Valid')) {
          fillColor = '#10b981'; // Hijau: Valid & memenuhi kriteria
          fillOpacity = 0.65;
          weight = 1.4;
        } else if (rawQc.includes('Perlu Revisi')) {
          fillColor = '#f59e0b'; // Oranye/Amber: RSD > 30% atau RSD 0%
          fillOpacity = 0.70;
          weight = 1.5;
        } else if (rawQc.includes('Kurang Lengkap')) {
          fillColor = '#06b6d4'; // Cyan: Kurang titik (tunggu min 3)
          fillOpacity = 0.50;
        }

        return {
          color: '#0f172a',
          weight: weight,
          opacity: 0.9,
          fillColor: fillColor,
          fillOpacity: fillOpacity,
          dashArray: null
        };
      } else {
        // MODE 2: STATUS PEMENUHAN TARGET (HIJAU / KUNING / MERAH)
        let fillColor = '#ef4444'; // Merah (0 titik)
        if (pointsInZone >= targetInfo.target) {
          fillColor = '#10b981'; // Hijau (Target Terpenuhi)
        } else if (pointsInZone > 0) {
          fillColor = '#eab308'; // Kuning (Proses / Belum Penuh)
        }

        return {
          color: '#0f172a',
          weight: 1.2,
          opacity: 0.9,
          fillColor: fillColor,
          fillOpacity: pointsInZone > 0 ? 0.6 : 0.35,
          dashArray: null
        };
      }
    },
    onEachFeature: function (feature, l) {
      const p = feature.properties || {};
      const nozn = `${p.NOZN}`.trim();
      const histZone = p.HISTZONE ? ` (${p.HISTZONE})` : '';
      const zoneId = p.NOZN ? `Zona ${p.NOZN}` : (p.HISTZONE ? `Zona ${p.HISTZONE}` : 'Zona ZNT');
      const targetInfo = getTargetForFeature(feature);
      const pointsInZone = zonePointsCountMap[nozn] || 0;
      const rawSurv = p.Surveyor || p.Nama || p.SURV || '';
      const survName = getCanonicalSurveyorName(rawSurv) || 'Belum Ditentukan';
      const survColor = getSurveyorColor(rawSurv);
      const luasFormatted = targetInfo.luasHa > 0 ? `${targetInfo.luasHa.toFixed(2)} Ha` : '-';

      const effectiveInThisZone = Math.min(pointsInZone, targetInfo.target);

      let statusBadge = `<span class="znt-badge" style="background:#ef4444; color:#fff;">Belum Ada Sampel</span>`;
      if (pointsInZone >= targetInfo.target) {
        const surplusText = pointsInZone > targetInfo.target ? ` (+${pointsInZone - targetInfo.target} surplus)` : '';
        statusBadge = `<span class="znt-badge" style="background:#10b981; color:#fff;">Target Selesai (${targetInfo.target}/${targetInfo.target})${surplusText}</span>`;
      } else if (pointsInZone > 0) {
        statusBadge = `<span class="znt-badge" style="background:#eab308; color:#000;">Kurang ${targetInfo.target - pointsInZone} Sampel</span>`;
      }

      // --- FORMAT ATRIBUT QC (QUALITY CONTROL) SIPENTA ---
      const qcInfo = getZoneQcInfo(p, nozn);
      const rawQc = qcInfo.statusQc;
      let qcBadge = `<span class="znt-badge" style="background:#64748b; color:#fff;">Belum Terdata QC</span>`;
      if (rawQc) {
        if (rawQc.includes('Lengkap & Valid')) {
          qcBadge = `<span class="znt-badge" style="background:#10b981; color:#fff;"><i class="fa-solid fa-circle-check"></i> ${rawQc}</span>`;
        } else if (rawQc.includes('Perlu Revisi')) {
          qcBadge = `<span class="znt-badge" style="background:#f59e0b; color:#000; font-weight:700;"><i class="fa-solid fa-triangle-exclamation"></i> ${rawQc}</span>`;
        } else if (rawQc.includes('Kurang Lengkap')) {
          qcBadge = `<span class="znt-badge" style="background:#06b6d4; color:#fff;"><i class="fa-solid fa-clock-rotate-left"></i> ${rawQc}</span>`;
        } else if (rawQc.includes('Belum Disurvey')) {
          qcBadge = `<span class="znt-badge" style="background:#475569; color:#cbd5e1;"><i class="fa-solid fa-hourglass-start"></i> ${rawQc}</span>`;
        } else {
          qcBadge = `<span class="znt-badge" style="background:#64748b; color:#fff;">${rawQc}</span>`;
        }
      }

      const rataNilaiNum = qcInfo.rataNilai || 0;
      const rataNilaiFormatted = (rataNilaiNum > 0)
        ? `Rp ${Math.round(rataNilaiNum).toLocaleString('id-ID')} / m²`
        : (rataNilaiNum < 0 ? `Rp ${Math.round(rataNilaiNum).toLocaleString('id-ID')} / m² (Perlu Cek)` : '-');

      const rsdNum = qcInfo.rsd;
      let rsdFormatted = '-';
      if (rsdNum !== null && rsdNum > 0) {
        const rsdColor = rsdNum > 30 ? '#f59e0b' : '#10b981';
        rsdFormatted = `<strong style="color:${rsdColor};">${rsdNum.toFixed(2)}%</strong>`;
      } else if (rsdNum === 0 && rawQc && !rawQc.includes('Belum')) {
        rsdFormatted = `<strong style="color:#f59e0b;">0.00% (Revisi)</strong>`;
      }

      l.bindPopup(`
        <div class="znt-popup">
          <div class="znt-popup-header" style="border-left: 4px solid ${survColor};">
            <span class="znt-popup-title">${zoneId}${histZone}</span>
            ${statusBadge}
          </div>
          <div style="margin-top:6px;">
            <div class="znt-popup-row"><span>Surveyor Wilayah:</span> <strong style="color:${survColor}; font-weight:700;">${survName}</strong></div>
            <div class="znt-popup-row"><span>Luasan Zona:</span> <strong>${luasFormatted}</strong></div>
            <div class="znt-popup-row"><span>Kategori Target:</span> <strong>${targetInfo.bracket}</strong></div>
            <div class="znt-popup-row"><span>Target Wajib:</span> <strong style="color:#38bdf8;">${targetInfo.target} Titik Sampel</strong></div>
            <div class="znt-popup-row"><span>Titik di Lapangan:</span> <strong>${pointsInZone} Titik</strong></div>
            <div class="znt-popup-row"><span>Dihitung untuk Target:</span> <strong style="color:${effectiveInThisZone >= targetInfo.target ? '#10b981' : '#eab308'}; font-weight:800;">${effectiveInThisZone} / ${targetInfo.target} Titik</strong></div>
            <div class="znt-popup-row"><span>Penggunaan Tanah:</span> <strong>${p.PENGGUNAAN || 'Umum'}</strong></div>
            <div class="znt-popup-row"><span>Zoning Titik Sampel:</span> <strong style="color:#38bdf8;">${p.Zoning_Sampel && p.Zoning_Sampel !== '-' ? p.Zoning_Sampel : (pointsInZone > 0 ? 'Tercatat' : '-')}</strong></div>

            <!-- HASIL QUALITY CONTROL (SIPENTA) -->
            <div style="margin-top:8px; padding-top:6px; border-top:1px dashed rgba(255,255,255,0.18);">
              <div style="font-size:0.68rem; font-weight:800; color:#38bdf8; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:4px;">
                <i class="fa-solid fa-clipboard-check"></i> Quality Control (SIPENTA)
              </div>
              <div class="znt-popup-row" style="align-items:center;">
                <span>Status QC:</span>
                <div>${qcBadge}</div>
              </div>
              <div class="znt-popup-row"><span>Rata-rata Nilai:</span> <strong style="color:#38bdf8; font-weight:700;">${rataNilaiFormatted}</strong></div>
              <div class="znt-popup-row"><span>RSD / Variasi:</span> <span>${rsdFormatted}</span></div>
            </div>
          </div>
        </div>
      `, { maxWidth: 320 });

      l.on('mouseover', function () {
        this.setStyle({ weight: 2.8, color: '#ffffff', fillOpacity: 0.88 });
      });
      l.on('mouseout', function () {
        if (colorMode === 'surveyor') {
          const fOp = (pointsInZone >= targetInfo.target) ? 0.65 : (pointsInZone > 0 ? 0.38 : 0.16);
          const w = (pointsInZone >= targetInfo.target) ? 1.6 : (pointsInZone > 0 ? 1.3 : 1.1);
          const dash = (pointsInZone >= targetInfo.target) ? null : (pointsInZone > 0 ? '4, 3' : '3, 3');
          this.setStyle({ weight: w, color: '#090d16', fillOpacity: fOp, dashArray: dash });
        } else if (colorMode === 'qc') {
          const qcInfo = getZoneQcInfo(p, nozn);
          const rawQc = qcInfo.statusQc;
          let fOp = 0.35;
          let w = 1.1;
          if (rawQc.includes('Lengkap & Valid')) { fOp = 0.65; w = 1.4; }
          else if (rawQc.includes('Perlu Revisi')) { fOp = 0.70; w = 1.5; }
          else if (rawQc.includes('Kurang Lengkap')) { fOp = 0.50; }
          this.setStyle({ weight: w, color: '#0f172a', fillOpacity: fOp, dashArray: null });
        } else {
          this.setStyle({ weight: 1.2, color: '#0f172a', fillOpacity: pointsInZone > 0 ? 0.6 : 0.35, dashArray: null });
        }
      });
    }
  });

  polygonLayerGroup.addLayer(layer);

  if (shouldFitBounds) {
    try {
      if (zonesToRender.length > 0) {
        map.fitBounds(layer.getBounds(), { padding: [30, 30] });
      }
    } catch (err) { }
  }
}

// =============================================================================
// 8. RENDER TITIK SAMPEL PADA PETA
// =============================================================================
function renderSamplePointsOnMap(pointsToRender) {
  pointsLayerGroup.clearLayers();
  sampleMarkersMap = {};

  pointsToRender.forEach(pt => {
    const coords = (pt.geometry && pt.geometry.coordinates) ? pt.geometry.coordinates : null;
    if (!coords || coords.length < 2) return;

    const lon = coords[0];
    const lat = coords[1];
    const p = pt.properties || {};
    const survColor = getSurveyorColor(p.Surveyor);

    const hargaFormatted = p.Harga && !isNaN(p.Harga) ? `Rp ${Number(p.Harga).toLocaleString('id-ID')}` : '-';
    const nilaiM2Formatted = p.NilaiPerM2 && !isNaN(p.NilaiPerM2) ? `Rp ${Math.round(p.NilaiPerM2).toLocaleString('id-ID')} / m²` : '-';
    const luasFormatted = p.Luas ? `${p.Luas} m²` : '-';

    const marker = L.circleMarker([lat, lon], {
      radius: 4.5,
      fillColor: survColor,
      color: '#ffffff',
      weight: 1.2,
      opacity: 0.95,
      fillOpacity: 0.85
    });

    marker.feature = pt;

    marker.bindPopup(`
      <div class="znt-popup">
        <div class="znt-popup-header" style="border-left: 4px solid ${survColor};">
          <span class="znt-popup-title">Sampel #${p.No || ''}</span>
          <span class="znt-badge" style="background:${survColor}25; color:${survColor}; border:1px solid ${survColor}60;">${p.JenisData || 'Survei'}</span>
        </div>
        <div style="margin-top:6px;">
          <div class="znt-popup-row"><span>Zona ZNT Terkait:</span> <strong style="color:#38bdf8;">Zona ${p.NOZN || '-'} (${p.HISTZONE || '-'})</strong></div>
          <div class="znt-popup-row"><span>Zoning / Peruntukan:</span> <strong style="color:#38bdf8;">${p.Zoning || p.ZoningKode || '-'}</strong></div>
          <div class="znt-popup-row"><span>Objek Fisik:</span> <strong>${p.GunaObjek || '-'}</strong></div>
          <div class="znt-popup-row"><span>Surveyor:</span> <strong>${getCanonicalSurveyorName(p.Surveyor)}</strong></div>
          <div class="znt-popup-row"><span>Tgl Survei:</span> <strong>${p.Tgl || '-'}</strong></div>
          <div class="znt-popup-row"><span>Alamat:</span> <strong>${p.Alamat || '-'}</strong></div>
          <div class="znt-popup-row"><span>Kel / Kec:</span> <strong>${p.Kelurahan || ''}, ${p.Kecamatan || ''}</strong></div>
          <div class="znt-popup-row"><span>Harga Objek:</span> <strong>${hargaFormatted}</strong></div>
          <div class="znt-popup-row"><span>Luas Tanah:</span> <strong>${luasFormatted}</strong></div>
          <div class="znt-popup-row"><span>Nilai Tanah/m²:</span> <strong style="color:#fcd34d;">${nilaiM2Formatted}</strong></div>
        </div>
      </div>
    `);

    // Catat referensi marker untuk pencarian instan
    if (p.No !== undefined && p.No !== null && `${p.No}`.trim() !== '') {
      sampleMarkersMap[`${p.No}`.trim()] = marker;
    }
    if (p.Id && `${p.Id}`.trim() !== '') {
      sampleMarkersMap[`${p.Id}`.trim().toLowerCase()] = marker;
    }

    pointsLayerGroup.addLayer(marker);
  });
}

// =============================================================================
// 9. LOGIKA FILTER & UPDATE DASHBOARD (LOGIKA CAPPED AKTUAL)
// =============================================================================
function populateSurveyorDropdown() {
  const select = document.getElementById('sort-surveyor');
  if (!select) return;
  const currVal = select.value;

  select.innerHTML = '<option value="default">Semua Surveyor</option>';
  if (CONFIG && CONFIG.surveyors) {
    CONFIG.surveyors.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.name;
      opt.textContent = s.name;
      select.appendChild(opt);
    });
  }

  if (currVal) {
    select.value = getCanonicalSurveyorName(currVal) || currVal;
  }
}

function refreshDashboard(shouldFitBounds = false) {
  const select = document.getElementById('sort-surveyor');
  const selectedSurveyor = select ? select.value : 'default';
  activeFilterSurveyor = selectedSurveyor;

  let activeZones = allZoneFeatures;
  let activePoints = allSamplePoints;

  if (selectedSurveyor !== 'default') {
    activePoints = allSamplePoints.filter(pt => {
      const p = pt.properties || {};
      return matchSurveyor(p.Surveyor, selectedSurveyor);
    });

    activeZones = allZoneFeatures.filter(f => {
      const p = f.properties || {};
      const surv = p.Surveyor || p.Nama || p.SURV || '';
      return matchSurveyor(surv, selectedSurveyor);
    });
  }

  // 1. Render Poligon Zona & Titik Sampel Terfilter
  renderZonesOnMap(activeZones, shouldFitBounds);
  renderSamplePointsOnMap(activePoints);

  // 2. Hitung Status Pemenuhan Zona & Capaian Aktual (Capped per Zona)
  let countDone = 0;
  let countProg = 0;
  let countZero = 0;
  let totalTarget = 0;
  let totalCappedAchieved = 0; // Capaian titik efektif: min(titik, target)

  activeZones.forEach(f => {
    const props = f.properties || {};
    const nozn = `${props.NOZN}`.trim();
    const ptsInZone = zonePointsCountMap[nozn] || 0;
    const tgt = getTargetForFeature(f).target;
    const cappedInThisZone = Math.min(ptsInZone, tgt);

    totalTarget += tgt;
    totalCappedAchieved += cappedInThisZone;

    if (ptsInZone >= tgt) {
      countDone++;
    } else if (ptsInZone > 0) {
      countProg++;
    } else {
      countZero++;
    }
  });

  const totalZones = activeZones.length;
  const totalGrossPoints = activePoints.length; // Total fisik semua titik
  const remainingTarget = Math.max(0, totalTarget - totalCappedAchieved);
  const completionPct = totalTarget > 0 ? ((totalCappedAchieved / totalTarget) * 100).toFixed(1) : '0.0';
  const surplusPoints = Math.max(0, totalGrossPoints - totalCappedAchieved);

  // 3. Update Elemen Statistik UI
  updateElementText('stat-total-zona', totalZones.toLocaleString('id-ID'));
  updateElementText('stat-zona-selesai', countDone.toLocaleString('id-ID'));
  updateElementText('stat-chip-selesai', countDone.toLocaleString('id-ID'));
  updateElementText('stat-chip-proses', countProg.toLocaleString('id-ID'));
  updateElementText('stat-chip-belum', countZero.toLocaleString('id-ID'));

  updateElementText('zone-completion-pct', `${completionPct}%`);
  updateElementText('sample-completion-pct', `${completionPct}%`);

  // 3b. Hitung Kualitas Data & Quality Control (QC SIPENTA)
  let qcValid = 0;
  let qcRevisi = 0;
  let qcKurang = 0;
  let qcBelum = 0;

  activeZones.forEach(f => {
    const props = f.properties || f.attributes || {};
    const nozn = `${props.NOZN}`.trim();
    const qcInfo = getZoneQcInfo(props, nozn);
    const sqc = (qcInfo.statusQc || '').trim();
    if (sqc.includes('Lengkap & Valid')) {
      qcValid++;
    } else if (sqc.includes('Perlu Revisi')) {
      qcRevisi++;
    } else if (sqc.includes('Kurang Lengkap')) {
      qcKurang++;
    } else if (sqc.includes('Belum Disurvey') || !sqc) {
      qcBelum++;
    } else {
      qcRevisi++;
    }
  });

  const qcValidPct = totalZones > 0 ? ((qcValid / totalZones) * 100).toFixed(1) : '0.0';
  console.log(`🔍 QC SIPENTA: Valid=${qcValid}, Revisi=${qcRevisi}, Kurang=${qcKurang}, Belum=${qcBelum} (${qcValidPct}%)`);

  updateElementText('stat-qc-valid', qcValid.toLocaleString('id-ID'));
  updateElementText('stat-qc-revisi', qcRevisi.toLocaleString('id-ID'));
  updateElementText('stat-chip-qc-valid', qcValid.toLocaleString('id-ID'));
  updateElementText('stat-chip-qc-revisi', qcRevisi.toLocaleString('id-ID'));
  updateElementText('stat-chip-qc-kurang', qcKurang.toLocaleString('id-ID'));
  updateElementText('stat-chip-qc-belum', qcBelum.toLocaleString('id-ID'));
  updateElementText('qc-valid-pct', `${qcValidPct}% Valid`);

  const progDone = document.getElementById('prog-seg-done');
  if (progDone) progDone.style.width = `${Math.min(100, Math.max(0, completionPct))}%`;

  // Capaian aktual (dibatasi maks per target zona)
  updateElementText('achieved-points', totalCappedAchieved.toLocaleString('id-ID'));
  updateElementText('remaining-points', remainingTarget.toLocaleString('id-ID'));
  updateElementText('target-points', totalTarget.toLocaleString('id-ID'));
  updateElementText('donut-center-number', totalCappedAchieved.toLocaleString('id-ID'));
  updateElementText('donut-center-sub', `/ ${totalTarget.toLocaleString('id-ID')}`);

  // Total fisik diambil & kelebihan
  const surplusText = surplusPoints > 0 ? ` (+${surplusPoints} surplus)` : '';
  updateElementText('gross-points', `${totalGrossPoints.toLocaleString('id-ID')}${surplusText}`);

  const sortStatus = document.getElementById('sort-status-text');
  if (sortStatus) {
    if (selectedSurveyor === 'default') {
      sortStatus.innerHTML = `<i class="fa-solid fa-map" style="color:var(--accent-sky)"></i> Seluruh Cilacap &bull; <strong>${totalCappedAchieved.toLocaleString('id-ID')} / ${totalTarget.toLocaleString('id-ID')}</strong> titik aktual (${completionPct}%) &bull; ${countDone}/${totalZones} zona selesai`;
    } else {
      const sCol = getSurveyorColor(selectedSurveyor);
      sortStatus.innerHTML = `<i class="fa-solid fa-user-check" style="color:${sCol}"></i> Surveyor: <strong>${selectedSurveyor}</strong> &bull; <strong>${totalCappedAchieved} / ${totalTarget}</strong> titik aktual (${completionPct}%) &bull; ${countDone}/${totalZones} zona`;
    }
  }

  // 4. Update Donut Chart
  if (donutChart) {
    donutChart.data.datasets[0].data = [totalCappedAchieved, remainingTarget];
    donutChart.update();
  }

  // 5. Update Bar Chart (Tren Harian)
  if (barChart) {
    const dailyMap = {};
    activePoints.forEach(pt => {
      const tgl = pt.properties ? pt.properties.Tgl : null;
      if (tgl) {
        dailyMap[tgl] = (dailyMap[tgl] || 0) + 1;
      }
    });

    const dates = Object.keys(dailyMap).sort().slice(-8);
    const namaBulanIndo = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const formattedLabels = dates.map(d => {
      const parts = d.split('-');
      if (parts.length === 3) {
        return `${parts[2]} ${namaBulanIndo[parseInt(parts[1], 10) - 1]}`;
      }
      return d;
    });

    barChart.data.labels = formattedLabels;
    barChart.data.datasets[0].data = dates.map(d => dailyMap[d]);
    barChart.update();
  }

  // 6. Update Log Sampel Terbaru
  renderRecentSamples(activePoints.slice(-12).reverse());

  // 7. Update Legenda Peta
  updateFloatingLegend(selectedSurveyor, totalCappedAchieved, totalTarget, completionPct);

  // 8. Update Badge Info Tanggal Pembaruan
  updateDashboardDateBadge();
}

function formatIndonesianDateShort(dateStr) {
  if (!dateStr) return '';
  const m = `${dateStr}`.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) {
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const day = parseInt(m[3], 10);
    const month = months[parseInt(m[2], 10) - 1];
    const year = m[1];
    return `${day} ${month} ${year}`;
  }
  return dateStr;
}

function updateDashboardDateBadge() {
  const rawDate = (CONFIG && CONFIG.lastUpdateDate) ? CONFIG.lastUpdateDate : new Date().toISOString().slice(0, 10);
  const rawTime = (CONFIG && CONFIG.lastUpdateTime) ? CONFIG.lastUpdateTime : "09:43 WIB";
  const formattedDate = formatIndonesianDateShort(rawDate);
  const displayText = `${formattedDate}, ${rawTime}`;

  // 1. Header Desktop
  const headerVal = document.getElementById('header-last-update-val');
  if (headerVal) headerVal.textContent = displayText;

  // 2. Mobile Header
  const mVal = document.getElementById('m-last-update-val');
  if (mVal) mVal.textContent = `Update: ${displayText}`;

  // 3. Sync Card di bawah sidebar
  const syncTime = document.getElementById('last-update-time');
  if (syncTime) {
    syncTime.innerHTML = `Terakhir diperbarui: <strong>${displayText}</strong>`;
  }
}

function updateElementText(id, text) {
  const el = document.getElementById(id);
  if (el) el.innerText = text;
}

function renderRecentSamples(sampleList) {
  const container = document.getElementById('recent-samples-list');
  const countBadge = document.getElementById('samples-count');
  if (!container) return;

  if (countBadge) countBadge.innerText = allSamplePoints.length;
  container.innerHTML = '';

  if (sampleList.length === 0) {
    container.innerHTML = '<div class="empty-state">Belum ada titik sampel tercatat.</div>';
    return;
  }

  sampleList.forEach(pt => {
    const p = pt.properties || {};
    const coords = (pt.geometry && pt.geometry.coordinates) ? pt.geometry.coordinates : null;
    const card = document.createElement('div');
    card.className = 'sample-log-item';
    const isTransaksi = (p.JenisData || '').toLowerCase().includes('transaksi');
    const tagClass = isTransaksi ? 'transaksi' : 'penawaran';
    const sCol = getSurveyorColor(p.Surveyor);
    card.style.borderLeftColor = sCol;

    const nilaiFormatted = p.NilaiPerM2 && !isNaN(p.NilaiPerM2) ? `Rp ${Math.round(p.NilaiPerM2).toLocaleString('id-ID')}/m²` : '';

    card.innerHTML = `
      <div class="sample-log-header">
        <span><i class="fa-solid fa-location-dot" style="color:${sCol}"></i> #${p.No || ''} Zona ${p.NOZN || '-'}</span>
        <span class="sample-type-tag ${tagClass}">${p.JenisData || 'Penawaran'}</span>
      </div>
      <div class="sample-log-meta">
        <span><i class="fa-regular fa-user"></i> ${getCanonicalSurveyorName(p.Surveyor)}</span>
        <span>&bull;</span>
        <span><i class="fa-regular fa-calendar"></i> ${p.Tgl || '-'}</span>
        ${p.Zoning ? `<span>&bull;</span> <span style="color:#38bdf8; font-weight:600;">${p.Zoning}</span>` : ''}
      </div>
      <div style="font-size:0.7rem; color:var(--text-muted);">${p.Alamat || ''}, ${p.Kelurahan || ''}</div>
      ${nilaiFormatted ? `<div class="sample-log-price">${nilaiFormatted}</div>` : ''}
    `;

    if (coords) {
      card.addEventListener('click', () => {
        map.setView([coords[1], coords[0]], 16);
      });
    }

    container.appendChild(card);
  });
}

function updateFloatingLegend(selectedSurveyor, achieved, target, pct) {
  updateElementText('legend-total-pct', `${pct}%`);
  updateElementText('legend-footer-achieved', achieved.toLocaleString('id-ID'));
  updateElementText('legend-footer-target', target.toLocaleString('id-ID'));
  updateElementText('legend-footer-pct', `${pct}%`);

  const pointer = document.getElementById('legend-progress-pointer');
  if (pointer) pointer.style.left = `${Math.min(100, Math.max(0, pct))}%`;

  // Update indikator mode warna di kartu legenda
  const modeLabel = document.getElementById('legend-mode-label');
  const modeBtn = document.getElementById('legend-mode-toggle');
  const gradBox = document.getElementById('legend-gradient-box');
  const opGuide = document.getElementById('legend-opacity-guide');
  const qcGuide = document.getElementById('legend-qc-guide');
  const statusTitle = document.getElementById('legend-status-title');

  if (colorMode === 'surveyor') {
    if (modeLabel) modeLabel.textContent = 'Per Surveyor';
    if (modeBtn) {
      modeBtn.className = 'legend-mode-btn';
      modeBtn.title = 'Mode aktif: Warna per Surveyor. Klik untuk ganti ke Status Target.';
    }
    if (gradBox) gradBox.style.display = 'none';
    if (opGuide) opGuide.style.display = 'flex';
    if (qcGuide) qcGuide.style.display = 'none';
    if (statusTitle) statusTitle.textContent = 'Intensitas Capaian Zona';
  } else if (colorMode === 'qc') {
    if (modeLabel) modeLabel.textContent = 'Status QC SIPENTA';
    if (modeBtn) {
      modeBtn.className = 'legend-mode-btn qc-mode';
      modeBtn.title = 'Mode aktif: Status QC SIPENTA. Klik untuk ganti ke Warna per Surveyor.';
    }
    if (gradBox) gradBox.style.display = 'none';
    if (opGuide) opGuide.style.display = 'none';
    if (qcGuide) qcGuide.style.display = 'flex';
    if (statusTitle) statusTitle.textContent = 'Kualitas Data Zona (QC)';
  } else {
    if (modeLabel) modeLabel.textContent = 'Status Target';
    if (modeBtn) {
      modeBtn.className = 'legend-mode-btn status-mode';
      modeBtn.title = 'Mode aktif: Status Target (Hijau/Kuning/Merah). Klik untuk ganti ke Status QC SIPENTA.';
    }
    if (gradBox) gradBox.style.display = 'flex';
    if (opGuide) opGuide.style.display = 'none';
    if (qcGuide) qcGuide.style.display = 'none';
    if (statusTitle) statusTitle.textContent = 'Status Pemenuhan Zona';
  }

  const survContainer = document.getElementById('legend-surveyor-list');
  if (!survContainer) return;
  survContainer.innerHTML = '';

  const surveyorList = (CONFIG && CONFIG.surveyors) ? CONFIG.surveyors : [];

  surveyorList.forEach(s => {
    const sPoints = allSamplePoints.filter(pt => matchSurveyor(pt.properties ? pt.properties.Surveyor : '', s.name));
    const sZones = allZoneFeatures.filter(f => matchSurveyor(f.properties ? (f.properties.Surveyor || f.properties.Nama || f.properties.SURV) : '', s.name));

    let sTarget = 0;
    let sCapped = 0;

    sZones.forEach(f => {
      const p = f.properties || {};
      const nozn = `${p.NOZN}`.trim();
      const pts = zonePointsCountMap[nozn] || 0;
      const tgt = getTargetForFeature(f).target;
      sTarget += tgt;
      sCapped += Math.min(pts, tgt);
    });

    const sPct = sTarget > 0 ? (sCapped / sTarget) * 100 : 0;
    const sCol = s.color || "#38bdf8";

    const isSelected = selectedSurveyor !== 'default' && matchSurveyor(selectedSurveyor, s.name);

    const row = document.createElement('div');
    row.className = `legend-surveyor-row ${isSelected ? 'active' : ''}`;
    row.innerHTML = `
      <div class="legend-surv-top">
        <div class="legend-surv-name-group">
          <span class="swatch-dot" style="background:${sCol}; box-shadow:0 0 6px ${sCol};"></span>
          <span>${s.name}</span>
        </div>
        <span class="legend-surv-badge" style="background:${sCol}25; color:${sCol}; border:1px solid ${sCol}60;">
          ${sCapped} / ${sTarget} pt
        </span>
      </div>
      <div class="legend-surv-bar-track">
        <div class="legend-surv-bar-fill" style="width: ${Math.max(4, Math.min(100, sPct))}%; background:${sCol};"></div>
      </div>
      <div class="legend-surv-details">
        <span>Capaian Aktual: <strong>${sPct.toFixed(1)}%</strong></span>
        <span style="color:var(--text-dim);">Fisik: ${sPoints.length} pt</span>
      </div>
    `;

    row.addEventListener('click', () => {
      const select = document.getElementById('sort-surveyor');
      if (select) {
        if (select.value === s.name) {
          select.value = 'default';
        } else {
          select.value = s.name;
        }
        refreshDashboard(true);
      }
    });

    survContainer.appendChild(row);
  });
}

// =============================================================================
// 9.5. LOGIKA PENCARIAN TITIK SAMPEL & KOORDINAT SPASIAL
// =============================================================================

/**
 * Efek visual highlight marker berdenyut (pulse) di peta
 */
function highlightPointOnMap(lat, lon, label) {
  if (searchPulseMarker) {
    try { map.removeLayer(searchPulseMarker); } catch(e){}
    searchPulseMarker = null;
  }

  const pulseIcon = L.divIcon({
    className: 'znt-pulse-marker-container',
    html: `
      <div class="znt-pulse-ring"></div>
      <div class="znt-pulse-dot"></div>
      ${label ? `<div class="znt-pulse-label">${label}</div>` : ''}
    `,
    iconSize: [48, 48],
    iconAnchor: [24, 24]
  });

  searchPulseMarker = L.marker([lat, lon], {
    icon: pulseIcon,
    zIndexOffset: 1200,
    interactive: false
  }).addTo(map);

  // Otomatis bersihkan setelah 15 detik
  setTimeout(() => {
    if (searchPulseMarker && map.hasLayer(searchPulseMarker)) {
      try { map.removeLayer(searchPulseMarker); } catch(e){}
      searchPulseMarker = null;
    }
  }, 15000);
}

/**
 * Konversi koordinat WGS84 ke TM-3 BPN dan UTM 49S
 */
function convertWgsToTm3AndUtm(lon, lat) {
  let tm3 = null;
  let utm = null;
  if (typeof proj4 !== 'undefined') {
    try {
      const pTm3 = proj4("WGS84", "EPSG:23835", [lon, lat]);
      if (pTm3 && !isNaN(pTm3[0]) && !isNaN(pTm3[1])) {
        tm3 = { x: Math.round(pTm3[0] * 10) / 10, y: Math.round(pTm3[1] * 10) / 10 };
      }
    } catch (e) { }
    try {
      const pUtm = proj4("WGS84", "EPSG:32749", [lon, lat]);
      if (pUtm && !isNaN(pUtm[0]) && !isNaN(pUtm[1])) {
        utm = { x: Math.round(pUtm[0] * 10) / 10, y: Math.round(pUtm[1] * 10) / 10 };
      }
    } catch (e) { }
  }
  return { tm3, utm };
}

/**
 * Cek spasial ray-casting apakah titik [lon, lat] berada di dalam poligon
 */
function pointInRing(pt, ring) {
  const x = pt[0], y = pt[1];
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function findZoneContainingPoint(lon, lat) {
  if (!allZoneFeatures || allZoneFeatures.length === 0) return null;
  for (let i = 0; i < allZoneFeatures.length; i++) {
    const f = allZoneFeatures[i];
    if (!f.geometry || !f.geometry.coordinates) continue;
    const geomType = f.geometry.type;
    const coords = f.geometry.coordinates;

    if (geomType === 'Polygon') {
      if (coords.length > 0 && pointInRing([lon, lat], coords[0])) {
        return f;
      }
    } else if (geomType === 'MultiPolygon') {
      for (let p = 0; p < coords.length; p++) {
        if (coords[p].length > 0 && pointInRing([lon, lat], coords[p][0])) {
          return f;
        }
      }
    }
  }
  return null;
}

/**
 * Hitung jarak Haversine dalam meter antara dua koordinat WGS84
 */
function getDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function findNearestSamplePoint(lat, lon) {
  if (!allSamplePoints || allSamplePoints.length === 0) return null;
  let nearest = null;
  let minDist = Infinity;

  for (let i = 0; i < allSamplePoints.length; i++) {
    const pt = allSamplePoints[i];
    if (!pt.geometry || !pt.geometry.coordinates) continue;
    const pLon = pt.geometry.coordinates[0];
    const pLat = pt.geometry.coordinates[1];
    const d = getDistanceMeters(lat, lon, pLat, pLon);
    if (d < minDist) {
      minDist = d;
      nearest = { pt, dist: d };
    }
  }

  return nearest;
}

/**
 * Parser cerdas koordinat: WGS84, TM-3 BPN, UTM 49S, dan DMS
 */
function parseCoordinateInput(inputStr) {
  if (!inputStr || typeof inputStr !== 'string') return null;
  const clean = inputStr.trim();
  if (!clean) return null;

  // 1. Cek format DMS (cth: 7°40'40.8" S 109°01'06" E)
  const dmsMatches = clean.match(/(\d+)[\s°]+(\d+)[\s']+([\d.]+)[\s"']*([NSEWnsew]?)/g);
  if (dmsMatches && dmsMatches.length >= 2) {
    function parseDmsPart(str) {
      const p = str.match(/(\d+)[\s°]+(\d+)[\s']+([\d.]+)[\s"']*([NSEWnsew]?)/);
      if (!p) return null;
      let dd = parseFloat(p[1]) + parseFloat(p[2]) / 60 + parseFloat(p[3]) / 3600;
      const dir = (p[4] || '').toUpperCase();
      if (dir === 'S' || dir === 'W') dd = -dd;
      return { val: dd, dir };
    }
    const d1 = parseDmsPart(dmsMatches[0]);
    const d2 = parseDmsPart(dmsMatches[1]);
    if (d1 && d2) {
      let lat, lon;
      if (d1.dir === 'S' || d1.dir === 'N' || (d1.val < 0 && d2.val > 0)) {
        lat = d1.val; lon = d2.val;
      } else {
        lon = d1.val; lat = d2.val;
      }
      return { lat, lon, type: 'WGS84 (DMS)', original: clean };
    }
  }

  // 2. Ekstrak dua angka numerik
  const nums = clean.replace(/,/g, ' ').replace(/[;|]/g, ' ').split(/\s+/).map(s => parseFloat(s)).filter(n => !isNaN(n));
  if (nums.length < 2) return null;

  const n1 = nums[0];
  const n2 = nums[1];

  // 3. Cek format WGS84 Desimal
  if ((n1 >= -90 && n1 <= 90) && (n2 >= -180 && n2 <= 180)) {
    let lat, lon;
    if (n1 < 0 && n2 > 0) {
      lat = n1; lon = n2;
    } else if (n2 < 0 && n1 > 0) {
      lon = n1; lat = n2;
    } else if (n1 > 90 && n2 < 0) {
      lon = n1; lat = n2;
    } else if (n2 > 90 && n1 < 0) {
      lat = n1; lon = n2;
    } else {
      lat = n1; lon = n2;
    }
    return { lat, lon, type: 'WGS84 (Desimal)', original: clean };
  }

  // 4. Cek format TM-3 BPN Zone 49.1 / 49.2 (EPSG:23835)
  let xTM3, yTM3, isTM3 = false;
  if ((n1 >= 50000 && n1 <= 350000) && (n2 >= 400000 && n2 <= 1100000)) {
    xTM3 = n1; yTM3 = n2; isTM3 = true;
  } else if ((n2 >= 50000 && n2 <= 350000) && (n1 >= 400000 && n1 <= 1100000)) {
    xTM3 = n2; yTM3 = n1; isTM3 = true;
  }

  if (isTM3 && typeof proj4 !== 'undefined') {
    try {
      const p = proj4("EPSG:23835", "WGS84", [xTM3, yTM3]);
      if (p && !isNaN(p[0]) && !isNaN(p[1])) {
        return { lat: p[1], lon: p[0], x: xTM3, y: yTM3, type: 'TM-3 BPN (EPSG:23835)', original: clean };
      }
    } catch (e) { }
  }

  // 5. Cek format UTM Zone 49S (EPSG:32749)
  let xUTM, yUTM, isUTM = false;
  if ((n1 >= 150000 && n1 <= 450000) && (n2 >= 8500000 && n2 <= 9500000)) {
    xUTM = n1; yUTM = n2; isUTM = true;
  } else if ((n2 >= 150000 && n2 <= 450000) && (n1 >= 8500000 && n1 <= 9500000)) {
    xUTM = n2; yUTM = n1; isUTM = true;
  }

  if (isUTM && typeof proj4 !== 'undefined') {
    try {
      const p = proj4("EPSG:32749", "WGS84", [xUTM, yUTM]);
      if (p && !isNaN(p[0]) && !isNaN(p[1])) {
        return { lat: p[1], lon: p[0], x: xUTM, y: yUTM, type: 'UTM Zone 49S', original: clean };
      }
    } catch (e) { }
  }

  return null;
}

/**
 * Filter pencarian titik sampel
 */
function searchSamplePoints(query) {
  if (!query || typeof query !== 'string') return [];
  const q = query.trim().toLowerCase().replace(/^#/, '');
  if (!q) return [];

  const exact = [];
  const startsWith = [];
  const contains = [];

  for (let i = 0; i < allSamplePoints.length; i++) {
    const pt = allSamplePoints[i];
    const p = pt.properties || {};
    const no = `${p.No || ''}`.trim().toLowerCase();
    const id = `${p.Id || ''}`.trim().toLowerCase();
    const nozn = `${p.NOZN || ''}`.trim().toLowerCase();
    const hist = `${p.HISTZONE || ''}`.trim().toLowerCase();
    const kel = `${p.Kelurahan || ''}`.trim().toLowerCase();
    const kec = `${p.Kecamatan || ''}`.trim().toLowerCase();
    const surv = `${p.Surveyor || ''}`.trim().toLowerCase();

    if (no === q || id === q || id.endsWith(q)) {
      exact.push(pt);
    } else if (no.startsWith(q) || id.includes(q)) {
      startsWith.push(pt);
    } else if (nozn === q || hist === q || kel.includes(q) || kec.includes(q) || surv.includes(q)) {
      contains.push(pt);
    }
  }

  return [...exact, ...startsWith, ...contains].slice(0, 15);
}

/**
 * Pin koordinat custom pada peta
 */
function plotCoordinateOnMap(lat, lon, parsedInfo) {
  if (searchCoordMarker) {
    try { map.removeLayer(searchCoordMarker); } catch(e){}
    searchCoordMarker = null;
  }

  const pinIcon = L.divIcon({
    className: 'znt-coord-pin-container',
    html: `
      <div class="znt-coord-pin-pulse"></div>
      <div class="znt-coord-pin-icon"><i class="fa-solid fa-crosshairs"></i></div>
    `,
    iconSize: [36, 36],
    iconAnchor: [18, 36],
    popupAnchor: [0, -36]
  });

  const conversions = convertWgsToTm3AndUtm(lon, lat);
  const zoneMatch = findZoneContainingPoint(lon, lat);
  const zoneProps = zoneMatch ? (zoneMatch.properties || zoneMatch.attributes || {}) : null;
  const nearestPoint = findNearestSamplePoint(lat, lon);

  const tm3Text = conversions.tm3 ? `X: ${conversions.tm3.x.toLocaleString('id-ID')}, Y: ${conversions.tm3.y.toLocaleString('id-ID')}` : '-';
  const utmText = conversions.utm ? `X: ${conversions.utm.x.toLocaleString('id-ID')}, Y: ${conversions.utm.y.toLocaleString('id-ID')}` : '-';
  const zoneText = zoneProps ? `Zona ${zoneProps.NOZN || '-'} (${zoneProps.HISTZONE || '-'}) - ${zoneProps.PENGGUNAAN || ''}` : 'Di luar poligon zona ZNT';
  const survText = zoneProps ? (zoneProps.Surveyor || '-') : '-';

  searchCoordMarker = L.marker([lat, lon], {
    icon: pinIcon,
    zIndexOffset: 1100
  }).addTo(map);

  const popupHtml = `
    <div class="znt-popup">
      <div class="znt-popup-header" style="border-left: 4px solid #ef4444;">
        <span class="znt-popup-title"><i class="fa-solid fa-location-crosshairs"></i> Koordinat Dicari</span>
        <span class="znt-badge" style="background:#ef444425; color:#f87171; border:1px solid #ef444460;">${parsedInfo.type || 'Koordinat'}</span>
      </div>
      <div style="margin-top:6px;">
        <div class="znt-popup-row"><span>WGS84 Lat, Lon:</span> <strong style="color:#38bdf8;">${lat.toFixed(6)}, ${lon.toFixed(6)}</strong></div>
        <div class="znt-popup-row"><span>TM-3 BPN:</span> <strong>${tm3Text}</strong></div>
        <div class="znt-popup-row"><span>UTM 49S:</span> <strong>${utmText}</strong></div>
        <div class="znt-popup-row"><span>Zona ZNT:</span> <strong style="color:#10b981;">${zoneText}</strong></div>
        <div class="znt-popup-row"><span>Surveyor Wilayah:</span> <strong>${survText}</strong></div>
        ${nearestPoint ? `
          <div class="znt-popup-row" style="margin-top:4px; padding-top:4px; border-top:1px dashed rgba(255,255,255,0.1);">
            <span>Titik Terdekat:</span>
            <strong style="color:#fcd34d;">#${nearestPoint.pt.properties.No || ''} (~${Math.round(nearestPoint.dist)} m)</strong>
          </div>
        ` : ''}
      </div>
    </div>
  `;

  searchCoordMarker.bindPopup(popupHtml).openPopup();
  return { conversions, zoneMatch, zoneProps, nearestPoint };
}

/**
 * Fokus peta ke titik sampel tertentu
 */
function focusOnSamplePoint(ptFeature) {
  if (!ptFeature || !ptFeature.geometry || !ptFeature.geometry.coordinates) return false;
  const coords = ptFeature.geometry.coordinates;
  const lon = coords[0];
  const lat = coords[1];
  const p = ptFeature.properties || {};

  // Pastikan layer titik aktif di peta
  if (!map.hasLayer(pointsLayerGroup)) {
    pointsLayerGroup.addTo(map);
    const togglePointsBtn = document.getElementById('toggle-points');
    if (togglePointsBtn) togglePointsBtn.classList.add('active');
  }

  // Terbang ke titik
  map.flyTo([lat, lon], 18, { animate: true, duration: 1.2 });

  // Berikan efek highlight pulse
  highlightPointOnMap(lat, lon, `#${p.No || ''}`);

  // Buka popup marker titik
  const keyNo = `${p.No || ''}`.trim();
  const keyId = `${p.Id || ''}`.trim().toLowerCase();
  const marker = sampleMarkersMap[keyNo] || sampleMarkersMap[keyId];
  if (marker) {
    setTimeout(() => {
      try { marker.openPopup(); } catch(e){}
    }, 700);
  }

  // Tampilkan kartu hasil di sidebar
  showPointSearchResult(ptFeature);

  // Jika mobile, otomatis beralih ke peta agar pengguna langsung melihat titiknya
  if (window.innerWidth <= 768) {
    const segMap = document.getElementById('seg-btn-map');
    if (segMap) segMap.click();
  }

  return true;
}

/**
 * Plot dan fokus ke koordinat spasial
 */
function focusOnCoordinates(lat, lon, parsedInfo) {
  map.flyTo([lat, lon], 18, { animate: true, duration: 1.2 });
  const meta = plotCoordinateOnMap(lat, lon, parsedInfo);
  showCoordSearchResult(lat, lon, parsedInfo, meta);

  if (window.innerWidth <= 768) {
    const segMap = document.getElementById('seg-btn-map');
    if (segMap) segMap.click();
  }
}

/**
 * Tampilkan ringkasan hasil titik sampel di kartu sidebar
 */
function showPointSearchResult(ptFeature) {
  const box = document.getElementById('search-result-box');
  const title = document.getElementById('result-title');
  const body = document.getElementById('result-body');
  const badge = document.getElementById('search-status-badge');
  if (!box || !body) return;

  const p = ptFeature.properties || {};
  const coords = ptFeature.geometry.coordinates;
  const lon = coords[0], lat = coords[1];
  const conversions = convertWgsToTm3AndUtm(lon, lat);
  const sCol = getSurveyorColor(p.Surveyor);
  const nilaiFormatted = p.NilaiPerM2 && !isNaN(p.NilaiPerM2) ? `Rp ${Math.round(p.NilaiPerM2).toLocaleString('id-ID')} / m²` : '-';

  if (badge) {
    badge.style.display = 'inline-block';
    badge.textContent = `Titik #${p.No || ''}`;
    badge.style.background = `${sCol}25`;
    badge.style.color = sCol;
  }

  if (title) {
    title.innerHTML = `<i class="fa-solid fa-location-dot" style="color:${sCol};"></i> Sampel #${p.No || ''} (ID: ${p.Id || '-'})`;
  }

  body.innerHTML = `
    <div class="result-row"><span>Zona Terkait:</span> <strong style="color:#38bdf8;">Zona ${p.NOZN || '-'} (${p.HISTZONE || '-'})</strong></div>
    <div class="result-row"><span>Penggunaan / Zoning:</span> <strong>${p.Zoning || p.GunaObjek || '-'}</strong></div>
    <div class="result-row"><span>Surveyor:</span> <strong>${getCanonicalSurveyorName(p.Surveyor)}</strong></div>
    <div class="result-row"><span>Lokasi:</span> <strong>${p.Kelurahan || ''}, ${p.Kecamatan || ''}</strong></div>
    <div class="result-row"><span>Nilai Tanah:</span> <strong style="color:#fcd34d;">${nilaiFormatted}</strong></div>
    <div class="result-row"><span>WGS84:</span> <strong style="font-family:'JetBrains Mono',monospace; font-size:0.7rem;">${lat.toFixed(6)}, ${lon.toFixed(6)}</strong></div>
    ${conversions.tm3 ? `<div class="result-row"><span>TM-3 BPN:</span> <strong style="font-family:'JetBrains Mono',monospace; font-size:0.7rem;">${conversions.tm3.x}, ${conversions.tm3.y}</strong></div>` : ''}
    <div class="result-actions">
      <button type="button" class="btn-result-focus" id="btn-refocus-point">
        <i class="fa-solid fa-crosshairs"></i> Fokus Ulang Titik
      </button>
    </div>
  `;

  const btnRefocus = document.getElementById('btn-refocus-point');
  if (btnRefocus) {
    btnRefocus.addEventListener('click', () => {
      focusOnSamplePoint(ptFeature);
    });
  }

  box.style.display = 'flex';
}

/**
 * Tampilkan ringkasan hasil plot koordinat di kartu sidebar
 */
function showCoordSearchResult(lat, lon, parsedInfo, meta) {
  const box = document.getElementById('search-result-box');
  const title = document.getElementById('result-title');
  const body = document.getElementById('result-body');
  const badge = document.getElementById('search-status-badge');
  if (!box || !body) return;

  const conversions = meta.conversions || convertWgsToTm3AndUtm(lon, lat);
  const zoneProps = meta.zoneProps;
  const nearest = meta.nearestPoint;

  if (badge) {
    badge.style.display = 'inline-block';
    badge.textContent = parsedInfo.type || 'Koordinat';
    badge.style.background = 'rgba(239, 68, 68, 0.2)';
    badge.style.color = '#f87171';
  }

  if (title) {
    title.innerHTML = `<i class="fa-solid fa-crosshairs" style="color:#ef4444;"></i> Lokasi Koordinat (${parsedInfo.type || 'Spasial'})`;
  }

  body.innerHTML = `
    <div class="result-row"><span>WGS84 (Lat, Lon):</span> <strong style="font-family:'JetBrains Mono',monospace; font-size:0.7rem; color:#38bdf8;">${lat.toFixed(6)}, ${lon.toFixed(6)}</strong></div>
    ${conversions.tm3 ? `<div class="result-row"><span>TM-3 BPN:</span> <strong style="font-family:'JetBrains Mono',monospace; font-size:0.7rem;">X: ${conversions.tm3.x.toLocaleString('id-ID')}, Y: ${conversions.tm3.y.toLocaleString('id-ID')}</strong></div>` : ''}
    ${conversions.utm ? `<div class="result-row"><span>UTM 49S:</span> <strong style="font-family:'JetBrains Mono',monospace; font-size:0.7rem;">X: ${conversions.utm.x.toLocaleString('id-ID')}, Y: ${conversions.utm.y.toLocaleString('id-ID')}</strong></div>` : ''}
    <div class="result-row"><span>Zona ZNT Terkait:</span> <strong style="color:#10b981;">${zoneProps ? `Zona ${zoneProps.NOZN || '-'} (${zoneProps.HISTZONE || '-'})` : 'Di luar poligon zona ZNT'}</strong></div>
    <div class="result-row"><span>Surveyor Wilayah:</span> <strong>${zoneProps ? (zoneProps.Surveyor || '-') : '-'}</strong></div>
    ${nearest ? `
      <div class="result-row" style="margin-top:4px; padding-top:4px; border-top:1px dashed rgba(255,255,255,0.08);">
        <span>Titik Terdekat:</span>
        <strong style="color:#fcd34d;">#${nearest.pt.properties.No || ''} (~${Math.round(nearest.dist)} m)</strong>
      </div>
    ` : ''}
    <div class="result-actions">
      <button type="button" class="btn-result-focus" id="btn-refocus-coord">
        <i class="fa-solid fa-location-crosshairs"></i> Fokus Lokasi
      </button>
      ${nearest ? `
        <button type="button" class="btn-result-focus" id="btn-switch-nearest" style="border-color:#fcd34d; color:#fcd34d; background:rgba(252,211,77,0.1);">
          <i class="fa-solid fa-location-dot"></i> Buka Titik #${nearest.pt.properties.No || ''}
        </button>
      ` : ''}
    </div>
  `;

  const btnRefocus = document.getElementById('btn-refocus-coord');
  if (btnRefocus) {
    btnRefocus.addEventListener('click', () => {
      map.flyTo([lat, lon], 18, { animate: true, duration: 1.2 });
      if (searchCoordMarker) searchCoordMarker.openPopup();
    });
  }

  const btnSwitch = document.getElementById('btn-switch-nearest');
  if (btnSwitch && nearest) {
    btnSwitch.addEventListener('click', () => {
      focusOnSamplePoint(nearest.pt);
    });
  }

  box.style.display = 'flex';
}

/**
 * Event listener dan kontrol pencarian
 */
function setupSearchControls() {
  // Tab Switcher di Sidebar
  const tabPoint = document.getElementById('tab-search-point');
  const tabCoord = document.getElementById('tab-search-coord');
  const contentPoint = document.getElementById('search-point-content');
  const contentCoord = document.getElementById('search-coord-content');

  if (tabPoint && tabCoord) {
    tabPoint.addEventListener('click', () => {
      tabPoint.classList.add('active');
      tabCoord.classList.remove('active');
      if (contentPoint) contentPoint.style.display = 'flex';
      if (contentCoord) contentCoord.style.display = 'none';
      const inputP = document.getElementById('input-search-point');
      if (inputP) inputP.focus();
    });

    tabCoord.addEventListener('click', () => {
      tabCoord.classList.add('active');
      tabPoint.classList.remove('active');
      if (contentPoint) contentPoint.style.display = 'none';
      if (contentCoord) contentCoord.style.display = 'flex';
      const inputC = document.getElementById('input-search-coord');
      if (inputC) inputC.focus();
    });
  }

  // Tombol Tutup Hasil
  const btnCloseResult = document.getElementById('btn-close-result');
  const resultBox = document.getElementById('search-result-box');
  const badge = document.getElementById('search-status-badge');
  if (btnCloseResult && resultBox) {
    btnCloseResult.addEventListener('click', () => {
      resultBox.style.display = 'none';
      if (badge) badge.style.display = 'none';
    });
  }

  // 1. Sidebar Pencarian Titik Sampel
  const inputPoint = document.getElementById('input-search-point');
  const btnClearPoint = document.getElementById('btn-clear-point');
  const btnDoSearchPoint = document.getElementById('btn-do-search-point');
  const acListPoint = document.getElementById('point-autocomplete-list');

  function renderPointAutocomplete(query) {
    if (!acListPoint) return;
    const results = searchSamplePoints(query);
    acListPoint.innerHTML = '';

    if (results.length === 0) {
      acListPoint.innerHTML = '<div style="padding:10px 12px; font-size:0.75rem; color:var(--text-dim);">Titik sampel tidak ditemukan.</div>';
      acListPoint.style.display = 'block';
      return;
    }

    results.forEach(pt => {
      const p = pt.properties || {};
      const sCol = getSurveyorColor(p.Surveyor);
      const nilaiFormatted = p.NilaiPerM2 && !isNaN(p.NilaiPerM2) ? `Rp ${Math.round(p.NilaiPerM2).toLocaleString('id-ID')}/m²` : '';

      const item = document.createElement('div');
      item.className = 'autocomplete-item';
      item.innerHTML = `
        <div class="ac-left">
          <div class="ac-title">
            <span style="color:${sCol};">#${p.No || ''}</span>
            <span style="color:#38bdf8;">Zona ${p.NOZN || '-'}</span>
            <span style="font-weight:normal; font-size:0.7rem; color:var(--text-muted);">&bull; ${p.GunaObjek || 'Tanah'}</span>
          </div>
          <div class="ac-sub">${p.Kelurahan || ''}, ${p.Kecamatan || ''} &bull; ${getCanonicalSurveyorName(p.Surveyor)}</div>
        </div>
        ${nilaiFormatted ? `<div class="ac-badge" style="background:${sCol}20; color:${sCol};">${nilaiFormatted}</div>` : ''}
      `;

      item.addEventListener('click', () => {
        if (inputPoint) inputPoint.value = `#${p.No || ''}`;
        acListPoint.style.display = 'none';
        focusOnSamplePoint(pt);
      });

      acListPoint.appendChild(item);
    });

    acListPoint.style.display = 'block';
  }

  if (inputPoint) {
    inputPoint.addEventListener('input', () => {
      const val = inputPoint.value.trim();
      if (btnClearPoint) btnClearPoint.style.display = val ? 'flex' : 'none';
      if (val.length >= 1) {
        renderPointAutocomplete(val);
      } else {
        if (acListPoint) acListPoint.style.display = 'none';
      }
    });

    inputPoint.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const val = inputPoint.value.trim();
        const results = searchSamplePoints(val);
        if (results.length > 0) {
          if (acListPoint) acListPoint.style.display = 'none';
          focusOnSamplePoint(results[0]);
        }
      } else if (e.key === 'Escape') {
        if (acListPoint) acListPoint.style.display = 'none';
      }
    });
  }

  if (btnClearPoint && inputPoint) {
    btnClearPoint.addEventListener('click', () => {
      inputPoint.value = '';
      btnClearPoint.style.display = 'none';
      if (acListPoint) acListPoint.style.display = 'none';
      inputPoint.focus();
    });
  }

  if (btnDoSearchPoint && inputPoint) {
    btnDoSearchPoint.addEventListener('click', () => {
      const val = inputPoint.value.trim();
      if (!val) return;
      const results = searchSamplePoints(val);
      if (results.length > 0) {
        if (acListPoint) acListPoint.style.display = 'none';
        focusOnSamplePoint(results[0]);
      } else {
        alert(`Titik sampel "${val}" tidak ditemukan.`);
      }
    });
  }

  // 2. Sidebar Pencarian Koordinat Spasial
  const inputCoord = document.getElementById('input-search-coord');
  const btnClearCoord = document.getElementById('btn-clear-coord');
  const btnDoSearchCoord = document.getElementById('btn-do-search-coord');

  function executeCoordSearch(coordText) {
    if (!coordText) return;
    const parsed = parseCoordinateInput(coordText);
    if (!parsed) {
      alert("Format koordinat tidak dikenali!\n\nContoh yang didukung:\n- WGS84: -7.6780, 109.0183\n- TM-3 BPN: 122705, 662213\n- UTM 49S: 281600, 9151200");
      return;
    }

    focusOnCoordinates(parsed.lat, parsed.lon, parsed);
  }

  if (inputCoord) {
    inputCoord.addEventListener('input', () => {
      const val = inputCoord.value.trim();
      if (btnClearCoord) btnClearCoord.style.display = val ? 'flex' : 'none';
    });

    inputCoord.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        executeCoordSearch(inputCoord.value.trim());
      }
    });
  }

  if (btnClearCoord && inputCoord) {
    btnClearCoord.addEventListener('click', () => {
      inputCoord.value = '';
      btnClearCoord.style.display = 'none';
      inputCoord.focus();
    });
  }

  if (btnDoSearchCoord && inputCoord) {
    btnDoSearchCoord.addEventListener('click', () => {
      executeCoordSearch(inputCoord.value.trim());
    });
  }

  // 3. Quick Search Toolbar pada Peta
  const mapSearchInput = document.getElementById('map-quick-search-input');
  const mapSearchClear = document.getElementById('btn-map-search-clear');
  const mapSearchDropdown = document.getElementById('map-search-dropdown');

  function renderMapSearchDropdown(query) {
    if (!mapSearchDropdown) return;
    mapSearchDropdown.innerHTML = '';

    const clean = query.trim();
    if (!clean) {
      mapSearchDropdown.style.display = 'none';
      return;
    }

    // Cek apakah input berupa koordinat
    const coordParse = parseCoordinateInput(clean);
    if (coordParse) {
      const coordItem = document.createElement('div');
      coordItem.className = 'autocomplete-item';
      coordItem.style.background = 'rgba(239, 68, 68, 0.15)';
      coordItem.innerHTML = `
        <div class="ac-left">
          <div class="ac-title" style="color:#f87171;">
            <i class="fa-solid fa-crosshairs"></i> Plot Koordinat (${coordParse.type})
          </div>
          <div class="ac-sub">Lat: ${coordParse.lat.toFixed(6)}, Lon: ${coordParse.lon.toFixed(6)}</div>
        </div>
        <div class="ac-badge" style="background:#ef4444; color:#fff;">Klik untuk Plot</div>
      `;
      coordItem.addEventListener('click', () => {
        mapSearchDropdown.style.display = 'none';
        focusOnCoordinates(coordParse.lat, coordParse.lon, coordParse);
      });
      mapSearchDropdown.appendChild(coordItem);
    }

    // Cek pencarian titik sampel
    const pointResults = searchSamplePoints(clean);
    pointResults.forEach(pt => {
      const p = pt.properties || {};
      const sCol = getSurveyorColor(p.Surveyor);
      const nilaiFormatted = p.NilaiPerM2 && !isNaN(p.NilaiPerM2) ? `Rp ${Math.round(p.NilaiPerM2).toLocaleString('id-ID')}/m²` : '';

      const item = document.createElement('div');
      item.className = 'autocomplete-item';
      item.innerHTML = `
        <div class="ac-left">
          <div class="ac-title">
            <span style="color:${sCol};">#${p.No || ''}</span>
            <span style="color:#38bdf8;">Zona ${p.NOZN || '-'}</span>
            <span style="font-weight:normal; font-size:0.7rem; color:var(--text-muted);">&bull; ${p.GunaObjek || 'Tanah'}</span>
          </div>
          <div class="ac-sub">${p.Kelurahan || ''}, ${p.Kecamatan || ''} &bull; ${getCanonicalSurveyorName(p.Surveyor)}</div>
        </div>
        ${nilaiFormatted ? `<div class="ac-badge" style="background:${sCol}20; color:${sCol};">${nilaiFormatted}</div>` : ''}
      `;

      item.addEventListener('click', () => {
        mapSearchInput.value = `#${p.No || ''}`;
        mapSearchDropdown.style.display = 'none';
        focusOnSamplePoint(pt);
      });

      mapSearchDropdown.appendChild(item);
    });

    if (!coordParse && pointResults.length === 0) {
      mapSearchDropdown.innerHTML = '<div style="padding:10px 12px; font-size:0.75rem; color:var(--text-dim);">Tidak ditemukan titik atau koordinat cocok.</div>';
    }

    mapSearchDropdown.style.display = 'block';
  }

  if (mapSearchInput) {
    mapSearchInput.addEventListener('input', () => {
      const val = mapSearchInput.value.trim();
      if (mapSearchClear) mapSearchClear.style.display = val ? 'flex' : 'none';
      if (val.length >= 1) {
        renderMapSearchDropdown(val);
      } else {
        if (mapSearchDropdown) mapSearchDropdown.style.display = 'none';
      }
    });

    mapSearchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const val = mapSearchInput.value.trim();
        const coordParse = parseCoordinateInput(val);
        if (coordParse) {
          if (mapSearchDropdown) mapSearchDropdown.style.display = 'none';
          focusOnCoordinates(coordParse.lat, coordParse.lon, coordParse);
          return;
        }
        const results = searchSamplePoints(val);
        if (results.length > 0) {
          if (mapSearchDropdown) mapSearchDropdown.style.display = 'none';
          focusOnSamplePoint(results[0]);
        }
      } else if (e.key === 'Escape') {
        if (mapSearchDropdown) mapSearchDropdown.style.display = 'none';
      }
    });
  }

  if (mapSearchClear && mapSearchInput) {
    mapSearchClear.addEventListener('click', () => {
      mapSearchInput.value = '';
      mapSearchClear.style.display = 'none';
      if (mapSearchDropdown) mapSearchDropdown.style.display = 'none';
      mapSearchInput.focus();
    });
  }

  // Klik di luar dropdown untuk menutup dropdown
  document.addEventListener('click', (e) => {
    if (acListPoint && !acListPoint.contains(e.target) && e.target !== inputPoint) {
      acListPoint.style.display = 'none';
    }
    if (mapSearchDropdown && !mapSearchDropdown.contains(e.target) && e.target !== mapSearchInput) {
      mapSearchDropdown.style.display = 'none';
    }
  });
}

// =============================================================================
// 10. EVENT LISTENERS
// =============================================================================
function setupEventListeners() {
  const select = document.getElementById('sort-surveyor');
  if (select) select.addEventListener('change', () => refreshDashboard(true));

  const btnReset = document.getElementById('btn-reset-filters');
  if (btnReset) {
    btnReset.addEventListener('click', () => {
      if (select) select.value = 'default';
      refreshDashboard(true);
    });
  }

  // Toggle Mode Pewarnaan (Warna Surveyor -> Status Target -> Status QC)
  function toggleColorMode() {
    if (colorMode === 'surveyor') {
      colorMode = 'status';
    } else if (colorMode === 'status') {
      colorMode = 'qc';
    } else {
      colorMode = 'surveyor';
    }

    const btnToggleColorMode = document.getElementById('btn-toggle-color-mode');
    if (btnToggleColorMode) {
      if (colorMode === 'surveyor') {
        btnToggleColorMode.className = 'btn-map-icon active';
        btnToggleColorMode.setAttribute('title', 'Mode Pewarnaan: Warna per Surveyor (Klik untuk ganti ke Status Target)');
      } else if (colorMode === 'qc') {
        btnToggleColorMode.className = 'btn-map-icon active qc-active';
        btnToggleColorMode.setAttribute('title', 'Mode Pewarnaan: Status QC SIPENTA (Klik untuk ganti ke Warna per Surveyor)');
      } else {
        btnToggleColorMode.className = 'btn-map-icon';
        btnToggleColorMode.setAttribute('title', 'Mode Pewarnaan: Status Target (Klik untuk ganti ke Status QC SIPENTA)');
      }
    }
    refreshDashboard(false);
  }

  const btnToggleColorMode = document.getElementById('btn-toggle-color-mode');
  if (btnToggleColorMode) {
    btnToggleColorMode.addEventListener('click', toggleColorMode);
  }

  const legendModeToggle = document.getElementById('legend-mode-toggle');
  if (legendModeToggle) {
    legendModeToggle.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleColorMode();
    });
  }

  // Basemap Dropdown
  const btnBasemap = document.getElementById('btn-basemap-toggle');
  const basemapMenu = document.getElementById('basemap-menu');
  if (btnBasemap && basemapMenu) {
    btnBasemap.addEventListener('click', (e) => {
      e.stopPropagation();
      basemapMenu.classList.toggle('show');
    });

    document.querySelectorAll('.basemap-option').forEach(opt => {
      opt.addEventListener('click', () => {
        const key = opt.getAttribute('data-layer');
        if (basemaps[key]) {
          map.removeLayer(currentBasemap);
          currentBasemap = basemaps[key];
          currentBasemap.addTo(map);
          aplLayerGroup.bringToFront();
          polygonLayerGroup.bringToFront();
          pointsLayerGroup.bringToFront();

          document.querySelectorAll('.basemap-option').forEach(o => o.classList.remove('active'));
          opt.classList.add('active');
          basemapMenu.classList.remove('show');
        }
      });
    });

    document.addEventListener('click', () => basemapMenu.classList.remove('show'));
  }

  // Reset Zoom
  const btnResetZoom = document.getElementById('btn-reset-zoom');
  if (btnResetZoom) {
    btnResetZoom.addEventListener('click', () => {
      if (polygonLayerGroup && polygonLayerGroup.getLayers().length > 0) {
        try {
          const group = L.featureGroup(polygonLayerGroup.getLayers());
          map.fitBounds(group.getBounds(), { padding: [30, 30] });
        } catch (e) { }
      }
    });
  }

  // Tombol Sinkronisasi SIPENTA dari Folder Downloads
  const btnSyncSipenta = document.getElementById('btn-sync-sipenta');
  if (btnSyncSipenta) {
    btnSyncSipenta.addEventListener('click', async () => {
      btnSyncSipenta.classList.add('syncing');
      const origText = btnSyncSipenta.innerHTML;
      btnSyncSipenta.innerHTML = '<i class="fa-solid fa-rotate"></i> Mengecek...';

      try {
        const resp = await fetch('api/sync');
        if (resp.ok) {
          const result = await resp.json();
          if (result.updated) {
            alert(`✅ Sinkronisasi Berhasil!\n\nDitemukan file SIPENTA terbaru:\n${result.file}\n\nData titik sampel dan pemenuhan zona telah diperbarui!`);
            await loadSamplePoints();
            refreshDashboard(false);
          } else {
            alert(`ℹ️ Data Sudah Mutakhir.\n\nFile terakhir yang digunakan:\n${result.file || 'Data survei'}\n\nTidak ditemukan file unduhan baru di folder Downloads.`);
          }
        } else {
          alert("Tips: Jika Anda baru mengunduh file Excel dari SIPENTA, Anda juga dapat mengklik UPDATE_DATA_EXCEL.bat.");
        }
      } catch (err) {
        alert("Pengecekan selesai. Jika baru mengunduh file dari SIPENTA, jalankan UPDATE_DATA_EXCEL.bat lalu refresh browser.");
      } finally {
        btnSyncSipenta.classList.remove('syncing');
        btnSyncSipenta.innerHTML = origText;
      }
    });
  }

  // Toggle Polygons
  const togglePolygonsBtn = document.getElementById('toggle-polygons');
  let polyVisible = true;
  if (togglePolygonsBtn) {
    togglePolygonsBtn.addEventListener('click', () => {
      polyVisible = !polyVisible;
      if (polyVisible) {
        map.addLayer(polygonLayerGroup);
        togglePolygonsBtn.classList.add('active');
      } else {
        map.removeLayer(polygonLayerGroup);
        togglePolygonsBtn.classList.remove('active');
      }
    });
  }

  // Toggle Points
  const togglePointsBtn = document.getElementById('toggle-points');
  let pointsVisible = true;
  if (togglePointsBtn) {
    togglePointsBtn.addEventListener('click', () => {
      pointsVisible = !pointsVisible;
      if (pointsVisible) {
        map.addLayer(pointsLayerGroup);
        togglePointsBtn.classList.add('active');
      } else {
        map.removeLayer(pointsLayerGroup);
        togglePointsBtn.classList.remove('active');
      }
    });
  }

  // Toggle Sidebar
  const btnToggleSidebar = document.getElementById('btn-toggle-sidebar');
  const appContainer = document.querySelector('.app-container');
  if (btnToggleSidebar && appContainer) {
    btnToggleSidebar.addEventListener('click', () => {
      appContainer.classList.toggle('sidebar-collapsed');
      setTimeout(() => map.invalidateSize(), 300);
    });
  }

  // Legenda Collapse
  const legendToggleBtn = document.getElementById('legend-toggle-btn');
  const mapLegend = document.getElementById('map-legend');
  if (legendToggleBtn && mapLegend) {
    legendToggleBtn.addEventListener('click', () => {
      mapLegend.classList.toggle('collapsed');
    });
  }

  // Mobile Segments
  const mobileButtons = document.querySelectorAll('.m-seg-btn');
  mobileButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.getAttribute('data-view');
      if (appContainer) appContainer.setAttribute('data-mobile-view', view);
      mobileButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      setTimeout(() => map.invalidateSize(), 200);
    });
  });

  // Kontrol Pencarian Titik Sampel & Koordinat
  setupSearchControls();
}

// =============================================================================
// 11. ENTRY POINT / INISIALISASI
// =============================================================================
window.addEventListener('DOMContentLoaded', () => {
  if (CONFIG) {
    if (CONFIG.projectTitle) {
      updateElementText('header-title', CONFIG.projectTitle);
      updateElementText('m-header-title', CONFIG.projectTitle);
    }
    if (CONFIG.projectSubtitle) {
      updateElementText('header-sub', CONFIG.projectSubtitle);
      updateElementText('m-header-sub', CONFIG.projectSubtitle);
    }
  }

  initLeafletMap();
  initCharts();
  setupEventListeners();
  loadAllData();
});
