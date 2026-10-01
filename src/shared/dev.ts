/* Tipos del mando dev (F0). [por que] El informe del doctor (`scripts/dev/doctor.mjs`)
 * y la vigilancia del servidor (F0b) comparten forma: un solo dueño evita que
 * el CLI y la consola diverjan en estados o motivos. */
// Estado por proyecto: exactamente uno. `bajo-mando` exige probe verde;
// `deriva` y `sin-boton` son visibles en consola, nunca verde ambiguo.
export type EstadoDev = 'bajo-mando' | 'deriva' | 'sin-boton' | 'no-aplica';

export interface ProyectoDev {
  clave: string;
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
}
