/* Doctor del mando dev (F0: clasifica; F1: +up que arranca puertos libres).
 * [por que] Modulo COMPARTIDO CLI<->server: el CLI (dev.mjs doctor) y el
 * servidor (src/server/dev/vigilancia.ts via execFile) ejecutan este mismo
 * archivo; no hay dos implementaciones que diverjan. Sensores verificados en
 * spike 2026-10-01 (Windows es-MX): Get-NetTCPConnection (objetos, sin
 * parser, IPv4+IPv6) + Get-CimInstance batch (CreationDate+CommandLine+Exe).
 * netstat/tasklist descartados (idioma/encoding, sin cmdline).
 * Exit codes: 0 verde, 2 degradado (huecos visibles), 1 error.
 * Con --assert: 1 tambien si el INSTRUMENTO falla (cobertura, motivos fuera
 * de enum, otro>20%, snapshot stale); 0 exige instrumento OK + area verde;
 * 2 = instrumento OK pero hay huecos visibles (deriva/sin-boton/huerfanos).
 * [por que] El cuerpo vive troceado en doctor/, un modulo por responsabilidad
 * (registro, sensores, puertos, clasificacion, lanzamiento, rust). Este
 * archivo es la fachada: conserva la ruta que ejecuta el servidor y los
 * nombres que importan dev.mjs, acciones.mjs y remoto.mjs. */

import { normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main } from './doctor/indice.mjs';

export {
  DIR_DEV,
  RAIZ_REPO,
  RUTA_REGISTRO,
  TTL_MS,
  TIMEOUT_SENSOR_MS,
  MAX_PIDS_CONSULTA,
  PUERTOS_PROTEGIDOS,
  MOTIVOS_ENUM,
  EXES_PERMITIDOS,
} from './doctor/base.mjs';

export {
  escanearEscucha,
  parsearNetstat,
  procesosDe,
} from './doctor/sistema/procesos.mjs';

export {
  esEntradaRemota,
  MODO_POR_DEFECTO,
  MODOS,
  modoDe,
  entradaEfectiva,
  puertosRemotosDe,
  localesDeModo,
  paresTunel,
  reenviosTunel,
  tunelDeEntrada,
  tunelDeQuien,
  puertoDeSaludValido,
  validarBloqueBuild,
  marcadorPuerto,
  esDelProyecto,
  enRuta,
  atribuirHuerfano,
  auxiliarDe,
  duenoDePuerto,
  accionParaPuerto,
  detectarDerivaEnv,
  esSistemaIgnorado,
} from './doctor/sistema/puertos.mjs';

export {
  validarMotivo,
} from './doctor/ficha/validacion.mjs';

export {
  leerRegistro,
  validarVps,
  validarIgnoradoSistema,
} from './doctor/ficha/registro.mjs';

export {
  detectarRust,
} from './doctor/sistema/rust.mjs';

export {
  clasificar,
  clasificarEntrada,
  escuchaRobusta,
  detectarCompartidos,
} from './doctor/clasificar.mjs';

export {
  lanzar,
  contextoEntrada,
  veredictoUpSinCobertura,
} from './doctor/lanzar.mjs';

export {
  up,
  main,
} from './doctor/indice.mjs';

const esCli = process.argv[1] && normalize(process.argv[1]) === normalize(fileURLToPath(import.meta.url));
if (esCli) {
  main().then(
    (c) => process.exit(c),
    (e) => {
      console.error(`doctor: ${e?.message ?? e}`);
      process.exit(1);
    },
  );
}
