/* Quienes consumen las herramientas, a que familia pertenecen y el estado de
 * sus routers. La lista NO se duplica: se lee del guard `quality-sync.mjs`. */
import fs from 'node:fs';
import path from 'node:path';
import { RAIZ_AREA } from '../../shared/rutas.mjs';
import { AQUI, EXCLUIDOS_POR_ALCANCE, MANAGER, ROUTERS, salta, solo } from './ajustes.mjs';
import { textoRouter } from './router.mjs';
import { comando, ejecutar, leerJsonDeTexto } from './utilidades.mjs';

/* Lista de consumidores tomada del guard: una sola fuente de verdad con
 * `sync:quality`, así no puede haber consumidores que se propaguen y no se
 * verifiquen (o al revés). */
export function consumidoresDeclarados() {
  const guard = path.join(MANAGER, 'scripts', 'quality-sync.mjs');
  const resultado = ejecutar(comando(process.execPath, [guard, '--json']), MANAGER);
  const reporte = leerJsonDeTexto(resultado.salida);
  if (!reporte?.consumidores) {
    throw new Error(`no se pudo leer la lista de consumidores de ${guard}: ${resultado.salida.slice(0, 300)}`);
  }
  return reporte.consumidores
    .filter(consumidor => !EXCLUIDOS_POR_ALCANCE.includes(consumidor.nombre))
    .filter(consumidor => !solo.length || solo.includes(consumidor.nombre))
    .filter(consumidor => !salta.includes(consumidor.nombre))
    .map(consumidor => ({ ...consumidor, dir: path.join(RAIZ_AREA, consumidor.ruta) }))
    .filter(consumidor => fs.existsSync(path.join(consumidor.dir, 'quality-tools.json')));
}

/* Familia del consumidor: A comparte el checkout del área, B usa un submódulo
 * propio, externo es cualquier otra cosa (no se le propaga el router). */
export function familiaDe(consumidor, config) {
  if (typeof config?.sourcePath !== 'string') return 'externo';
  const absoluta = path.resolve(consumidor.dir, config.sourcePath);
  const relativoCompartido = path.relative(path.join(RAIZ_AREA, '.quality-tools'), absoluta);
  if (relativoCompartido && !relativoCompartido.startsWith('..') && !path.isAbsolute(relativoCompartido)) return 'A';
  const relativoPropio = path.relative(consumidor.dir, absoluta);
  if (relativoPropio && !relativoPropio.startsWith('..') && !path.isAbsolute(relativoPropio)) return 'B';
  return 'externo';
}

/* Compara el router ignorando el fin de línea. [por que] Un proyecto clonado con
 * `core.autocrlf` guarda el router con CRLF y el canónico con LF: mismo contenido,
 * mismo comportamiento, y aun así se reportaba `drift`. Ruido que esconde la
 * deriva de verdad. El BOM sí se respeta: un fichero con BOM lo ejecuta Node, pero
 * no es lo que reparte el propagador. */
function sinFinDeLinea(texto) {
  return texto.replace(/\r\n/g, '\n');
}

export function revisarRouters(consumidor, escribirAhora) {
  return ROUTERS.map(router => {
    const destino = path.join(consumidor.dir, 'scripts', 'quality', router.archivo);
    /* Invariante del host: el adapter canónico vive en `workspace-manager`, que
     * también es consumidor, así que su ruta de router coincide con el adapter.
     * Nunca se escribe un router encima del adapter. [por que] Un bump de pin lo
     * borró el 2026-09-10 y dejó 9 proyectos con un router que se llamaba a sí
     * mismo; el host se recuperó desde el historial local. */
    if (path.resolve(destino) === path.resolve(AQUI, router.archivo)) {
      return { router: router.archivo, estado: 'host' };
    }
    const esperado = textoRouter(router);
    if (!fs.existsSync(destino)) {
      if (!escribirAhora) return { router: router.archivo, estado: 'ausente' };
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      fs.writeFileSync(destino, esperado);
      return { router: router.archivo, estado: 'creado' };
    }
    if (sinFinDeLinea(fs.readFileSync(destino, 'utf8')) === sinFinDeLinea(esperado)) {
      return { router: router.archivo, estado: 'ok' };
    }
    if (escribirAhora) {
      fs.writeFileSync(destino, esperado);
      return { router: router.archivo, estado: 'actualizado' };
    }
    return { router: router.archivo, estado: 'drift' };
  });
}
