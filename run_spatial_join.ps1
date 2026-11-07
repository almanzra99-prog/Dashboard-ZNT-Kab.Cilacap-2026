Add-Type -AssemblyName System.IO.Compression.FileSystem

Add-Type -TypeDefinition @"
using System;
using System.IO;
using System.Collections.Generic;
using System.Text.RegularExpressions;
using System.Globalization;

public class RingInfo
{
    public bool IsHole;
    public List<double[]> Points;
    public double MinX = double.MaxValue;
    public double MaxX = double.MinValue;
    public double MinY = double.MaxValue;
    public double MaxY = double.MinValue;
}

public class ZonePolygon
{
    public string Nozn;
    public string Histzone;
    public string Penggunaan;
    public double LuasHa;
    public string Surveyor;
    public double MinX = double.MaxValue;
    public double MaxX = double.MinValue;
    public double MinY = double.MaxValue;
    public double MaxY = double.MinValue;
    public List<RingInfo> Rings = new List<RingInfo>();

    public void AddRing(List<double[]> pts)
    {
        if (pts.Count < 3) return;
        double sArea = SignedArea(pts);
        // Dalam format Esri: Area bertanda Positif di Cartesian = Counter-Clockwise = HOLE
        // Area bertanda Negatif di Cartesian = Clockwise = EXTERIOR
        bool isHole = (sArea > 0);

        var r = new RingInfo { IsHole = isHole, Points = pts };
        foreach (var p in pts)
        {
            double x = p[0], y = p[1];
            if (x < r.MinX) r.MinX = x;
            if (x > r.MaxX) r.MaxX = x;
            if (y < r.MinY) r.MinY = y;
            if (y > r.MaxY) r.MaxY = y;

            if (x < MinX) MinX = x;
            if (x > MaxX) MaxX = x;
            if (y < MinY) MinY = y;
            if (y > MaxY) MaxY = y;
        }
        Rings.Add(r);
    }

    public static double SignedArea(List<double[]> ring)
    {
        double area = 0.0;
        int n = ring.Count;
        for (int i = 0, j = n - 1; i < n; j = i++)
        {
            area += (ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1]);
        }
        return area / 2.0;
    }

    public bool Contains(double px, double py)
    {
        if (px < MinX || px > MaxX || py < MinY || py > MaxY)
            return false;

        bool insideOuter = false;
        foreach (var r in Rings)
        {
            if (px < r.MinX || px > r.MaxX || py < r.MinY || py > r.MaxY)
                continue;

            if (PointInRing(px, py, r.Points))
            {
                if (r.IsHole)
                {
                    // Titik berada di dalam lubang (hole/enclave) -> BUKAN bagian poligon ini!
                    return false;
                }
                else
                {
                    insideOuter = true;
                }
            }
        }
        return insideOuter;
    }

    private static bool PointInRing(double px, double py, List<double[]> ring)
    {
        bool inside = false;
        int n = ring.Count;
        for (int i = 0, j = n - 1; i < n; j = i++)
        {
            double xi = ring[i][0], yi = ring[i][1];
            double xj = ring[j][0], yj = ring[j][1];

            bool intersect = ((yi > py) != (yj > py))
                && (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
            if (intersect)
                inside = !inside;
        }
        return inside;
    }
}

public class SpatialJoiner
{
    private const double a = 6378137.0;
    private const double f = 1.0 / 298.257223563;
    private const double k0 = 0.9999;
    private const double x0 = 200000.0;
    private const double y0 = 1500000.0;
    private const double lon0_deg = 109.5;

    public static void Forward(double lat_deg, double lon_deg, out double x, out double y)
    {
        double lat = lat_deg * Math.PI / 180.0;
        double lon = lon_deg * Math.PI / 180.0;
        double lon0 = lon0_deg * Math.PI / 180.0;

        double e2 = 2 * f - f * f;
        double e_prime2 = e2 / (1.0 - e2);

        double N = a / Math.Sqrt(1.0 - e2 * Math.Sin(lat) * Math.Sin(lat));
        double T = Math.Tan(lat) * Math.Tan(lat);
        double C = e_prime2 * Math.Cos(lat) * Math.Cos(lat);
        double A = (lon - lon0) * Math.Cos(lat);

        double M = a * ((1.0 - e2 / 4.0 - 3.0 * e2 * e2 / 64.0 - 5.0 * e2 * e2 * e2 / 256.0) * lat
            - (3.0 * e2 / 8.0 + 3.0 * e2 * e2 / 32.0 + 45.0 * e2 * e2 * e2 / 1024.0) * Math.Sin(2.0 * lat)
            + (15.0 * e2 * e2 / 256.0 + 45.0 * e2 * e2 * e2 / 1024.0) * Math.Sin(4.0 * lat)
            - (35.0 * e2 * e2 * e2 / 3072.0) * Math.Sin(6.0 * lat));

        x = x0 + k0 * N * (A + (1.0 - T + C) * Math.Pow(A, 3.0) / 6.0
            + (5.0 - 18.0 * T + T * T + 72.0 * C - 58.0 * e_prime2) * Math.Pow(A, 5.0) / 120.0);

        y = y0 + k0 * (M + N * Math.Tan(lat) * (A * A / 2.0
            + (5.0 - T + 9.0 * C + 4.0 * C * C) * Math.Pow(A, 4.0) / 24.0
            + (61.0 - 58.0 * T + T * T + 600.0 * C - 330.0 * e_prime2) * Math.Pow(A, 6.0) / 720.0));
    }
}
"@

