/* Agrupamiento de entradas del limpiador-pc para la vista (fase → grupos).
 * [por que] Extraido de usePanelPc (limite-lineas del hook): son funciones
 * puras sin estado y el hook solo las consume. */
import type { EntradaPc } from '../v2/pc/apiPc.js';

export const TITULO_FASE: Record<EntradaPc['fase'], string> = {
  area: 'área de trabajo',
  caches: 'caches del perfil',
  extern: 'herramientas externas',
  vscode: 'VS Code',
  chrome: 'Chrome',
  tmp: 'temporales del sistema',
};

const ORDEN_FASE: EntradaPc['fase'][] = ['area', 'caches', 'extern', 'vscode', 'chrome', 'tmp'];

export interface Fila {
  id: string;
  fase: EntradaPc['fase'];
  clave: string;
  ruta: string;
  bytes: number;
  detalle: string;
}

export interface Grupo {
  id: string;
  titulo: string;
  filas: Fila[];
  bytes: number;
}

/* Quita el prefijo `\\?\` para mostrar rutas legibles. */
export function rutaCorta(ruta: string): string {
  return ruta.startsWith('\\\\?\\') ? ruta.slice(4) : ruta;
}

/* Grupos ordenados: área y tmp por tipo (de mayor a menor peso), el resto
 * un grupo por origen en orden de fase. El id de fila de área y tmp es su
 * ruta suelta (el filtro `--solo-ruta`); en el resto, fase+clave. */
export function aGrupos(entradas: EntradaPc[]): Grupo[] {
  const grupos: Grupo[] = [];
  const porTipo = new Map<string, { fase: EntradaPc['fase']; tipo: string; filas: Fila[] }>();
  for (const e of entradas) {
    if (e.fase !== 'area' && e.fase !== 'tmp') continue;
    const k = `${e.fase}::${e.clave}`;
    let g = porTipo.get(k);
    if (!g) {
      g = { fase: e.fase, tipo: e.clave, filas: [] };
      porTipo.set(k, g);
    }
    g.filas.push({ id: `${e.fase}::${e.ruta}`, fase: e.fase, clave: e.clave, ruta: e.ruta, bytes: e.bytes, detalle: e.detalle });
  }
  const tipos = [...porTipo.values()].sort(
    (a, b) => b.filas.reduce((x, f) => x + f.bytes, 0) - a.filas.reduce((x, f) => x + f.bytes, 0),
  );
  for (const g of tipos) {
    g.filas.sort((a, b) => b.bytes - a.bytes);
    grupos.push({ id: `${g.fase}::${g.tipo}`, titulo: g.tipo, filas: g.filas, bytes: g.filas.reduce((x, f) => x + f.bytes, 0) });
  }
  for (const fase of ORDEN_FASE) {
    if (fase === 'area' || fase === 'tmp') continue;
    const filas = entradas
      .filter((e) => e.fase === fase)
      .sort((a, b) => b.bytes - a.bytes)
      .map((e) => ({
        id: `${e.fase}::${e.clave}`,
        fase: e.fase,
        clave: e.clave,
        ruta: e.ruta,
        bytes: e.bytes,
        detalle: e.detalle,
      }));
    if (filas.length > 0) {
      grupos.push({ id: fase, titulo: TITULO_FASE[fase], filas, bytes: filas.reduce((x, f) => x + f.bytes, 0) });
    }
  }
  return grupos;
}

/* Grupos grandes plegados por defecto (el usuario los abre si quiere). */
export function plegadoInicial(grupos: Grupo[]): Set<string> {
  return new Set(grupos.filter((g) => g.filas.length > 8).map((g) => g.id));
}
