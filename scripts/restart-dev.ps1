# 재고 시스템 개발 서버 재시작 스크립트
# 사용법: .\scripts\restart-dev.ps1
# 또는: powershell -ExecutionPolicy Bypass -File .\scripts\restart-dev.ps1

$ErrorActionPreference = "Stop"
$port = 3007

Write-Host "1. 포트 $port 사용 프로세스 확인 중..." -ForegroundColor Cyan
$processes = @()
try {
  $conns = Get-NetTCPConnection -LocalPort $port -ErrorAction SilentlyContinue
  $processes = $conns | Select-Object -ExpandProperty OwningProcess -Unique | Where-Object { $_ -ne 0 }
} catch {
  # netstat fallback
  $lines = netstat -ano | Select-String ":$port\s+.*LISTENING"
  foreach ($line in $lines) {
    $parts = $line -split '\s+'
    $procId = $parts[-1]
    if ($procId -match '^\d+$' -and $procId -ne '0') { $processes += [int]$procId }
  }
  $processes = $processes | Select-Object -Unique
}

if ($processes) {
  foreach ($procId in $processes) {
    try {
      $proc = Get-Process -Id $procId -ErrorAction SilentlyContinue
      if ($proc) {
        Write-Host "   PID $procId ($($proc.ProcessName)) 종료 중..." -ForegroundColor Yellow
        Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
      }
    } catch {}
  }
  Write-Host "   완료." -ForegroundColor Green
} else {
  Write-Host "   사용 중인 프로세스 없음." -ForegroundColor Green
}

Write-Host "2. .next 캐시 삭제 중..." -ForegroundColor Cyan
$projectRoot = Split-Path $PSScriptRoot -Parent
$nextPath = Join-Path $projectRoot ".next"
if (Test-Path $nextPath) {
  Remove-Item -Recurse -Force $nextPath -ErrorAction SilentlyContinue
  Write-Host "   완료." -ForegroundColor Green
} else {
  Write-Host "   캐시 없음." -ForegroundColor Green
}

Write-Host "3. 개발 서버 시작 중 (http://localhost:$port)..." -ForegroundColor Cyan
Set-Location $projectRoot
npm run dev
