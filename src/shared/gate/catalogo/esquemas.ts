/* Registro estatico de esquemas por herramienta del gate.
 * [por que] Cada herramienta tiene un esquema curado (el JSON que el editor
 * pinta) y un archivo de config asociado. Antes esa correspondencia se escribia
 * a mano en cuatro sitios con cadenas de `? :` sobre el tipo o el nombre del
 * archivo (cliente y server): anadir una herramienta obligaba a tocar todos.
 * Con el registro, anadir una = una linea aqui, y quien la consume no cambia.
 *
 * Es la mitad ESTATICA de `ProveedorGate`: existe para cuando el server no
 * responde (el bundle del cliente lo lleva embebido) y para mapear el nombre del
 * archivo de config, que el proveedor no conoce. El server, cuando puede, sirve
 * el esquema del proveedor; esto es el respaldo y el mapa de nombres.
 *
 * No importa node: lo usa tambien el cliente. */
import type { NodoEsquema } from '../modelo/esquema.js';
import type { TipoGate } from '../proveedores.js';
import { ESQUEMA_SENTINEL } from './sentinel.js';
import { ESQUEMA_VARSENSE } from './varsense.js';

export interface EsquemaHerramienta {
  tipo: TipoGate;
  /* Archivo de config curado de la herramienta, dentro del proyecto. */
  archivo: string;
  esquema(): NodoEsquema;
}

export const ESQUEMAS: readonly EsquemaHerramienta[] = [
  { tipo: 'sentinel', archivo: 'sentinel.config.json', esquema: ESQUEMA_SENTINEL },
  { tipo: 'varsense', archivo: 'varsense.config.json', esquema: ESQUEMA_VARSENSE },
];

/* Esquema de una herramienta, o undefined si no es del gate. */
export function esquemaPorTipo(tipo: TipoGate): NodoEsquema | undefined {
  return ESQUEMAS.find((e) => e.tipo === tipo)?.esquema();
}

/* Esquema curado del archivo de config con ese nombre, o undefined si ese
 * archivo no tiene esquema (p. ej. taller.json o registro.json). */
export function esquemaPorArchivo(nombre: string): NodoEsquema | undefined {
  return ESQUEMAS.find((e) => e.archivo === nombre)?.esquema();
}
