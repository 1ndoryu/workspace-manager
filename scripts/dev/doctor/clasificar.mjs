/* Clasificacion de cada proyecto (bajo-mando/deriva/sin-boton/parado) y del area. */

import { basename } from 'node:path';

import { RAIZ_REPO } from './base.mjs';
import { repoPrincipalDeWorktree } from './worktree.mjs';
import { datosCimDe, normalizarRuta, procesosSshVivos, sensoresDeSistema, sshDeSistema } from './sistema/procesos.mjs';
import { atribuirHuerfano, auxiliarDe, entradaEfectiva, esAppInstalada, esDelProyecto, esEntradaRemota, esSistemaIgnorado, localesDeModo, marcadorPuerto, puertosRemotosDe, sondear, tunelDeEntrada, tunelDeListener, tunelDeQuien } from './sistema/puertos.mjs';
import { entradaDeProyecto } from './clasificar-entrada.mjs';

// Reexports: la API publica no cambia (doctor.mjs e indice.mjs importan de este modulo).
export { entradaDeProyecto } from './clasificar-entrada.mjs';
export { codigoSalida, tabla, detectarCompartidos } from './clasificar-salida.mjs';
export { escuchaRobusta } from './clasificar-sensores.mjs';

/* Clasifica snapshot x registro x escucha. Por proyecto: exactamente un
 * estado. Huerfanos: listeners sin entrada del registro; se atribuyen por
 * ruta o marcador del puerto, o quedan con clave null (grupo propio).
 * `establecidas` (netstat ESTABLISHED) delata las dependencias: un listener
 * usado por un cliente de un proyecto (p. ej. el tunel de BD) no es huerfano.
 * `sistema` (opcional) es el snapshot del servidor: si viene, CIM y ssh salen de el. */
