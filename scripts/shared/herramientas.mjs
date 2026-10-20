/* Herramientas del gate de calidad que los scripts gestionan. Definición única para los scripts.
 * [por qué] Gemelo de `TipoGate` en `src/shared/gate/proveedores.ts`: node no importa TypeScript,
 * así que la lista se repite aquí. Añadir una herramienta es cambiar esta lista y el registro. */
export const HERRAMIENTAS_GATE = ['sentinel', 'varsense'];
