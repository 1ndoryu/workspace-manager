/* Política guard en disco: lectura de sentinel.config.json y escritura de ediciones
 * (con comprobación de hash y rollback en lotes). El texto y el plan viven en
 * politica-plan.ts; aquí solo se lee, se compara y se escribe. */
import { join } from 'node:path';
import { escribirAtomico, hashDe, leerFichero } from '../../escritura.js';
import {
  ErrorValidacion,
  LISTAS_GUARD,
  type CambioPolitica,
  type EdicionLote,
  type LecturaPolitica,
  type Listas,
  type Plantilla,
  type ResultadoEdicion,
  type ResultadoLote,
} from './politica-tipos.js';
import { aplicarPlantilla, planificarCambio } from './politica-plan.js';
import { validarPolitica } from './politica-validar.js';

/* Lee y valida <raiz>/sentinel.config.json. Symlink o carpeta → inválida. */
export function leerPolitica(raiz: string): LecturaPolitica {
  const lectura = leerFichero(join(raiz, 'sentinel.config.json'));
  if (lectura.estado === 'ausente') return { estado: 'ausente' };
  if (lectura.estado === 'invalido') return { estado: 'invalida', motivo: lectura.motivo, hash: null };
  let json: unknown;
  try {
    json = JSON.parse(lectura.contenido);
  } catch {
    return { estado: 'invalida', motivo: 'JSON no válido', hash: lectura.hash };
  }
  const v = validarPolitica(json);
  if (!v.ok) return { estado: 'invalida', motivo: v.motivo, hash: lectura.hash };
  return { estado: 'ok', modo: v.modo, listas: v.listas, contenido: lectura.contenido, hash: lectura.hash };
}

/* Calcula la edición de un proyecto sin escribir. Comprueba el hash previo:
 * si el fichero cambió desde que la página lo leyó, no se pisa (409). */
export function calcularEdicion(
  raiz: string,
  hashPrevio: string,
  cambio: CambioPolitica,
  contexto?: { plantilla: Plantilla; stacks: string[] },
): ResultadoEdicion {
  const lectura = leerPolitica(raiz);
  if (lectura.estado !== 'ok') {
    return { estado: 'error', motivo: lectura.estado === 'ausente' ? 'el proyecto no tiene sentinel.config.json' : lectura.motivo };
  }
  if (lectura.hash !== hashPrevio) {
    return { estado: 'conflicto', motivo: 'sentinel.config.json cambió desde que se leyó; recarga la página' };
  }
  let listas: Listas = { ...lectura.listas };
  for (const k of LISTAS_GUARD) if (cambio.listas?.[k]) listas[k] = cambio.listas[k] ?? [];
  if (cambio.aplicarPlantilla) {
    if (!contexto) throw new ErrorValidacion('falta la plantilla para aplicarla');
    listas = aplicarPlantilla(listas, contexto.stacks, contexto.plantilla);
  }
  const plan = planificarCambio(lectura.contenido, { modo: cambio.modo, listas });
  return { estado: 'ok', cambia: plan.cambia, diff: plan.diff, hash: hashDe(plan.nuevo), plan, lectura };
}

/* Relee justo antes de escribir: si el fichero cambió desde el cálculo, no se
 * pisa. [por que] Cierra la ventana lectura→escritura lo mejor posible: un
 * editor o un agente pueden escribir en cualquier momento, y sin bloqueo de
 * ficheros no hay garantía total, solo comprobación. */
function reverificar(raiz: string, hashCalculado: string): string | null {
  const ahora = leerPolitica(raiz);
  if (ahora.estado !== 'ok' || ahora.hash !== hashCalculado) {
    return 'sentinel.config.json cambió mientras se calculaba la edición; recarga la página';
  }
  return null;
}

/* Escribe la edición de un proyecto (atómico). Sin cambios, no toca el fichero. */
export function guardarEdicion(
  raiz: string,
  hashPrevio: string,
  cambio: CambioPolitica,
  contexto?: { plantilla: Plantilla; stacks: string[] },
): ResultadoEdicion {
  const r = calcularEdicion(raiz, hashPrevio, cambio, contexto);
  if (r.estado !== 'ok' || !r.cambia) return r;
  const motivo = reverificar(raiz, r.lectura.hash);
  if (motivo) return { estado: 'conflicto', motivo };
  escribirAtomico(join(raiz, 'sentinel.config.json'), r.plan.nuevo);
  return r;
}

/* Lote de ediciones: calcula todas primero y, si alguna no es válida, no escribe
 * nada. Si una escritura falla a mitad, restaura las ya escritas con su contenido
 * original. `escribir` se inyecta solo para probar el rollback. */
export function guardarLote(
  entradas: EdicionLote[],
  escribir: (ruta: string, contenido: string) => void = escribirAtomico,
): ResultadoLote {
  const calculados = entradas.map((e) => ({
    clave: e.clave,
    raiz: e.raiz,
    resultado: calcularEdicion(e.raiz, e.hashPrevio, e.cambio, e.contexto),
  }));
  const resultados = calculados.map(({ clave, resultado }) => ({ clave, resultado }));
  if (calculados.some(({ resultado }) => resultado.estado !== 'ok')) return { ok: false, resultados };

  const escritas: Array<{ clave: string; ruta: string; original: string }> = [];
  try {
    for (const { clave, raiz, resultado } of calculados) {
      if (resultado.estado !== 'ok' || !resultado.cambia) continue;
      const motivo = reverificar(raiz, resultado.lectura.hash);
      if (motivo) throw new Error(`${clave}: ${motivo}`);
      const ruta = join(raiz, 'sentinel.config.json');
      escribir(ruta, resultado.plan.nuevo);
      escritas.push({ clave, ruta, original: resultado.lectura.contenido });
    }
  } catch (err) {
    const revertidas: string[] = [];
    const sinRevertir: string[] = [];
    for (const e of escritas.reverse()) {
      try {
        escribir(e.ruta, e.original);
        revertidas.push(e.clave);
      } catch {
        sinRevertir.push(e.clave);
      }
    }
    return { ok: false, resultados, revertidas, sinRevertir, error: err instanceof Error ? err.message : String(err) };
  }
  return { ok: true, resultados };
}
