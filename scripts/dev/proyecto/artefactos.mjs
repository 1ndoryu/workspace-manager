/* Mando `artefactos` (20AA-7): que proyectos consumen el artefacto de otro y si
 * estan al dia. Solo lectura, y lo unico del area que consulta la 89 sin
 * arrancar nada.
 *
 * [por que] El doctor ya pinta este aviso, pero ahi va sin las rutas ni los
 * tamanos: para responder «¿por que dice desactualizado?» hace falta ver los dos
 * lados. Aqui se muestran todos los veredictos, incluido `al-dia`, que en el
 * informe del doctor seria ruido. */

import { detectarArtefactos } from '../doctor/sistema/artefactos.mjs';
import { leerRegistro } from '../doctor/ficha/registro.mjs';

const AYUDA = 'uso: dev artefactos [--json]   artefactos que un proyecto consume de otro (20AA-7)';

export async function artefactos(argv) {
  const args = argv ?? [];
  if (args.includes('--ayuda') || args.includes('-h')) {
    console.log(AYUDA);
    return 0;
  }
  const comoJson = args.includes('--json');
  const registro = leerRegistro();
  // [por que] `todos`: el mando existe justo para ver tambien los que estan bien
  // (y para distinguir «no hay nada declarado» de «esta al dia»).
  const avisos = await detectarArtefactos(registro, { todos: true });
  if (comoJson) {
    console.log(JSON.stringify(avisos));
    return 0;
  }
  if (avisos.length === 0) {
    console.log('artefactos: ninguna entrada declara `consumeArtefacto`');
    return 0;
  }
  for (const a of avisos) {
    console.log(`${a.veredicto.padEnd(18)} ${a.proyecto} <- ${a.consumido}`);
    console.log(`${' '.repeat(18)} ${a.detalle}`);
  }
  // [por que] `sin-dato` no es culpa del proyecto: la 89 puede estar caida. Solo
  // los veredictos que exigen actuar devuelven 2 (degradado, igual que el doctor).
  return avisos.some((a) => a.veredicto !== 'al-dia' && a.veredicto !== 'sin-dato') ? 2 : 0;
}