export async function clasificar(proyectos, registro, escucha, ignorados = [], establecidas = [], sistema = null) {
  // [por que] Los clientes de un listener también se miran en CIM: su pid dice quién lo usa.
  const puertosEscucha = new Set(escucha.map((e) => e.puerto));
  const clientes = establecidas.filter((f) => puertosEscucha.has(f.puertoRemoto));
  const pids = [...new Set([...escucha.map((e) => e.pid), ...clientes.map((f) => f.pid)])];
  // [por que] Solo se consulta CIM por servicios si el registro declara alguno.
  // [por que] Apps propias fuera del area se tratan como exenciones declaradas: no
  // son huecos ni deriva, y no hace falta matarlas para que el tablero quede limpio.
  const ignoradosSis = [...(registro.ignoradosSistema ?? []), ...(registro.externosPropios ?? [])];
  const { procs, servicios } = sistema
    ? sensoresDeSistema(sistema, pids)
    : await datosCimDe(pids, { servicios: ignoradosSis.some((s) => s.servicio) });
  const areaNorm = normalizarRuta(RAIZ_REPO);

  const candidatos = escucha.filter((e) => {
    if (e.ip === '127.0.0.1' || e.ip === '::1') return true;
    if (e.ip === '0.0.0.0' || e.ip === '::') {
      const pr = procs.get(e.pid);
      const texto = normalizarRuta(`${pr?.exe ?? ''} ${pr?.cmd ?? ''}`);
      return texto.includes(areaNorm);
    }
    return false;
  });

  const porPuerto = new Map();
  for (const c of candidatos) {
    if (!porPuerto.has(c.puerto)) porPuerto.set(c.puerto, []);
    porPuerto.get(c.puerto).push(c);
  }

  const resultado = [];
  const consumidos = new Set();
  // [por que 06AA-1] La entrada marcada puede traer `ruta` rota: entradaDeProyecto
  // la casa tambien por id==clave para que el aviso salga como deriva atribuida.
  const delProyecto = proyectos.map((p) => ({ ...p, entrada: entradaDeProyecto(p, registro) }));
  const pool = [...delProyecto, ...ignorados];
  for (const p of proyectos) {
    const entrada = entradaDeProyecto(p, registro);
    if (!entrada) {
      // [por que] Un worktree comparte repo y botón con su proyecto: no es un proyecto sin onboarding.
      const principal = repoPrincipalDeWorktree(p.ruta);
      if (principal) {
        resultado.push({ clave: p.clave, id: null, estado: 'no-aplica', motivo: `worktree de ${basename(principal)}` });
      } else if (p.clave in registro.noAplica) {
        resultado.push({ clave: p.clave, id: null, estado: 'no-aplica', motivo: registro.noAplica[p.clave] });
      } else {
        resultado.push({ clave: p.clave, id: null, estado: 'sin-boton', motivo: 'pendiente-onboarding' });
      }
      continue;
    }
    const r = await clasificarEntrada(p, entrada, porPuerto, procs);
    for (const k of r.consumidos) consumidos.add(k);
    resultado.push({ clave: p.clave, id: entrada.id, estado: r.estado, motivo: r.motivo });
  }

  const huerfanos = [];
  const entradasReg = [...registro.entradas.values()];
  let sshVivos = null; // lazy: solo si hay un listener cuyo pid ya no existe
  // [por que] netstat da dos filas por socket (IPv4 e IPv6) y un proceso con dos
  // sockets en el mismo puerto no es dos huecos: un hueco = un par puerto+pid.
  const vistos = new Set();
  for (const c of candidatos) {
    if (consumidos.has(`${c.ip}:${c.puerto}:${c.pid}`)) continue;
    if (vistos.has(`${c.puerto}:${c.pid}`)) continue;
    const proc = procs.get(c.pid);
    // [por que] Script auxiliar declarado del proyecto (p. ej. mejora.mjs): es
    // del area y no es hueco ni huerfano; fuera de `puertos` no genera deriva.
    if (auxiliarDe(c.puerto, proc?.cmd, registro.entradas.values())) continue;
    // [por que] Terceros/sistema declarados (uTorrent, Intel, VPN, sccache,
    // kernel, servicios de Windows): no son del area ni son huecos.
    if (esSistemaIgnorado(c.pid, proc, ignoradosSis, servicios.get(c.pid) ?? null, c.puerto)) continue;
    // [por que 16AA-20] Tunel ssh de una ficha remota: ocupa su puerto local a
    // proposito, no es un hueco. Antes salian ocho «(sin proyecto)» —los tres de
    // la lab (13103/13104/14190) y los cinco de las fichas (3105, 3110, 5199).
    if (tunelDeQuien(proc, entradasReg)) continue;
    // [por que] Exe instalado de un artefacto consumido (proyecto-escritorio, 58601): es la app del
    // proyecto, no un hueco. Solo cuenta el fichero exacto de consumeArtefacto.instalado.
    if (esAppInstalada(proc, entradasReg)) continue;
    // [por que] pid muerto (netstat lo atribuye al padre de `ssh -f`): el túnel
    // vivo se reconoce por su reenvío -L hacia una ficha remota declarada.
    if (!proc) {
      sshVivos ??= sistema ? sshDeSistema(sistema) : await procesosSshVivos();
      if (tunelDeListener(c.puerto, sshVivos, entradasReg)) continue;
    }
    // [por que] Un cliente ESTABLISHED de un proyecto registrado usa este listener
    // (tunel de BD de PROYECTO TASKS, 15433): es dependencia, no hueco. Solo cuentan
    // proyectos del registro: un cliente ignorado no debe blanquear un listener ajeno.
    const dependeDeProyecto = clientes.some(
      (f) => f.puertoRemoto === c.puerto && f.pid !== c.pid && atribuirHuerfano(procs.get(f.pid), delProyecto, c.puerto),
    );
    if (dependeDeProyecto) continue;
    // [por que] El pool incluye los ignorados del area: opencode-propio (ignorado
    // en el tablero) se atribuye y cae en noAplica en vez de salir huerfano mudo.
    const clave = atribuirHuerfano(proc, pool, c.puerto);
    // [por que] gestion-externa (opencode-propio-dev): su listener no es un hueco
    // del area; el mando no lo gestiona ni lo reporta como deriva. Otros motivos
    // de noAplica siguen visibles.
    if (clave && registro.noAplica?.[clave] === 'gestion-externa') continue;
    vistos.add(`${c.puerto}:${c.pid}`);
    huerfanos.push({
      ip: c.ip,
      puerto: c.puerto,
      pid: c.pid,
      exe: proc?.exe ?? null,
      cmd: (proc?.cmd ?? '').slice(0, 200),
      verificado: Boolean(proc?.cmd),
      clave,
    });
  }
  return { proyectos: resultado, huerfanos };
}


