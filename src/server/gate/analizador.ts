/* Analizador real de sentinel por proyecto (plan analisis-sentinel-consola A0).
 * [por que] La consola debe reportar los hallazgos reales que `sentinel
 * analyze` detecta en cada repo SIN consumir recursos. Para eso este modulo:
 *  - corre `sentinel analyze --workspace <ruta> --format json` (una sola vez por
 *    cambio real), nunca dentro del escaneo raiz (que vive aparte y es asincrono);
 *  - cachea por frescura = branch + HEAD + version de sentinel: si el repo no
 *    cambio y sentinel no cambio, se sirve cacheado sin volver a spawn;
 *  - es elegibilidad por puerta ('sentinel'), salta carpetas/cargo;
 *  - es ejecucion ASINCRONA en cola serial: los spawns ceden el event loop
 *    para no congelar toda la API durante un analizar-todo (un barrido con
 *    execFileSync bloqueaba snapshot/config/doctor durante segundos);
 *  - ante fallo marca 'error' y NUNCA rompe el snapshot;
 *  - si el proyecto es del taller (registro.json + taller.json), el analisis corre
 *    en la VPS sobre su replica (remoto.ts, S3.7); si esa corrida no arranca, queda
 *    en 'error' con su motivo, sin reintento en el portatil (AGENTS §1). Lo demas no cambia.
 * El cliente es 'tonto': pide y muestra; este modulo es el dueno de la ejecucion.
 *
 * [por que esta partido] La auditoria SOLID (E3) vio dos oficios en un fichero:
 * guardar (que se cachea, cuando se poda, como se persiste) y traducir formato
 * (JSON de las herramientas -> AnalisisSentinel, fusion sentinel + varsense).
 * Los dos viven ahora en `analisis/`; aqui queda lanzar y decidir donde corre. */
import { join } from 'node:path';
import { huellaArbol, huellaSinCambios } from './arbol/huella.js';
import { compartirVuelo } from './vuelo.js';
import type { AnalisisSentinel, Proyecto } from '../../shared/types.js';
import {
  analisisFresco,
  esCacheable,
  guardarAnalisis,
  leerAnalisis,
  podarAnalisis,
} from './analisis/almacen.js';
import { separarVigencia } from './vigencia.js';
import { PUERTO_PROCESOS } from '../plataforma/sistema/procesos.js';
import type { PuertoProcesos } from '../plataforma/sistema/procesos.js';
import { datoError, montarAnalisis } from './analisis/reporte.js';
import {
  checkoutVarsense,
  cliRuntime,
  correrSentinel,
  correrVarsense,
  hashArtefacto,
  varsenseAplica,
  varsenseConfigHash,
  varsenseRuntime,
} from './herramientas/ejecucion.js';
import type { ResultadoSpawn } from './herramientas/ejecucion.js';
import { correrSentinelRemoto, correrVarsenseRemoto, prepararReplica } from './herramientas/remoto.js';
import { hostTaller, leerConfigRemota, modoAnalisis } from './herramientas/config.js';
import { mensaje } from './herramientas/ssh.js';
import type { ConfigRemota } from './herramientas/config.js';

/* La lectura de lo guardado se reexporta aqui a proposito: este fichero es la
 * puerta del analisis para las rutas, y quien pide resultados no deberia tener
 * que saber en que submodulo viven. */
export { esCacheable, leerAnalisis } from './analisis/almacen.js';

/* [por que] Lo guardado solo se sirve si su frescura es la actual (ver vigencia.ts). Lo que
 * ya no coincide no se muestra: el proyecto aparece sin analizar hasta el siguiente análisis. */
export function analisisVigentes(proyectos: Proyecto[]): AnalisisSentinel[] {
  return separarVigencia(proyectos.filter(esElegible), claveVigente, analisisFresco).vigentes;
}

