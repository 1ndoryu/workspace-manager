/* Binarios del sistema que el manager lanza. Definición única para los scripts.
 * [por qué] Gemelo de `src/shared/binarios.ts`: node ejecuta los `.mjs` sueltos y
 * no puede importar TypeScript, así que la derivación se repite. Es el único sitio
 * donde se permite (igual que en `rutas.mjs` y `puertos.mjs`); el resto de scripts
 * importa de aquí. */
function binario(valor, defecto) {
  return typeof valor === 'string' && valor.trim() ? valor.trim() : defecto;
}

/** Cliente SSH: el transporte al taller, los túneles y la lectura del estado de la 89. */
export const BIN_SSH = binario(process.env.WS_SSH, 'ssh');

/** Empaquetador de la copia del runtime a la VPS (`tar` por ssh, no `scp -r`). */
export const BIN_TAR = binario(process.env.WS_TAR, 'tar');

/** Git del escáner: rama, HEAD, diffs y estado del árbol. */
export const BIN_GIT = binario(process.env.WS_GIT, 'git');

/** npm de los scripts de calidad (instalar, compilar y probar consumidores). */
export const BIN_NPM = binario(process.env.WS_NPM, 'npm');
