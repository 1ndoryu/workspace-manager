/* quality:bump — propaga un release de herramienta a TODOS los consumidores.
 *
 * [por que] El invariante "un commit común para todos" ya estaba guardado
 * (`quality-sync.mjs`), pero no existía el ESCRITOR: publicar Sentinel 0.7.9
 * exigió editar 11 `quality-tools.json` a mano, y la propagación se hacía con un
 * script suelto en una ruta temporal que el barrido de `C:\tmp` puede borrar
 * (109A-9). Este script es la herramienta única: reescribe el pin, regenera el
 * lock, produce la evidencia (con la caché de certificación, ver
 * `certificacion.mjs`) y verifica con el doctor de cada consumidor.
 *
 * La lista de consumidores NO se duplica aquí: se toma del propio guard
 * (`quality-sync.mjs --json`), que ya es su fuente de verdad. Así el conjunto que
 * propaga y el que verifica no pueden divergir.
 *
 * Es DRY-RUN por defecto (coherente con `lock-generator.mjs`): sin `--write` no
 * toca nada. Idempotente: sobre un estado ya propagado no produce cambios.
 *
 * Uso:
 *   node scripts/quality/bump.mjs --tool sentinel                     (dry-run)
 *   node scripts/quality/bump.mjs --tool sentinel --write
 *   node scripts/quality/bump.mjs --shims [--write]
 * Opciones:
 *   --tool <nombre>       herramienta a propagar (sentinel|varsense)
 *   --commit <sha>        commit destino (por defecto el HEAD del checkout)
 *   --version <v>         versión destino (por defecto la del package.json)
 *   --source <dir>        checkout desde el que se deriva el destino
 *                         (por defecto <área>/.quality-tools/<tool>)
 *   --only a,b / --skip a,b   restringe los consumidores
 *   --shims               revisa (y con --write reescribe) los routers del adapter
 *   --no-steps            solo reescribe manifiestos/routers, sin lock/setup/doctor
 *   --json                salida legible por máquina
 *
 * Rutas y familias: A = checkout compartido (el adapter es un router al canónico);
 * B = submódulo versionado dentro del consumidor (tiene su propio adapter y su
 * lock exige el gitlink commiteado en el padre). Los routers solo se propagan a
 * la familia A; un adapter propio nunca se pisa.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const MANAGER = path.resolve(AQUI, '..', '..');
const RAIZ_AREA = path.resolve(MANAGER, '..');

/* Routers: archivos que en cada consumidor son solo un puente al adapter único
 * del área. `ADAPTER` es el nombre del archivo canónico al que delegan. */
const ROUTERS = [
  { archivo: 'quality-setup.mjs', prefijo: 'quality:setup' },
  { archivo: 'lock-generator.mjs', prefijo: 'quality:lock' },
];

const EXCLUIDOS_POR_ALCANCE = ['glory-harness'];

const argv = process.argv.slice(2);

function valorDe(flag) {
  const indice = argv.indexOf(flag);
  return indice >= 0 && argv[indice + 1] ? argv[indice + 1] : null;
}

const soloShims = argv.includes('--shims');
const escribir = argv.includes('--write');
/* Los routers solo se ESCRIBEN en modo --shims. [por que] Antes los tocaba
 * también `--tool <t> --write`, y como el destino del host coincide con el
 * adapter canónico, un bump de pin borraba el adapter y dejaba routers que
 * delegaban en sí mismos (recursión + AssignProcessToJobObject, 2026-09-10). */
const escribirRouters = soloShims && escribir;
const salidaJson = argv.includes('--json');
const conPasos = !argv.includes('--no-steps');
const herramienta = valorDe('--tool');
const solo = (valorDe('--only') ?? '').split(',').map(s => s.trim()).filter(Boolean);
const salta = (valorDe('--skip') ?? '').split(',').map(s => s.trim()).filter(Boolean);

/* ---------------------------------------------------------------- utilidades */

