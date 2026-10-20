/* Lo que la salud necesita del entorno: plataforma, carpeta de usuario, rutas del
 * manager y variables. [por que] El recogedor no lee `process.env`, `homedir()` ni las
 * constantes de plataforma por su cuenta: se le pasa este objeto. Así sus casos se
 * prueban con un entorno falso y no dependen de la máquina donde corran. */
import { homedir } from 'node:os';
import { CARPETA_SKILLS, RAIZ_REPO, rutaConfigPrivada } from '../plataforma/rutas.js';
import { raizTemporales } from '../plataforma/sistema/temporales.js';

export interface Entorno {
  plataforma: NodeJS.Platform;
  homedir: string;
  /* Repo del manager: de aquí salen el mando (`scripts/dev`), el pin de Sentinel y el
   * nombre de la skill. Es distinto de la raíz del área. */
  raizRepo: string;
  raizTemporales: string;
  carpetaSkills: string;
  rutaConfigPrivada(nombre: string): string;
  /* Variables de usuario que la salud mira; `undefined` si no están definidas. */
  localAppData: string | undefined;
  cargoIncremental: string | undefined;
}

/* El entorno de verdad. Único sitio que lee el proceso al componer la salud. */
export function entornoReal(): Entorno {
  return {
    plataforma: process.platform,
    homedir: homedir(),
    raizRepo: RAIZ_REPO,
    raizTemporales: raizTemporales(),
    carpetaSkills: CARPETA_SKILLS,
    rutaConfigPrivada: (nombre) => rutaConfigPrivada(nombre),
    localAppData: process.env.LOCALAPPDATA,
    cargoIncremental: process.env.CARGO_INCREMENTAL,
  };
}
