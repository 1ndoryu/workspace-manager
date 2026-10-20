/* Parseo puro de la salida de audit (npm, pnpm, cargo) y reglas de alcance de
 * los crates. [por que] Vive aparte de vulnerabilidades.ts: sin efectos (ni
 * CLI ni disco) para poder probarlo solo, y para no pasar del limite de 300
 * lineas por archivo. */
import type { AnalisisVulnerabilidades, HallazgoVulnerabilidad } from '../../../../shared/types.js';
import { bandaDeclarada, severidadDeAviso } from '../cvss.js';

/* Gestor que produjo el audit. Mismo conjunto que LockDetectado.gestor. */
export type Gestor = 'npm' | 'pnpm' | 'cargo';

/* Severidad de un aviso, o `null` si el audit no la declara. [por que] Antes se
 * hacia `String(s ?? 'low')`: cualquier forma que no se supiera leer —y la de
 * cargo nunca se supo, porque `cvss` es un vector de texto y no un objeto—
 * acababa en `low`. Un `low` por defecto es severidad bajada, y eso no se hace
 * con un problema real. Ahora `null` viaja como `sinSeveridad` y se ve. */
function sev(aviso: unknown): HallazgoVulnerabilidad['severidad'] | null {
  if (typeof aviso === 'string') return bandaDeclarada(aviso);
  return severidadDeAviso(aviso);
}

/* Campo de texto del aviso, o `undefined` si no es una cadena util. */
function texto(valor: unknown): string | undefined {
  return typeof valor === 'string' && valor.trim() !== '' ? valor : undefined;
}

/* npm audit --json: { metadata: { vulnerabilities: {info,low,moderate,high,
 * critical} }, vulnerabilities: { "<paquete>": { severity, ... } } }.
 * pnpm audit --json: { metadata: {...}, vulnerabilities: [ {name,severity,...} ] }.
 * cargo audit --json: { vulnerabilities: { found, count, list: [ {advisory,
 *                       versions, affected} ] }, ... }. */
export interface JsonAudit {
  vulnerabilities?: unknown;
}

/* Añade un hallazgo. `aviso` es el objeto del que sale la severidad (el advisory de
 * cargo, la entrada de npm/pnpm). Sin banda declarada se marca `sinSeveridad` en vez
 * de rellenar con `low`: el conteo sigue sumando, pero el motivo lo dice. */
type Agregar = (paquete: string, aviso: unknown, rango: string, id?: string, titulo?: string) => void;
type Parseador = (vulns: unknown, agregar: Agregar) => void;

/* cargo-audit 0.22 emite `vulnerabilities` como {found,count,list} con `list` = array
 * de {advisory, versions, affected}; versiones viejas emitian un mapa id -> objeto.
 * Leer found/count/list como paquetes daba falsos positivos, asi que la forma se
 * detecta por el array `list`. */
const parsearCargo: Parseador = (vulns, agregar) => {
  if (!vulns || typeof vulns !== 'object') return;
  const mapa = vulns as Record<string, unknown>;
  const lista = Array.isArray(mapa['list']) ? (mapa['list'] as Array<Record<string, unknown>>) : null;
  if (lista) {
    for (const item of lista) {
      const adv = (item['advisory'] ?? {}) as Record<string, unknown>;
      const vers = (item['versions'] ?? {}) as Record<string, unknown>;
      const parcheadas = Array.isArray(vers['patched'])
        ? (vers['patched'] as unknown[]).map(String).join(', ')
        : '';
      agregar(
        String(adv['package'] ?? item['package'] ?? '?'),
        adv,
        parcheadas,
        texto(adv['id']),
        texto(adv['title']),
      );
    }
    return;
  }
  for (const [id, v] of Object.entries(mapa)) {
    const o = (v ?? {}) as Record<string, unknown>;
    const adv = (o['advisory'] ?? {}) as Record<string, unknown>;
    agregar(
      String(o['package'] ?? adv['package'] ?? id),
      o,
      String(o['vulnerable_versions'] ?? o['range'] ?? ''),
      texto(adv['id']) ?? id,
      texto(adv['title']),
    );
  }
};

/* pnpm audit --json: array de { name, severity, range, url }. */
const parsearPnpm: Parseador = (vulns, agregar) => {
  if (!Array.isArray(vulns)) return;
  for (const v of vulns as Array<Record<string, unknown>>) {
    agregar(String(v['name'] ?? '?'), v, String(v['range'] ?? ''), undefined, texto(v['title']));
  }
};

/* npm audit --json: mapa paquete -> { severity, range, via: [ {title, url, cvss} ] }.
 * El primer `via` con objeto da el titulo y el vector CVSS; los `via` que son cadenas
 * son dependencias que arrastran el aviso, no avisos. */
