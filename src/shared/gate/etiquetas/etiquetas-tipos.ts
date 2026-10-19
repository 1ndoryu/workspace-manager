/* Contrato de una etiqueta del catalogo de config (nombre legible + descripcion).
 * [por que] Módulo hoja: `etiquetas.ts` y `etiquetas-reglas.ts` se importaban en
 * círculo solo por este tipo (uno trae el catálogo de reglas, el otro el tipo).
 * Aquí vive el contrato y ambos dependen de él, no el uno del otro. */
export interface InfoSegmento {
  nombre: string;
  descripcion?: string;
  /* Explicacion detallada para el tooltip del editor: breve, clara y
   * suficiente para entender de que trata la opcion sin mirar la doc. */
  detalle?: string;
}
