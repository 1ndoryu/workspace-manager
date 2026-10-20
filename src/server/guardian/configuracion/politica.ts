/* Política guard por proyecto (F11.4). La lógica vive en politica/: tipos y validación
 * (puros), plan de edición (puro) y lectura/escritura en disco (E/S). Aquí se reexporta
 * todo para que los importadores no cambien. */
export {
  MODOS_GUARD,
  LISTAS_GUARD,
  SIN_SHIM,
  ErrorValidacion,
} from './politica/politica-tipos.js';
export type {
  ModoGuard,
  ListaGuard,
  Listas,
  Plantilla,
  CambioPolitica,
  LecturaPolitica,
  ResultadoValidacion,
  PlanEdicion,
  EntradaEdicion,
  ResultadoEdicion,
  EdicionLote,
  ResultadoLote,
} from './politica/politica-tipos.js';
export { validarEntradas, validarCambio, validarPolitica } from './politica/politica-validar.js';
export { planificarCambio, aplicarPlantilla, diferenciasPlantilla } from './politica/politica-plan.js';
export { leerPolitica, calcularEdicion, guardarEdicion, guardarLote } from './politica/politica-io.js';
