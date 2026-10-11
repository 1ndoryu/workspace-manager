/* Salud del entorno y de los proyectos (10AA-2 F8): comprobaciones de prevención de los
 * problemas recurrentes. Tipos compartidos entre el servidor (calcula) y el tablero
 * (muestra y cuenta en `problemas (N)`).
 * [por que] Cada hallazgo lleva la acción siguiente, no solo el síntoma: el tablero
 * avisa para que alguien actúe, no como volcado de diagnósticos. */

export const SEVERIDADES_SALUD = ['error', 'aviso', 'info'] as const;
export type SeveridadSalud = (typeof SEVERIDADES_SALUD)[number];

export interface Hallazgo {
  /* Id estable de la comprobación, p. ej. 'target-en-arbol'. */
  id: string;
  severidad: SeveridadSalud;
  mensaje: string;
  /* Siguiente paso concreto. */
  accion: string;
  /* Documento de referencia, ruta relativa al área. */
  doc?: string;
}

/* [por que] Cobertura declarada: qué se miró y qué no, con su motivo. Un «sin
 * hallazgos» solo es evidencia si se sabe qué comprobaciones se ejecutaron. */
export interface Omitida {
  id: string;
  motivo: string;
}

export interface ResultadoSalud {
  ambito: 'proyecto' | 'area';
  /* Clave del proyecto, o '(área)' para las comprobaciones del área. */
  clave: string;
  hallazgos: Hallazgo[];
  ejecutadas: string[];
  omitidas: Omitida[];
  calculadoEn: string;
}

/* Clave del grupo sintético del área en el tablero. [por que] No es una clave de
 * proyecto: el tablero la trata como grupo sin selección, como «(puertos sin proyecto)». */
export const CLAVE_AREA = '(área)';
