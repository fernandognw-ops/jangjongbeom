# Start server on port 3007 (kill existing process first)
$port = 3007
$projectRoot = Split-Path $PSScriptRoot -Parent

Write-Host "[1] Killing process on port $port..."
$conns = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
foreach ($c in $conns) {
  if ($c.OwningProcess -and $c.OwningProcess -ne 0) {
    Stop-Process -Id $c.OwningProcess -Force -ErrorAction SilentlyContinue
    Write-Host "    PID $($c.OwningProcess) stopped"
  }
}
Start-Sleep -Seconds 3

Write-Host "[2] Starting production server at http://localhost:$port"
Set-Location $projectRoot
npm run start