/* Proyectos que la consola NO puede mirar en este barrido: los elegibles sin análisis vigente
 * (árbol sucio, HEAD nuevo o análisis que falló). [por que se exporta] El motor de avisos da por
 * resuelta una clave que deja de aparecer, y sin esto un cambio sin commitear en un proyecto se
 * leía como «sus cinco problemas se resolvieron»: la campana anunciaba resueltos y nuevos en
 * bucle con los mismos cinco (20AA-31). El criterio es el mismo que `analisisVigentes`; que esté
 * aquí y no en la fuente de avisos evita que las dos copias se separen. */
export function proyectosSinAnalisisVigente(snapshot: { proyectos: Proyecto[] }): Proyecto[] {
  const vigentes = new Set(analisisVigentes(snapshot.proyectos).map((a) => a.clave));
  return snapshot.proyectos.filter((p) => esElegible(p) && !vigentes.has(p.clave));
}

export function analisisVigentePara(p: Proyecto): AnalisisSentinel | null {
  return analisisFresco(p.clave, claveVigente(p));
}

/* [por que] Las rutas síncronas no pueden leer el árbol (git es asíncrono), así que solo
 * sirven lo guardado de un proyecto limpio según el último escaneo: su huella es la de
 * un árbol sin cambios. Con cambios sin commitear devuelve un centinela que ninguna huella
 * guardada (sha1) puede igualar: el dato queda «sin analizar» en vez de servir un análisis
 * anterior a esos cambios. El gate y los análisis sí miden el árbol. */
const SIN_VIGENCIA = '?cambios-sin-commit';
function claveVigente(p: Proyecto): string {
  if (p.git?.dirty !== false || !p.git.ultimoCommit) return SIN_VIGENCIA;
  return huellaSinCambios(frescoDe(p), p.git.ultimoCommit.hash);
}

/* Solo los proyectos cuyo gate real es sentinel (carpetas/cargo no aplican). */
export function esElegible(p: Proyecto): boolean {
  return p.gate?.puerta === 'sentinel';
}

/* Clave de frescura: branch + HEAD + version de sentinel + hash del artefacto
 * del runtime + (si el proyecto declara varsense) version de varsense + hash
 * de su dist + hash de su config + modo de análisis. [por que] El analisis fusiona ambos
 * reportes (fase G): si varsense cambia de version, se reconstruye su dist, o su
 * `varsense.config.json` cambia, el resultado deja de ser fresco aunque el repo y sentinel
 * no cambien. El modo también: un análisis hecho en el portátil no puede seguir sirviéndose
 * como si fuera de la 89 tras cambiar `analisisEn` (caché incoherente). */
function frescoDe(p: Proyecto): string {
  const rama = p.git?.rama ?? '?';
  const head = p.git?.ultimoCommit?.hash ?? '?sin-commits';
  const res = cliRuntime(p.ruta);
  const v = res?.version ?? '?';
  const vs = checkoutVarsense();
  const rSent = res ? hashArtefacto(res.cli) : '?sin-runtime';
  const rVs = vs ? hashArtefacto(join(vs, 'dist', 'cli', 'index.js')) : 'sin-varsense';
  const vr = varsenseRuntime();
  const cfg = varsenseConfigHash(p.ruta);
  return `${p.ruta}|${rama}|${head}|${v}|${rSent}|${vr?.version ?? 'sin-varsense'}|${rVs}|${cfg ?? 'sin-config'}|${modoAnalisis(p.clave)}`;
}

/* [por que] Ejecutar N repos en serie no satura CPU; el detalle esta en las
 * funciones de corrida que ceden el event loop (async) y en la cola serial. */

/* Ejecuta una corrida remota: un fallo se convierte en motivo, no en excepción. */
async function intentar(f: () => Promise<ResultadoSpawn | null>): Promise<[ResultadoSpawn | null, string | undefined]> {
  try {
    return [await f(), undefined];
  } catch (err) {
    return [null, mensaje(err)];
  }
}

/* Análisis local del proyecto: sentinel y varsense en paralelo. */
async function analizarEnLocal(p: Proyecto, puerto: PuertoProcesos): Promise<AnalisisSentinel> {
  const [res, resVs] = await Promise.all([correrSentinel(p.ruta, puerto), correrVarsense(p.ruta, puerto)]);
  return montarAnalisis(p, res, resVs);
}

