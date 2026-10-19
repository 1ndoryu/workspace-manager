/* Contrato de la conformidad del taller (solo tipos). Módulo hoja: sin lógica ni imports.
 * [por que] conformidad.ts (reglas) y conformidadPublico.ts (reglas públicas) se importaban
 * en círculo solo por estos tipos. Aquí viven y ambos dependen de ellos, no el uno del otro. */
export type AmbitoConformidad = '89' | 'publico' | 'local';
export type SeveridadConformidad = 'error' | 'advertencia';

export interface Hallazgo {
  id: string;
  ambito: AmbitoConformidad;
  severidad: SeveridadConformidad;
  detalle: string;
  remedio: string;
}

/* Salida JSON de la sonda `scripts/remoto/taller-estado` (lectura, sin escritura). */
export interface EstadoTaller89 {
  version: number;
  tomadaEn: string;
  disco: { libreGb: number };
  /* `nivel` (0 mantenimiento, 1 aviso, 2 suelo) y `liberadoGb` son de la última corrida de
   * cm-sweep, y `ultimaLimpieza` su marca de tiempo. Opcionales: una sonda antigua no los trae y
   * null significa «no se pudo leer el estado», que no es lo mismo que un cero. */
  sweep: {
    edadHoras: number | null;
    timerActivo: boolean;
    nivel?: number | null;
    liberadoGb?: number | null;
    ultimaLimpieza?: string | null;
  };
  memoria: { disponibleMiB: number; swapUsadaMiB: number };
  /* `proceso` llega vacío cuando el socket es de otro usuario (la sonda no corre como root). */
  escuchas: { direccion: string; puerto: number; proto: 'tcp' | 'udp'; proceso?: string }[];
  tmux: string[];
  cmHeavy: { ocupado: boolean };
  buildsFueraDeCmHeavy: { pid: number; cmd: string }[];
  secretos: { ruta: string; modo: string }[];
  cloudflared: { version: string | null; tokenModo: string | null; viva: boolean };
  /* `existe: null` = el taller no declara BD de trabajo: no se evalúa (A9 no aplica). */
  bdTrabajo: { existe: boolean | null; edadHoras: number | null };
  managerDaemonVivo: boolean;
}

/* Foto resumida de una línea de `~/taller/_datos/estado.jsonl` (S3.4). Solo los campos que el
 * panel pinta; el resto de la sonda queda fuera para que la respuesta no crezca sin medida. */
export interface MuestraHistorial {
  tomadaEn: string;
  libreGb: number;
  disponibleMiB: number;
  swapUsadaMiB: number;
  cmHeavyOcupado: boolean;
  cloudflaredViva: boolean;
  managerDaemonVivo: boolean;
}

/* Resultado de pedir cada hostname público sin credenciales (P1). `location` es la
 * cabecera Location de la respuesta, si la hay. */
export interface EstadoPublico {
  hosts: { host: string; status: number | null; location: string | null; error: string | null }[];
}

/* Procesos y escuchas del laptop (lectura de Win32_Process y Get-NetTCPConnection) y
 * estado de Mutagen. `mutagen` es null si no aparece el binario ni en el PATH ni en las
 * rutas conocidas: entonces no se afirma nada del sync (L3 lo avisa en vez de dar el
 * daemon por vivo). */
export interface EstadoLocal {
  procesos: { pid: number; nombre: string; cmd: string }[];
  escuchas: { direccion: string; puerto: number; proceso: string }[];
  mutagen: { daemonVivo: boolean; sesionesMalas: string[] } | null;
  /* Motivo si no se pudieron leer procesos y escuchas. Sin él, L1 y L2 callarían por falta
   * de datos y parecería que no hay avisos. Sin ese motivo, la ausencia de avisos sería falsa. */
  sinLectura?: string;
}

/* Lo que el registro declara y debe cumplirse. */
export interface RegistroConformidad {
  sesionesDev: string[];
  hostsPublicos: string[];
  /* Sesiones tmux (dev-<id>-<puerto>) del proyecto de cada hostname público. */
  sesionesDevPorHost: Record<string, string[]>;
  puertosLocalesPublicos: number[];
  sitiosRust: { id: string; buildMode: string | null }[];
  /* Marcas (subcadenas, en minúsculas) de las apps ajenas al área: las que el
   * registro declara `gestion-externa`. [por qué] L1 no denuncia lo que no es
   * nuestro, pero *cuáles* son esas apps es configuración, no código: antes era
   * un literal con el nombre de una. Vacío = no hay ninguna exenta. */
  ajenos: string[];
}

export interface EntradaConformidad {
  t89: EstadoTaller89 | null;
  motivoSinLectura?: string;
  publico: EstadoPublico | null;
  local: EstadoLocal;
  registro: RegistroConformidad;
  /* Alias SSH del taller, para que el remedio diga a qué máquina conectarse. Null si
   * no hay taller configurado: el texto entonces no nombra ninguna. */
  hostTaller?: string | null;
  /* Nombre de la carpeta del propio tablero, para reconocer sus procesos. Lo
   * aporta quien reúne el estado (el único que puede mirar el sistema de
   * archivos: este módulo es puro y se importa también desde el cliente). Sin
   * él no se reconoce ningún proceso suyo, y eso solo afecta a la regla L1. */
  nombreMando?: string | null;
}
