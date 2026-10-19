/* Disposición del mapa v2: tres nodos de ubicación (laptop, VPS 89, producción)
 * en el centro de un cuadrado de celdas. Cada proyecto se asienta en la celda
 * libre más cercana al nodo donde corre y se enlaza con él; si además tiene
 * despliegue en Coolify, se enlaza también con producción.
 * [por que] Función pura y separada de la vista para poder probarla sin SVG. */
import type { Proyecto } from '../../shared/types.js';
import { PESO_ESTADO, estadoProyecto } from '../estado.js';
import { posicionGrid, type PuntoIso } from './tiles.js';

export type IdHub = 'laptop' | 'vps89' | 'produccion';

export interface Celda {
  col: number;
  fila: number;
}

export interface Hub extends Celda {
  id: IdHub;
  etiqueta: string;
  /* Proyectos enlazados a este nodo. */
  total: number;
}

export interface Colocado extends Celda {
  p: Proyecto;
}

export interface Enlace {
  clave: string;
  desde: Celda;
  hasta: IdHub;
  tipo: 'ejecucion' | 'produccion';
  /* Brilla lo que corre: ejecución en marcha o producción en running. */
  vivo: boolean;
  /* Puente entre dos nodos: su línea va recta al nodo, sin pasillos. */
  directo?: boolean;
}

/* Enlace fijo entre dos nodos (laptop-VPS 89, VPS 89-producción). */
export interface Troncal {
  de: IdHub;
  a: IdHub;
  /* Eje que se recorre primero (el codo queda fuera del triángulo de nodos). */
  primero: 'col' | 'fila';
}

export interface Disposicion {
  colocados: Colocado[];
  hubs: Hub[];
  enlaces: Enlace[];
  troncales: Troncal[];
}

/* [por que] La laptop no llega a producción directa: pasa por la VPS 89, así que
 * solo hay dos lados del triángulo de nodos. */
const TRONCALES: Troncal[] = [
  { de: 'laptop', a: 'vps89', primero: 'fila' },
  { de: 'vps89', a: 'produccion', primero: 'col' },
];

/* Camino directo entre dos celdas siguiendo los ejes de la cuadrícula (un solo codo):
 * así la línea respeta la perspectiva isométrica y no cruza en diagonal. */
function caminoL(a: Celda, b: Celda, primero: 'col' | 'fila'): Celda[] {
  const codo = primero === 'col' ? { col: b.col, fila: a.fila } : { col: a.col, fila: b.fila };
  return [a, codo, b];
}

/* Celdas pares por las que pasa un camino (para que ninguna caja se asiente encima). */
function celdasDeCamino(camino: Celda[]): Celda[] {
  const t: Celda[] = [];
  for (let i = 1; i < camino.length; i++) {
    const [p, q] = [camino[i - 1], camino[i]];
    const pasos = Math.max(Math.abs(q.col - p.col), Math.abs(q.fila - p.fila)) / 2;
    for (let k = 0; k <= pasos; k++) {
      t.push({ col: p.col + (Math.sign(q.col - p.col) * 2 * k), fila: p.fila + (Math.sign(q.fila - p.fila) * 2 * k) });
    }
  }
  return t;
}

function textoRuta(celdas: Celda[]): string {
  return celdas.map(({ col, fila }) => { const p = posicionGrid(col, fila); return `${p.x},${p.y}`; }).join(' ');
}

type Destino = IdHub | 'libre';

/* Orden fijo de reparto: así cada grupo recibe sus celdas más cercanas por turnos. */
const TURNOS: IdHub[] = ['vps89', 'laptop', 'produccion'];

/* Solo cuenta donde corre de verdad: ejecución en marcha o producción en running. Lo demás
 * (apagado) va al bloque aparte, sin enlaces. */
