<#
.SYNOPSIS
  Reconstruye coolify-manager-rs y publica el binario duradero que usa la tab vps.
.DESCRIPTION
  El portatil no compila Rust desde el 2026-10-16 (AGENTS §1): la compilacion la
  hace la VPS 89 cruzada a Windows (cargo-xwin), en
  coolify-manager-rs\scripts\build-windows.mjs. Aqui solo se publica el
  resultado, que es lo que necesita el taller.
  C:\tmp se purga cada hora: el binario NO vive ahi. Destino duradero:
  <home>\bin\coolify-manager.exe (+ .version con commit fuente).
  Uso: powershell -ExecutionPolicy Bypass -File scripts\actualizar-coolify-manager.ps1
#>
[CmdletBinding()]
param(
  [string]$Repo,
  [string]$DestinoDir,
  [string]$HostRemoto
)
$ErrorActionPreference = "Stop"

# Ninguna ruta de esta maquina va incrustada: el area es la carpeta padre de este
# repo, el binario duradero vive en <home>\bin y el host del taller sale de la
# config privada. Los tres se pueden pisar por parametro.
if (-not $Repo) { $Repo = Join-Path (Split-Path (Split-Path $PSScriptRoot -Parent) -Parent) "coolify-manager-rs" }
if (-not $DestinoDir) { $DestinoDir = Join-Path $env:USERPROFILE "bin" }
if (-not $HostRemoto) {
  $ficha = Join-Path $PSScriptRoot "..\config\taller.json"
  if (-not (Test-Path -LiteralPath $ficha)) {
    throw "Falta $ficha: define -HostRemoto o crea la config privada (config\ejemplos\taller.example.json)."
  }
  $HostRemoto = (Get-Content -Raw -LiteralPath $ficha | ConvertFrom-Json).host
}

if (-not (Test-Path -LiteralPath $Repo)) { throw "Repo no existe: $Repo" }
$rama = (git -C $Repo rev-parse --abbrev-ref HEAD).Trim()
if ($rama -ne "main") { throw "El repo esta en '$rama', se exige 'main'. Cambia tu y reintenta." }
# quality-tools.json y sentinel.lock.json los reescriben las herramientas de
# calidad solas: no son cambios de codigo y no deben bloquear la compilacion.
$sucios = @(git -C $Repo status --porcelain |
  Where-Object { $_ -notmatch 'quality-tools\.json|sentinel\.lock\.json' })
if ($sucios.Count -gt 0) { throw "Hay cambios sin commitear en el repo. Limpia antes de compilar:`n$($sucios -join "`n")" }

$tmpExe = "C:\tmp\coolify-manager-rs\coolify-manager.exe"
Write-Host "Compilando en la VPS 89 (cross-compile a Windows) ..."
& node (Join-Path $Repo "scripts\build-windows.mjs") --salida $tmpExe --host $HostRemoto
if ($LASTEXITCODE -ne 0) { throw "build-windows.mjs fallo (exit $LASTEXITCODE)." }
if (-not (Test-Path -LiteralPath $tmpExe)) { throw "No se genero: $tmpExe" }

if (-not (Test-Path -LiteralPath $DestinoDir)) {
  New-Item -ItemType Directory -Path $DestinoDir | Out-Null
}
$final = Join-Path $DestinoDir "coolify-manager.exe"
Copy-Item -LiteralPath $tmpExe -Destination $final -Force
$commit = (git -C $Repo rev-parse HEAD).Trim()
"fuente=coolify-manager-rs@$commit`nfecha=$(Get-Date -Format 'yyyy-MM-dd HH:mm')" |
  Set-Content -LiteralPath (Join-Path $DestinoDir "coolify-manager.version") -Encoding UTF8

$ver = & $final --version
if ($LASTEXITCODE -ne 0) { throw "El binario publicado no arranca (exit $LASTEXITCODE)." }
Write-Host "OK: $ver (commit $commit)"
