/* Dominio archivos: navegador de archivos del area.
 * [por que] Contrato propio, independiente del snapshot. */
/* Entrada del navegador de archivos: carpeta o archivo dentro del area. */
export interface EntradaArchivo {
  nombre: string;
  ruta: string;
  tipo: 'carpeta' | 'archivo';
  tamano: number | null;
}

export interface ListadoDirectorio {
  ruta: string;
  padre: string;
  entradas: EntradaArchivo[];
}