function destinoDe(p: Proyecto, vivos: ReadonlySet<string>, enProd: ReadonlySet<string>): Destino {
  if (p.ejecucion && vivos.has(p.clave)) return p.ejecucion.donde;
  return enProd.has(p.clave) ? 'produccion' : 'libre';
}

/* Todos los nodos a los que se enlaza: ejecución en marcha y/o producción. */
function destinosDe(p: Proyecto, vivos: ReadonlySet<string>, enProd: ReadonlySet<string>): IdHub[] {
  const ds: IdHub[] = [];
  if (p.ejecucion && vivos.has(p.clave)) ds.push(p.ejecucion.donde);
  if (enProd.has(p.clave) && !ds.includes('produccion')) ds.push('produccion');
  return ds;
}

function distancia2(a: Celda, b: Celda): number {
  return (a.col - b.col) ** 2 + (a.fila - b.fila) ** 2;
}

/* Saca de `libres` la celda más cercana al ancla; el desempate por col y fila es estable. */
function tomarMasCercana(libres: Celda[], ancla: Celda): Celda {
  let mejor = 0;
  for (let i = 1; i < libres.length; i++) {
    const d = distancia2(libres[i], ancla) - distancia2(libres[mejor], ancla);
    if (d < 0 || (d === 0 && (libres[i].col < libres[mejor].col || (libres[i].col === libres[mejor].col && libres[i].fila < libres[mejor].fila)))) mejor = i;
  }
  return libres.splice(mejor, 1)[0];
}

export function disponer(
  proyectos: Proyecto[],
  vivos: ReadonlySet<string>,
  enProd: ReadonlySet<string> = new Set(),
): Disposicion {
  /* Lado del cuadrado en celdas (par): crece hasta que quepan todos con holgura. */
  let lado = 12;
  while ((lado / 2 + 1) ** 2 < proyectos.length + 6) lado += 2;

  /* Nodos en triángulo en el centro del cuadrado (celdas pares): los proyectos
   * se reparten alrededor de su nodo y las líneas se quedan cortas. */
  const c = Math.round(lado / 4) * 2;
  const hubs: Hub[] = [
    { id: 'laptop', etiqueta: 'Laptop', col: c - 4, fila: c + 2, total: 0 },
    { id: 'vps89', etiqueta: 'VPS 89', col: c, fila: c - 4, total: 0 },
    { id: 'produccion', etiqueta: 'Producción', col: c + 4, fila: c + 2, total: 0 },
  ];
  const anclas: Record<IdHub, Celda> = { laptop: hubs[0], vps89: hubs[1], produccion: hubs[2] };

  /* Celdas pares libres, menos las de los nodos. */
  const libres: Celda[] = [];
  for (let col = 0; col <= lado; col += 2) {
    for (let fila = 0; fila <= lado; fila += 2) {
      if (!hubs.some((h) => h.col === col && h.fila === fila)) libres.push({ col, fila });
    }
  }

  /* Los troncales ocupan sus celdas: ninguna caja queda encima de su línea. */
  const reservada = (c: Celda) => TRONCALES.some((t) => celdasDeCamino(caminoL(anclas[t.de], anclas[t.a], t.primero)).some((r) => r.col === c.col && r.fila === c.fila));
  for (let i = libres.length - 1; i >= 0; i--) if (reservada(libres[i])) libres.splice(i, 1);

  const grupos: Record<Destino, Proyecto[]> = { laptop: [], vps89: [], produccion: [], libre: [] };
  const orden = [...proyectos].sort(
    (a, b) => PESO_ESTADO[estadoProyecto(a)] - PESO_ESTADO[estadoProyecto(b)] || a.id.localeCompare(b.id),
  );
  /* Puentes: enlazados a dos nodos a la vez (p. ej. laptop y producción). */
  const puentes: { p: Proyecto; ds: IdHub[] }[] = [];
  for (const p of orden) {
    const ds = destinosDe(p, vivos, enProd);
    if (ds.length > 1) puentes.push({ p, ds });
    else grupos[destinoDe(p, vivos, enProd)].push(p);
  }

  const colocados: Colocado[] = [];
  /* [por que] Un puente se asienta a mitad de camino entre sus dos nodos, así sus
   * líneas salen por caras opuestas y se lee como el paso de uno a otro. Va
   * primero para quedarse con las celdas del medio. */
  for (const { p, ds } of puentes) {
    const [a, b] = ds.map((id) => anclas[id]);
    const { col, fila } = tomarMasCercana(libres, { col: (a.col + b.col) / 2, fila: (a.fila + b.fila) / 2 });
    colocados.push({ p, col, fila });
    /* Y las de sus líneas rectas a cada nodo. */
    for (const h of ds.map((id) => anclas[id])) {
      for (const r of celdasDeCamino(caminoL({ col, fila }, h, 'col'))) {
        const i = libres.findIndex((l) => l.col === r.col && l.fila === r.fila);
        if (i >= 0) libres.splice(i, 1);
      }
    }
  }
  /* Apagados (sin ejecución en marcha ni despliegue): bloque aparte, separado del cuadrado de nodos
   * por dos celdas vacías, para que se lea que no están conectados a nada. */
  const ancho = lado / 2 + 1;
  grupos.libre.forEach((p, i) => {
    colocados.push({ p, col: (i % ancho) * 2, fila: -4 - 2 * Math.floor(i / ancho) });
  });
  let quedan = true;
  while (quedan) {
    quedan = false;
    for (const destino of TURNOS) {
      const p = grupos[destino].shift();
      if (!p) continue;
      quedan = true;
      const celda = tomarMasCercana(libres, anclas[destino]);
      colocados.push({ p, col: celda.col, fila: celda.fila });
    }
  }

  const enlaces: Enlace[] = [];
  const directo = new Set(puentes.map((x) => x.p.clave));
  for (const c of colocados) {
    const d = directo.has(c.p.clave);
    if (c.p.ejecucion && vivos.has(c.p.clave)) {
      enlaces.push({ clave: c.p.clave, desde: c, hasta: c.p.ejecucion.donde, tipo: 'ejecucion', vivo: true, directo: d });
    }
    if (enProd.has(c.p.clave)) {
      enlaces.push({ clave: c.p.clave, desde: c, hasta: 'produccion', tipo: 'produccion', vivo: true, directo: d });
    }
  }
  for (const e of enlaces) hubs.find((h) => h.id === e.hasta)!.total += 1;

  return { colocados, hubs, enlaces, troncales: TRONCALES };
}

