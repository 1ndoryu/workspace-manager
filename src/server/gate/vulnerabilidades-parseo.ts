/* Parseo puro de la salida de audit (npm, pnpm, cargo) y reglas de alcance de
 * los crates. [por que] Vive aparte de vulnerabilidades.ts: sin efectos (ni
 * CLI ni disco) para poder probarlo solo, y para no pasar del limite de 300
 * lineas por archivo. */
import type { AnalisisVulnerabilidades, HallazgoVulnerabilidad } from '../../shared/types.js';

/* Gestor que produjo el audit. Mismo conjunto que LockDetectado.gestor. */
export type Gestor = 'npm' | 'pnpm' | 'cargo';

/* Normaliza una severidad arbitraria del JSON de audit a las 4 conocidas.
 * cargo audit usa severidad por CVSS (informational/low/medium/high/critical);
 * npm/pnpm usan info/low/moderate/high/critical. Se mapea a las 4. */
function sev(s: unknown): HallazgoVulnerabilidad['severidad'] {
  const t = String(s ?? 'low').toLowerCase();
  if (t === 'critical') return 'critical';
  if (t === 'high') return 'high';
  if (t === 'moderate' || t === 'medium') return 'moderate';
  return 'low';
}

/* npm audit --json: { metadata: { vulnerabilities: {info,low,moderate,high,
 * critical} }, vulnerabilities: { "<paquete>": { severity, ... } } }.
 * pnpm audit --json: { metadata: {...}, vulnerabilities: [ {name,severity,...} ] }.
 * cargo audit --json: { vulnerabilities: { found, count, list: [ {advisory,
 *                       versions, affected} ] }, ... }. */
export interface JsonAudit {
  vulnerabilities?: unknown;
}

/* El resumen se deriva siempre de los hallazgos: pnpm no trae `metadata` y, si
 * se leyera de ahi, un proyecto con vulnerabilidades saldria como 'ok'. */
export function parsearAudit(g: Gestor, crudo: JsonAudit): {
  resumen: AnalisisVulnerabilidades['resumen'];
  hallazgos: HallazgoVulnerabilidad[];
} {
  const hallazgos: HallazgoVulnerabilidad[] = [];
  const vulns = crudo.vulnerabilities;
  const agregar = (paquete: string, s: unknown, rango: string) => {
    hallazgos.push({ paquete, severidad: sev(s), rango });
  };

  if (g === 'cargo') {
    /* cargo-audit 0.22 emite `vulnerabilities` como {found,count,list} con
     * `list` = array de {advisory, versions, affected}; versiones viejas
     * emitian un mapa id -> objeto. Leer found/count/list como paquetes daba
     * falsos positivos, asi que la forma se detecta por el array `list`. */
    if (vulns && typeof vulns === 'object') {
      const mapa = vulns as Record<string, unknown>;
      const lista = Array.isArray(mapa['list'])
        ? (mapa['list'] as Array<Record<string, unknown>>)
        : null;
      if (lista) {
        for (const item of lista) {
          const adv = (item['advisory'] ?? {}) as Record<string, unknown>;
          const vers = (item['versions'] ?? {}) as Record<string, unknown>;
          const parcheadas = Array.isArray(vers['patched'])
            ? (vers['patched'] as unknown[]).map(String).join(', ')
            : '';
          const severityRaw =
            adv['severity'] ??
            (item['cvss'] as { severity?: unknown } | undefined)?.severity ??
            (adv['cvss'] as { severity?: unknown } | undefined)?.severity;
          agregar(
            String(adv['package'] ?? item['package'] ?? '?'),
            severityRaw,
            parcheadas,
          );
        }
      } else {
        for (const [id, v] of Object.entries(mapa)) {
          const o = (v ?? {}) as Record<string, unknown>;
          const severityRaw =
            o['severity'] ??
            (o['cvss'] as { severity?: unknown } | undefined)?.severity ??
            (o['advisory'] as { severity?: unknown } | undefined)?.severity;
          agregar(
            String(o['package'] ?? id),
            severityRaw,
            String(o['vulnerable_versions'] ?? o['range'] ?? ''),
          );
        }
      }
    }
    return { resumen: contar(hallazgos), hallazgos };
  }

  if (Array.isArray(vulns)) {
    /* pnpm: array de { name, severity, range }. */
    for (const v of vulns as Array<Record<string, unknown>>) {
      agregar(String(v['name'] ?? '?'), v['severity'], String(v['range'] ?? ''));
    }
    return { resumen: contar(hallazgos), hallazgos };
  }
  if (vulns && typeof vulns === 'object') {
    /* npm: mapa paquete -> { severity, ... }. */
    for (const [pkg, v] of Object.entries(vulns as Record<string, unknown>)) {
      const o = (v ?? {}) as Record<string, unknown>;
      agregar(pkg, o['severity'], String(o['range'] ?? o['range_safe'] ?? ''));
    }
  }
  return { resumen: contar(hallazgos), hallazgos };
}

/* Nombre de crate seguro para la linea de `cargo tree`: solo letras, digitos,
 * `-` y `_`. Cualquier otra cosa no llega a la shell. */
export function nombrePaqueteValido(nombre: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(nombre);
}

/* `cargo tree -i <crate> -e normal,build --target all` sale 0 con stdout vacio
 * cuando el crate no esta en el grafo de build ("nothing to print"). Cualquier
 * otro resultado (exit != 0 por crate no descargado, timeout) es "desconocido" y
 * se trata como alcanzable: es el lado conservador. */
export function esNoAlcanzable(codigo: number | null, stdout: string): boolean {
  return codigo === 0 && stdout.trim() === '';
}

export function contar(hallazgos: HallazgoVulnerabilidad[]): AnalisisVulnerabilidades['resumen'] {
  const resumen = { critical: 0, high: 0, moderate: 0, low: 0 };
  for (const h of hallazgos) resumen[h.severidad]++;
  return resumen;
}