const parsearNpm: Parseador = (vulns, agregar) => {
  if (!vulns || typeof vulns !== 'object') return;
  for (const [pkg, v] of Object.entries(vulns as Record<string, unknown>)) {
    const o = (v ?? {}) as Record<string, unknown>;
    const vias = Array.isArray(o['via']) ? o['via'] : [];
    const aviso = vias.find((x) => x && typeof x === 'object');
    agregar(pkg, aviso ?? o, String(o['range'] ?? o['range_safe'] ?? ''),
      undefined, texto((aviso as Record<string, unknown> | undefined)?.['title']));
  }
};

/* Un formato de salida por gestor: añadir uno es una entrada de esta tabla. */
const PARSEADORES: Record<Gestor, Parseador> = { npm: parsearNpm, pnpm: parsearPnpm, cargo: parsearCargo };

/* El resumen se deriva siempre de los hallazgos: pnpm no trae `metadata` y, si
 * se leyera de ahi, un proyecto con vulnerabilidades saldria como 'ok'. */
export function parsearAudit(g: Gestor, crudo: JsonAudit): {
  resumen: AnalisisVulnerabilidades['resumen'];
  hallazgos: HallazgoVulnerabilidad[];
} {
  const hallazgos: HallazgoVulnerabilidad[] = [];
  const agregar: Agregar = (paquete, aviso, rango, id, titulo) => {
    const banda = sev(aviso);
    hallazgos.push({
      paquete,
      severidad: banda ?? 'low',
      ...(banda ? {} : { sinSeveridad: true as const }),
      rango,
      ...(id ? { id } : {}),
      ...(titulo ? { titulo } : {}),
    });
  };
  PARSEADORES[g](crudo.vulnerabilities, agregar);
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

/* Excepciones de .cargo/audit.toml. Cada id de `ignore` puede llevar su vencimiento
 * en el comentario que lo precede (`VENCE AAAA-MM-DD`). [por que] cargo-audit no
 * caduca excepciones: sin esto el tablero cuenta como hallazgo algo aceptado a
 * proposito. Vigentes: se pasan a `--ignore`. Vencidas o sin fecha: siguen
 * contando (fallo cerrado: obliga a decidir al vencer). */
export interface ExcepcionesAudit {
  vigentes: string[];
  vencidas: string[];
  sinFecha: string[];
}

const RE_ID_RUSTSEC = /"(RUSTSEC-\d{4}-\d{4})"/g;
const RE_VENCE = /VENCE (\d{4}-\d{2}-\d{2})/;

/* `hoy` en AAAA-MM-DD: la comparacion es lexicografica. La excepcion deja de
 * contar desde el dia de vencimiento. Solo ids con forma RUSTSEC: el resultado
 * acaba en la linea de `cargo audit`, que va por la shell. */
export function parsearExcepcionesAudit(toml: string, hoy: string): ExcepcionesAudit {
  const r: ExcepcionesAudit = { vigentes: [], vencidas: [], sinFecha: [] };
  let comentarios: string[] = [];
  let trasId = false;
  for (const linea of toml.split(/\r?\n/)) {
    const t = linea.trim();
    /* [por que] Una linea en blanco separa grupos: ningun comentario anterior
     * presta su VENCE a los ids que siguen. */
    if (t === '') {
      comentarios = [];
      trasId = false;
      continue;
    }
    if (t.startsWith('#')) {
      /* [por que] Un comentario que sigue a un id abre otro grupo. Sin esto el
       * VENCE del primer id se pierde para los que van debajo de el. */
      if (trasId) {
        comentarios = [];
        trasId = false;
      }
      comentarios.push(t);
      continue;
    }
    const ids = [...t.matchAll(RE_ID_RUSTSEC)].map((m) => m[1]);
    if (ids.length > 0) trasId = true;
    /* [por que] El grupo conserva su comentario: los ids que siguen a un mismo
     * comentario comparten su VENCE (p. ej. 0367/0368/0369 en proyecto-ejemplo). */
    const venc = ids.length > 0 ? RE_VENCE.exec(comentarios.join('\n')) : null;
    for (const id of ids) {
      if (!venc) r.sinFecha.push(id);
      else if (hoy < venc[1]) r.vigentes.push(id);
      else r.vencidas.push(id);
    }
  }
  return r;
}

/* Fecha local AAAA-MM-DD. [por que] Local, no UTC: la excepcion vence en el dia
 * del equipo que audita. */
export function fechaLocal(d: Date): string {
  const dos = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}
