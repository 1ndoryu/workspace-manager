/* Registro de proveedores del gate (plan gate-dinamico E1).
 * [por que] El editor y el server dejaron de depender de claves sueltas por
 * archivo: ahora cada herramienta del gate (sentinel, varsense...) es un
 * PROVEEDOR con interfaz unica (`esquema`, `reglas`, `versionReferencia`,
 * `runtimeInstalado`). El server resuelve el proveedor y sirve el esquema por
 * API; el cliente es 'tonto' y no importa JSON internos. Anadir una herramienta
 * nueva = registrar un proveedor; ninguna capa del editor cambia.
 *
 * Este modulo es PURAMENTE de tipos/registro y NO importa node, para poder
 * vivirlo tanto en el server como (en el futuro) en el cliente. Los proveedores
 * concretos (que leen el runtime) se registran server-side en
 * `src/server/gate/proveedor.ts`; aqui solo vive el contrato y lo que no
 * depende del entorno. */
import type { NodoEsquema } from './modelo/esquema.js';
import type { ReglaCatalogo } from './catalogo/reglas.js';

/* Herramientas de gate soportadas por el editor de config. */
export type TipoGate = 'sentinel' | 'varsense';

export interface ProveedorGate {
  tipo: TipoGate;
  /* Esquema canonico de la config de la herramienta (dirigido por datos). */
  esquema(): NodoEsquema;
  /* Reglas vivas o estaticas segun el proveedor. [por que] OPCIONAL: varsense no
   * tiene catalogo de reglas propio. Mientras fue obligatorio lo implementaba con
   * un degenerado (`[]`) y el cliente se lo saltaba ramificando por tipo
   * (`tipo === 'sentinel' ? reglasGate().reglas : []`): el contrato no era
   * sustituible. Un proveedor sin reglas simplemente no las declara, y quien
   * consume no distingue uno de otro. */
  reglas?(): ReglaCatalogo[];
  /* Version del runtime CONTRA EL QUE se curo el esquema. Opcional por lo mismo:
   * varsense la cumplia con `'—'`, que es un valor que no significa nada. */
  versionReferencia?(): string;
  /* Version REAL detectada en el sistema, o null si no hay runtime. */
  runtimeInstalado(): string | null;
  /* Fuente de la resolucion (para mostrarla en la UI y en la consola). */
  fuente(): 'runtime' | 'estatica';
}

/* Registro mutable de proveedores por tipo. Se llena server-side (no hay
 * proveedores concretos aqui, porque leer el runtime requiere node). El
 * cliente solo consulta. */
const registro = new Map<TipoGate, ProveedorGate>();

export function registrarProveedor(p: ProveedorGate): void {
  registro.set(p.tipo, p);
}

export function proveedorDe(tipo: TipoGate): ProveedorGate | undefined {
  return registro.get(tipo);
}

export function tiposDeGate(): TipoGate[] {
  return Array.from(registro.keys());
}

/* Metadata de resolucion de un proveedor (lo que sirve la API y muestra la UI):
 * version de referencia (curación), version real del runtime y fuente.
 * `versionReferencia` es null cuando el proveedor no la declara (varsense): null
 * es "no aplica", que es distinto de una cadena inventada como `'—'`. */
export interface MetadatosGate {
  tipo: TipoGate;
  versionReferencia: string | null;
  runtimeInstalado: string | null;
  fuente: 'runtime' | 'estatica';
}