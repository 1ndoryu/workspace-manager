/* Rutas de los enlaces proyecto -> nodo por la cuadrícula isométrica.
 * [por que] Cada línea toma el camino más corto y con menos giros por los pasillos
 * (las celdas con alguna coordenada impar, que no tienen caja): una caja de frente
 * al nodo se une con un solo tramo, y ninguna línea cruza por debajo de otra caja.
 * Función pura, sin SVG, para poder probarla. */
import { caminoL, type Celda, type Colocado, type Enlace, type Hub, type Troncal } from './disposicion.js';
import { posicionGrid, type PuntoIso } from './tiles.js';

/* Ruta de cada enlace (clave `${clave}-${hasta}`): esquinas de la ruta, de la caja al nodo. */
export type Rutas = Map<string, Celda[]>;

/* Las cuatro caras de una celda, como vector unitario en celdas (col, fila). */
const DIRS: [number, number][] = [[0, 1], [1, 0], [0, -1], [-1, 0]];

/* Costes: cada paso cuesta PASO; girar y pisar una celda ya usada por otra línea cuestan más,
 * así las líneas se reparten por pasillos distintos si no alarga mucho el camino. */
const PASO = 2;
const GIRO = 3;
const REPETIDA = 3;
/* Celdas de margen alrededor de las cajas: sitio para rodear a una caja que estorba. */
const MARGEN = 6;

const k = (c: Celda) => `${c.col},${c.fila}`;
export const claveEnlace = (e: Enlace) => `${e.clave}-${e.hasta}`;

/* Todas las celdas (de una en una) que recorre un camino de esquinas. */
function celdasUnitarias(camino: Celda[]): Celda[] {
  const t: Celda[] = [camino[0]];
  for (let i = 1; i < camino.length; i++) {
    const [p, q] = [camino[i - 1], camino[i]];
    const [dc, df] = [Math.sign(q.col - p.col), Math.sign(q.fila - p.fila)];
    for (let n = Math.abs(q.col - p.col) + Math.abs(q.fila - p.fila); n > 0; n--) {
      const u = t[t.length - 1];
      t.push({ col: u.col + dc, fila: u.fila + df });
    }
  }
  return t;
}

/* Deja solo las esquinas: quita los puntos en medio de un tramo recto. */
function esquinas(celdas: Celda[]): Celda[] {
  return celdas.filter((c, i) => {
    if (i === 0 || i === celdas.length - 1) return true;
    const [a, b] = [celdas[i - 1], celdas[i + 1]];
    return !((a.col === c.col && c.col === b.col) || (a.fila === c.fila && c.fila === b.fila));
  });
}

interface Nodo { coste: number; seq: number; col: number; fila: number; dir: number; previo: Nodo | null }

