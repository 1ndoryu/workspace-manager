/* Motivos de `noAplica` y de los puntos sin verificar: el enum fijo o `otro{detalle,caducidad}` con
 * caducidad de 1 a 31 días. Vive aparte de validacion.mjs para que ese archivo quede bajo 300 líneas
 * (gate limite-lineas); validacion.mjs lo reexporta, así que los importadores no cambian. */
import { MOTIVOS_ENUM, RE_OTRO } from '../base.mjs';

export function validarMotivo(motivo, donde) {
  if (MOTIVOS_ENUM.has(motivo)) return;
  const m = RE_OTRO.exec(motivo ?? '');
  if (!m) throw new Error(`${donde}: motivo fuera de enum (${motivo})`);
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const cad = new Date(m[2] + 'T00:00:00');
  if (Number.isNaN(cad.getTime())) throw new Error(`${donde}: caducidad invalida (${m[2]})`);
  const dias = Math.round((cad - hoy) / 86_400_000);
  if (dias < 1 || dias > 31) throw new Error(`${donde}: caducidad fuera de 1..31 dias (${m[2]})`);
}