/* Ruta de un troncal: camino directo entre los nodos, por los ejes de la cuadrícula.
 * [por que] Están conectados directamente; los pasillos solo ordenan a los proyectos. */
export function rutaTroncal(t: Troncal, hubs: Hub[]): string {
  const [a, b] = [t.de, t.a].map((id) => hubs.find((x) => x.id === id)!);
  return textoRuta(caminoL(a, b, t.primero));
}

/* Franja del pasillo (en celdas, respecto al centro de la caja) que ocupa cada
 * nodo; dentro de ella cada enlace recibe su propio carril. */
const FRANJA = { vps89: [0.55, 0.95], produccion: [1.05, 1.45], laptop: [-1.45, -0.55] } as const;

/* Carril propio por enlace: reparte los de un mismo nodo a lo largo de su
 * franja, asi ninguna linea tapa a otra al compartir pasillo. */
export function carrilesDe(enlaces: Enlace[], hubs: Hub[]): Map<string, number> {
  const t = new Map<string, number>();
  (Object.keys(FRANJA) as (keyof typeof FRANJA)[]).forEach((id) => {
    const h = hubs.find((x) => x.id === id)!;
    const ls = enlaces
      .filter((e) => e.hasta === id)
      .sort((a, b) => Math.abs(b.desde.col - h.col) + Math.abs(b.desde.fila - h.fila) - (Math.abs(a.desde.col - h.col) + Math.abs(a.desde.fila - h.fila)) || a.clave.localeCompare(b.clave));
    const [lo, hi] = FRANJA[id];
    ls.forEach((e, i) => t.set(`${e.clave}-${id}`, ls.length < 2 ? (lo + hi) / 2 : lo + ((hi - lo) * i) / (ls.length - 1)));
  });
  return t;
}

