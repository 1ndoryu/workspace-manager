/* Sincronizacion WM -> TASKS de proyectos del kanban (08AA-6).
 * [por que] Las columnas fijas salen del snapshot WM, pero las tareas viven
 * en TASKS: cada repo WM no-ignorado necesita su proyecto TASKS. Este modulo
 * es puro salvo `crear` (inyectado): empareja por `wmClave` exacto y crea
 * con PUT-upsert solo los que faltan. Nunca borra ni renombra en TASKS (un
 * ignorado pierde su columna pero su proyecto queda intacto; lo mismo un
 * repo renombrado: la clave vieja queda huerfana oculta).
 *
 * Id generado espejo de TASKS `generarIdTarea` (`Date.now()*1000 +
 * resto`): el espacio de ids legacy es el mismo y asi no se colisiona con
 * los que crea el front TASKS; ademas se saltan los ya ocupados. */

export interface EntradaWm {
  clave: string;
  nombre: string;
}

export interface ColumnaSincronizada {
  clave: string;
  nombre: string;
  legacyId: number;
}

export interface ProyectoConClave {
  legacyId: number;
  wmClave: string | null;
}

export interface DepsSincronizar {
  /* Repos WM en orden de snapshot (ya sin ignorados: el escaner filtra). */
  wm: EntradaWm[];
  /* Proyectos TASKS tal como vienen del agregado (con `wmClave`). */
  task: ProyectoConClave[];
  /* Crea el proyecto en TASKS (PUT-upsert); propaga ErrorKanban. */
  crear: (legacyId: number, entrada: EntradaWm) => Promise<unknown>;
  ahora?: () => number;
}

/* Id legacy libre estilo TASKS: base `ahora()*1000` + resto 0..999,
 * saltando los ocupados (los de TASKS + los generados en esta pasada).
 * Determinista y testeable sin reloj real. */
export function generarIdLibre(ocupados: Set<number>, ahoraMs: number): number {
  const base = Math.floor(ahoraMs) * 1000;
  for (let i = 0; i < 1000; i += 1) {
    const candidato = base + ((Math.floor(ahoraMs) + i) % 1000);
    if (candidato > 0 && !ocupados.has(candidato)) return candidato;
  }
  throw {codigo: 'servidor', mensaje: 'sin-ids-libres para proyecto TASKS'} as const;
}

function entradaValida(e: unknown): e is EntradaWm {
  if (typeof e !== 'object' || e === null) return false;
  const e2 = e as {clave?: unknown; nombre?: unknown};
  return typeof e2.clave === 'string' && e2.clave !== '' && typeof e2.nombre === 'string' && e2.nombre !== '';
}

export async function sincronizarColumnas(deps: DepsSincronizar): Promise<ColumnaSincronizada[]> {
  const ahora = deps.ahora ?? Date.now;
  const porClave = new Map<string, number>();
  const ocupados = new Set<number>();
  for (const t of deps.task) {
    ocupados.add(t.legacyId);
    if (t.wmClave !== null && t.wmClave !== '' && !porClave.has(t.wmClave)) {
      porClave.set(t.wmClave, t.legacyId);
    }
  }
  const columnas: ColumnaSincronizada[] = [];
  for (const entrada of deps.wm) {
    if (!entradaValida(entrada)) continue;
    const existente = porClave.get(entrada.clave);
    if (existente !== undefined) {
      columnas.push({clave: entrada.clave, nombre: entrada.nombre, legacyId: existente});
      continue;
    }
    const nuevoId = generarIdLibre(ocupados, ahora());
    await deps.crear(nuevoId, entrada);
    ocupados.add(nuevoId);
    porClave.set(entrada.clave, nuevoId);
    columnas.push({clave: entrada.clave, nombre: entrada.nombre, legacyId: nuevoId});
  }
  return columnas;
}
