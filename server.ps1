$port = 8080
$prefix = "http://localhost:$port/"
$root = $PSScriptRoot

# Fungsi Cerdas: Cek apakah ada file SIPENTA baru di Downloads atau Folder Proyek
function Check-And-Update-SIPENTA {
    try {
        $downloadsFolder = [System.IO.Path]::Combine($env:USERPROFILE, "Downloads")
        $geojsonPath = Join-Path $root "data\titik_sampel_with_nozn.geojson"
        
        $searchPaths = @(
            (Join-Path $root "data"),
            (Join-Path $root "datazona_znt.geojson"),
            $root
        )
        if (Test-Path $downloadsFolder -ErrorAction SilentlyContinue) {
            $searchPaths += $downloadsFolder
        }
        
        # Cek apakah ada pembaruan SHP_QC.geojson
        $qcCandidates = @(
            (Join-Path $root "arsip_data_mentah\SHP_QC.geojson"),
            (Join-Path $root "datazona_znt.geojson\SHP_QC.geojson")
        )
        $qcPath = $null
        foreach ($cand in $qcCandidates) {
            if (Test-Path $cand) { $qcPath = $cand; break }
        }
        $zonaPath = Join-Path $root "datazona_znt.geojson\ZONA_CILACAP.geojson"
        if (Test-Path $qcPath) {
            $qcTime = (Get-Item $qcPath).LastWriteTime
            $zonaTime = (Get-Item $zonaPath).LastWriteTime
            if ($qcTime -gt $zonaTime.AddSeconds(2)) {
                Write-Host ">>> DITEMUKAN PEMBARUAN SHP_QC.geojson! Menggabungkan atribut QC..." -ForegroundColor Cyan
                $mergeScript = Join-Path $root "merge_qc_to_zona.ps1"
                $psiQc = New-Object System.Diagnostics.ProcessStartInfo
                $psiQc.FileName = "powershell.exe"
                $psiQc.Arguments = "-ExecutionPolicy Bypass -File `"$mergeScript`""
                $psiQc.UseShellExecute = $false
                $psiQc.CreateNoWindow = $true
                $procQc = [System.Diagnostics.Process]::Start($psiQc)
                $procQc.WaitForExit(30000)
            }
        }

        $xlsxFiles = Get-ChildItem -Path $searchPaths -Filter "*Data-Survey*.xlsx" -File -ErrorAction SilentlyContinue | Sort-Object LastWriteTime -Descending
        if (-not $xlsxFiles -or $xlsxFiles.Count -eq 0) {
            return @{ updated = $false; message = "Tidak ada file survei Excel" }
        }
        
        $latestXlsx = $xlsxFiles[0]
        $shouldUpdate = $false
        
        if (-not (Test-Path $geojsonPath)) {
            $shouldUpdate = $true
        } else {
            $geojsonTime = (Get-Item $geojsonPath).LastWriteTime
            if ($latestXlsx.LastWriteTime -gt $geojsonTime.AddSeconds(2)) {
                $shouldUpdate = $true
            }
        }
        
        if ($shouldUpdate) {
            Write-Host "`n========================================================" -ForegroundColor Yellow
            Write-Host ">>> DITEMUKAN FILE SIPENTA TERBARU: $($latestXlsx.Name)" -ForegroundColor Cyan
            Write-Host ">>> Menjalankan Spatial Join otomatis..." -ForegroundColor Yellow
            
            $joinScript = Join-Path $root "run_spatial_join.ps1"
            $psi = New-Object System.Diagnostics.ProcessStartInfo
            $psi.FileName = "powershell.exe"
            $psi.Arguments = "-ExecutionPolicy Bypass -File `"$joinScript`""
            $psi.UseShellExecute = $false
            $psi.CreateNoWindow = $true
            $proc = [System.Diagnostics.Process]::Start($psi)
            $proc.WaitForExit(60000)
            
            Write-Host ">>> Spatial Join Selesai! Data Dashboard Terupdate." -ForegroundColor Green
            Write-Host "========================================================`n" -ForegroundColor Yellow
            
            return @{
                updated = $true
                file = $latestXlsx.Name
                location = $latestXlsx.DirectoryName
                time = $latestXlsx.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss")
            }
        }
        
        return @{
            updated = $false
            file = $latestXlsx.Name
            location = $latestXlsx.DirectoryName
            time = $latestXlsx.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss")
        }
    } catch {
        Write-Warning "Pengecekan update SIPENTA: $_"
        return @{ updated = $false; error = "$_" }
    }
}

# Cek pembaruan data saat server pertama kali dijalankan
Check-And-Update-SIPENTA | Out-Null

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add($prefix)

try {
    $listener.Start()
} catch {
    $port = 8085
    $prefix = "http://localhost:$port/"
    $listener = New-Object System.Net.HttpListener
    $listener.Prefixes.Add($prefix)
    $listener.Start()
}

Write-Host "==========================================================" -ForegroundColor Green
Write-Host "   DASHBOARD ZNT CILACAP 2026 BERHASIL DIAKTIFKAN!" -ForegroundColor Cyan
Write-Host "   Alamat: $prefix" -ForegroundColor Yellow
Write-Host "   Fitur Auto-Sync SIPENTA dari Downloads Aktif!" -ForegroundColor Magenta
Write-Host "==========================================================" -ForegroundColor Green
Write-Host "Sedang membuka browser..."

Start-Process $prefix

$mimeMap = @{
    ".html" = "text/html; charset=utf-8"
    ".htm"  = "text/html; charset=utf-8"
    ".css"  = "text/css; charset=utf-8"
    ".js"   = "application/javascript; charset=utf-8"
    ".json" = "application/json; charset=utf-8"
    ".geojson" = "application/json; charset=utf-8"
    ".png"  = "image/png"
    ".jpg"  = "image/jpeg"
    ".jpeg" = "image/jpeg"
    ".svg"  = "image/svg+xml"
    ".ico"  = "image/x-icon"
}

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        $path = $request.Url.LocalPath.TrimStart('/')
        if ([string]::IsNullOrEmpty($path)) {
            $path = "index.html"
        }

        # API SINKRONISASI SIPENTA (/api/sync)
        if ($path -eq "api/sync" -or $path -eq "api/check-update") {
            $syncRes = Check-And-Update-SIPENTA
            $jsonStr = $syncRes | ConvertTo-Json -Compress
            $resBytes = [System.Text.Encoding]::UTF8.GetBytes($jsonStr)
            
            $response.ContentType = "application/json; charset=utf-8"
            $response.AddHeader("Access-Control-Allow-Origin", "*")
            $response.ContentLength64 = $resBytes.Length
            $response.OutputStream.Write($resBytes, 0, $resBytes.Length)
            $response.Close()
            continue
        }

        # Cek otomatis saat refresh halaman utama atau meminta geojson titik
        if ($path -eq "index.html" -or $path -eq "data/titik_sampel_with_nozn.geojson") {
            Check-And-Update-SIPENTA | Out-Null
        }

        # URL decode path
        $path = [System.Uri]::UnescapeDataString($path)
        $localPath = Join-Path $root $path

        if (Test-Path $localPath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($localPath).ToLower()
            $mime = "application/octet-stream"
            if ($mimeMap.ContainsKey($ext)) {
                $mime = $mimeMap[$ext]
            }

            $response.ContentType = $mime
            $response.AddHeader("Access-Control-Allow-Origin", "*")

            $bytes = [System.IO.File]::ReadAllBytes($localPath)
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $response.StatusCode = 404
            $errBytes = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found: $path")
            $response.OutputStream.Write($errBytes, 0, $errBytes.Length)
        }
        $response.Close()
    } catch {
        # Listener stopped or client disconnected
    }
}