Write-Output "Memulai pemrosesan Spatial Join Titik Sampel ke Poligon ZNT (dengan dukungan Donut Holes)..."

# 1. Parse ZONA_CILACAP.geojson
$geoJsonPath = "datazona_znt.geojson\ZONA_CILACAP.geojson"
Write-Output "Membaca $geoJsonPath..."
$geoJsonText = [System.IO.File]::ReadAllText((Resolve-Path $geoJsonPath))

$zones = [System.Collections.Generic.List[ZonePolygon]]::new()

Write-Output "Parsing fitur poligon zona..."
$geoObj = $geoJsonText | ConvertFrom-Json

foreach ($f in $geoObj.features) {
    $zp = [ZonePolygon]::new()
    $p = $f.attributes
    if (-not $p) { $p = $f.properties }

    $zp.Nozn = "$($p.NOZN)"
    $zp.Histzone = "$($p.HISTZONE)"
    $zp.Penggunaan = "$($p.PENGGUNAAN)"
    if ($p.Luas_Ha) {
        $zp.LuasHa = [double]$p.Luas_Ha
    }
    $zp.Surveyor = "$($p.Surveyor)"

    $rings = $f.geometry.rings
    if (-not $rings) { $rings = $f.geometry.coordinates }

    foreach ($ring in $rings) {
        $rList = [System.Collections.Generic.List[double[]]]::new()
        foreach ($coord in $ring) {
            $cx = [double]$coord[0]
            $cy = [double]$coord[1]
            $rList.Add(@($cx, $cy))
        }
        $zp.AddRing($rList)
    }

    $zones.Add($zp)
}

Write-Output "Berhasil memuat $($zones.Count) poligon zona ZNT."

# 2. Baca Titik Sampel dari file XLSX terbaru (Otomatis cek folder Proyek & folder Downloads SIPENTA)
$searchPaths = @(
    (Resolve-Path "data" -ErrorAction SilentlyContinue),
    (Resolve-Path "datazona_znt.geojson" -ErrorAction SilentlyContinue),
    (Resolve-Path "." -ErrorAction SilentlyContinue)
)
$downloadsFolder = [System.IO.Path]::Combine($env:USERPROFILE, "Downloads")
try {
    if (Test-Path $downloadsFolder -ErrorAction SilentlyContinue) {
        $searchPaths += $downloadsFolder
    }
} catch { }

# Prioritas 1: Cari file hasil unduhan SIPENTA (*Data-Survey*.xlsx)
$xlsxFiles = Get-ChildItem -Path $searchPaths -Filter "*Data-Survey*.xlsx" -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
if (-not $xlsxFiles -or $xlsxFiles.Count -eq 0) {
    # Prioritas 2: Cari sembarang file Excel survei (.xlsx)
    $xlsxFiles = Get-ChildItem -Path $searchPaths -Filter "*.xlsx" -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
}

if (-not $xlsxFiles -or $xlsxFiles.Count -eq 0) {
    Write-Error "Tidak ditemukan file Excel survei (.xlsx) di folder proyek maupun folder Downloads!"
    return
}

$latestXlsx = $xlsxFiles[0]
$xlsxPath = $latestXlsx.FullName
Write-Output "Memproses file Excel: $($latestXlsx.Name)"
Write-Output "Lokasi sumber: $($latestXlsx.DirectoryName) (Tanggal: $($latestXlsx.LastWriteTime))"

