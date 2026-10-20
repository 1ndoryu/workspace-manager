/* Escritura del archivo de config del gate de un proyecto (E/S: disco y re-escaneo).
 * [por que aparte] Es lo unico de las rutas del gate que escribe en disco; el resto son manejadores
 * de HTTP en rutasGate-handlers.ts. */
import { join } from 'node:path';
import { campoStr, json, leerBody } from '../../http.js';
import { ARCHIVOS_GATE } from '../../scanner/gate.js';
import { guardarYRefrescar } from '../escritura/guardarArchivo.js';
import type { Contexto } from './rutasGate-handlers.js';
import { avisosDeEsquema } from './rutasGate-avisos.js';

export async function guardarArchivoGate(c: Contexto, proyecto: { ruta: string }, clave: string): Promise<void> {
  const body = (await leerBody(c.req)) as { nombre?: unknown; contenido?: unknown };
  const nombre = campoStr(body, 'nombre', '');
  const contenido = campoStr(body, 'contenido', null);
  if ((ARCHIVOS_GATE as readonly string[]).includes(nombre) === false || contenido === null) {
    json(c.res, 400, { error: 'archivo o contenido invalido' });
    return;
  }
  /* [por que] Validar JSON antes de escribir: no se permite romper el gate de un proyecto
   * con JSON inválido. Solo se exige parseable (no se re-serializa, para no reformatear).
   * Si el archivo tiene esquema curado, los avisos de esquema se devuelven NO bloqueantes:
   * guardar con un error de esquema es legítimo a mitad de edición. */
  let valor: unknown = null;
  try {
    valor = JSON.parse(contenido) as unknown;
  } catch {
    json(c.res, 422, { error: 'JSON invalido', detalle: 'el contenido no es JSON valido' });
    return;
  }
  const avisos = avisosDeEsquema(nombre, valor);
  const rutaArchivo = join(proyecto.ruta, nombre);
  try {
    await guardarYRefrescar(rutaArchivo, contenido, 'gate');
    json(c.res, 200, {
      ok: true,
      clave,
      nombre,
      ruta: rutaArchivo,
      avisos: avisos.slice(0, 10),
      totalErrores: avisos.filter((a) => a.severidad === 'error').length,
      totalAdvertencias: avisos.filter((a) => a.severidad === 'advertencia').length,
    });
  } catch (err) {
    json(c.res, 500, { error: 'No se pudo escribir', detalle: String(err) });
  }
}
