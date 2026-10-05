/* Acciones CLI del mando dev (F2): status/logs/open/stop. Solo actuan con
 * contexto verificado (contextoEntrada): registro valido + snapshot con
 * cobertura + escucha viva. `stop` nunca toca puertos protegidos y revalida
 * el PID (creationTime exacta) <500ms antes de `taskkill /PID /T`. */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, join, normalize, resolve } from 'node:path';
import {
  clasificarEntrada,
  contextoEntrada,
  esDelProyecto,
  escanearEscucha,
  leerRegistro,
  marcadorPuerto,
  PUERTOS_PROTEGIDOS,
  procesosDe,
  RAIZ_REPO,
} from './doctor.mjs';

function taskkill(pid, forzado) {
  const args = forzado ? ['/F', '/PID', String(pid), '/T'] : ['/PID', String(pid), '/T'];
  return new Promise((resolveP) => {
    execFile('taskkill.exe', args, { timeout: 15_000, windowsHide: true }, (err, stdout) => {
      resolveP({ ok: !err, salida: String(stdout ?? '').trim().slice(0, 200) });
    });
  });
}

function puertoLibre(puerto) {
  return escanearEscucha().then(
    (esc) => !esc.some((e) => e.puerto === puerto),
    () => false,
  );
}

/* [por que] Tras taskkill el kernel puede tardar ~1s en soltar el socket:
 * un solo chequeo declara "sobrevive" cuando el proceso ya murio (caso real
 * 2026-10-01: sonda-f2b pid 12560 terminado pero puerto aun listado).
 * Reintentar 3x500ms distingue muerte lenta de supervivencia real; si sigue
 * ocupado, el rojo se mantiene (fail-closed). */
async function puertoLibreTrasKill(puerto, intentos = 3) {
  for (let i = 0; i < intentos; i++) {
    if (await puertoLibre(puerto)) return true;
    await new Promise((r) => setTimeout(r, 500));
  }
  return puertoLibre(puerto);
}

/* Revalida el PID antes de matar: CIM fresco, creationTime EXACTA y
 * exe/cmd todavia del proyecto. Si algo cambio (reuso de PID), aborta. */
async function revalidarPid(pid, rutaProyecto, marcador, creadoAntes) {
  const procs = await procesosDe([pid]);
  const proc = procs.get(pid);
  if (!proc?.creado) return { vale: false, porQue: 'proceso desaparecido o sin datos' };
  if (proc.creado !== creadoAntes) return { vale: false, porQue: 'creationTime cambio (PID reusado)' };
  if (!esDelProyecto(proc, rutaProyecto, marcador)) {
    return { vale: false, porQue: 'exe/cmd ya no son del proyecto' };
  }
  return { vale: true };
}

/* Solo registro (sin snapshot ni sensores): leer un log o imprimir URLs no
 * necesita estado vivo. Falla cerrado si el registro no trae la entrada. */
function entradaDe(id, args) {
  const iReg = args.indexOf('--registro');
  const rutaReg = iReg >= 0 ? args[iReg + 1] : undefined;
  let registro;
  try {
    registro = leerRegistro(rutaReg);
  } catch (e) {
    return { ok: false, resumen: `registro invalido (${e.message})` };
  }
  const entrada = registro.entradas.get(id);
  if (!entrada) {
    return { ok: false, resumen: 'sin entrada en registro (pendiente onboarding o no-aplica)' };
  }
  const rutaAbs = isAbsolute(entrada.ruta) ? normalize(entrada.ruta) : resolve(RAIZ_REPO, entrada.ruta);
  return { ok: true, entrada, rutaAbs };
}

/* F2 `status [id]`: sin id = tabla global (delega en doctor --all, misma
 * salida); con id = una linea verificada de la entrada. */
export async function status(argv) {
  const args = argv ?? [];
  const id = args[0] && !args[0].startsWith('-') ? args[0] : null;
  if (!id) {
    const { main } = await import('./doctor.mjs');
    return main(['--all', ...args]);
  }
  const comoJson = args.includes('--json');
  const ctx = await contextoEntrada(id, args);
  if (!ctx.ok) {
    const resumen = `status ${id}: ${ctx.resumen}`;
    if (comoJson) console.log(JSON.stringify({ id, resumen }));
    else console.log(resumen);
    return 1;
  }
  const r = await clasificarEntrada(ctx.proyecto, ctx.entrada, ctx.porPuerto, ctx.procs);
  if (comoJson) console.log(JSON.stringify({ id, estado: r.estado, motivo: r.motivo, detalle: r.detalle }));
  else console.log(`${r.estado.padEnd(11)} ${id}  ${r.motivo}`);
  return r.estado === 'bajo-mando' || r.estado === 'parado' ? 0 : r.estado === 'deriva' || r.estado === 'sin-boton' ? 2 : 1;
}

/* F2 `logs <id> [--lineas N]`: cola acotada (defecto 50, tope 200) del log
 * de `up`. Sin log = mensaje + exit 1, nunca vacio-verde. */
