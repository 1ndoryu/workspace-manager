/* Tipos compartidos entre server y cliente del workspace-manager.
 * [por que] Contrato unico para que el escaner (server) y las vistas (client)
 * no deriven en tipos duplicados que se desincronicen. Los tipos viven por
 * dominio en ./tipos/; este barrel mantiene estable la ruta de importacion. */

export * from './tipos/proyecto.js';
export * from './tipos/git.js';
export * from './tipos/vps.js';
export * from './tipos/analisis.js';
export * from './tipos/config.js';
export * from './tipos/snapshot.js';
export * from './tipos/archivos.js';
