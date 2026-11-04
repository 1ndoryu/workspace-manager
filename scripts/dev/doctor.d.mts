/* Declaraciones del doctor del mando dev para quien lo importa desde TypeScript.
 * [por que] El doctor vive en `.mjs` (lo ejecutan tanto el CLI como el servidor) y el proyecto no
 * compila JavaScript (`allowJs` apagado), así que TS no ve sus tipos. Aquí se declara solo lo que
 * el servidor usa: una sola definición de la regla, no una copia en TS que pueda divergir. */

export const esPermanente: (entrada?: { permanente?: boolean; supervisar?: boolean }) => boolean;

export const paresTunelPortatil: (entrada: unknown) => [number, number][];

export const paresTunelInverso: (entrada: unknown) => [number, number][];

/* Reenvíos `-R` de una línea de comandos ssh, como pares [puerto en la 89, puerto del portátil]. */
export const reenviosInversos: (cmd: unknown) => [number, number][];

/* ssh.exe vivos del portátil (los túneles). `cmd` es la línea de comandos completa. */
export const procesosSshVivos: () => Promise<{ pid: number | null; cmd: string | null; imagen: string | null; creado: string | null }[]>;