function citar(valor) {
  return /[\s"]/u.test(valor) ? `"${valor.replace(/"/gu, '\\"')}"` : valor;
}

function comando(exe, args) {
  return [exe, ...args].map(citar).join(' ');
}

function ejecutar(linea, cwd, timeout = 0) {
  const resultado = spawnSync(linea, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    shell: true,
    maxBuffer: 32 * 1024 * 1024,
    ...(timeout > 0 ? { timeout } : {}),
  });
  return {
    status: typeof resultado.status === 'number' ? resultado.status : 2,
    salida: `${resultado.stdout ?? ''}${resultado.stderr ?? ''}`,
    error: resultado.error?.message ?? null,
  };
}

function leerJson(archivo) {
  try {
    return JSON.parse(fs.readFileSync(archivo, 'utf8'));
  } catch {
    return null;
  }
}

/* Recorta el primer objeto JSON de una salida que puede traer líneas de log. */
function leerJsonDeTexto(texto) {
  const inicio = texto.indexOf('{');
  const fin = texto.lastIndexOf('}');
  if (inicio < 0 || fin <= inicio) return null;
  try {
    return JSON.parse(texto.slice(inicio, fin + 1));
  } catch {
    return null;
  }
}

/* ------------------------------------------------- router (puente sin lógica) */

/* Texto EXACTO del router. Vive aquí y solo aquí: es lo que se propaga a todos
 * los consumidores, así que no puede divergir por copia-pega. */
function textoRouter({ archivo, prefijo }) {
  return `#!/usr/bin/env node
/* ${archivo} (router) — NO contiene lógica del gate: delega en el adapter único
 * del área. [por que] Este archivo estaba copiado en 9 proyectos y cada fix había
 * que aplicarlo tantas veces (109A-9). Si necesitas cambiar el comportamiento,
 * cambia el adapter, no este router: se propaga con \`quality:bump --shims --write\`.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const ADAPTER = '${archivo}';
const RELATIVO = path.join('workspace-manager', 'scripts', 'quality', ADAPTER);
const AREA_POR_DEFECTO = 'C:/Users/Owner/OneDrive/Documentos/area-trabajo';

/* Resuelve la raíz del área sin depender de una ruta absoluta frágil: variable
 * explícita, luego el propio manifiesto (sourcePath apunta a <área>/.quality-tools),
 * y solo como último recurso el default del área de trabajo. */
function raizDelArea(proyecto) {
  const porEntorno = (process.env.WS_AREA_ROOT ?? '').trim();
  if (porEntorno) return path.resolve(porEntorno);
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(proyecto, 'quality-tools.json'), 'utf8'));
    for (const tool of Object.values(manifest?.tools ?? {})) {
      if (typeof tool?.sourcePath !== 'string') continue;
      const absoluta = path.resolve(proyecto, tool.sourcePath);
      const corte = absoluta.toLowerCase().lastIndexOf(path.sep + '.quality-tools');
      if (corte > 0) return absoluta.slice(0, corte);
    }
  } catch { /* sin manifiesto legible: se usa el default del área */ }
  return AREA_POR_DEFECTO;
}

const proyecto = process.cwd();
const adapter = path.join(raizDelArea(proyecto), RELATIVO);
if (!fs.existsSync(adapter)) {
  process.stderr.write('[${prefijo}] router: falta el adapter único del área en ' + adapter + '\\n');
  process.stderr.write('[${prefijo}] router: define WS_AREA_ROOT o provisiona el área; no se simula evidencia\\n');
  process.exit(2);
}
/* Guard anti-recursión: si el destino resuelve al propio router, delegar sería
 * llamarse a sí mismo en bucle. [por que] Pasó cuando el adapter canónico fue
 * sobrescrito por un router; el fallo se veía como error de job object, no como
 * recursión, y costó diagnosticarlo. Mejor un error explícito. */
if (path.resolve(adapter) === path.resolve(process.argv[1] ?? '')) {
  process.stderr.write('[${prefijo}] router: el adapter resuelve al propio router (' + adapter + ')\\n');
  process.stderr.write('[${prefijo}] router: restaura el adapter canónico; no se delega en sí mismo\\n');
  process.exit(2);
}
const resultado = spawnSync(process.execPath, [adapter, ...process.argv.slice(2)], {
  cwd: proyecto,
  stdio: 'inherit',
  windowsHide: true,
});
if (resultado.error) {
  process.stderr.write('[${prefijo}] router: no se pudo ejecutar el adapter: ' + resultado.error.message + '\\n');
  process.exit(2);
}
process.exit(resultado.status ?? 2);
`;
}

/* ------------------------------------------------- manifiesto: pin sin reserializar */

/* Recorre una cadena JSON saltando escapes (para no confundir una llave dentro
 * de un string con estructura). */
function finDeCadena(texto, comilla) {
  for (let i = comilla + 1; i < texto.length; i += 1) {
    if (texto[i] === '\\') {
      i += 1;
      continue;
    }
    if (texto[i] === '"') return i;
  }
  return texto.length - 1;
}

/* Localiza el objeto \`tools.<tool>\` por emparejamiento de llaves. */
function spanHerramienta(texto, tool) {
  const declaracion = new RegExp(`"${tool}"\\s*:`, 'u').exec(texto);
  if (!declaracion) return null;
  const inicio = texto.indexOf('{', declaracion.index + declaracion[0].length);
  if (inicio < 0) return null;
  let nivel = 0;
  for (let i = inicio; i < texto.length; i += 1) {
    const caracter = texto[i];
    if (caracter === '"') {
      i = finDeCadena(texto, i);
      continue;
    }
    if (caracter === '{') nivel += 1;
    else if (caracter === '}') {
      nivel -= 1;
      if (nivel === 0) return { inicio, fin: i + 1 };
    }
  }
  return null;
}

function cambiarCampo(fragmento, campo, valor) {
  const patron = new RegExp(`("${campo}"\\s*:\\s*)"[^"]*"`, 'u');
  if (!patron.test(fragmento)) return null;
  return fragmento.replace(patron, (_, prefijo) => `${prefijo}"${valor}"`);
}

/* Reescribe SOLO commit y versión de la herramienta: reserializar el manifiesto
 * reformatearía el archivo entero y ensuciaría el diff de algo que otras
 * herramientas leen. Devuelve null si el manifiesto no tiene la forma esperada. */
function reescribirPin(texto, tool, { commit, version }) {
  const span = spanHerramienta(texto, tool);
  if (!span) return null;
  const original = texto.slice(span.inicio, span.fin);
  let fragmento = original;
  for (const [campo, valor] of [['commit', commit], ['version', version]]) {
    if (!valor) continue;
    const siguiente = cambiarCampo(fragmento, campo, valor);
    if (siguiente === null) return null;
    fragmento = siguiente;
  }
  if (fragmento === original) return { texto, cambio: false };
  return { texto: texto.slice(0, span.inicio) + fragmento + texto.slice(span.fin), cambio: true };
}

/* Red de seguridad: el texto tocado debe seguir siendo JSON válido, con el pin
 * aplicado y sin ningún otro cambio. Un escritor que no cumple esto no escribe. */
function validarReescritura(antes, despues, tool, esperado) {
  let a;
  let b;
  try {
    a = JSON.parse(antes);
    b = JSON.parse(despues);
  } catch {
    return 'el resultado no es JSON válido';
  }
  const quitar = valor => {
    const copia = { ...(valor ?? {}) };
    delete copia.commit;
    delete copia.version;
    return copia;
  };
  if (JSON.stringify(quitar(a.tools?.[tool])) !== JSON.stringify(quitar(b.tools?.[tool]))) {
    return 'cambió algo más que commit/version de la herramienta';
  }
  if (esperado.commit && b.tools?.[tool]?.commit !== esperado.commit) return 'el commit no quedó aplicado';
  if (esperado.version && b.tools?.[tool]?.version !== esperado.version) return 'la versión no quedó aplicada';
  const resto = manifiesto => {
    const { tools = {}, ...demas } = manifiesto;
    const { [tool]: descartada, ...otras } = tools;
    return JSON.stringify({ ...demas, tools: otras });
  };
  if (resto(a) !== resto(b)) return 'cambió contenido ajeno a esa herramienta';
  return null;
}

/* ------------------------------------------------------------ consumidores */

/* Lista de consumidores tomada del guard: una sola fuente de verdad con
 * `sync:quality`, así no puede haber consumidores que se propaguen y no se
 * verifiquen (o al revés). */
function consumidoresDeclarados() {
  const guard = path.join(MANAGER, 'scripts', 'quality-sync.mjs');
  const resultado = ejecutar(comando(process.execPath, [guard, '--json']), MANAGER);
  const reporte = leerJsonDeTexto(resultado.salida);
  if (!reporte?.consumidores) {
    throw new Error(`no se pudo leer la lista de consumidores de ${guard}: ${resultado.salida.slice(0, 300)}`);
  }
  return reporte.consumidores
    .filter(consumidor => !EXCLUIDOS_POR_ALCANCE.includes(consumidor.nombre))
    .filter(consumidor => !solo.length || solo.includes(consumidor.nombre))
    .filter(consumidor => !salta.includes(consumidor.nombre))
    .map(consumidor => ({ ...consumidor, dir: path.join(RAIZ_AREA, consumidor.ruta) }))
    .filter(consumidor => fs.existsSync(path.join(consumidor.dir, 'quality-tools.json')));
}

/* Familia del consumidor: A comparte el checkout del área, B usa un submódulo
 * propio, externo es cualquier otra cosa (no se le propaga el router). */
function familiaDe(consumidor, config) {
  if (typeof config?.sourcePath !== 'string') return 'externo';
  const absoluta = path.resolve(consumidor.dir, config.sourcePath);
  const relativoCompartido = path.relative(path.join(RAIZ_AREA, '.quality-tools'), absoluta);
  if (relativoCompartido && !relativoCompartido.startsWith('..') && !path.isAbsolute(relativoCompartido)) return 'A';
  const relativoPropio = path.relative(consumidor.dir, absoluta);
  if (relativoPropio && !relativoPropio.startsWith('..') && !path.isAbsolute(relativoPropio)) return 'B';
  return 'externo';
}

/* ---------------------------------------------------- objetivo del release */

function objetivoDelRelease(tool, { commit, version, source }) {
  const fuente = path.resolve(source ?? path.join(RAIZ_AREA, '.quality-tools', tool));
  if (!fs.existsSync(fuente)) {
    throw new Error(`no existe el checkout de referencia ${fuente}; pasa --source o provisiona el área`);
  }
  const head = ejecutar(comando('git', ['rev-parse', 'HEAD']), fuente);
  const headReal = head.status === 0 ? head.salida.trim() : null;
  const pkg = leerJson(path.join(fuente, 'package.json'));
  const commitFinal = commit ?? headReal;
  const versionFinal = version ?? pkg?.version ?? null;
  if (!commitFinal) throw new Error(`no se pudo determinar el commit de ${tool}; pasa --commit`);
  if (headReal && commitFinal !== headReal) {
    throw new Error(
      `el checkout de referencia está en ${headReal.slice(0, 12)} pero el destino es ${commitFinal.slice(0, 12)}; ` +
        'mueve el checkout o pasa --source (un pin que el checkout no tiene dejaría la evidencia sin poder generarse)',
    );
  }
  return { fuente, commit: commitFinal, version: versionFinal, head: headReal };
}

/* ------------------------------------------------------------- pasos por consumidor */

function pasosDe(consumidor, config, configSentinel) {
  const propios = archivo => path.join(consumidor.dir, 'scripts', 'quality', archivo);
  const lock = fs.existsSync(propios('lock-generator.mjs')) ? propios('lock-generator.mjs') : path.join(AQUI, 'lock-generator.mjs');
  const setupPropio = [propios('quality-setup.mjs'), propios('setup.mjs')].find(archivo => fs.existsSync(archivo));
  const setup = setupPropio ?? path.join(AQUI, 'quality-setup.mjs');
  const pkg = leerJson(path.join(consumidor.dir, 'package.json'));
  let doctor;
  if (pkg?.scripts?.['quality:doctor']) {
    doctor = 'npm run quality:doctor --silent';
  } else {
    /* [219A-2] El doctor siempre es `sentinel doctor`, aunque se este
     * propagando otra tool: el CLI de varsense no tiene subcomando doctor
     * y el fallback imprimia "Uso:" (fallo falso en GLORYINSPECTOR/PORT). */
    const cfgDoctor = configSentinel ?? config;
    const provision = path.resolve(consumidor.dir, cfgDoctor?.provisionPath ?? '.quality-tools');
    const cli = typeof cfgDoctor?.cli === 'string' && cfgDoctor.cli ? path.join(provision, cfgDoctor.cli) : null;
    doctor = cli && fs.existsSync(cli) ? comando(process.execPath, [cli, 'doctor', '--json']) : null;
  }
  return {
    lock: comando(process.execPath, [lock, '--write']),
    setup: comando(process.execPath, [setup]),
    doctor,
  };
}

function revisarRouters(consumidor, escribirAhora) {
  return ROUTERS.map(router => {
    const destino = path.join(consumidor.dir, 'scripts', 'quality', router.archivo);
    /* Invariante del host: el adapter canónico vive en `workspace-manager`, que
     * también es consumidor, así que su ruta de router coincide con el adapter.
     * Nunca se escribe un router encima del adapter. [por que] Un bump de pin lo
     * borró el 2026-09-10 y dejó 9 proyectos con un router que se llamaba a sí
     * mismo; el host se recuperó desde el historial local. */
    if (path.resolve(destino) === path.resolve(AQUI, router.archivo)) {
      return { router: router.archivo, estado: 'host' };
    }
    const esperado = textoRouter(router);
    if (!fs.existsSync(destino)) {
      if (!escribirAhora) return { router: router.archivo, estado: 'ausente' };
      fs.mkdirSync(path.dirname(destino), { recursive: true });
      fs.writeFileSync(destino, esperado);
      return { router: router.archivo, estado: 'creado' };
    }
    if (fs.readFileSync(destino, 'utf8') === esperado) return { router: router.archivo, estado: 'ok' };
    if (escribirAhora) {
      fs.writeFileSync(destino, esperado);
      return { router: router.archivo, estado: 'actualizado' };
    }
    return { router: router.archivo, estado: 'drift' };
  });
}

function propagarConsumidor(consumidor, tool, destino) {
  const dirManifiesto = path.join(consumidor.dir, 'quality-tools.json');
  const bruto = fs.readFileSync(dirManifiesto, 'utf8');
  const manifiesto = JSON.parse(bruto);
  const config = manifiesto.tools?.[tool];
  const fila = {
    proyecto: consumidor.nombre,
    familia: familiaDe(consumidor, config),
    routers: [],
    pin: 'ausente',
    lock: '—',
    setup: '—',
    doctor: '—',
    issues: null,
    estado: 'ok',
    nota: null,
  };
  if (!config) {
    fila.nota = `${tool} no declarada en el manifiesto`;
    return fila;
  }

  if (fila.familia === 'A') fila.routers = revisarRouters(consumidor, escribirRouters);

  const commitActual = config.commit ?? null;
  const versionActual = config.version ?? null;
  const yaAlineado = commitActual === destino.commit && (!destino.version || versionActual === destino.version);
  if (yaAlineado) {
    fila.pin = 'sin-cambios';
  } else if (!escribir) {
    fila.pin = 'cambiaría';
  } else {
    const resultado = reescribirPin(bruto, tool, destino);
    if (!resultado) {
      fila.pin = 'error';
      fila.estado = 'error';
      fila.nota = 'el manifiesto no tiene la forma esperada (¿tools.<tool> con commit/version?)';
      return fila;
    }
    const problema = validarReescritura(bruto, resultado.texto, tool, destino);
    if (problema) {
      fila.pin = 'error';
      fila.estado = 'error';
      fila.nota = `reescritura rechazada: ${problema}`;
      return fila;
    }
    if (resultado.cambio) {
      fs.writeFileSync(dirManifiesto, resultado.texto);
      fila.pin = 'cambiado';
    } else {
      fila.pin = 'sin-cambios';
    }
  }

  if (!conPasos || !escribir) return fila;

  const pasos = pasosDe(consumidor, config, manifiesto.tools?.sentinel);
  const lock = ejecutar(pasos.lock, consumidor.dir, 300_000);
  fila.lock = lock.status === 0 ? 'ok' : 'fallo';
  if (lock.status !== 0) {
    fila.estado = 'bloqueado';
    fila.nota = primeraLineaUtil(lock.salida) ?? 'lock falló';
    return fila;
  }

  const setup = ejecutar(pasos.setup, consumidor.dir, 3_600_000);
  fila.setup = setup.status === 0 ? 'ok' : 'fallo';
  if (setup.status !== 0) {
    fila.estado = 'error';
    fila.nota = primeraLineaUtil(setup.salida) ?? 'setup falló';
    return fila;
  }

  const evidencia = leerJson(path.join(consumidor.dir, '.sentinel', 'release-evidence', `${tool}.json`));
  fila.origen = evidencia?.origen ?? null;

  if (!pasos.doctor) {
    fila.doctor = 'n/d';
    return fila;
  }
  const doctor = ejecutar(pasos.doctor, consumidor.dir, 300_000);
  const informe = leerJsonDeTexto(doctor.salida);
  fila.doctor = doctor.status === 0 ? 'ok' : 'fallo';
  fila.issues = Array.isArray(informe?.issues) ? informe.issues.length : null;
  if (informe && informe.readyForGate === false) fila.doctor = 'no-listo';
  const doctorRoto = doctor.status !== 0 || fila.doctor !== 'ok';
  if (doctorRoto) {
    fila.estado = 'error';
    fila.nota = primeraLineaUtil(doctor.salida) ?? 'doctor no listo';
  }
  return fila;
}

/* Mensaje de error útil: la primera línea con contenido y sin ruido de npm. */
function primeraLineaUtil(salida) {
  const linea = String(salida ?? '')
    .split(/\r?\n/u)
    .map(texto => texto.trim())
    .find(texto => texto.length > 0 && !/^>|^npm (error )?code|^npm ERR! *$/u.test(texto));
  return linea ? linea.slice(0, 200) : null;
}

/* ------------------------------------------------------------------- informe */

function imprimirTabla(filas) {
  const cabecera = ['Proyecto', 'Fam', 'Pin', 'Routers', 'Evid', 'Lock', 'Setup', 'Doctor', 'Iss'];
  const filasTexto = filas.map(fila => [
    fila.proyecto,
    fila.familia,
    fila.pin,
    fila.routers.length
      ? fila.routers.map(router => `${router.estado.slice(0, 4)}`).join('/')
      : '—',
    fila.origen ? fila.origen.slice(0, 4) : '—',
    fila.lock,
    fila.setup,
    fila.doctor,
    fila.issues === null ? '—' : String(fila.issues),
  ]);
  const anchos = cabecera.map((titulo, columna) =>
    Math.max(titulo.length, ...filasTexto.map(fila => fila[columna]?.length ?? 0)),
  );
  const linea = valores => valores.map((valor, columna) => String(valor).padEnd(anchos[columna])).join('  ');
  process.stdout.write(`${linea(cabecera)}\n${linea(anchos.map(ancho => '-'.repeat(ancho)))}\n`);
  for (const fila of filasTexto) process.stdout.write(`${linea(fila)}\n`);
}

function main() {
  if (soloShims) {
    const filas = [];
    for (const consumidor of consumidoresDeclarados()) {
      const config = leerJson(path.join(consumidor.dir, 'quality-tools.json'))?.tools?.[herramienta ?? 'sentinel'];
      if (familiaDe(consumidor, config) !== 'A') continue;
      filas.push({ proyecto: consumidor.nombre, routers: revisarRouters(consumidor, escribir) });
    }
    const conDrift = filas.filter(fila => fila.routers.some(router => !['ok', 'host'].includes(router.estado)));
    if (salidaJson) {
      process.stdout.write(`${JSON.stringify({ modo: 'shims', escribir, filas }, null, 2)}\n`);
    } else {
      for (const fila of filas) {
        process.stdout.write(`${fila.proyecto.padEnd(28)} ${fila.routers.map(r => `${r.router}=${r.estado}`).join('  ')}\n`);
      }
      process.stdout.write(
        `\n[quality:bump] routers: ${filas.length} consumidor(es) familia A revisado(s), ${conDrift.length} con drift${escribir ? ' (corregido)' : ' (usa --write)'}\n`,
      );
    }
    process.exitCode = escribir || conDrift.length === 0 ? 0 : 1;
    return;
  }

  if (!herramienta) {
    process.stderr.write('[quality:bump] falta --tool (o usa --shims)\n');
    process.exitCode = 2;
    return;
  }

  let consumidores;
  let destino;
  try {
    consumidores = consumidoresDeclarados();
    destino = objetivoDelRelease(herramienta, {
      commit: valorDe('--commit'),
      version: valorDe('--version'),
      source: valorDe('--source'),
    });
  } catch (error) {
    process.stderr.write(`[quality:bump] ${error.message}\n`);
    process.exitCode = 2;
    return;
  }

  if (!salidaJson) {
    process.stdout.write(
      `[quality:bump] ${herramienta} → ${destino.commit.slice(0, 12)}${destino.version ? ` (${destino.version})` : ''}` +
        ` · fuente ${destino.fuente} · ${escribir ? 'ESCRITURA' : 'dry-run'}\n`,
    );
  }

  const filas = consumidores.map(consumidor => propagarConsumidor(consumidor, herramienta, destino));
  const problemas = filas.filter(fila => fila.estado !== 'ok');

  if (salidaJson) {
    process.stdout.write(
      `${JSON.stringify({ herramienta, destino, escribiendo: escribir, filas, problemas: problemas.length }, null, 2)}\n`,
    );
  } else {
    imprimirTabla(filas);
    const cambios = filas.filter(fila => fila.pin === 'cambiado').length;
    process.stdout.write(
      `\n[quality:bump] ${filas.length} consumidor(es) · ${cambios} manifiesto(s) ${escribir ? 'reescrito(s)' : 'por reescribir'}` +
        ` · ${problemas.length} con problema\n`,
    );
    for (const fila of problemas) process.stdout.write(`  - ${fila.proyecto} [${fila.estado}]: ${fila.nota ?? 'sin detalle'}\n`);
    if (problemas.some(fila => fila.estado === 'bloqueado')) {
      process.stdout.write(
        '  [nota] un consumidor de familia B queda bloqueado hasta commitear el gitlink del submódulo en el padre (requiere autorización).\n',
      );
    }
    if (!escribir) process.stdout.write('[quality:bump] dry-run: nada modificado (añade --write para aplicar)\n');
  }

  process.exitCode = problemas.length === 0 ? 0 : 1;
}

main();