/* Cola de prioridad mínima (montículo binario); desempata por orden de inserción. */
class Cola {
  private a: Nodo[] = [];
  private menor = (x: Nodo, y: Nodo) => x.coste < y.coste || (x.coste === y.coste && x.seq < y.seq);
  get vacia() { return this.a.length === 0; }
  meter(n: Nodo) {
    const a = this.a;
    a.push(n);
    for (let i = a.length - 1; i > 0; ) {
      const p = (i - 1) >> 1;
      if (!this.menor(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }
  sacar(): Nodo {
    const a = this.a;
    const top = a[0];
    const ultimo = a.pop()!;
    if (a.length > 0) {
      a[0] = ultimo;
      for (let i = 0; ; ) {
        const [l, r] = [2 * i + 1, 2 * i + 2];
        let m = i;
        if (l < a.length && this.menor(a[l], a[m])) m = l;
        if (r < a.length && this.menor(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}

interface Mundo {
  /* Celdas pares con caja o nodo: no se atraviesan. */
  ocupadas: Set<string>;
  /* Celdas ya recorridas por otras líneas. */
  recorridas: Map<string, number>;
  min: Celda;
  max: Celda;
}

/* Dijkstra sobre (celda, dirección): camino de menor coste de `desde` a `hasta`,
 * saliendo por una cara que no esté en `prohibidas`. */
function mejorCamino(desde: Celda, hasta: Celda, prohibidas: Set<number>, m: Mundo): Celda[] | null {
  const cola = new Cola();
  const visto = new Set<string>();
  let seq = 0;
  const origen: Nodo = { coste: 0, seq: seq++, col: desde.col, fila: desde.fila, dir: -1, previo: null };
  cola.meter(origen);
  while (!cola.vacia) {
    const n = cola.sacar();
    const clave = `${n.col},${n.fila},${n.dir}`;
    if (visto.has(clave)) continue;
    visto.add(clave);
    if (n.col === hasta.col && n.fila === hasta.fila) {
      const celdas: Celda[] = [];
      for (let x: Nodo | null = n; x; x = x.previo) celdas.unshift({ col: x.col, fila: x.fila });
      return esquinas(celdas);
    }
    DIRS.forEach(([dc, df], d) => {
      if (n.dir < 0 ? prohibidas.has(d) : (d + 2) % 4 === n.dir) return;
      const [col, fila] = [n.col + dc, n.fila + df];
      if (col < m.min.col || col > m.max.col || fila < m.min.fila || fila > m.max.fila) return;
      const esMeta = col === hasta.col && fila === hasta.fila;
      if (!esMeta && m.ocupadas.has(`${col},${fila}`)) return;
      const coste = n.coste + PASO + (n.dir >= 0 && d !== n.dir ? GIRO : 0) + (m.recorridas.get(`${col},${fila}`) ?? 0);
      cola.meter({ coste, seq: seq++, col, fila, dir: d, previo: n });
    });
  }
  return null;
}

/* Índice de la cara por la que sale una ruta (0..3 sobre DIRS). */
function caraDe(ruta: Celda[]): number {
  const [a, b] = ruta;
  return DIRS.findIndex(([dc, df]) => dc === Math.sign(b.col - a.col) && df === Math.sign(b.fila - a.fila));
}

/* Rutas de todos los enlaces. Primero los puentes (para que se queden con el camino recto), luego los demás
 * de menor a mayor distancia: los más cortos se quedan con el camino directo.
 * Las líneas de una misma caja salen por caras distintas. */
export function rutasDe(colocados: Colocado[], hubs: Hub[], enlaces: Enlace[], troncales: Troncal[]): Rutas {
  const todas: Celda[] = [...colocados, ...hubs];
  const m: Mundo = {
    ocupadas: new Set(todas.map(k)),
    recorridas: new Map(),
    min: { col: Math.min(...todas.map((c) => c.col)) - MARGEN, fila: Math.min(...todas.map((c) => c.fila)) - MARGEN },
    max: { col: Math.max(...todas.map((c) => c.col)) + MARGEN, fila: Math.max(...todas.map((c) => c.fila)) + MARGEN },
  };
  const marcar = (ruta: Celda[]) => celdasUnitarias(ruta).forEach((c) => m.recorridas.set(k(c), REPETIDA));
  for (const t of troncales) {
    marcar(caminoL(hubs.find((h) => h.id === t.de)!, hubs.find((h) => h.id === t.a)!, t.primero));
  }

  const distancia = (e: Enlace) => {
    const h = hubs.find((x) => x.id === e.hasta)!;
    return Math.abs(h.col - e.desde.col) + Math.abs(h.fila - e.desde.fila);
  };
  const orden = [...enlaces].sort(
    (a, b) => Number(!!b.directo) - Number(!!a.directo) || distancia(a) - distancia(b) || claveEnlace(a).localeCompare(claveEnlace(b)),
  );
  const rutas: Rutas = new Map();
  const caras = new Map<string, Set<number>>();
  for (const e of orden) {
    const h = hubs.find((x) => x.id === e.hasta)!;
    const usadas = caras.get(e.clave) ?? new Set<number>();
    const desde = { col: e.desde.col, fila: e.desde.fila };
    const recta = esquinas(caminoL(desde, { col: h.col, fila: h.fila }, 'col').filter((c, i, a) => i === 0 || k(c) !== k(a[i - 1])));
    /* [por que] Un puente se queda con su recta si su cara está libre; si otra línea de la caja ya sale por ahí, rodea. */
    const ruta = (e.directo && !usadas.has(caraDe(recta)) ? recta : mejorCamino(desde, h, usadas, m)) ?? recta;
    rutas.set(claveEnlace(e), ruta);
    usadas.add(caraDe(ruta));
    caras.set(e.clave, usadas);
    marcar(ruta);
  }
  return rutas;
}

/* Cara por la que sale la ruta, como vector unitario (col, fila). */
export function caraSalida(ruta: Celda[]): [number, number] {
  return DIRS[caraDe(ruta)];
}

/* Punto de salida en pantalla: donde arranca el borde degradado de la caja. */
export function puntoSalida(ruta: Celda[]): PuntoIso {
  const [dc, df] = caraSalida(ruta);
  return posicionGrid(ruta[0].col + dc, ruta[0].fila + df);
}
