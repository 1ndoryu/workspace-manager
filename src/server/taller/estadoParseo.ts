/* Parte pura del estado del taller: forma de la sonda, parseo del historial, script de
 * Mutagen y lectura de sus sesiones. Sin red, procesos ni reloj: se prueba sin mocks.
 * [por que] Separada de `estado.ts` (límite de 300 líneas) para que lo que decide la
 * conformidad no comparta archivo con lo que la lee. */
import type { EstadoTaller89, MuestraHistorial } from '../../shared/taller/conformidad.js';
import { esNumero, esObjeto } from '../../shared/guardas.js';

/* Comprueba la forma antes de confiar en el JSON: una sonda desactualizada o rota no debe
 * producir hallazgos falsos ni «sano» por campos ausentes. */
export function errorFormaTaller89(x: unknown): string | null {
  if (!esObjeto(x)) return 'la sonda no devolvió un objeto';
  if (x.version !== 1) return `versión de sonda no soportada (${String(x.version)})`;
  const ok = esObjeto(x.disco) && esNumero(x.disco.libreGb)
    && esObjeto(x.sweep)
    && esObjeto(x.memoria) && esNumero(x.memoria.disponibleMiB) && esNumero(x.memoria.swapUsadaMiB)
    && Array.isArray(x.escuchas) && Array.isArray(x.tmux)
    && esObjeto(x.cmHeavy) && Array.isArray(x.buildsFueraDeCmHeavy) && Array.isArray(x.secretos)
    && esObjeto(x.cloudflared) && esObjeto(x.bdTrabajo) && typeof x.managerDaemonVivo === 'boolean';
  return ok ? null : 'la sonda devolvió campos incompletos';
}

/* Convierte el texto de estado.jsonl en muestras, de la más antigua a la más reciente. Una
 * línea rota o de otra forma se descarta sin parar la lectura: una mala no oculta las buenas. */
export function parsearHistorial(texto: string): MuestraHistorial[] {
  const muestras: MuestraHistorial[] = [];
  for (const linea of texto.split('\n')) {
    if (!linea.trim()) continue;
    let x: unknown;
    try {
      x = JSON.parse(linea);
    } catch {
      continue;
    }
    if (errorFormaTaller89(x) || typeof (x as { tomadaEn?: unknown }).tomadaEn !== 'string') continue;
    const t = x as EstadoTaller89;
    muestras.push({
      tomadaEn: t.tomadaEn,
      libreGb: t.disco.libreGb,
      disponibleMiB: t.memoria.disponibleMiB,
      swapUsadaMiB: t.memoria.swapUsadaMiB,
      cmHeavyOcupado: t.cmHeavy.ocupado,
      cloudflaredViva: t.cloudflared.viva,
      managerDaemonVivo: t.managerDaemonVivo,
    });
  }
  return muestras;
}

/* [por que] Procesos y escuchas ya no salen de aquí: los lee `sistemaLocal` (un solo CIM y un
 * netstat, compartidos con la vigilancia). Esta consulta queda solo para Mutagen, que no está en
 * esa lectura. -EncodedCommand evita el reparto de comillas entre Node y PowerShell. */
export const SCRIPT_MUTAGEN = `
try { [Console]::OutputEncoding = [Text.Encoding]::UTF8 } catch {}
$ErrorActionPreference = 'Stop'
$mutagenExe = resolverMutagen
$mutagenPresente = [bool]$mutagenExe
$mutagenOk = $false
$mutagenSalida = ''
if ($mutagenPresente) {
  try {
    $mutagenSalida = (& $mutagenExe sync list 2>&1 | Out-String)
    $mutagenOk = ($LASTEXITCODE -eq 0)
  } catch {
    $mutagenSalida = $_.ToString()
  }
}
[pscustomobject]@{ mutagenPresente = $mutagenPresente; mutagenOk = $mutagenOk; mutagenSalida = $mutagenSalida } | ConvertTo-Json -Compress -Depth 4
`;

/* [por que] `Get-Command mutagen` no basta: el binario puede estar fuera del PATH del
 * PowerShell no interactivo que arranca el manager (16AA-13). Sin esto, L3 sale en
 * error siempre y el sync L→89 no se comprueba nunca. Se prueba el PATH, luego el
 * declarado en la config y, como último recurso, donde lo deja su instalador. */
export function funcionMutagen(declarado: string | null): string {
  /* Cita para PowerShell (comilla simple doblada): la ruta la escribe la config. */
  const ruta = declarado ? `'${declarado.replace(/'/g, "''")}'` : "''";
  return `
function resolverMutagen {
  $cmd = Get-Command mutagen -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidatos = @(
    ${ruta},
    (Join-Path $env:LOCALAPPDATA 'Mutagen\\mutagen.exe')
  )
  foreach ($c in $candidatos) { if ($c -and (Test-Path -LiteralPath $c)) { return $c } }
  return $null
}
`;
}

/* Sesiones taller-* de Mutagen malas: parada, con conflictos o con problemas.
 * [por que] El parser es conservador: sin «Watching» u otro estado de sync, avisa. */
export function sesionesMutagenMalas(salida: string): string[] {
  const malas: string[] = [];
  /* PowerShell devuelve CRLF: se normaliza antes de partir por líneas. */
  for (const bloque of salida.replace(/\r\n/g, '\n').split(/^(?=Name: )/m)) {
    const nombre = /^Name: (.+)$/m.exec(bloque)?.[1]?.trim();
    if (!nombre || !nombre.startsWith('taller-')) continue;
    const estado = /^Status: (.+)$/m.exec(bloque)?.[1]?.trim() ?? 'sin estado';
    const enSync = /Watching|Scanning|Staging|Reconciling|Synchronizing|Saving|Transitioning/i.test(estado);
    if (!enSync || /^(Conflicts|Problems):/m.test(bloque)) malas.push(`${nombre} (${estado})`);
  }
  return malas;
}
