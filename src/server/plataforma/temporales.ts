/* Raíz de los temporales del área (AGENTS §0.2).
 * [por que] En Windows es C:/tmp, la que mide y purga GloryTmpSweep. En Linux (VPS 89)
 * no existe la unidad C:, así que la raíz es ~/tmp: mismo rol, sin depender de la unidad.
 * WM_TMP la sobrescribe (tests, otra unidad) sin tocar el código. */
import os from 'node:os';
import path from 'node:path';

export function raizTemporales(
  env: NodeJS.ProcessEnv = process.env,
  plataforma: NodeJS.Platform = process.platform,
  casa: string = os.homedir(),
): string {
  const declarada = env.WM_TMP?.trim();
  if (declarada) return declarada;
  return plataforma === 'win32' ? 'C:/tmp' : path.join(casa, 'tmp');
}
