/* Doctor del mando dev (F0): solo detecta, nunca arranca nada.
 * [por que] Modulo COMPARTIDO CLI<->server: el CLI (`dev.mjs doctor`) y el
 * servidor (`src/server/dev/vigilancia.ts` via execFile) ejecutan este mismo
 * archivo; no hay dos implementaciones que diverjan. Sensores verificados en
 * spike 2026-10-01 (Windows es-MX): Get-NetTCPConnection (objetos, sin
 * parser, IPv4+IPv6) + Get-CimInstance batch (CreationDate+CommandLine+Exe).
 * netstat/tasklist descartados (idioma/encoding, sin cmdline).
 * Exit codes: 0 verde, 2 degradado (huecos visibles), 1 error.
 * Con --assert: 1 tambien si el INSTRUMENTO falla (cobertura, motivos fuera
 * de enum, `otro`>20%, snapshot stale); 0 exige instrumento OK + area verde;
 * 2 = instrumento OK pero hay huecos visibles (deriva/sin-boton/huerfanos). */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';

export const DIR_DEV = dirname(fileURLToPath(import.meta.url));
export const RAIZ_REPO = resolve(DIR_DEV, '..', '..');
export const RUTA_REGISTRO = join(DIR_DEV, 'registro.json');
export const TTL_MS = 60_000;
export const TIMEOUT_SENSOR_MS = 5_000;
export const MAX_PIDS_CONSULTA = 20;
export const PUERTOS_PROTEGIDOS = new Set([8787, 5174, 5175]);
export const MOTIVOS_ENUM = new Set([
  'solo-docs',
  'gestion-externa',
  'pendiente-onboarding',
  'pausado-archivado',
  'puerto-dinamico',
]);
const RE_OTRO = /^otro\{detalle="(.{1,80})",caducidad=(\d{4}-\d{2}-\d{2})\}$/;
const BOTONES_VALIDOS = new Set([
  'node scripts/dev.mjs',
  'npm run dev',
  'npm run server',
  'cargo run -p pulse',
  'dev-web.mjs',
  'dev-web.ts',
  'dev-runner.ts',
  'dev.sh',
  'dev.ps1',
]);

/* Lee y valida el registro (schema v1). Falla cerrado: cualquier desvio
 * es error, nunca "vale igual". */
export function leerRegistro(ruta = RUTA_REGISTRO) {
  if (!existsSync(ruta)) throw new Error(`registro ausente: ${ruta}`);
  let crudo;
  try {
    crudo = JSON.parse(readFileSync(ruta, 'utf8'));
  } catch (e) {
    throw new Error(`registro JSON invalido: ${String(e)}`);
  }
  if (crudo.version !== 1) throw new Error(`registro: version!=1 (${crudo.version})`);
  if (!Array.isArray(crudo.proyectos)) throw new Error('registro: proyectos no es array');
  const entradas = new Map();
  for (const e of crudo.proyectos) {
    validarEntrada(e);
    if (entradas.has(e.id)) throw new Error(`registro: id duplicado '${e.id}'`);
    entradas.set(e.id, e);
  }
  const noAplica = crudo.noAplica ?? {};
  if (typeof noAplica !== 'object' || Array.isArray(noAplica)) {
    throw new Error('registro: noAplica no es objeto');
  }
  for (const [clave, motivo] of Object.entries(noAplica)) validarMotivo(motivo, `noAplica.${clave}`);
  return { version: 1, entradas, noAplica };
}

