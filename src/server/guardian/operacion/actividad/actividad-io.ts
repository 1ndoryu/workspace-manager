/* Lectura en disco de la actividad del Guardián: la cola acotada de un fichero
 * (diario o auditoría) y los leases activos. Solo lee; nunca escribe. */
import { closeSync, fstatSync, openSync, readdirSync, readFileSync, readSync, statSync } from 'node:fs';
import path from 'node:path';
import { acotar, parseObjeto } from './actividad-parseo.js';
import { MAX_LONGITUD_FILTRO, type LeaseActiva } from './actividad-tipos.js';

const BYTES_LEASE = 64 * 1024;
const MAX_LEASES = 200;

/* Lee las últimas `maxBytes` de un fichero. null si no existe o no es un fichero
 * regular. Si se corta por la izquierda, descarta la primera línea (parcial). */
export function leerCola(ruta: string, maxBytes: number): string[] | null {
  let fd: number;
  try {
    fd = openSync(ruta, 'r');
  } catch {
    return null;
  }
  try {
    const info = fstatSync(fd);
    if (!info.isFile()) return null;
    const inicio = Math.max(0, info.size - maxBytes);
    const largo = info.size - inicio;
    const buf = Buffer.alloc(largo);
    let leido = 0;
    while (leido < largo) {
      const n = readSync(fd, buf, leido, largo - leido, inicio + leido);
      if (n === 0) break;
      leido += n;
    }
    let texto = buf.subarray(0, leido).toString('utf8');
    if (inicio > 0) {
      const salto = texto.indexOf('\n');
      texto = salto === -1 ? '' : texto.slice(salto + 1);
    }
    return texto.split('\n');
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

export function leerLeases(guardRoot: string, ahora: number): { activos: LeaseActiva[]; expirados: number } {
  const dir = path.join(guardRoot, 'leases');
  let nombres: string[];
  try {
    nombres = readdirSync(dir).filter((n) => n.endsWith('.json')).slice(0, MAX_LEASES);
  } catch {
    return { activos: [], expirados: 0 };
  }
  const activos: LeaseActiva[] = [];
  let expirados = 0;
  for (const nombre of nombres) {
    const ruta = path.join(dir, nombre);
    try {
      if (statSync(ruta).size > BYTES_LEASE) continue;
      const r = parseObjeto(readFileSync(ruta, 'utf8'));
      if (
        !r ||
        r.schemaVersion !== 1 ||
        typeof r.id !== 'string' ||
        typeof r.pid !== 'number' ||
        typeof r.projectRoot !== 'string' ||
        typeof r.command !== 'string' ||
        typeof r.issuedAt !== 'string' ||
        typeof r.expiresAt !== 'string'
      ) {
        continue;
      }
      const expira = Date.parse(r.expiresAt);
      if (!Number.isFinite(expira) || expira <= ahora) {
        expirados += 1;
        continue;
      }
      activos.push({
        id: r.id,
        pid: r.pid,
        projectRoot: r.projectRoot.slice(0, MAX_LONGITUD_FILTRO),
        command: acotar(r.command),
        taskId: typeof r.taskId === 'string' ? acotar(r.taskId) : null,
        issuedAt: r.issuedAt,
        expiresAt: r.expiresAt,
      });
    } catch {
      continue;
    }
  }
  activos.sort((a, b) => b.issuedAt.localeCompare(a.issuedAt));
  return { activos, expirados };
}
