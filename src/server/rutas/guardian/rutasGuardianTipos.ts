/* Tipos de las rutas del Guardián (10AA-2 F11.4). [por que] Viven en su propio módulo
 * para que las lecturas (rutasGuardian.ts) y las escrituras (rutasGuardianEscritura.ts)
 * compartan contrato sin importarse entre sí: así no hay ciclo de módulos. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Proyecto } from '../../../shared/types.js';
import type { leerActividad } from '../../guardian/operacion/actividad.js';
import type { probarComando } from '../../guardian/operacion/probar.js';
import type { ejecutarMantenimiento } from '../../guardian/operacion/mantenimiento.js';

/* Lo que el router necesita del entorno. Inyectable: los tests usan un snapshot
 * falso y comandos falsos, nunca el área real. */
export interface DependenciasGuardian {
  /* Raíz del área: aquí vive .quality-tools/guard-plantillas.json (D7 a). */
  raizArea: string;
  proyectos: () => Proyecto[];
  proyectoPorClave: (clave: string) => Proyecto | null;
  leerActividad: typeof leerActividad;
  probarComando: typeof probarComando;
  ejecutarMantenimiento: typeof ejecutarMantenimiento;
}

export interface Contexto {
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  deps: DependenciasGuardian;
}

export type Manejador = (c: Contexto) => Promise<void>;