/* Inspeccion por entrada (F1): mismo veredicto que clasificar + detalle por
 * puerto para que `up` decida sin reinterpretar strings. situacion:
 * arriba | libre | ocupado-desconocido | duplicado | no-verificable |
 * sin-probe. Solo `libre` autoriza arrancar; el resto rehusa en voz alta. */
export async function clasificarEntrada(p, entrada, porPuerto, procs) {
  // [por que 06AA-1] Entrada con aviso de registro = no-actuable: deriva con
  // el motivo del aviso, sin mirar puertos (ni `up` ni `status` la tocan;
  // `up` solo la reanima por la via `reconstruir` en arrancarUno).
  if (entrada._avisoRegistro) {
    return { estado: 'deriva', motivo: entrada._avisoRegistro, detalle: [], consumidos: new Set() };
  }
  const timeoutMs = entrada.timeoutMs ?? 2000;
  const healths = entrada.healths?.length ? entrada.healths : entrada.puertos.map((puerto) => ({ puerto }));
  const consumidos = new Set();
  const detalle = [];
  let estado = 'bajo-mando';
  let motivo = 'probe verde';
  // [por que 10AA-3] Varios puertos pueden caer a la vez (proyecto-h 3105+5182
  // tras `stop`). Antes cada problema hacía `break`: el 5182 nunca entraba en
  // `detalle`, `up` lanzaba solo 3105 y reportaba "probe verde". Ahora se
  // clasifican todos los puertos; el primer problema fija el motivo.
  const fijarDeriva = (texto) => {
    if (estado !== 'bajo-mando') return;
    estado = 'deriva';
    motivo = texto;
  };
  // [por que 16AA-20] Una ficha con `host` no tiene oyente local: lo que escucha
  // en el portatil es su tunel ssh. Se clasifica por el tunel —el puerto local
  // declarado en `puertosLocales`, o el mismo numero— y solo si el tunel esta
  // abierto. Antes se filtraba por `entrada.puertos`, que en una ficha remota
  // son los de la 89: el tunel salia «ocupado por desconocido» y los puertos sin
  // tunel «libre (parado)», asi que cinco proyectos que sirven 200 en la 89
  // salian en deriva o parados. Y el modo manda: en `build` los puertos son los
  // del bloque, no los del dev.
  const remota = esEntradaRemota(entrada);
  const ef = remota ? entradaEfectiva(entrada) : entrada;
  const mapaLocal = new Map();
  if (remota) {
    const locales = localesDeModo(ef);
    puertosRemotosDe(ef).forEach((r, i) => mapaLocal.set(r, locales[i]));
  }
  const saludLocal = [];
  const sinTunel = [];
  for (const h of healths) {
    const local = remota ? mapaLocal.get(h.puerto) : entrada.puertos.includes(h.puerto) ? h.puerto : undefined;
    if (local === undefined) continue;
    if (remota && (porPuerto.get(local) ?? []).length === 0) {
      sinTunel.push(h.puerto);
      continue;
    }
    saludLocal.push({ ...h, puertoLocal: local });
  }
  for (const h of saludLocal) {
    const oyentes = porPuerto.get(h.puertoLocal) ?? [];
    // [por que] Dos `tsx watch` del mismo servidor pelean el puerto
    // (caso real 2026-10-01: pids 23444+16484 en 8787, probe intermitente).
    // Quedarse con el primero ocultaria el duplicado: es deriva visible.
    const propios = oyentes.filter(
      (o) => esDelProyecto(procs.get(o.pid), p.ruta, marcadorPuerto(entrada, h.puerto)) || tunelDeEntrada(procs.get(o.pid), entrada),
    );
    // [por que 16AA-20] Un mismo proceso puede tener dos sockets en escucha del
    // mismo puerto (dual-stack: `::1` y `127.0.0.1`, medido en el tunel ssh de
    // MN, pid 26076). El duplicado que importa son dos PROCESOS peleando el
    // puerto; contar sockets daba «duplicado: 26076,26076» en un tunel sano.
    const porPid = new Map();
    for (const o of propios) if (!porPid.has(o.pid)) porPid.set(o.pid, o);
    const duelos = [...porPid.values()];
    if (duelos.length > 1) {
      fijarDeriva(`puerto ${h.puerto} con ${duelos.length} procesos del proyecto (duplicado: ${duelos.map((o) => o.pid).join(',')})`);
      detalle.push({ puerto: h.puerto, situacion: 'duplicado', pids: duelos.map((o) => o.pid) });
      continue;
    }
    const propio = duelos[0];
    if (!propio) {
      if (oyentes.length) {
        fijarDeriva(`puerto ${h.puerto} ocupado por desconocido`);
        detalle.push({ puerto: h.puerto, situacion: 'ocupado-desconocido', pids: oyentes.map((o) => o.pid) });
      } else {
        fijarDeriva(`puerto ${h.puerto} libre (parado)`);
        detalle.push({ puerto: h.puerto, situacion: 'libre', pids: [] });
      }
      continue;
    }
    for (const o of oyentes) consumidos.add(`${o.ip}:${o.puerto}:${o.pid}`);
    const proc = procs.get(propio.pid);
    if (!proc?.cmd) {
      fijarDeriva(`puerto ${h.puerto} no verificable (sin cmdline)`);
      detalle.push({ puerto: h.puerto, situacion: 'no-verificable', pids: [propio.pid] });
      continue;
    }
    consumidos.add(`${propio.ip}:${propio.puerto}:${propio.pid}`);
    const s = await sondear(h.puertoLocal, h.ruta, h.esperaJson, timeoutMs, entrada.dominio);
    if (!s.ok) {
      fijarDeriva(`puerto ${h.puerto} sin probe (status ${s.status})`);
      detalle.push({ puerto: h.puerto, situacion: 'sin-probe', pids: [propio.pid] });
      continue;
    }
    detalle.push({ puerto: h.puerto, situacion: 'arriba', pids: [propio.pid] });
  }
  // [por que] El corte en el primer health fallido dejaba sin consumir los
  // puertos propios restantes: salian como huerfanos "(sin proyecto)" aunque
  // fueran del proyecto (proyecto-web: gateway 3102 tras 5199 caido). La
  // atribucion no cambia el estado; solo evita falsos huerfanos.
  for (const h of saludLocal) {
    for (const o of porPuerto.get(h.puertoLocal) ?? []) {
      if (esDelProyecto(procs.get(o.pid), p.ruta, marcadorPuerto(entrada, h.puerto)) || tunelDeEntrada(procs.get(o.pid), entrada)) {
        consumidos.add(`${o.ip}:${o.puerto}:${o.pid}`);
      }
    }
  }
  /* Túneles declarados que no están abiertos. [por que] Sin ninguno abierto la
   * sesión no está en marcha: `parado`, no deriva. Con alguno abierto, uno
   * cerrado es un hueco visible (`up` lo abre); pero si la ficha declara
   * `tunelSsh: false` el portátil no abre túneles a propósito y esos puertos los
   * verifica la 89: darlos por libres era el falso «libre (parado)» de MN. */
  if (remota && sinTunel.length > 0) {
    if (saludLocal.length === 0) {
      return { estado: 'parado', motivo: `tunel cerrado (${sinTunel.join(', ')})`, detalle: [], consumidos };
    }
    if (entrada.tunelSsh !== false) fijarDeriva(`tunel cerrado (${sinTunel.join(', ')})`);
  }
  if (estado === 'deriva' && detalle.length > 0 && detalle.every((d) => d.situacion === 'libre')) {
    /* [05AA-4] Todo libre = detenido normal, no caida: 'parado' (exit 0,
     * seriedad null con botones). Parcial (alguno arriba + alguno libre)
     * sigue deriva (degradado visible). */
    estado = 'parado';
  }
  return { estado, motivo, detalle, consumidos };
}
