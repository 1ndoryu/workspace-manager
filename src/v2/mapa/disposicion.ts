/* Disposición del mapa v2: tres nodos de ubicación (laptop, VPS 89, producción)
 * en las esquinas de un cuadrado de celdas. Cada proyecto se asienta en la celda
 * libre más cercana al nodo donde corre y se enlaza con él; si además tiene
 * despliegue en Coolify, se enlaza también con producción.
 * [por que] Función pura y separada de la vista para poder probarla sin SVG. */
import type { Proyecto } from '../../shared/types.js';
import { PESO_ESTADO, estadoProyecto } from '../estado.js';

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
  /* Brilla lo que corre: ejecución en marcha o despliegue en producción. */
  vivo: boolean;
}

export interface Disposicion {
  colocados: Colocado[];
  hubs: Hub[];
  enlaces: Enlace[];
}

type Destino = IdHub | 'libre';

/* Orden fijo de reparto: así cada grupo recibe sus celdas más cercanas por turnos. */
const TURNOS: IdHub[] = ['vps89', 'laptop', 'produccion'];

/* Solo cuenta donde corre de verdad: ejecución en marcha o despliegue. Lo demás
 * (apagado) va al bloque aparte, sin enlaces. */
function destinoDe(p: Proyecto, vivos: ReadonlySet<string>): Destino {
  if (p.ejecucion && vivos.has(p.clave)) return p.ejecucion.donde;
  return p.despliegue ? 'produccion' : 'libre';
}

function distancia2(a: Celda, b: Celda): number {
  return (a.col - b.col) ** 2 + (a.fila - b.fila) ** 2;
}

export function disponer(proyectos: Proyecto[], vivos: ReadonlySet<string>): Disposicion {
  /* Lado del cuadrado en celdas (par): crece hasta que quepan todos con holgura. */
  let lado = 12;
  while ((lado / 2 + 1) ** 2 < proyectos.length + 6) lado += 2;

  const hubs: Hub[] = [
    { id: 'laptop', etiqueta: 'Laptop', col: 0, fila: lado, total: 0 },
    { id: 'vps89', etiqueta: 'VPS 89', col: lado, fila: 0, total: 0 },
    { id: 'produccion', etiqueta: 'Producción', col: lado, fila: lado, total: 0 },
  ];
  const anclas: Record<IdHub, Celda> = { laptop: hubs[0], vps89: hubs[1], produccion: hubs[2] };

  /* Celdas pares libres, menos las de los nodos. */
  const libres: Celda[] = [];
  for (let col = 0; col <= lado; col += 2) {
    for (let fila = 0; fila <= lado; fila += 2) {
      if (!hubs.some((h) => h.col === col && h.fila === fila)) libres.push({ col, fila });
    }
  }

  const grupos: Record<Destino, Proyecto[]> = { laptop: [], vps89: [], produccion: [], libre: [] };
  const orden = [...proyectos].sort(
    (a, b) => PESO_ESTADO[estadoProyecto(a)] - PESO_ESTADO[estadoProyecto(b)] || a.id.localeCompare(b.id),
  );
  for (const p of orden) grupos[destinoDe(p, vivos)].push(p);

  const colocados: Colocado[] = [];
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
      /* Celda libre más cercana al ancla; el desempate por col y fila es estable. */
      let mejor = 0;
      for (let i = 1; i < libres.length; i++) {
        const d = distancia2(libres[i], anclas[destino]) - distancia2(libres[mejor], anclas[destino]);
        if (d < 0 || (d === 0 && (libres[i].col < libres[mejor].col || (libres[i].col === libres[mejor].col && libres[i].fila < libres[mejor].fila)))) mejor = i;
      }
      const [celda] = libres.splice(mejor, 1);
      colocados.push({ p, col: celda.col, fila: celda.fila });
    }
  }

  const enlaces: Enlace[] = [];
  for (const c of colocados) {
    if (c.p.ejecucion && vivos.has(c.p.clave)) {
      enlaces.push({ clave: c.p.clave, desde: c, hasta: c.p.ejecucion.donde, tipo: 'ejecucion', vivo: true });
    }
    if (c.p.despliegue) {
      enlaces.push({ clave: c.p.clave, desde: c, hasta: 'produccion', tipo: 'produccion', vivo: true });
    }
  }
  for (const e of enlaces) hubs.find((h) => h.id === e.hasta)!.total += 1;

  return { colocados, hubs, enlaces };
}
