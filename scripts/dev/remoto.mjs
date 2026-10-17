/* F3 taller remoto (VPS 89): una entrada del registro con `host` corre en la VPS,
 * en una sesion tmux por puerto. El laptop mantiene un tunel SSH hacia 127.0.0.1,
 * salvo tunelSsh:false (la VPS expone sus puertos sola, p. ej. Cloudflare Tunnel).
 * Diseno: Agente/planes/plan-taller-remoto-vps89-2026-10-14.md.
 * [por que] El mando local no ve procesos remotos: la verdad es la sesion tmux
 * (en 89) y el PID del tunel (local, validado por creationTime e imagen/cmdline).
 * Sin probe por el tunel no hay verde; un puerto escuchando fuera de loopback
 * en 89 se mata antes de exponer nada.
 *
 * El modulo vivia en un solo archivo de 814 lineas efectivas (limite 300). Se
 * partio por dominio en scripts/dev/remoto/ y este archivo quedo como barril:
 * los consumidores (dev.mjs, acciones.mjs) siguen importando de aqui igual.
 *
 *   ssh.mjs       comandos por SSH a la VPS
 *   comandos.mjs  construccion de los comandos remotos (arranque, build, npm ci)
 *   sondas.mjs    sondas de salud y lectura de la escucha (ss/netstat)
 *   estado.mjs    estado en disco del taller (PID del tunel)
 *   tunel.mjs     tunel SSH: args, marcador, identidad y ciclo de vida
 *   entorno.mjs   validacion de la ficha y generacion de los .env
 *   ficha.mjs     puertos, healths y estado real de una entrada en la VPS
 *   bd.mjs        sincronizacion de la base de datos (dumps, conteos, desvio)
 *   ciclo.mjs     preparar, up, status, stop y logs
 *   indice.mjs    decidir si un id va a la VPS y despachar el subcomando
 */

/* [por que] El modo y la deteccion de entrada remota viven en doctor/ (una sola
 * definicion): el doctor tambien los necesita para clasificar una ficha con
 * `host`, y definirlos dos veces los desincronizaria. Se reexportan aqui porque
 * los consumidores de este modulo ya los importaban de este archivo. */
export { esEntradaRemota, entradaEfectiva, MODO_POR_DEFECTO, modoDe } from './doctor.mjs';

export { comandoConstruirFront, comandoNpmCi, comandoPrecompilar, comandoRemotoUp, comandoSondaRemota, rutaLogNpmCi } from './remoto/comandos.mjs';

export { analizarEscucha, pidDeEscucha, pidsEscuchandoLocal, variablesDistintas } from './remoto/sondas.mjs';

export { argsTunel, marcadorTunel, tunelDePuertosNuestros, tunelEsNuestro } from './remoto/tunel.mjs';

export { contenidoEnvFrontend, contenidoEnvRemoto, filtrarSqlParaPg16, leerUrlBdLocal, validarHostRemoto } from './remoto/entorno.mjs';

export { localesTodos, puertosTodos } from './remoto/ficha.mjs';

export { desvioConLaptop, desviosDeConteos, diferenciasConteos, parsearConteos, sincronizarBd } from './remoto/bd.mjs';

export { construirFrontRemoto } from './remoto/ciclo.mjs';

export { despachar, entradaRemotaDe } from './remoto/indice.mjs';