function validarEntrada(e) {
  for (const k of ['id', 'ruta', 'boton', 'puertos', 'expectedCmdline']) {
    if (!(k in e)) throw new Error(`registro: entrada sin '${k}' (${JSON.stringify(e).slice(0, 80)})`);
  }
  const conocidas = new Set(['id', 'ruta', 'boton', 'puertos', 'healths', 'timeoutMs', 'expectedCmdline', 'tipoLauncher']);
  for (const k of Object.keys(e)) {
    if (!conocidas.has(k)) throw new Error(`registro: clave desconocida '${k}' en '${e.id}'`);
  }
  const rutaAbs = isAbsolute(e.ruta) ? normalize(e.ruta) : resolve(RAIZ_REPO, e.ruta);
  // [por que] El mando gestiona proyectos hermanos (glory-pulse, ...): el
  // area valida es area-trabajo, no solo este repo.
  const areaNorm = normalize(resolve(RAIZ_REPO, '..'));
  if (rutaAbs !== areaNorm && !rutaAbs.startsWith(areaNorm + sep)) {
    throw new Error(`registro: '${e.id}' ruta fuera del area (${e.ruta})`);
  }
  if (!existsSync(rutaAbs)) throw new Error(`registro: '${e.id}' ruta inexistente (${e.ruta})`);
  if (!Array.isArray(e.boton) || e.boton.length === 0 || e.boton.some((a) => typeof a !== 'string')) {
    throw new Error(`registro: '${e.id}' boton debe ser array de strings no vacio`);
  }
  const primero = e.boton[0];
  const botonOk = [...BOTONES_VALIDOS].some((b) => primero === b || primero.endsWith('/' + b) || primero.endsWith('\\' + b));
  if (!botonOk && !primero.startsWith('run-')) throw new Error(`registro: '${e.id}' boton fuera de allowlist (${primero})`);
  if (!Array.isArray(e.puertos) || e.puertos.some((p) => !Number.isInteger(p) || p < 1 || p > 65535)) {
    throw new Error(`registro: '${e.id}' puertos invalidos`);
  }
  for (const p of e.puertos) {
    // [por que] 8787/5175 son del propio manager y 5174 de opencode-propio:
    // ningun OTRO proyecto puede reclamarlos; la entrada raiz si (self).
    if (PUERTOS_PROTEGIDOS.has(p) && rutaAbs !== normalize(RAIZ_REPO)) {
      throw new Error(`registro: '${e.id}' usa puerto protegido ${p}`);
    }
  }
  const healths = e.healths ?? [];
  if (!Array.isArray(healths)) throw new Error(`registro: '${e.id}' healths no es array`);
  for (const h of healths) {
    if (!Number.isInteger(h?.puerto) || !e.puertos.includes(h.puerto)) {
      throw new Error(`registro: '${e.id}' health con puerto fuera de la entrada`);
    }
    // [por que] Health sin ruta valida = probe contra el(Query) puerto sin
    // saber que pedir: el verde seria fingido. Sin validacion, un typo
    // (`ruta: 'api/x'` sin barra) pasa callado y el probe falla como deriva.
    if (typeof h.ruta !== 'string' || !h.ruta.startsWith('/')) {
      throw new Error(`registro: '${e.id}' health sin ruta absoluta (puerto ${h.puerto})`);
    }
    if ('esperaJson' in h && typeof h.esperaJson !== 'boolean') {
      throw new Error(`registro: '${e.id}' health esperaJson no booleano (puerto ${h.puerto})`);
    }
    for (const k of Object.keys(h)) {
      if (!['puerto', 'ruta', 'esperaJson'].includes(k)) {
        throw new Error(`registro: '${e.id}' health con clave desconocida '${k}'`);
      }
    }
  }
  // [por que] F0d: nuevo launcher = campo tipoLauncher + checklist, no `if`
  // en codigo. Si viene, debe decir algo (string no vacio); el contenido lo
  // documenta el onboarding, el doctor solo exige que exista con forma.
  if ('tipoLauncher' in e && (typeof e.tipoLauncher !== 'string' || e.tipoLauncher.length === 0)) {
    throw new Error(`registro: '${e.id}' tipoLauncher vacio`);
  }
  if ('timeoutMs' in e && (!Number.isInteger(e.timeoutMs) || e.timeoutMs < 500 || e.timeoutMs > 30000)) {
    throw new Error(`registro: '${e.id}' timeoutMs fuera de 500..30000`);
  }
  if (typeof e.expectedCmdline !== 'string' || e.expectedCmdline.length === 0) {
    throw new Error(`registro: '${e.id}' expectedCmdline vacio`);
  }
}

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

/* Ejecuta powershell con salida UTF-8 y timeout duro. */
function correrPs(script, timeoutMs = TIMEOUT_SENSOR_MS) {
  return new Promise((resolveP, rejectP) => {
    const prefijo = '[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new(); ';
    const hijo = execFile(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', prefijo + script],
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (err, stdout) => {
        if (err) {
          const causa = err.killed || err.signal === 'SIGTERM' ? 'timeout' : String(err.message ?? err).slice(0, 160);
          rejectP(new Error(`powershell fallo (${causa})`));
          return;
        }
        resolveP(stdout);
      },
    );
    void hijo;
  });
}

