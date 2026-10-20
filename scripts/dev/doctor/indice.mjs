/* Subcomandos del doctor: `--all` (informe del área) y reexporta `up` (indice-up.mjs).
 * [por que] Las reglas puras (proyectos a evaluar, criterios de --assert) viven en
 * indice-informe.mjs; aquí queda la lectura de registro y snapshot, y la salida. */

import { avisoTaller } from '../taller/taller-aviso.mjs';
import { readFileSync } from 'node:fs';

import { TTL_MS } from './base.mjs';
import { clasificar, codigoSalida, detectarCompartidos, escuchaRobusta, tabla } from './clasificar.mjs';
import { leerSnapshotServidor } from './lanzar.mjs';
import { detectarDerivaEnv } from './sistema/puertos.mjs';
import { leerRegistro } from './ficha/registro.mjs';
import { detectarRust } from './sistema/rust.mjs';
import { detectarArtefactos } from './sistema/artefactos.mjs';
import { fallosAssert, proyectosYIgnorados } from './indice-informe.mjs';

export { up } from './indice-up.mjs';

/* CLI: doctor --all [--json] [--snapshot-file <ruta>] [--assert].
 * `up` vive en indice-up.mjs y se reexporta desde aqui (doctor.mjs lo expone). */
export async function main(argv) {
  const args = argv ?? process.argv.slice(2);
  if (args[0] !== '--all') {
    console.log('uso: doctor --all [--json] [--snapshot-file <ruta>] [--assert]');
    return 0;
  }
  const comoJson = args.includes('--json');
  const conAssert = args.includes('--assert');
  const iSnap = args.indexOf('--snapshot-file');
  const rutaSnap = iSnap >= 0 ? args[iSnap + 1] : null;

  let registro;
  try {
    registro = leerRegistro();
  } catch (e) {
    console.error(`registro: ${e.message}`);
    return 1;
  }
  let snapshot = null;
  let errorSensor = null;
  if (rutaSnap) {
    try {
      snapshot = JSON.parse(readFileSync(rutaSnap, 'utf8'));
    } catch (e) {
      console.error(`snapshot: no se pudo leer (${e.message})`);
      return 1;
    }
  } else {
    // [por que] Sin --snapshot-file la lista de proyectos sale del backend, igual
    // que status/up (contextoEntrada). Antes quedaba vacia: todo listener salia
    // como huerfano "(sin proyecto)", incluidos 8787/5175 de workspace-manager.
    // Sin snapshot no se clasifica a ciegas: falla con el motivo.
    let r = await leerSnapshotServidor();
    // [por que] La cache del backend puede superar el TTL (60 s): --assert la
    // rechazaria sin que el area haya cambiado. Se fuerza un escaneo solo entonces.
    if (!r.error && r.snapshot && Date.now() - new Date(r.snapshot.escaneadoEn).getTime() > TTL_MS) {
      r = await leerSnapshotServidor(true);
    }
    if (r.error || !r.snapshot) errorSensor = `snapshot: servidor 8787 sin datos (${r.error ?? 'vacio'}); arranca el backend o pasa --snapshot-file`;
    else snapshot = r.snapshot;
  }
  const { proyectos, ignoradosArea } = proyectosYIgnorados(snapshot, registro);
  const snapshotEn = snapshot?.escaneadoEn ?? null;

  let escucha = [];
  let establecidas = [];
  // [por que] Con sistema en el snapshot (lo escribe el servidor) no hace falta netstat propio.
  const sistema = snapshot?.sistema ?? null;
  if (sistema) ({ escucha, establecidas } = sistema);
  else if (!errorSensor) ({ escucha, establecidas, errorSensor } = await escuchaRobusta());
  const tomadoEn = new Date().toISOString();
  /* [por que 2026-10-20] Los artefactos (SSH a la 89, ~3 s medidos) solo dependen del
   * registro: se lanzan antes de clasificar y se esperan al armar el informe, en vez de
   * sumar su tiempo al de clasificar. */
  const artefactos = detectarArtefactos(registro);
  let clasif = { proyectos: [], huerfanos: [] };
  if (!errorSensor) {
    try {
      clasif = await clasificar(proyectos, registro, escucha, ignoradosArea, establecidas, sistema);
    } catch (e) {
      errorSensor = `clasificar: ${e.message}`;
    }
  }
  // [por que] derivaEnv es aviso: no entra en codigoSalida (el registro manda
  // sobre el .env, y un .env desfasado no debe tumbar el chequeo del tablero).
  // [por que 20AA-7] artefactos es aviso como derivaEnv: que el .exe de
  // MN-Escritorio no embeba el front nuevo no puede tumbar el chequeo del
  // tablero. Es lo unico del informe que sale a la 89 (~2,7 s medidos), sobre un
  // doctor que ya tarda ~23 s y que el servidor cachea 60 s.
  const informe = { version: 1, tomadoEn, snapshotEn, ttlMs: TTL_MS, errorSensor, compartidos: detectarCompartidos(registro), rust: detectarRust(registro), artefactos: await artefactos, derivaEnv: detectarDerivaEnv(registro), ...clasif };

  if (conAssert) {
    const fallos = fallosAssert(informe, proyectos, snapshotEn);
    if (fallos.length > 0) {
      console.error(`ASSERT FAIL:\n- ${fallos.join('\n- ')}`);
      const listaOtro = informe.proyectos.filter((p) => typeof p.motivo === 'string' && p.motivo.startsWith('otro{'));
      if (listaOtro.length > 0) {
        console.error(`OTROS:\n- ${listaOtro.map((p) => `${p.clave}: ${p.motivo}`).join('\n- ')}`);
      }
      return 1;
    }
  }

  if (comoJson) console.log(JSON.stringify(informe));
  else {
    console.log(tabla(informe));
    // [por que 14AA-5] Aviso bajo la tabla; no entra en codigoSalida.
    await avisoTaller();
  }
  return codigoSalida(informe);
}
