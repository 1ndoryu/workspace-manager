/* Archivo de configuración de cada herramienta del gate, en un solo sitio.
 * [por que] La correspondencia herramienta → archivo estaba escrita a mano en el editor (cliente),
 * en la vista de sincronización y en el registro de esquemas. Añadir una herramienta obligaba a
 * tocar tres capas y el olvido era silencioso (el server respondía 400 antes de llegar al
 * registro). Este módulo es ligero a propósito: NO importa los esquemas curados, así el bundle del
 * cliente puede usarlo sin arrastrar los JSON de Sentinel y VarSense. */
import type { TipoGate } from '../proveedores.js';

/** Archivo editable por herramienta. `satisfies` obliga a declarar una entrada por tipo. */
export const ARCHIVO_POR_TIPO = {
  sentinel: 'sentinel.config.json',
  varsense: 'varsense.config.json',
} as const satisfies Record<TipoGate, string>;

/** Herramientas con archivo propio, derivadas del mapa (no de una lista aparte). */
export const TIPOS_CON_ARCHIVO = Object.keys(ARCHIVO_POR_TIPO) as TipoGate[];

/** Herramienta a la que pertenece un archivo de config, o null si es de otro tipo. */
export function tipoDeArchivo(nombre: string): TipoGate | null {
  const hallado = TIPOS_CON_ARCHIVO.find((tipo) => ARCHIVO_POR_TIPO[tipo] === nombre);
  return hallado ?? null;
}