/* Las cuatro caras de una celda, como vector unitario en celdas (col, fila). */
const LADOS: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];

/* Cara de la caja por donde sale cada enlace (clave `${clave}-${hasta}`).
 * [por que] Si varias lineas de una caja salen por la misma cara, se pisan y el
 * borde degradado no tiene dos colores distintos: cada enlace toma la cara libre
 * que mira mas hacia su nodo. */
export function ladosDe(enlaces: Enlace[], hubs: Hub[]): Map<string, [number, number]> {
  const t = new Map<string, [number, number]>();
  const porCaja = new Map<string, Enlace[]>();
  for (const e of enlaces) porCaja.set(e.clave, [...(porCaja.get(e.clave) ?? []), e]);
  for (const grupo of porCaja.values()) {
    const usados = new Set<number>();
    for (const e of grupo) {
      const h = hubs.find((x) => x.id === e.hasta)!;
      const dc = h.col - e.desde.col;
      const df = h.fila - e.desde.fila;
      let mejor = -1;
      LADOS.forEach(([lc, lf], i) => {
        if (usados.has(i)) return;
        if (mejor < 0 || lc * dc + lf * df > LADOS[mejor][0] * dc + LADOS[mejor][1] * df) mejor = i;
      });
      usados.add(mejor);
      t.set(`${e.clave}-${e.hasta}`, LADOS[mejor]);
    }
  }
  return t;
}

/* Celda de salida del enlace: a una distancia del centro de la caja igual a su
 * carril, en la cara que le toca. Con carriles distintos, las lineas no se solapan. */
function salidaDe(e: Enlace, carriles: Map<string, number>, lados: Map<string, [number, number]>): Celda {
  const k = `${e.clave}-${e.hasta}`;
  const [dc, df] = lados.get(k)!;
  const d = Math.abs(carriles.get(k)!);
  return { col: e.desde.col + dc * d, fila: e.desde.fila + df * d };
}

/* Punto de salida en pantalla: donde arranca el borde degradado de la caja. */
export function puntoSalida(e: Enlace, carriles: Map<string, number>, lados: Map<string, [number, number]>): PuntoIso {
  const s = salidaDe(e, carriles, lados);
  return posicionGrid(s.col, s.fila);
}

/* Ruta por el suelo, por los pasillos impares (las celdas vacias entre cajas):
 * sale de la caja por su cara, corre en paralelo a la cuadricula y entra al nodo de lado. */
export function rutaSuelo(
  e: Enlace,
  hubs: Hub[],
  carriles: Map<string, number>,
  lados: Map<string, [number, number]>,
): string {
  const h = hubs.find((x) => x.id === e.hasta)!;
  if (e.directo) return textoRuta(caminoL(e.desde, h, 'col'));
  const s = carriles.get(`${e.clave}-${e.hasta}`)!;
  const salida = salidaDe(e, carriles, lados);
  /* Pasillo paralelo a la cara de salida, y tramo de entrada al nodo. */
  const porFila = lados.get(`${e.clave}-${e.hasta}`)![0] === 0;
  const pasillo = porFila ? { col: h.col + s, fila: salida.fila } : { col: salida.col, fila: h.fila + s };
  const entrada = porFila ? { col: pasillo.col, fila: h.fila } : { col: h.col, fila: pasillo.fila };
  const celdas = [e.desde, salida, pasillo, entrada, h];
  return celdas.map(({ col, fila }) => { const p = posicionGrid(col, fila); return `${p.x},${p.y}`; }).join(' ');
}
