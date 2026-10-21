/* Declaraciones del doctor del mando dev para quien lo importa desde TypeScript.
 * [por que] El doctor vive en `.mjs` (lo ejecutan tanto el CLI como el servidor) y el proyecto no
 * compila JavaScript (`allowJs` apagado), así que TS no ve sus tipos. Aquí se declara solo lo que
 * el servidor usa: una sola definición de la regla, no una copia en TS que pueda divergir. */

export const esPermanente: (entrada?: { permanente?: boolean; supervisar?: boolean }) => boolean;

export const paresTunelPortatil: (entrada: unknown) => [number, number][];
