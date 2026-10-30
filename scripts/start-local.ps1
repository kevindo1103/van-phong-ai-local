# Start AI Office locally on Windows. Does not edit AGENTS.md / CLAUDE.md.
$ErrorActionPreference = 'Stop'
$repo = Split-Path $PSScriptRoot -Parent
Set-Location $repo
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  throw "Node.js >=18 is required"
}
if (-not (Test-Path (Join-Path $repo 'node_modules\three\build\three.module.js'))) {
  Write-Host 'Installing pinned Three.js package...' -ForegroundColor Cyan
  & npm.cmd ci --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw 'npm ci failed' }
}
if (-not (Test-Path (Join-Path $repo 'config.json'))) {
  $setupArgs = @('setup.js', '--yes', '--title', 'AI Operations | Bingxue', '--owner', 'Admin')
  if (Test-Path 'D:\BINGXUE_ERP') {
    $setupArgs += @('--project', 'D:/BINGXUE_ERP')
  }
  if (Test-Path 'D:\BingxueWorktrees') {
    $setupArgs += @('--project', 'D:/BingxueWorktrees')
  }
  & node @setupArgs
  if ($LASTEXITCODE -ne 0) { throw 'Cannot create local config' }
}
Write-Host 'Office: http://127.0.0.1:7788 (Ctrl+C to stop)' -ForegroundColor Green
& node server.js
