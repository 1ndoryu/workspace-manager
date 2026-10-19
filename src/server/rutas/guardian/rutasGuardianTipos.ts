/* Tipos de las rutas del Guardián (10AA-2 F11.4). [por que] Viven en su propio módulo
 * para que las lecturas (rutasGuardian.ts) y las escrituras (rutasGuardianEscritura.ts)
 * compartan contrato sin importarse entre sí: así no hay ciclo de módulos. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Proyecto } from '../../../shared/types.js';
import type { leerActividad } from '../../guardian/operacion/actividad.js';
import type { probarComando } from '../../guardian/operacion/probar.js';
import type { ejecutarMantenimiento } from '../../guardian/operacion/mantenimiento.js';

/* [por que] Partido por uso (ISP): cada handler declara solo lo que toca, así un
 * test o un sustituto no tiene que fingir el resto. Las lecturas no ejecutan
 * nada; las escrituras no leen actividad ni listan el área. */
interface ProyectosGuardian {
  /* Carpeta de la config privada: aquí vive guard-plantillas.json (D7 a). */
  dirConfig: string;
  /* Async: el snapshot se lee con git (puede escanear el área). */
  proyectoPorClave: (clave: string) => Promise<Proyecto | null>;
}

export interface LecturaGuardian extends ProyectosGuardian {
  proyectos: () => Promise<Proyecto[]>;
  leerActividad: typeof leerActividad;
}

export interface EscrituraGuardian extends ProyectosGuardian {
  probarComando: typeof probarComando;
  ejecutarMantenimiento: typeof ejecutarMantenimiento;
}

/* Lo que el router necesita del entorno. Inyectable: los tests usan un snapshot
 * falso y comandos falsos, nunca el área real. */
export type DependenciasGuardian = LecturaGuardian & EscrituraGuardian;

/* Lo que comparten las ayudas que resuelven un proyecto y su plantilla. */
export type DepsProyecto = Pick<ProyectosGuardian, 'dirConfig' | 'proyectoPorClave'>;

export interface Contexto<D = DependenciasGuardian> {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  deps: D;
}

export type Manejador = (c: Contexto) => Promise<void>;
