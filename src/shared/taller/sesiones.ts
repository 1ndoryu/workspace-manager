/* Nombres de sesión del taller (Mutagen y tmux), en un solo sitio.
 * [por que] Mutagen rechaza los nombres de sesión con espacios («invalid session name:
 * invalid name character at index 15: ' '») y los ids del taller a veces los llevan («un id con espacios»),
 * así que ese proyecto no se podía subir a la 89. Se normaliza a [A-Za-z0-9._-].
 * Los ids normales (sin espacios) no cambian.
 * La misma regla está en scripts/remoto/rcargo.mjs (los scripts no pueden importar TypeScript):
 * al tocar una, tocar la otra. */

export function slugSesion(valor: string): string {
  return String(valor).replace(/[^A-Za-z0-9._-]+/g, '-');
}

export function sesionMutagen(clave: string): string {
  return `taller-${slugSesion(clave)}`;
}

export function sesionDev(clave: string, puerto: number): string {
  return `dev-${slugSesion(clave)}-${puerto}`;
}
