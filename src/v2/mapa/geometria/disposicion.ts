/* Disposición del mapa v2: tres nodos de ubicación (laptop, VPS 89, producción)
 * en el centro de un cuadrado de celdas. Cada proyecto se asienta en la celda
 * libre más cercana al nodo donde corre y se enlaza con él; si además tiene
 * despliegue en Coolify, se enlaza también con producción.
 * [por que] Función pura y separada de la vista para poder probarla sin SVG. */
import type { Proyecto } from '../../../shared/types.js';
import { PESO_ESTADO, estadoProyecto } from '../../estado.js';
import { textoRuta } from './tiles.js';

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
  /* Puente entre dos nodos: su ruta se calcula antes que las demás, para quedarse con el camino recto. */
  directo?: boolean;
}

/* Nombre de cada nodo, para leerlo fuera del mapa (lista de proyectos, tooltip). */
export const ETIQUETA_HUB: Record<IdHub, string> = {
  laptop: 'Laptop',
  vps89: 'VPS 89',
  produccion: 'Producción',
};

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
export function caminoL(a: Celda, b: Celda, primero: 'col' | 'fila'): Celda[] {
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


type Destino = IdHub | 'libre';

/* Orden fijo de reparto: así cada grupo recibe sus celdas más cercanas por turnos. */
const TURNOS: IdHub[] = ['vps89', 'laptop', 'produccion'];

/* Solo cuenta donde corre de verdad: ejecución en marcha o producción en running. Lo demás
 * (apagado) va al bloque aparte, sin enlaces. */
function destinoDe(p: Proyecto, vivos: ReadonlySet<string>, enProd: ReadonlySet<string>): Destino {
  if (p.ejecucion && vivos.has(p.clave)) return p.ejecucion.donde;
  return enProd.has(p.clave) ? 'produccion' : 'libre';
}

/* Todos los nodos a los que se enlaza: ejecución en marcha y/o producción.
 * [por que] Exportada: la lista de proyectos pinta el mismo color que el mapa, y para eso
 * necesita la misma respuesta que `disponer` (una regla, un origen; AGENTS §5). */
export function destinosDe(p: Proyecto, vivos: ReadonlySet<string>, enProd: ReadonlySet<string>): IdHub[] {
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
    { id: 'laptop', etiqueta: ETIQUETA_HUB.laptop, col: c - 4, fila: c + 2, total: 0 },
    { id: 'vps89', etiqueta: ETIQUETA_HUB.vps89, col: c, fila: c - 4, total: 0 },
    { id: 'produccion', etiqueta: ETIQUETA_HUB.produccion, col: c + 4, fila: c + 2, total: 0 },
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