const AVISO_EMERGENCIA =
  'EMERGENCIA --local: analizado en este equipo porque la VPS no estaba disponible; no se guarda en caché';

/* Aviso del modo local por ausencia de taller. [por que] Sin `config/taller.json` no hay dónde
 * más analizar: se analiza aquí y se dice, para que nadie lea «analizado» como «analizado en el
 * taller». No es la emergencia: este resultado sí es normal y sí se cachea. */
const AVISO_SIN_TALLER =
  'analizado en este equipo: no hay taller configurado (falta config/taller.json)';

/* [por que] `--local` es la emergencia de AGENTS §1 (VPS caída): analiza aquí y marca el dato
 * con su aviso. Quien lo llama no lo guarda ni lo reutiliza, así que un análisis de emergencia
 * nunca pasa por análisis normal. */
async function analizarEmergencia(p: Proyecto, puerto: PuertoProcesos): Promise<AnalisisSentinel> {
  try {
    return { ...(await analizarEnLocal(p, puerto)), aviso: AVISO_EMERGENCIA };
  } catch (err) {
    return { ...datoError(p.clave, mensaje(err)), aviso: AVISO_EMERGENCIA };
  }
}

/* Análisis del proyecto donde su modo diga. [por que] Un proyecto de taller se analiza
 * en la 89 y, si esta no responde, queda en 'error' con su motivo. No hay reintento en
 * el portátil: ese reintento era carga pesada en la laptop (AGENTS §1), y el fallo se ve
 * en el tablero en lugar de esconderse en un análisis local. */
async function analizarConModo(p: Proyecto, puerto: PuertoProcesos): Promise<AnalisisSentinel> {
  if (modoAnalisis(p.clave) === 'taller') return analizarEnTaller(p);
  const dato = await analizarEnLocal(p, puerto);
  /* [por que] Se analiza aquí porque no hay taller, no por elección del proyecto: el dato es
   * válido y se cachea, pero se dice de dónde sale. Con taller configurado y `analisisEn: local`
   * la marca es explícita y no hace falta el aviso. */
  return hostTaller() === null ? { ...dato, aviso: AVISO_SIN_TALLER } : dato;
}

/* [por que] S3.7: el taller analiza su réplica del proyecto. Antes se vacía la cola de
 * mutagen, así la réplica coincide con el árbol local. Un fallo remoto no lanza: queda
 * en 'error' con su motivo, y no se cachea (el siguiente análisis reintenta). */
async function analizarEnTaller(p: Proyecto): Promise<AnalisisSentinel> {
  const clave = p.clave;
  let cfg: ConfigRemota;
  try {
    cfg = leerConfigRemota();
  } catch (err) {
    return datoError(clave, `análisis en el taller no arrancó: ${mensaje(err)}`);
  }
  let raiz: string;
  try {
    raiz = await prepararReplica(clave, cfg);
  } catch (err) {
    return datoError(clave, `análisis en el taller (${cfg.host}) no arrancó: ${mensaje(err)}`);
  }
  const conVs = varsenseAplica(p.ruta);
  const [[res, errorRes], [resVs, errorVs]] = await Promise.all([
    intentar(() => correrSentinelRemoto(clave, cfg, p.ruta)),
    intentar(() => (conVs ? correrVarsenseRemoto(clave, cfg, p.ruta) : Promise.resolve(null))),
  ]);
  return montarAnalisis(p, res, resVs, raiz, { sentinel: errorRes, varsense: errorVs });
}