/* Puertos escuchando: objetos via Get-NetTCPConnection (sin parsear texto).
 * Solo binds explicitos loopback (127.0.0.1/::1) + 0.0.0.0/[::] atribuibles
 * al area por proceso (los binds globales de servicios del sistema quedan
 * fuera de alcance declarado). */
export async function escanearEscucha() {
  const sal = await correrPs(
    `Get-NetTCPConnection -State Listen | Select-Object @{n='ip';e={$_.LocalAddress.ToString()}},@{n='puerto';e={$_.LocalPort}},@{n='pid';e={$_.OwningProcess}} | ConvertTo-Json -Compress -Depth 2`,
  );
  let filas;
  try {
    const j = JSON.parse(sal);
    filas = Array.isArray(j) ? j : j ? [j] : [];
  } catch {
    throw new Error('sensor puertos: JSON inesperado de Get-NetTCPConnection');
  }
  return filas
    .filter((f) => Number.isInteger(f?.puerto) && Number.isInteger(f?.pid))
    .map((f) => ({ ip: String(f.ip), puerto: f.puerto, pid: f.pid }));
}

/* Datos de procesos en consultas batch (trozos de <=20 PIDs): CreationDate
 * ISO, ExecutablePath y CommandLine. Sin CommandLine visible (elevados) el
 * proceso NO es confiable: se marca, nunca se da por bueno. */
export async function procesosDe(pids) {
  const unicos = [...new Set(pids)].filter((p) => Number.isInteger(p) && p > 0);
  if (unicos.length === 0) return new Map();
  // [por que] Un solo filtro CIM largo devuelve un subconjunto SIN error y
  // los PIDs recortados quedarian NO-VERIFICADO en silencio. Trozos de 20
  // secuenciales (~0.5 s c/u): completo sin sacrificar el tope por llamada.
  const mapa = new Map();
  for (let i = 0; i < unicos.length; i += MAX_PIDS_CONSULTA) {
    const trozo = unicos.slice(i, i + MAX_PIDS_CONSULTA);
    const filtro = trozo.map((p) => `ProcessId=${p}`).join(' OR ');
    const sal = await correrPs(
      `Get-CimInstance Win32_Process -Filter "${filtro}" | Select-Object @{n='pid';e={$_.ProcessId}},@{n='creado';e={$_.CreationDate.ToString('o')}},@{n='exe';e={$_.ExecutablePath}},@{n='cmd';e={$_.CommandLine}} | ConvertTo-Json -Compress -Depth 2`,
    );
    let filas;
    try {
      const j = JSON.parse(sal);
      filas = Array.isArray(j) ? j : j ? [j] : [];
    } catch {
      throw new Error('sensor procesos: JSON inesperado de Get-CimInstance');
    }
    for (const f of filas) {
      if (!Number.isInteger(f?.pid)) continue;
      mapa.set(f.pid, { creado: f.creado ?? null, exe: f.exe ?? null, cmd: f.cmd ?? null });
    }
  }
  return mapa;
}