# Jika file terbaru berada di folder Downloads, otomatis buat salinan arsip ke folder data proyek
if ($latestXlsx.DirectoryName -like "*Downloads*") {
    $archiveDest = Join-Path "data" $latestXlsx.Name
    try {
        Copy-Item $latestXlsx.FullName $archiveDest -Force
        Write-Output "Salinan otomatis disimpan ke folder arsip proyek: $archiveDest"
    } catch { }
}
$zip = [System.IO.Compression.ZipFile]::OpenRead($xlsxPath)

$sharedStrings = @()
$ssEntry = $zip.Entries | Where-Object { $_.FullName -eq 'xl/sharedStrings.xml' }
if ($ssEntry) {
    $stream = $ssEntry.Open()
    $reader = New-Object System.IO.StreamReader($stream)
    [xml]$ssXml = $reader.ReadToEnd()
    $stream.Close()
    $reader.Close()
    foreach ($si in $ssXml.sst.si) {
        if ($si.t) { $sharedStrings += $si.t }
        elseif ($si.r) { $sharedStrings += ($si.r.t -join '') }
        else { $sharedStrings += "" }
    }
}

$sheetEntry = $zip.Entries | Where-Object { $_.FullName -eq 'xl/worksheets/sheet1.xml' }
$stream = $sheetEntry.Open()
$reader = New-Object System.IO.StreamReader($stream)
[xml]$sheetXml = $reader.ReadToEnd()
$stream.Close()
$reader.Close()
$zip.Dispose()

$rows = $sheetXml.worksheet.sheetData.row

function Get-CellVal($c) {
    if (-not $c.v) { return "" }
    if ($c.t -eq "s") {
        $idx = [int]$c.v
        return $sharedStrings[$idx]
    }
    return $c.v
}

function Get-ColIndex([string]$cellRef) {
    $colLetters = $cellRef -replace '[0-9]', ''
    $idx = 0
    foreach ($ch in [char[]]$colLetters) {
        $idx = $idx * 26 + ([int]$ch - [int][char]'A' + 1)
    }
    return $idx - 1
}

Write-Output "Membaca $($rows.Count - 1) data survei dan mencocokkan secara spasial..."

$matchedCount = 0
$unmatchedCount = 0
$outputCsvRows = [System.Collections.Generic.List[string]]::new()
$geoJsonPoints = [System.Collections.Generic.List[string]]::new()

$headerLine = "Nomor_Sampel,Nomor_Identifikasi,Nama_Surveyor,Tanggal_Pelaksanaan,Jenis_Objek,Alamat,Kelurahan,Kecamatan,Latitude,Longitude,TM3_X,TM3_Y,Status_Hak,Jenis_Data,Harga_Penawaran_Transaksi,Luas_Tanah_M2,Nilai_Tanah_Per_M2,NOZN,HISTZONE,PENGGUNAAN_ZONA,LUAS_ZONA_HA,TARGET_SAMPEL_ZONA,STATUS_ZONA"
$outputCsvRows.Add($headerLine)

$zonePointCounts = @{}

