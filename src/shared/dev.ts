/* Tipos del mando dev (F0). [por que] El informe del doctor (`scripts/dev/doctor.mjs`)
 * y la vigilancia del servidor (F0b) comparten forma: un solo dueño evita que
 * el CLI y la consola diverjan en estados o motivos. */
// Estado por proyecto: exactamente uno. `bajo-mando` exige probe verde;
// `deriva` y `sin-boton` son visibles en consola, nunca verde ambiguo.
export type EstadoDev = 'bajo-mando' | 'deriva' | 'sin-boton' | 'no-aplica' | 'parado';

export interface ProyectoDev {
  clave: string;
  /* Id de la entrada del registro que lo gestiona (F3: lo usa el tablero
   * para llamar up/stop/logs/open); null en sin-boton/no-aplica (nada
   * que arrancar: el tablero no ofrece botones). */
  id: string | null;
  estado: EstadoDev;
  motivo: string;
}

// Listener sin entrada que lo reclame. `clave` es la mejor atribucion por
// ruta (exe+cmd) o null; `verificado` exige CommandLine visible.
export interface HuerfanoDev {
  ip: string;
  puerto: number;
  pid: number;
  exe: string | null;
  cmd: string;
  verificado: boolean;
  clave: string | null;
}

export interface InformeDev {
  version: 1;
  tomadoEn: string;
  snapshotEn: string | null;
  ttlMs: number;
  errorSensor: string | null;
  proyectos: ProyectoDev[];
  huerfanos: HuerfanoDev[];
  compartidos?: { puerto: number; ids: string[] }[];
  // Higiene Rust (05AA-2): avisos solo-lectura del doctor, nunca errores.
  rust?: AvisoRust[];
  // Artefactos entre proyectos (20AA-7): un proyecto que empotra el artefacto de
  // compilacion de otro (`proyecto-escritorio` <- `proyecto-web/frontend/dist`).
  // Mismo trato que rust: solo-lectura, nunca error; sale como degradado.
  artefactos?: AvisoArtefacto[];
}

export interface AvisoRust {
  chequeo: 'tamano' | 'perfil' | 'cache' | 'colision';
  proyectos: string[];
  detalle: string;
}

/* `al-dia` solo viaja con `todos` (el mando `artefactos`); en el informe del
 * doctor es ruido. Los demas son los modos de olvidarse un paso:
 * `desactualizado` = el producto no embebe lo consumido; `instalado-distinto` =
 * se compilo pero no se copio; `sin-producto`/`sin-instalar` = falta un lado. */
export interface AvisoArtefacto {
  proyecto: string;
  consumido: string;
  veredicto: 'al-dia' | 'desactualizado' | 'sin-producto' | 'sin-instalar' | 'instalado-distinto' | 'sin-dato';
  detalle: string;
}
