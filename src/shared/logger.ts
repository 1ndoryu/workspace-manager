/* Logger central del manager (client + server).
 * [por que] La regla `console-production` de sentinel exige enrutar la
 * consola por un logger (whitelist por defecto `/logger.`): centralizar aqui
 * da un punto unico de prefijo/formato y mantiene los mensajes operativos
 * (persistencia, arranque, re-escaneos) visibles en consola sin marcar
 * hallazgos. Mantenerlo deliberadamente minimo: el proyecto no tiene un
 * sistema de logging mas rico y no se justifica uno. */
function prefijo(nivel: string): string {
  return `[workspace-manager:${nivel}]`;
}

export const logger = {
  log(...args: unknown[]): void {
    console.log(prefijo('log'), ...args);
  },
  warn(...args: unknown[]): void {
    console.warn(prefijo('warn'), ...args);
  },
  error(...args: unknown[]): void {
    console.error(prefijo('error'), ...args);
  },
  debug(...args: unknown[]): void {
    console.debug(prefijo('debug'), ...args);
  },
};
