/* Fila del taller para el panel (20AA-16). Solo tipos: módulo hoja, sin lógica ni imports.
 * [por que] La construye el servidor desde el registro (`server/taller/proyectosTaller.ts`) y la
 * consume el frente; con una sola definición no pueden divergir. Es lo único que pulse no puede
 * saber: un proyecto parado no tiene procesos que mirar, pero sí sesión, puerto y hostname. */
export interface ProyectoTaller {
  /* Nombre del proyecto, que es exactamente el «sitio» que sirve pulse en modo procesos. */
  id: string;
  /* Sesiones tmux de la 89 (una por puerto remoto): `dev-<slug>-<puerto>`. */
  sesiones: string[];
  /* Puerto local por el que se llega desde el portátil (el túnel); null sin túnel. */
  puertoLocal: number | null;
  /* Hostname que se enseña: el público si lo hay (Cloudflare), si no el del taller. */
  hostname: string | null;
}
