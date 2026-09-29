<#
.SYNOPSIS
  Reconstruye coolify-manager-rs y publica el binario duradero que usa la tab vps.
.DESCRIPTION
  C:\tmp se purga cada hora: el binario NO vive ahi. Destino duradero:
  C:\Users\Owner\bin\coolify-manager.exe (+ .version con commit fuente).
  La compilacion usa CARGO_TARGET_DIR en C:\tmp (regla del area) con sccache;
  si C:\tmp supera 6 GB y no hay target ajeno que purgar, falla con mensaje
  en vez de borrar el target activo de otro proyecto (preguntar al usuario).
  Uso: powershell -ExecutionPolicy Bypass -File scripts\actualizar-coolify-manager.ps1
#>
[CmdletBinding()]
param(
  [string]$Repo = "C:\Users\Owner\OneDrive\Documentos\area-trabajo\coolify-manager-rs",
  [string]$DestinoDir = "C:\Users\Owner\bin",
  [string]$TargetDir = "C:\tmp\glory-target\coolify-manager"
)
$ErrorActionPreference = "Stop"

if (-not (Test-Path -LiteralPath $Repo)) { throw "Repo no existe: $Repo" }
$rama = (git -C $Repo rev-parse --abbrev-ref HEAD).Trim()
if ($rama -ne "main") { throw "El repo esta en '$rama', se exige 'main'. Cambia tu y reintenta." }
if ((git -C $Repo status --porcelain).Trim() -ne "") { throw "Hay cambios sin commitear en el repo. Limpia antes de compilar." }

$tmpBytes = (Get-ChildItem -LiteralPath "C:\tmp" -Recurse -File -ErrorAction SilentlyContinue |
  Measure-Object -Property Length -Sum).Sum
$tmpGB = $tmpBytes / 1GB
if ($tmpGB -gt 6 -and -not (Test-Path -LiteralPath $TargetDir)) {
  throw ("C:\tmp en {0:N2} GB (>6 GB) y no hay target propio que reutilizar. " -f $tmpGB +
    "Libera un target de rama en desuso o pide confirmacion antes de tocar el activo, y reintenta.")
}

$env:CARGO_TARGET_DIR = $TargetDir
$env:RUSTC_WRAPPER = "sccache"
if (-not $env:SCCACHE_CACHE_SIZE) { $env:SCCACHE_CACHE_SIZE = "5G" }

Write-Host "Compilando release en $TargetDir ..."
& cargo build --release --manifest-path (Join-Path $Repo "Cargo.toml")
if ($LASTEXITCODE -ne 0) { throw "cargo build fallo (exit $LASTEXITCODE)." }

$origen = Join-Path $TargetDir "release\coolify-manager.exe"
if (-not (Test-Path -LiteralPath $origen)) { throw "No se genero: $origen" }
if (-not (Test-Path -LiteralPath $DestinoDir)) {
  New-Item -ItemType Directory -Path $DestinoDir | Out-Null
}
Copy-Item -LiteralPath $origen -Destination (Join-Path $DestinoDir "coolify-manager.exe") -Force
$commit = (git -C $Repo rev-parse HEAD).Trim()
"fuente=coolify-manager-rs@$commit`nfecha=$(Get-Date -Format 'yyyy-MM-dd HH:mm')" |
  Set-Content -LiteralPath (Join-Path $DestinoDir "coolify-manager.version") -Encoding UTF8

$ver = & (Join-Path $DestinoDir "coolify-manager.exe") --version
Write-Host "OK: $ver (commit $commit)"
