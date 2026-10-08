/* Respuestas puras de /api/vps/* (07AA-19): parseo y envoltorios sin
 * estado del servidor. Vivían en rutasVps.ts y lo llevaban al límite de
 * líneas del gate; aquí son testeables sin binario ni red (igual que
 * rutasVpsPiezas.test.ts). El controlador solo enruta y guarda estado. */
import type { VpsPieza, VpsSitio } from '../../shared/types.js';
import { NOMBRE_OK, redactar } from './puente.js';

const MAX_TEXTO = 4000;
/* Claves cuyo valor nunca viaja al frontend (el --json puede traer env con
 * secretos y el visor generico lo mostraria todo). */
const CLAVE_SECRETA = /api[_-]?key|token|secret|password|passwd|authorization/i;

export function sanearJson(v: unknown): unknown {
  if (typeof v === 'string') return redactar(v);
  if (Array.isArray(v)) return v.map(sanearJson);
  if (v && typeof v === 'object') {
    const limpio: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      limpio[k] = CLAVE_SECRETA.test(k) ? '···' : sanearJson(val);
    }
    return limpio;
  }
  return v;
}

export function recortar(texto: string): string {
  const t = texto.trim();
  return t.length > MAX_TEXTO ? `${t.slice(0, MAX_TEXTO)}\n…(recortado)` : t;
}

/* Parsea la tabla NOMBRE DOMINIO TARGET «STACK UUID» [ESTADO] del `list`:
 * columnas por posicion del header (separador 2+ espacios; el header del
 * UUID es "STACK UUID", asi que se busca por inclusion). Filas que no
 * cuadran se saltan (la seccion Minecraft tiene otra forma). */
export function parsearListado(texto: string, conEstado: boolean): VpsSitio[] {
  const lineas = texto.split('\n');
  const cab = lineas.findIndex((l) => /NOMBRE/.test(l) && /DOMINIO/.test(l));
  if (cab < 0) return [];
  const cols = lineas[cab].split(/\s{2,}/).map((c) => c.trim());
  const i = (n: string) => cols.findIndex((c) => c.includes(n));
  const iNombre = i('NOMBRE');
  const iDominio = i('DOMINIO');
  const iTarget = i('TARGET');
  const iUuid = i('UUID');
  const iEstado = i('ESTADO');
  if (iNombre < 0) return [];
  const sitios: VpsSitio[] = [];
  for (const l of lineas.slice(cab + 1)) {
    if (!l.trim() || /^(Minecraft|─|═|=)/i.test(l.trim())) continue;
    const c = l.split(/\s{2,}/).map((x) => x.trim());
    const nombre = c[iNombre] ?? '';
    if (!nombre || !NOMBRE_OK.test(nombre)) continue;
    sitios.push({
      nombre,
      dominio: iDominio >= 0 ? (c[iDominio] ?? '') : '',
      target: iTarget >= 0 ? (c[iTarget] ?? '') : '',
      uuid: iUuid >= 0 ? (c[iUuid] ?? '') : '',
      estadoReal: conEstado && iEstado >= 0 && c[iEstado] ? c[iEstado] : '',
    });
  }
  return sitios;
}

export async function pieza<T>(fn: () => Promise<T>, texto = false): Promise<VpsPieza> {
  try {
    const datos = await fn();
    return {
      ok: true,
      datos: texto && typeof datos === 'string' ? recortar(datos) : datos,
      error: null,
    };
  } catch (err) {
    return { ok: false, datos: null, error: String(err).slice(0, 200) };
  }
}

/* Resumen del audit legacy (formato verificado 2026-09-29): lineas `Load:`,
 * `CPU: sampleN busy=X%`, `Memoria: used=A free=B total=C`, `Disco: ...
 * use=N%` y `nombre=Up <tiempo> [(healthy)]` por contenedor. Si el formato
 * cambia, cae a no-disponible y el llamante muestra el texto. */
export function resumirAuditoria(crudo: string): VpsPieza {
  const metricas: { metrica: string; pct: number }[] = [];
  const busys = [...crudo.matchAll(/busy=([0-9.]+)%/g)].map((m) => Number(m[1]));
  if (busys.length > 0) {
    metricas.push({
      metrica: 'cpu',
      pct: Math.round((busys.reduce((a, b) => a + b, 0) / busys.length) * 10) / 10,
    });
  }
  const mem = /Memoria:\s*used=(\d+)MB\s*free=\d+MB\s*total=(\d+)MB/.exec(crudo);
  if (mem) {
    metricas.push({
      metrica: 'memoria',
      pct: Math.round((Number(mem[1]) / Number(mem[2])) * 1000) / 10,
    });
  }
  const disco = /Disco:.*use=(\d+)%/.exec(crudo);
  if (disco) metricas.push({ metrica: 'disco', pct: Number(disco[1]) });
  const carga = /Load:\s*([0-9.]+ [0-9.]+ [0-9.]+)/.exec(crudo);
  const contenedores: { nombre: string; actividad: string; saludable: boolean }[] = [];
  for (const m of crudo.matchAll(/^(\S+)=Up\s+([^(]+?)(\(healthy\))?\s*$/gm)) {
    contenedores.push({
      nombre: m[1],
      actividad: m[2].trim(),
      saludable: !!m[3],
    });
  }
  if (metricas.length === 0 && contenedores.length === 0) {
    return { ok: false, datos: null, error: 'sin-metricas' };
  }
  return {
    ok: true,
    datos: {
      metricas,
      carga: carga ? carga[1] : null,
      contenedores: {
        total: contenedores.length,
        sanos: contenedores.filter((c) => c.saludable).length,
        noSanos: contenedores.filter((c) => !c.saludable).map((c) => c.nombre),
      },
    },
    error: null,
  };
}