/* Analiza UN proyecto, con cache por frescura (sin spawn si esta fresco) y
 * single-flight por promesa compartida: si el mismo proyecto ya se esta
 * analizando, quien lo pide espera el MISMO vuelo (nunca dos spawns a la vez
 * del mismo repo). El check+set es atomico (sin await en el medio).
 * [por que] Desde la fase G el analisis fusiona sentinel + varsense: si el
 * proyecto declara varsense y el runtime esta provisionado, ambos corren en
 * paralelo y los reportes se unen (hallazgos tagueados por fuente). Si solo
 * varsense falla, sentinel sigue valiendo y el estado varsense queda en el
 * campo `varsense` (nunca rompe el analisis).
 * [por que] `puerto` es la costura para tests: solo afecta a la corrida local. La caché
 * y el vuelo compartido siguen por clave de proyecto, así que un puerto falso debe usar
 * `forzar` y una clave propia para no mezclarse con un análisis real. */
const enVuelo = new Map<string, Promise<AnalisisSentinel>>();
export async function analizarProyecto(
  p: Proyecto,
  forzar = false,
  emergencia = false,
  puerto: PuertoProcesos = PUERTO_PROCESOS,
): Promise<AnalisisSentinel> {
  if (emergencia) return analizarEmergencia(p, puerto);
  const clave = p.clave;
  /* [por que] La clave guardada incluye el árbol de trabajo (huellaArbol), no solo HEAD: un
   * cambio sin commitear invalida el análisis. Sin huella (git falla o demasiados cambios)
   * no se lee ni se guarda caché: se analiza siempre. */
  const huella = await huellaArbol(p.ruta, frescoDe(p));
  if (!forzar && huella !== null) {
    const guardado = analisisFresco(clave, huella);
    if (guardado) return guardado;
  }
  return compartirVuelo(enVuelo, clave, async (): Promise<AnalisisSentinel> => {
    /* [por que] Cualquier fallo del despacho queda en 'error' (nunca rompe el snapshot). */
    let dato: AnalisisSentinel;
    try {
      dato = await analizarConModo(p, puerto);
    } catch (err) {
      dato = datoError(clave, mensaje(err));
    }
    if (huella !== null) guardarAnalisis(clave, huella, dato);
    return dato;
  });
}

/* Análisis para el gate (`--inicio`, `--cierre`, `Arranque cierre`): cuenta el
 * árbol de trabajo, no solo HEAD, así que no puede servirse de la caché por
 * frescura. Se cachea aparte por huella del árbol (huella.ts): si nada cambió
 * desde el último análisis del gate se reutiliza (0 s en vez de ~60 s).
 * `forzar` salta la caché y re-analiza. [por que] La huella se calcula también
 * tras analizar y solo se guarda si coincide: si el árbol cambió durante el
 * análisis, el resultado no describe la huella de partida. */
const cacheGate = new Map<string, { huella: string; dato: AnalisisSentinel }>();
export async function analizarParaGate(p: Proyecto, forzar = false, emergencia = false): Promise<AnalisisSentinel> {
  if (emergencia) return analizarEmergencia(p, PUERTO_PROCESOS);
  const huella = await huellaArbol(p.ruta, frescoDe(p));
  const previo = cacheGate.get(p.clave);
  if (!forzar && huella !== null && previo?.huella === huella) return previo.dato;
  const dato = await analizarProyecto(p, true);
  if (huella !== null && esCacheable(dato) && (await huellaArbol(p.ruta, frescoDe(p))) === huella) {
    cacheGate.set(p.clave, { huella, dato });
  } else {
    cacheGate.delete(p.clave);
  }
  return dato;
}

/* Barrido serial del workspace: analiza solo los elegibles UNO POR UNO
 * (await), cediendo el event loop entre proyectos para no congelar la API
 * mientras corre. Rehusa lo fresco (cache) y los vuelos en curso. */
export async function analizarTodo(
  proyectos: Proyecto[],
  forzar = false,
  emergencia = false,
): Promise<AnalisisSentinel[]> {
  const detalles: AnalisisSentinel[] = [];
  for (const p of proyectos.filter(esElegible)) {
    detalles.push(await analizarProyecto(p, forzar, emergencia));
  }
  podarAnalisis(new Set(proyectos.map((p) => p.clave)));
  return detalles;
}