export async function logs(argv) {
  const args = argv ?? [];
  const id = args[0];
  if (!id || id.startsWith('-')) {
    console.error('uso: dev logs <id> [--lineas N] [--registro <ruta>]');
    return 1;
  }
  const iLin = args.indexOf('--lineas');
  const n = iLin >= 0 ? Number.parseInt(args[iLin + 1], 10) : 50;
  const lineas = Number.isInteger(n) ? Math.min(Math.max(n, 1), 200) : 50;
  const e = entradaDe(id, args);
  if (!e.ok) {
    console.error(`logs ${id}: ${e.resumen}`);
    return 1;
  }
  const rutaLog = join(e.rutaAbs, 'logs', `dev-up-${e.entrada.id}.log`);
  if (!existsSync(rutaLog)) {
    console.error(`logs ${id}: sin log (up nunca arranco aqui: ${rutaLog})`);
    return 1;
  }
  const todo = readFileSync(rutaLog, 'utf8').split(/\r?\n/);
  const cola = todo.slice(-lineas);
  console.log(cola.join('\n'));
  return 0;
}

/* F2 `open <id>`: imprime las URLs servidas (no abre nada solo: abrir el
 * navegador lo hace el usuario; el mando no finge acciones). */
export async function open(argv) {
  const args = argv ?? [];
  const id = args[0];
  if (!id || id.startsWith('-')) {
    console.error('uso: dev open <id> [--registro <ruta>]');
    return 1;
  }
  const e = entradaDe(id, args);
  if (!e.ok) {
    console.error(`open ${id}: ${e.resumen}`);
    return 1;
  }
  const healths = e.entrada.healths?.length ? e.entrada.healths : e.entrada.puertos.map((puerto) => ({ puerto }));
  const dominio = e.entrada.dominio ?? '127.0.0.1';
  for (const h of healths) {
    console.log(`http://${dominio}:${h.puerto}${h.ruta ?? '/'}`);
  }
  return 0;
}

/* F2 `stop <id>`: detiene SOLO listeners propios en puertos NO protegidos.
 * Protegidos (8787/5174/5175) = refuse siempre (el servidor se apaga por
 * otros medios). Ocupante ajeno = refuse (no mata). Pre-kill: re-query CIM y
 * creationTime exacta; post-kill: puerto libre verificado. */
export async function stop(argv) {
  const args = argv ?? [];
  const id = args[0];
  if (!id || id.startsWith('-')) {
    console.error('uso: dev stop <id> [--snapshot-file <ruta>] [--registro <ruta>] [--json]');
    return 1;
  }
  const comoJson = args.includes('--json');
  const sale = (codigo, obj) => {
    if (comoJson) console.log(JSON.stringify(obj));
    else console.log(obj.resumen);
    return codigo;
  };
  const ctx = await contextoEntrada(id, args);
  if (!ctx.ok) {
    return sale(1, { resumen: `stop ${id}: ${ctx.resumen}` });
  }
  const { entrada, proyecto, porPuerto, procs } = ctx;
  const r = await clasificarEntrada(proyecto, entrada, porPuerto, procs);
  const propios = [];
  for (const h of entrada.puertos) {
    const oyentes = porPuerto.get(h) ?? [];
    for (const o of oyentes) {
      if (esDelProyecto(procs.get(o.pid), proyecto.ruta, marcadorPuerto(entrada, h))) propios.push(o);
    }
  }
  if (propios.length === 0) {
    return sale(1, { resumen: `stop ${id}: nada propio escuchando (${r.motivo}): no se mata a ciegas` });
  }
  const protegidos = propios.filter((o) => PUERTOS_PROTEGIDOS.has(o.puerto));
  if (protegidos.length > 0) {
    return sale(1, {
      resumen: `stop ${id}: rehusado (puertos protegidos ${protegidos.map((o) => `${o.puerto} pid ${o.pid}`).join(', ')}): el servidor se apaga por otros medios`,
    });
  }
  const detenidos = [];
  for (const o of propios) {
    const antes = procs.get(o.pid);
    const rev = await revalidarPid(o.pid, proyecto.ruta, marcadorPuerto(entrada, o.puerto), antes?.creado);
    if (!rev.vale) {
      return sale(1, { resumen: `stop ${id}: pid ${o.pid} ya no vale (${rev.porQue}): aborto, re-escanea` });
    }
    let tk = await taskkill(o.pid, false);
    if (!(await puertoLibreTrasKill(o.puerto))) {
      tk = await taskkill(o.pid, true);
    }
    if (!(await puertoLibreTrasKill(o.puerto))) {
      return sale(1, { resumen: `stop ${id}: pid ${o.pid} sobrevive tras /F (puerto ${o.puerto} ocupado): NO verde (${tk.salida})` });
    }
    detenidos.push(`${o.puerto} pid ${o.pid}`);
  }
  return sale(0, { id, veredicto: 'detenido', resumen: `stop ${id}: detenido (${detenidos.join(', ')}) + puertos libres` });
}
