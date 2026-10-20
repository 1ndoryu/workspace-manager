/* Medición de C:	mp con presupuesto de tiempo y caché de 10 min. Es E/S de disco: el
 * recuento se hace en lotes asíncronos. [por que] Separada de recoger.ts (19AA-13). */
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';

/* Directorios que se listan y ficheros que se miden a la vez. [por que] Medido en
 * C:\tmp (16.754 ficheros, 2.167 directorios): con `stat` en serie 20,3 s; en lotes
 * de 8, 2,7 s con el mismo total. Lote acotado para no abrir miles de descriptores. */
const LOTE_TMP = 8;
/* [por que] El tamaño de temporales cambia despacio y su recuento cuesta ~3 s en E/S:
 * la salud de área se recalcula cada 60 s, así que se reusa el dato 10 min. */
const TTL_TMP_MS = 10 * 60_000;
let cacheTmp: { raiz: string; en: number; valor: { bytes: number; parcial: boolean } | null } | null = null;

/* Suma de C:\tmp con presupuesto de tiempo. Asíncrona para no bloquear el servidor.
 * [por que] Si no existe, null (la comprobación se omite); si se corta, parcial. */
export async function medirTmp(raiz: string, presupuestoMs: number): Promise<{ bytes: number; parcial: boolean } | null> {
  if (cacheTmp && cacheTmp.raiz === raiz && Date.now() - cacheTmp.en < TTL_TMP_MS) return cacheTmp.valor;
  const valor = await recontarTmp(raiz, presupuestoMs);
  /* [por que] Un recuento cortado por presupuesto no se reusa: sería un dato a medias durante 10 min. */
  if (!valor?.parcial) cacheTmp = { raiz, en: Date.now(), valor };
  return valor;
}

async function recontarTmp(raiz: string, presupuestoMs: number): Promise<{ bytes: number; parcial: boolean } | null> {
  try {
    await stat(raiz);
  } catch {
    return null;
  }
  const fin = Date.now() + presupuestoMs;
  let bytes = 0;
  let parcial = false;
  const pendientes = [raiz];
  while (pendientes.length > 0) {
    if (Date.now() > fin) {
      parcial = true;
      break;
    }
    const dirs = pendientes.splice(0, LOTE_TMP);
    const listados = await Promise.all(dirs.map((d) => readdir(d, { withFileTypes: true }).catch(() => null)));
    const ficheros: string[] = [];
    listados.forEach((entradas, i) => {
      for (const e of entradas ?? []) {
        const ruta = join(dirs[i], e.name);
        if (e.isDirectory()) pendientes.push(ruta);
        else if (e.isFile()) ficheros.push(ruta);
      }
    });
    for (let i = 0; i < ficheros.length; i += LOTE_TMP) {
      const tamanos = await Promise.all(
        ficheros.slice(i, i + LOTE_TMP).map((f) => stat(f).then((s) => s.size, () => 0)),
      );
      /* fichero desaparecido durante el recorrido: cuenta 0 */
      for (const t of tamanos) bytes += t;
    }
  }
  return { bytes, parcial };
}
