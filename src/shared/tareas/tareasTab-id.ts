/* Id legacy nuevo para las tareas que se crean desde WM (partido de tareasTab.ts). */

/* Id legacy nuevo espejo de TASKS `generarIdTarea` (`Date.now()*1000 +
 * resto`): el PUT del proxy es upsert y asi el alta inline no colisiona con
 * los ids que crea el front TASKS. Contador de modulo (como TASKS). */
let restoIdTarea = 0;

export function generarIdTarea(ahora: number = Date.now()): number {
  restoIdTarea = (restoIdTarea + 1) % 1000;
  return Math.floor(ahora) * 1000 + restoIdTarea;
}