for ($r = 1; $r -lt $rows.Count; $r++) {
    $row = $rows[$r]
    $rowCells = @{}
    foreach ($c in $row.c) {
        $idx = Get-ColIndex $c.r
        $rowCells[$idx] = Get-CellVal $c
    }

    $noSampel = $rowCells[0]
    $noId = $rowCells[2]
    $surveyor = $rowCells[3]
    $tgl = $rowCells[4]
    $jnsObjek = $rowCells[5]
    $alamat = $rowCells[6]
    $kelurahan = $rowCells[7]
    $kecamatan = $rowCells[8]
    $latStr = $rowCells[9]
    $lonStr = $rowCells[10]
    $statusHak = $rowCells[11]
    $jnsData = $rowCells[12]
    $harga = $rowCells[14]
    $luas = $rowCells[15]
    $nilaiPerM2 = $rowCells[57]

    $lat = 0; $lon = 0
    $hasCoords = [double]::TryParse($latStr, [System.Globalization.NumberStyles]::Any, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$lat) -and `
                 [double]::TryParse($lonStr, [System.Globalization.NumberStyles]::Any, [System.Globalization.CultureInfo]::InvariantCulture, [ref]$lon)

    $nozn = ""
    $histzone = ""
    $penggunaanZona = ""
    $luasZonaHa = 0
    $targetSampel = 3
    $statusZona = "Belum Terpetakan"
    $tm3X = 0; $tm3Y = 0

    if ($hasCoords) {
        [SpatialJoiner]::Forward($lat, $lon, [ref]$tm3X, [ref]$tm3Y)

        # Cari semua poligon yang memuat titik ini (jika ada overlap, ambil yang luasnya paling spesifik/kecil)
        $matchingZones = [System.Collections.Generic.List[ZonePolygon]]::new()
        foreach ($zp in $zones) {
            if ($zp.Contains($tm3X, $tm3Y)) {
                $matchingZones.Add($zp)
            }
        }

        $found = $null
        if ($matchingZones.Count -eq 1) {
            $found = $matchingZones[0]
        } elseif ($matchingZones.Count -gt 1) {
            # Ambil poligon dengan luasan terkecil (enclave / zona pemukiman di dalam pertanian)
            $smallest = $matchingZones[0]
            foreach ($mz in $matchingZones) {
                if ($mz.LuasHa -gt 0 -and $mz.LuasHa -lt $smallest.LuasHa) {
                    $smallest = $mz
                }
            }
            $found = $smallest
        }

        if ($found) {
            $nozn = $found.Nozn
            $histzone = $found.Histzone
            $penggunaanZona = $found.Penggunaan
            $luasZonaHa = $found.LuasHa

            if ($luasZonaHa -ge 1250) { $targetSampel = 5 }
            elseif ($luasZonaHa -ge 900) { $targetSampel = 4 }
            else { $targetSampel = 3 }

            $statusZona = "Masuk Zona $nozn"
            $matchedCount++

            if (-not $zonePointCounts.ContainsKey($nozn)) {
                $zonePointCounts[$nozn] = 0
            }
            $zonePointCounts[$nozn]++
        } else {
            $unmatchedCount++
            $statusZona = "Di Luar Poligon Zona"
        }

        $alamatEsc = $alamat -replace '"', '\"'
        $geoPointJson = "{`"type`":`"Feature`",`"properties`":{`"No`":`"$noSampel`",`"Id`":`"$noId`",`"Surveyor`":`"$surveyor`",`"Tgl`":`"$tgl`",`"Alamat`":`"$alamatEsc`",`"Kelurahan`":`"$kelurahan`",`"Kecamatan`":`"$kecamatan`",`"JenisData`":`"$jnsData`",`"Harga`":`"$harga`",`"Luas`":`"$luas`",`"NilaiPerM2`":`"$nilaiPerM2`",`"NOZN`":`"$nozn`",`"HISTZONE`":`"$histzone`",`"Target`":$targetSampel},`"geometry`":{`"type`":`"Point`",`"coordinates`":[$lon, $lat]}}"
        $geoJsonPoints.Add($geoPointJson)
    }

    $csvLine = "`"$noSampel`",`"$noId`",`"$surveyor`",`"$tgl`",`"$jnsObjek`",`"$alamat`",`"$kelurahan`",`"$kecamatan`",$lat,$lon,$tm3X,$tm3Y,`"$statusHak`",`"$jnsData`",`"$harga`",`"$luas`",`"$nilaiPerM2`",`"$nozn`",`"$histzone`",`"$penggunaanZona`",$luasZonaHa,$targetSampel,`"$statusZona`""
    $outputCsvRows.Add($csvLine)
}

Write-Output "=== HASIL SPATIAL JOIN ==="
Write-Output "Total Titik Sampel Diproses : $($rows.Count - 1)"
Write-Output "Titik Berhasil Masuk Zona   : $matchedCount titik"
Write-Output "Titik di Luar Poligon       : $unmatchedCount titik"
Write-Output "Jumlah Zona yang Ada Sampel : $($zonePointCounts.Keys.Count) zona"

if ($zonePointCounts.ContainsKey("641")) {
    Write-Output ">>> ZONA 641 SEKARANG MEMILIKI: $($zonePointCounts['641']) TITIK! <<<"
} else {
    Write-Output ">>> ZONA 641 MASIH BELUM ADA TITIK <<<"
}

# Simpan CSV hasil
$csvOutputPath = "data\titik_sampel_with_nozn.csv"
[System.IO.File]::WriteAllLines((Resolve-Path -Path "." | Join-Path -ChildPath $csvOutputPath), $outputCsvRows, [System.Text.Encoding]::UTF8)
Write-Output "✅ CSV tersimpan di: $csvOutputPath"

# Simpan GeoJSON Titik Sampel untuk Peta
$geoJsonOutputPath = "data\titik_sampel_with_nozn.geojson"
$fullGeoJson = "{`"type`":`"FeatureCollection`",`"name`":`"titik_sampel_cilacap`",`"features`":[" + ($geoJsonPoints -join ",") + "]}"
[System.IO.File]::WriteAllText((Resolve-Path -Path "." | Join-Path -ChildPath $geoJsonOutputPath), $fullGeoJson, [System.Text.Encoding]::UTF8)
Write-Output "✅ GeoJSON titik tersimpan di: $geoJsonOutputPath"
