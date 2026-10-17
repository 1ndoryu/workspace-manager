/* Severidad CVSS 3.1 a partir del vector. [por que] `cargo audit` no emite un
 * campo `severity`: el aviso RUSTSEC trae `cvss` como **vector de texto**
 * ("CVSS:3.1/AV:N/AC:H/PR:N/UI:N/S:U/C:N/I:N/A:L") y nada mas. El parser leia
 * `cvss.severity`, que sobre una cadena es `undefined`, y caia en el valor por
 * defecto de `sev()`: **todas** las vulnerabilidades de cargo salian `low`.
 * Medido el 2026-10-17 sobre la salida real de KAMPLES: dos avisos de `zip` son
 * 9.1 (criticos) y dos 7.3 (altos) y el tablero los pintaba como `low`. No era
 * un detalle de presentacion: era severidad bajada, que es justo lo que no se
 * puede hacer con un problema real.
 *
 * Se implementa la formula base de CVSS 3.1 en vez de aproximar por metricas
 * sueltas: es determinista, esta especificada y se puede probar contra valores
 * conocidos. La banda cualitativa es la de la propia especificacion. */

export type BandaCvss = 'critical' | 'high' | 'moderate' | 'low';

const PESO_AV: Record<string, number> = { N: 0.85, A: 0.62, L: 0.55, P: 0.2 };
const PESO_AC: Record<string, number> = { L: 0.77, H: 0.44 };
const PESO_UI: Record<string, number> = { N: 0.85, R: 0.62 };
const PESO_CIA: Record<string, number> = { H: 0.56, L: 0.22, N: 0 };
/* PR depende del alcance: 3.1 usa pesos distintos en S:U y S:C. */
const PESO_PR_U: Record<string, number> = { N: 0.85, L: 0.62, H: 0.27 };
const PESO_PR_C: Record<string, number> = { N: 0.85, L: 0.68, H: 0.5 };

/* Redondeo al alza al primer decimal, con la regla de 3.1: un valor ya exacto
 * no sube (2.30 queda 2.3, no 2.4). */
function redondearArriba(x: number): number {
  const mil = Math.round(x * 100000);
  return mil % 10000 === 0 ? mil / 100000 : (Math.floor(mil / 10000) + 1) / 10;
}

/* Metricas del vector, o `null` si falta alguna de las ocho que puntuan. Un
 * vector truncado no se adivina: mejor sin dato que con dato inventado. */
function metricas(vector: string): Record<string, string> | null {
  if (!/^CVSS:3\.[01]\//.test(vector)) return null;
  const m: Record<string, string> = {};
  for (const parte of vector.slice(vector.indexOf('/') + 1).split('/')) {
    const [k, v] = parte.split(':');
    if (k && v) m[k] = v;
  }
  const necesarias = ['AV', 'AC', 'PR', 'UI', 'S', 'C', 'I', 'A'];
  return necesarias.every((k) => m[k] !== undefined) ? m : null;
}

/** Puntuacion base CVSS 3.1 (0-10), o `null` si el vector no es interpretable. */
export function puntuacionCvss(vector: string): number | null {
  const m = metricas(vector);
  if (!m) return null;
  const av = PESO_AV[m.AV];
  const ac = PESO_AC[m.AC];
  const ui = PESO_UI[m.UI];
  const c = PESO_CIA[m.C];
  const i = PESO_CIA[m.I];
  const a = PESO_CIA[m.A];
  const cambiado = m.S === 'C';
  const pr = (cambiado ? PESO_PR_C : PESO_PR_U)[m.PR];
  if (av === undefined || ac === undefined || ui === undefined || c === undefined
    || i === undefined || a === undefined || pr === undefined) {
    return null;
  }
  const iss = 1 - (1 - c) * (1 - i) * (1 - a);
  const impacto = cambiado
    ? 7.52 * (iss - 0.029) - 3.25 * (iss - 0.02) ** 15
    : 6.42 * iss;
  if (impacto <= 0) return 0;
  const explotabilidad = 8.22 * av * ac * pr * ui;
  const bruto = cambiado
    ? Math.min(1.08 * (impacto + explotabilidad), 10)
    : Math.min(impacto + explotabilidad, 10);
  return redondearArriba(bruto);
}

/** Banda cualitativa de CVSS 3.1: 0.1-3.9 baja, 4.0-6.9 media, 7.0-8.9 alta, 9.0+ critica. */
export function bandaCvss(puntuacion: number): BandaCvss {
  if (puntuacion >= 9) return 'critical';
  if (puntuacion >= 7) return 'high';
  if (puntuacion >= 4) return 'moderate';
  return 'low';
}

/** Banda a partir de un vector en texto, o `null` si no hay vector utilizable. */
export function severidadDeVector(vector: string): BandaCvss | null {
  const p = puntuacionCvss(vector);
  return p === null ? null : bandaCvss(p);
}

/* Severidades de npm/pnpm, que si traen la banda ya calculada. */
const BANDAS_NPM: Record<string, BandaCvss> = {
  critical: 'critical',
  high: 'high',
  moderate: 'moderate',
  medium: 'moderate',
  low: 'low',
  info: 'low',
  informational: 'low',
};

/** Normaliza una banda ya textual (npm, pnpm o el `severity` de un aviso viejo). */
export function bandaDeclarada(valor: unknown): BandaCvss | null {
  if (typeof valor !== 'string') return null;
  return BANDAS_NPM[valor.toLowerCase()] ?? null;
}

/* Los tres sitios donde aparece la severidad de un aviso, en orden de fiabilidad:
 * la banda explicita, el vector como cadena (cargo/RUSTSEC) y el objeto
 * `{ score, vector }` de npm. Devuelve `null` si no hay ninguno: quien llama
 * decide que hacer, pero nunca se inventa una banda. */
export function severidadDeAviso(aviso: unknown): BandaCvss | null {
  if (!aviso || typeof aviso !== 'object') return null;
  const o = aviso as Record<string, unknown>;
  const declarada = bandaDeclarada(o['severity']);
  if (declarada) return declarada;
  const cvss = o['cvss'];
  if (typeof cvss === 'string') return severidadDeVector(cvss);
  if (cvss && typeof cvss === 'object') {
    const c = cvss as Record<string, unknown>;
    if (typeof c['vector'] === 'string') return severidadDeVector(c['vector']);
    if (typeof c['score'] === 'number') return bandaCvss(c['score']);
  }
  return null;
}
