/* Lanzamiento de procesos: resolver el exe, arrancar y esperar el probe. */

import { cabeceraAutorizacion } from '../token.mjs';
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import http from 'node:http';
import { dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';

import { RAIZ_REPO } from './base.mjs';
import { escuchaRobusta } from './clasificar.mjs';
import { envPara } from './entorno.mjs';
import { escanearEscucha, normalizarRuta, procesosDe } from './procesos.mjs';
import { esDelProyecto, marcadorPuerto, sondear } from './puertos.mjs';
import { leerRegistro } from './registro.mjs';
import { resolverDirecto, resolverExe } from './resolver.mjs';

/* Lanza detached con logs a <ruta>/logs/dev-up-<id>.log (*.log gitignored).
 * Devuelve pid. Nunca mata nada: el dueño del puerto decide. */
export async function lanzar(entrada, rutaAbs, argv, envExtra) {
  const directo = resolverDirecto(rutaAbs, argv);
  const argvLanzar = directo ?? argv;
  let exe;
  let prefijo;
  if (directo) {
    exe = process.execPath;
    prefijo = [];
  } else {
    const nombreExe = argvLanzar[0].toLowerCase();
    // [por que] Binario absoluto precompilado (pulse.exe): se usa tal cual
    // (existencia ya validada en el registro); `where` solo resuelve nombres
    // del PATH y rehusaba el spawn (caso real 2026-10-05).
    if (/^[a-z]:[\\/]/i.test(argvLanzar[0]) && existsSync(resolve(argvLanzar[0]))) {
      exe = argvLanzar[0];
      prefijo = [];
    } else {
      ({ exe, prefijo } = await resolverExe(nombreExe === 'node' && argvLanzar[1] === '-e' ? 'node' : nombreExe));
    }
  }
  const dir = join(rutaAbs, 'logs');
  mkdirSync(dir, { recursive: true });
  const rutaLog = join(dir, `dev-up-${entrada.id}.log`);
  appendFileSync(rutaLog, `--- up ${new Date().toISOString()} :: ${argvLanzar.join(' ')}\n`);
  const fd = openSync(rutaLog, 'a');
  // [por que] La atribucion (esDelProyecto) exige exe bajo la ruta del
  // proyecto o cmd con RAIZ_REPO/expectedCmdline: un `node script-relativo`
  // queda "ocupado-desconocido" y el `up` nunca lo adopta (caso real
  // 2026-10-05: backend compilado). Absolutizar no cambia el programa.
  const esNodo = exe.toLowerCase().endsWith('node.exe') || exe.toLowerCase().endsWith('/node') || exe === process.execPath;
  const argsSpawn = [...prefijo, ...argvLanzar.slice(1)];
  if (esNodo && argsSpawn[0] && !argsSpawn[0].startsWith('-') && !isAbsolute(argsSpawn[0]) && existsSync(resolve(rutaAbs, argsSpawn[0]))) {
    argsSpawn[0] = resolve(rutaAbs, argsSpawn[0]);
  }
  const hijo = spawn(exe, argsSpawn, {
    cwd: rutaAbs,
    detached: true,
    stdio: ['ignore', fd, fd],
    windowsHide: true,
    ...(envExtra ? { env: { ...process.env, ...envExtra } } : {}),
  });
  hijo.unref();
  if (!hijo.pid) throw new Error('spawn sin pid');
  return { pid: hijo.pid, rutaLog };
}


/* [por que] El probe solo mira que el puerto responda 200: un servicio ajeno
 * que ya escuchara (o gane la carrera tras un spawn fallido) daria verde a un
 * arranque que no es nuestro. Verde exige un oyente del proyecto (misma
 * atribucion que stop). Fail-closed: si el escaneo falla, no hay verde. */
export async function oyenteDelProyecto(entrada, rutaAbs, puerto) {
  try {
    const oyentes = (await escanearEscucha()).filter((e) => e.puerto === puerto);
    if (oyentes.length === 0) return false;
    const procs = await procesosDe(oyentes.map((o) => o.pid));
    const marcador = marcadorPuerto(entrada, puerto);
    return oyentes.some((o) => esDelProyecto(procs.get(o.pid), rutaAbs, marcador));
  } catch {
    return false;
  }
}


export function esperarProbe(puerto, rutaRecurso, esperaJson, timeoutMs, limiteMs, dominio) {
  const t0 = Date.now();
  return new Promise((resolveP, rejectP) => {
    const intento = async () => {
      // [por que] sondear lanza si falta el token del manager: sin este try el rechazo
      // quedaba sin manejar y la promesa nunca resolvia.
      let s;
      try {
        s = await sondear(puerto, rutaRecurso, esperaJson, timeoutMs, dominio);
      } catch (e) {
        rejectP(e);
        return;
      }
      if (s.ok) {
        resolveP(true);
        return;
      }
      if (Date.now() - t0 > limiteMs) {
        resolveP(false);
        return;
      }
      setTimeout(intento, 1000);
    };
    intento();
  });
}


export function leerSnapshotServidor(forzar = false) {
  return new Promise((resolveP) => {
    const req = http.get(
      { host: '127.0.0.1', port: 8787, path: forzar ? '/api/workspace?forzar=1' : '/api/workspace', timeout: 30_000, headers: cabeceraAutorizacion() },
      (res) => {
        let cuerpo = '';
        res.on('data', (t) => {
          cuerpo += t;
          if (cuerpo.length > 8 * 1024 * 1024) req.destroy();
        });
        res.on('end', () => {
          try {
            resolveP({ snapshot: JSON.parse(cuerpo), error: null });
          } catch {
            resolveP({ snapshot: null, error: 'respuesta no JSON' });
          }
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', (e) => resolveP({ snapshot: null, error: String(e.message ?? e).slice(0, 120) }));
  });
}


/* Contexto compartido up/status/stop (F2): registro (+--registro para e2e),
 * snapshot (archivo o servidor; nunca a ciegas), proyecto casado por ruta,
 * escucha + procesos + mapa por puerto. Falla cerrado con motivo. */
export async function contextoEntrada(id, args, { autoBackend = false } = {}) {
  const iSnap = args.indexOf('--snapshot-file');
  const rutaSnap = iSnap >= 0 ? args[iSnap + 1] : null;
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
    return { ok: false, resumen: `sin entrada en registro (pendiente onboarding o no-aplica): nada que hacer` };
  }
  const rutaAbs = isAbsolute(entrada.ruta) ? normalize(entrada.ruta) : resolve(RAIZ_REPO, entrada.ruta);
  let snapshot = null;
  // Motivo de cobertura no verificada (snapshot del servidor caido o lento); null = verificada.
  let sinCobertura = null;
  if (rutaSnap) {
    try {
      snapshot = JSON.parse(readFileSync(rutaSnap, 'utf8'));
    } catch (e) {
      return { ok: false, resumen: `snapshot ilegible (${e.message})` };
    }
  } else {
    let r = await leerSnapshotServidor();
    // [por que] `up` (autoBackend) arranca el backend solo si 8787 no tiene
    // listener (ECONNREFUSED): sin el, ningun proyecto se decide. status/stop
    // siguen de solo lectura y solo avisan.
    if (autoBackend && r.error && /ECONNREFUSED/.test(r.error)) {
      const fallo = await arrancarBackend(registro);
      if (fallo) return { ok: false, resumen: fallo };
      r = await leerSnapshotServidor();
    }
    // [por que 2026-10-13] Un timeout del snapshot (8787 ocupado) no es que el
    // proyecto este caido: el probe de sus puertos sigue siendo verdad. Sin
    // snapshot la cobertura queda sin verificar y cada comando decide: status
    // reporta con nota, up solo confirma ya-arriba y stop rehusa.
    if (r.error || !r.snapshot) sinCobertura = `snapshot del servidor: ${r.error ?? 'sin datos'}`;
    else snapshot = r.snapshot;
  }
  const proyectos = (snapshot?.proyectos ?? []).map((p) => ({ clave: p.clave, ruta: p.ruta }));
  let proyecto = proyectos.find((p) => normalizarRuta(rutaAbs) === normalizarRuta(p.ruta));
  if (!proyecto) {
    // [por que] config.ignorados oculta el proyecto del tablero por decision
    // curada (p. ej. RESTAURANTE, 05AA): el escaner lo conoce y lo filtra del
    // snapshot. Sigue siendo cobertura valida para arrancarlo; el tablero no
    // cambia. Exige repo real (.git) en la ruta del registro.
    const claveIgnorada = relative(dirname(RAIZ_REPO), rutaAbs).split(sep).join('/');
    const ignorados = snapshot?.config?.ignorados ?? [];
    if (ignorados.includes(claveIgnorada) && existsSync(join(rutaAbs, '.git'))) {
      proyecto = { clave: claveIgnorada, ruta: rutaAbs, ignorado: true };
    }
  }
  if (!proyecto && snapshot) {
    return { ok: false, resumen: `'${entrada.ruta}' fuera del snapshot (stale?): sin cobertura no se actua` };
  }
  // [por que] Sin snapshot, la ruta del registro basta para clasificar puertos
  // (clasificarEntrada solo usa p.ruta); la cobertura queda en sinCobertura.
  if (!proyecto) proyecto = { clave: null, ruta: rutaAbs };
  const { escucha, errorSensor } = await escuchaRobusta();
  if (errorSensor) {
    return { ok: false, resumen: errorSensor };
  }
  const pids = [...new Set(escucha.map((e) => e.pid))];
  const procs = await procesosDe(pids);
  // [por que] Los binarios Rust compilan en C:\tmp por regla del area: un
  // `0.0.0.0` suyo jamas contiene RAIZ_REPO y el filtro viejo los borraba
  // (caso real 2026-10-03: pulse en 3000 visto como "libre"). La contencion
  // correcta es la misma atribucion que esDelProyecto (exe bajo la ruta del
  // proyecto o cmd con su expectedCmdline), aplicada a TODAS las entradas.
  const todas = [...(registro.entradas?.values() ?? [])];
  const esDeAlgunProyecto = (pr) => {
    if (!pr) return false;
    for (const t of todas) {
      // [por que 06AA-1] La marcada no atribuye: sus marcadores no son de
      // confianza y su ruta puede estar rota (el isAbsolute no debe tumbar
      // el contexto de OTRA entrada sana).
      if (t._avisoRegistro || typeof t.ruta !== 'string') continue;
      const rAbs = isAbsolute(t.ruta) ? normalize(t.ruta) : resolve(RAIZ_REPO, t.ruta);
      if (pr.exe && normalizarRuta(pr.exe).startsWith(normalizarRuta(rAbs) + '\\')) return true;
      const marcas = Array.isArray(t.expectedCmdline) ? t.expectedCmdline : [t.expectedCmdline];
      if (marcas.some((m) => typeof m === 'string' && m.length > 0 && (pr.cmd ?? '').includes(m))) return true;
    }
    return normalizarRuta(`${pr.exe ?? ''} ${pr.cmd ?? ''}`).includes(normalizarRuta(RAIZ_REPO));
  };
  const candidatos = escucha.filter((e) => {
    if (e.ip === '127.0.0.1' || e.ip === '::1') return true;
    if (e.ip === '0.0.0.0' || e.ip === '::') return esDeAlgunProyecto(procs.get(e.pid));
    return false;
  });
  const porPuerto = new Map();
  for (const c of candidatos) {
    if (!porPuerto.has(c.puerto)) porPuerto.set(c.puerto, []);
    porPuerto.get(c.puerto).push(c);
  }
  return { ok: true, entrada, proyecto, rutaAbs, porPuerto, procs, sinCobertura };
}


/* Arranca el backend de workspace-manager (boton[0]) como fuente del snapshot.
 * [por que] Sin el, `up` de cualquier proyecto se queda parado. Solo se llama
 * si 8787 esta libre (ECONNREFUSED): nunca mata ni suplanta un 8787 ocupado. */
async function arrancarBackend(registro) {
  /* [por que] El backend que sirve el snapshot es el de ESTE repo: se identifica
   * por su ruta (la raiz del repo), no por un id concreto, que cambia con el
   * nombre de la carpeta al clonar. Es la misma identidad con la que la
   * validacion protege los puertos (rutaAbs === RAIZ_REPO). */
  const raizRepo = normalize(RAIZ_REPO);
  const wm = [...registro.entradas.values()].find((e) => {
    const abs = isAbsolute(e.ruta) ? normalize(e.ruta) : resolve(RAIZ_REPO, e.ruta);
    return abs === raizRepo;
  });
  if (!wm || !Array.isArray(wm.boton) || !wm.boton[0]) {
    return 'servidor caido y sin entrada de este repo con boton: pasa --snapshot-file';
  }
  const rutaWm = isAbsolute(wm.ruta) ? normalize(wm.ruta) : resolve(RAIZ_REPO, wm.ruta);
  let lan;
  try {
    lan = await lanzar(wm, rutaWm, wm.boton[0], envPara(wm));
  } catch (e) {
    return `servidor caido y el arranque del backend fallo (${e.message})`;
  }
  const h = (wm.healths ?? []).find((x) => x.puerto === 8787) ?? { ruta: '/api/pc/estado', esperaJson: true };
  const ok = await esperarProbe(8787, h.ruta, h.esperaJson, wm.timeoutMs ?? 3000, wm.arranqueMs ?? 60_000, wm.dominio);
  if (!ok) return `backend arrancado pid ${lan.pid} pero sin probe en 8787 (log ${lan.rutaLog}): NO verde`;
  if (!(await oyenteDelProyecto(wm, rutaWm, 8787))) {
    return `backend arrancado pid ${lan.pid} pero el oyente de 8787 no es el suyo (log ${lan.rutaLog}): NO verde`;
  }
  return null;
}


/* `up` sin cobertura (snapshot no disponible): solo confirma un ya-arriba con
 * probe verde, con codigo 2 (degradado: ni cobertura ni `requiere` comprobados).
 * Cualquier otro estado rehusa. Nunca arranca, reconstruye ni toca dependencias. */
export function veredictoUpSinCobertura(id, r, motivo) {
  if (r.estado === 'bajo-mando') {
    return { codigo: 2, resumen: `up ${id}: ya-arriba (${r.motivo}); cobertura no verificada (${motivo}): dependencias sin comprobar` };
  }
  return {
    codigo: 1,
    resumen: `up ${id}: rehusado (${r.estado}: ${r.motivo}); sin cobertura (${motivo}) no se arranca. Arranca el backend de este repo (su boton[0]) o pasa --snapshot-file`,
  };
}