function normalizarRuta(r) {
  return String(r ?? '').replace(/\//g, '\\').toLowerCase();
}

/* ¿El proceso pertenece al proyecto? Exe bajo la ruta del proyecto O
 * cmdline que contiene expectedCmdline (deteccion; el match EXACTO con
 * normalizacion UTC es pre-kill, F1). */
function esDelProyecto(proc, rutaProyecto, expectedCmdline) {
  if (!proc) return false;
  const base = normalizarRuta(rutaProyecto);
  if (proc.exe && normalizarRuta(proc.exe).startsWith(base + '\\')) return true;
  if (proc.cmd && expectedCmdline && proc.cmd.includes(expectedCmdline)) return true;
  return false;
}

function sondear(puerto, rutaRecurso, esperaJson, timeoutMs) {
  return new Promise((resolveP) => {
    const req = http.get(
      { host: '127.0.0.1', port: puerto, path: rutaRecurso || '/', timeout: timeoutMs },
      (res) => {
        let cuerpo = '';
        res.on('data', (t) => {
          cuerpo += t;
          if (cuerpo.length > 64 * 1024) req.destroy();
        });
        res.on('end', () => {
          const okStatus = res.statusCode === 200;
          let okJson = true;
          if (esperaJson !== false) {
            try {
              JSON.parse(cuerpo);
            } catch {
              okJson = false;
            }
          }
          resolveP({ ok: okStatus && okJson, status: res.statusCode });
        });
      },
    );
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', () => resolveP({ ok: false, status: null }));
  });
}

/* Clasifica snapshot x registro x escucha. Por proyecto: exactamente un
 * estado. Huerfanos: listeners sin entrada del registro; se atribuyen por
 * prefijo de ruta (exe+cmd) o quedan con clave null (grupo propio). */
export async function clasificar(proyectos, registro, escucha) {
  const pids = [...new Set(escucha.map((e) => e.pid))];
  const procs = await procesosDe(pids);
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
  for (const p of proyectos) {
    const entrada = [...registro.entradas.values()].find(
      (e) => normalizarRuta(isAbsolute(e.ruta) ? e.ruta : resolve(RAIZ_REPO, e.ruta)) === normalizarRuta(p.ruta),
    );
    if (!entrada) {
      if (p.clave in registro.noAplica) {
        resultado.push({ clave: p.clave, estado: 'no-aplica', motivo: registro.noAplica[p.clave] });
      } else {
        resultado.push({ clave: p.clave, estado: 'sin-boton', motivo: 'pendiente-onboarding' });
      }
      continue;
    }
    const timeoutMs = entrada.timeoutMs ?? 2000;
    const healths = entrada.healths?.length ? entrada.healths : entrada.puertos.map((puerto) => ({ puerto }));
    let estado = 'bajo-mando';
    let motivo = 'probe verde';
    for (const h of healths) {
      const oyentes = porPuerto.get(h.puerto) ?? [];
      // [por que] Dos `tsx watch` del mismo servidor pelean el puerto
      // (caso real 2026-10-01: pids 23444+16484 en 8787, probe intermitente).
      // Quedarse con el primero ocultaria el duplicado: es deriva visible.
      const propios = oyentes.filter((o) => esDelProyecto(procs.get(o.pid), p.ruta, entrada.expectedCmdline));
      if (propios.length > 1) {
        estado = 'deriva';
        motivo = `puerto ${h.puerto} con ${propios.length} procesos del proyecto (duplicado: ${propios.map((o) => o.pid).join(',')})`;
        break;
      }
      const propio = propios[0];
      if (!propio) {
        estado = 'deriva';
        motivo = oyentes.length ? `puerto ${h.puerto} ocupado por desconocido` : `puerto ${h.puerto} libre (caido?)`;
        break;
      }
      for (const o of oyentes) consumidos.add(`${o.ip}:${o.puerto}:${o.pid}`);
      const proc = procs.get(propio.pid);
      if (!proc?.cmd) {
        estado = 'deriva';
        motivo = `puerto ${h.puerto} no verificable (sin cmdline)`;
        break;
      }
      consumidos.add(`${propio.ip}:${propio.puerto}:${propio.pid}`);
      const s = await sondear(h.puerto, h.ruta, h.esperaJson, timeoutMs);
      if (!s.ok) {
        estado = 'deriva';
        motivo = `puerto ${h.puerto} sin probe (status ${s.status})`;
        break;
      }
    }
    resultado.push({ clave: p.clave, estado, motivo });
  }

  const huerfanos = [];
  for (const c of candidatos) {
    if (consumidos.has(`${c.ip}:${c.puerto}:${c.pid}`)) continue;
    const proc = procs.get(c.pid);
    let clave = null;
    let mejor = 0;
    for (const p of proyectos) {
      const base = normalizarRuta(p.ruta);
      const texto = normalizarRuta(`${proc?.exe ?? ''} ${proc?.cmd ?? ''}`);
      if (texto.includes(base) && base.length > mejor) {
        mejor = base.length;
        clave = p.clave;
      }
    }
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

function codigoSalida(informe) {
  if (informe.errorSensor) return 1;
  if (informe.huerfanos.length > 0) return 2;
  if (informe.proyectos.some((p) => p.estado === 'deriva' || p.estado === 'sin-boton')) return 2;
  return 0;
}

function tabla(informe) {
  const lineas = ['estado      clave                      motivo'];
  for (const p of informe.proyectos) {
    lineas.push(`${p.estado.padEnd(11)} ${(p.clave ?? '').slice(0, 26).padEnd(26)} ${p.motivo}`);
  }
  for (const h of informe.huerfanos) {
    lineas.push(`deriva      ${h.clave ? `@${h.clave} ` : '(sin proyecto) '}(puerto ${h.puerto} pid ${h.pid}${h.verificado ? '' : ' NO-VERIFICADO'})`);
  }
  if (informe.errorSensor) lineas.push(`ERROR sensor: ${informe.errorSensor}`);
  lineas.push(`tomadoEn=${informe.tomadoEn} snapshotEn=${informe.snapshotEn}`);
  return lineas.join('\n');
}

/* CLI: doctor --all [--json] [--snapshot-file <ruta>] [--assert] */
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
  if (rutaSnap) {
    try {
      snapshot = JSON.parse(readFileSync(rutaSnap, 'utf8'));
    } catch (e) {
      console.error(`snapshot: no se pudo leer (${e.message})`);
      return 1;
    }
  }
  const proyectos = (snapshot?.proyectos ?? []).map((p) => ({ clave: p.clave, ruta: p.ruta }));
  const snapshotEn = snapshot?.escaneadoEn ?? null;

  let escucha = [];
  let errorSensor = null;
  try {
    escucha = await escanearEscucha();
  } catch (e) {
    // [por que] Arranque frio: el primer powershell+CIM tras idle puede
    // superar los 5s y no es un defecto del area. UN reintento; si falla dos
    // veces seguidas es real y queda en errorSensor (fail-loud, nunca hueco).
    await new Promise((r) => setTimeout(r, 1000));
    try {
      escucha = await escanearEscucha();
    } catch (e2) {
      errorSensor = `sensor: ${e.message} / reintento: ${e2.message}`;
    }
  }
  const tomadoEn = new Date().toISOString();
  let clasif = { proyectos: [], huerfanos: [] };
  if (!errorSensor) {
    try {
      clasif = await clasificar(proyectos, registro, escucha);
    } catch (e) {
      errorSensor = `clasificar: ${e.message}`;
    }
  }
  const informe = { version: 1, tomadoEn, snapshotEn, ttlMs: TTL_MS, errorSensor, ...clasif };

  if (conAssert) {
    const fallos = [];
    if (informe.proyectos.length !== proyectos.length) {
      fallos.push(`cobertura: clasificados ${informe.proyectos.length} != snapshot ${proyectos.length}`);
    }
    // [por que] Anti-trampa: el enum de motivos rige la INTENCION humana
    // (sin-boton/no-aplica: por que nadie lo gestiona); deriva/bajo-mando
    // llevan EVIDENCIA del sensor (texto libre: que se vio), no intencion.
    // Mezclarlos permitiria esconder proyectos tras 'otro' inventados o
    // motivos vacios. `otro` >20% = el registro dejo de describir el area.
    let otros = 0;
    let clasificados = 0;
    for (const p of informe.proyectos) {
      if (p.estado === 'sin-boton' || p.estado === 'no-aplica') {
        clasificados++;
        try {
          validarMotivo(p.motivo, p.clave);
        } catch (e) {
          fallos.push(e.message);
        }
        if (typeof p.motivo === 'string' && p.motivo.startsWith('otro{')) otros++;
      } else if (p.estado === 'deriva' || p.estado === 'bajo-mando') {
        if (typeof p.motivo !== 'string' || p.motivo.length === 0 || p.motivo.length > 200) {
          fallos.push(`${p.clave}: evidencia vacia o excesiva (${p.estado})`);
        }
      } else {
        fallos.push(`${p.clave}: estado desconocido '${p.estado}'`);
      }
    }
    if (clasificados > 0 && otros / clasificados > 0.2) {
      fallos.push(`otro supera 20% (${otros}/${clasificados}): el registro no describe el area`);
    }
    if (snapshotEn) {
      const edad = Date.now() - new Date(snapshotEn).getTime();
      if (!(edad >= 0 && edad <= TTL_MS)) fallos.push(`snapshot stale (edad ${Math.round(edad / 1000)}s > TTL)`);
    } else if (proyectos.length > 0) {
      fallos.push('snapshot sin escaneadoEn');
    }
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
  else console.log(tabla(informe));
  return codigoSalida(informe);
}

const esCli = process.argv[1] && normalize(process.argv[1]) === normalize(join(DIR_DEV, 'doctor.mjs'));
if (esCli) {
  main().then(
    (c) => process.exit(c),
    (e) => {
      console.error(`doctor: ${e?.message ?? e}`);
      process.exit(1);
    },
  );
}
