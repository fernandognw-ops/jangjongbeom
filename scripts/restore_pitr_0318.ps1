# ============================================================
# Supabase PITR 복원 스크립트
# 복원 시점: 2026-03-18 07:00 KST
# ============================================================
# 사용법:
#   $env:SUPABASE_ACCESS_TOKEN = "sbp_xxxxxxxx"
#   .\scripts\restore_pitr_0318.ps1
#
# 토큰 발급: https://supabase.com/dashboard/account/tokens
# ============================================================

$PROJECT_REF = "slnmhblsxzjgmaqbfbwa"
$RECOVERY_TIME = 1773784800  # 2026-03-18 07:00 KST

$token = $env:SUPABASE_ACCESS_TOKEN
if (-not $token) {
    Write-Host "오류: SUPABASE_ACCESS_TOKEN 환경 변수를 설정하세요." -ForegroundColor Red
    Write-Host "  예: `$env:SUPABASE_ACCESS_TOKEN = `"sbp_xxxxxxxx`"" -ForegroundColor Yellow
    exit 1
}

$body = @{ recovery_time_target_unix = $RECOVERY_TIME } | ConvertTo-Json
$uri = "https://api.supabase.com/v1/projects/$PROJECT_REF/database/backups/restore-pitr"

Write-Host "PITR 복원 요청 중..." -ForegroundColor Cyan
Write-Host "  프로젝트: $PROJECT_REF" -ForegroundColor Gray
Write-Host "  복원 시점: 2026-03-18 07:00 KST (Unix: $RECOVERY_TIME)" -ForegroundColor Gray

try {
    $response = Invoke-RestMethod -Method Post `
        -Uri $uri `
        -Headers @{
            "Authorization" = "Bearer $token"
            "Content-Type"  = "application/json"
        } `
        -Body $body

    Write-Host "복원 요청이 접수되었습니다." -ForegroundColor Green
    Write-Host $response
} catch {
    $statusCode = $_.Exception.Response.StatusCode.value__
    $errBody = $_.ErrorDetails.Message
    Write-Host "오류 ($statusCode): $errBody" -ForegroundColor Red
    if ($statusCode -eq 403) {
        Write-Host "PITR은 Pro 플랜 + PITR 애드온이 필요합니다." -ForegroundColor Yellow
    }
    exit 1
}
