// Sesión de Mutagen (réplica laptop→89): nombre, patrones ignorados y comparación con la sesión viva.
// Vive aparte de rcargo.mjs para que el wrapper no supere el límite de 300 líneas.

/* [por que] Mutagen rechaza los nombres de sesión con espacios («invalid session name:
 * invalid name character at index 15: ' '») y los ids del taller los llevan («PROYECTO TASKS»),
 * así que un proyecto con espacio en el nombre no se podía subir. Se normaliza a [A-Za-z0-9._-].
 * Los ids normales (p. ej. `mi-proyecto`) no cambian. Misma regla, en TypeScript, en
 * src/shared/taller/sesiones.ts: al tocar una, tocar la otra. */
export function slugSesion(valor) {
  return String(valor).replace(/[^A-Za-z0-9._-]+/g, '-');
}

export function nombreSesion(proyecto) {
  return `taller-${slugSesion(proyecto)}`;
}

// Patrones que la réplica de un proyecto no envía: los globales de `sync.ignorar` más los de
// `sync.ignorarPorProyecto[<proyecto>]` (p. ej. datos locales que no deben viajar a la 89).
export function ignoresDeProyecto(config, proyecto) {
  const globales = config.sync?.ignorar ?? [];
  const propios = config.sync?.ignorarPorProyecto?.[proyecto] ?? [];
  return [...globales, ...propios];
}

// Argumentos de `mutagen sync create`. Réplica laptop→89: la VPS nunca escribe de vuelta.
export function argsCrearSesion(config, proyecto, rutaLocal) {
  const ignorar = ignoresDeProyecto(config, proyecto).flatMap((p) => ['--ignore', p]);
  return [
    'sync', 'create',
    '--name', nombreSesion(proyecto),
    '--mode', config.sync.modo,
    ...ignorar,
    rutaLocal,
    `${config.host}:${config.dirRemotoBase}/${proyecto}`,
  ];
}

/* Patrones que ignora una sesión viva, de `mutagen sync list --template '{{json .}}'`.
 * `null` si la salida no es legible: un fallo de lectura no autoriza a recrear nada. */
export function ignoresDeSesion(salida) {
  let sesiones;
  try {
    sesiones = JSON.parse(salida ?? '');
  } catch {
    return null;
  }
  const sesion = Array.isArray(sesiones) ? sesiones[0] : null;
  const rutas = sesion?.ignore?.paths;
  return Array.isArray(rutas) ? rutas : null;
}

/* ¿La sesión ignora exactamente lo que declara `sync.ignorar`? Se compara como conjunto: Mutagen
 * no promete conservar el orden de los `--ignore`. */
export function ignoresAlDia(esperados, vivos) {
  if (!Array.isArray(esperados) || !Array.isArray(vivos) || esperados.length !== vivos.length) return false;
  const conjunto = new Set(vivos);
  return esperados.every((p) => conjunto.has(p));
}
