$qcSearchPaths = @(
    ".\arsip_data_mentah\SHP_QC.geojson",
    ".\datazona_znt.geojson\SHP_QC.geojson",
    ".\SHP_QC.geojson"
)
$qcPath = $null
foreach ($p in $qcSearchPaths) {
    if (Test-Path $p) {
        $qcPath = $p
        break
    }
}
$zonaPath = ".\datazona_znt.geojson\ZONA_CILACAP.geojson"

if (-not $qcPath) {
    Write-Error "File SHP_QC.geojson tidak ditemukan!"
    exit 1
}

Write-Host "Membaca SHP_QC dari: $qcPath..."
$qcJson = Get-Content -Path $qcPath -Raw | ConvertFrom-Json

# Buat kamus mapping QC berdasarkan NOZN
$qcDict = @{}
foreach ($feat in $qcJson.features) {
    $attrs = $feat.attributes
    if (-not $attrs) { $attrs = $feat.properties }
    $nozn = "$($attrs.NOZN)".Trim()
    
    $rataNilai = 0
    if ($null -ne $attrs.Rata_Nilai) {
        $rataNilai = [Math]::Round([double]$attrs.Rata_Nilai, 2)
    }
    
    $rsdPersen = 0
    if ($null -ne $attrs.RSD_Persen) {
        $rsdPersen = [Math]::Round([double]$attrs.RSD_Persen, 2)
    }
    
    $statusQc = ""
    if ($null -ne $attrs.Status_QC) {
        $statusQc = "$($attrs.Status_QC)".Trim()
    }

    $jmlTitik = 0
    if ($null -ne $attrs.Jml_Titik) {
        $jmlTitik = [int]$attrs.Jml_Titik
    }
    
    $qcDict[$nozn] = @{
        Rata_Nilai = $rataNilai
        RSD_Persen = $rsdPersen
        Status_QC  = $statusQc
        Jml_Titik_QC = $jmlTitik
    }
}

Write-Host "Berhasil memetakan $($qcDict.Count) zona dari SHP_QC.geojson."

Write-Host "Membaca ZONA_CILACAP.geojson..."
$zonaJson = Get-Content -Path $zonaPath -Raw | ConvertFrom-Json

$mergedCount = 0
foreach ($feat in $zonaJson.features) {
    $attrs = $feat.attributes
    if (-not $attrs) { $attrs = $feat.properties }
    $nozn = "$($attrs.NOZN)".Trim()
    
    if ($qcDict.ContainsKey($nozn)) {
        $qcData = $qcDict[$nozn]
        
        $attrs | Add-Member -NotePropertyName "Rata_Nilai" -NotePropertyValue $qcData.Rata_Nilai -Force
        $attrs | Add-Member -NotePropertyName "RSD_Persen" -NotePropertyValue $qcData.RSD_Persen -Force
        $attrs | Add-Member -NotePropertyName "Status_QC" -NotePropertyValue $qcData.Status_QC -Force
        $attrs | Add-Member -NotePropertyName "Jml_Titik_QC" -NotePropertyValue $qcData.Jml_Titik_QC -Force
        
        $mergedCount++
    }
}

Write-Host "Menggabungkan $mergedCount dari $($zonaJson.features.Count) zona..."

$fullZonaPath = [System.IO.Path]::GetFullPath($zonaPath)
$jsonOutput = $zonaJson | ConvertTo-Json -Depth 20 -Compress
[System.IO.File]::WriteAllText($fullZonaPath, $jsonOutput, [System.Text.Encoding]::UTF8)

$sizeMb = [Math]::Round((Get-Item $fullZonaPath).Length / 1MB, 2)
Write-Host "SUKSES! ZONA_CILACAP.geojson berhasil diperbarui dengan data QC!" -ForegroundColor Green
Write-Host "Ukuran file akhir: $sizeMb MB (Aman untuk GitHub Pages < 25 MB)" -ForegroundColor Cyan
