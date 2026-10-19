/* La forma del taller y DÓNDE corre cada cosa: se lee taller.json, se decide el modo
 * de análisis de un proyecto y se construyen las rutas remotas. [por que] Nada de esto
 * habla con la VPS: son datos y una decisión. Estaba dentro de remoto.ts, que además
 * transportaba y ejecutaba, y ahí la decisión de modo quedaba enterrada entre comandos.
 * Sin taller.json todo sigue funcionando en local: la ausencia del fichero es una
 * configuración válida (un clon recién hecho no lo trae), no un error. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { RAIZ_REPO } from '../../plataforma/rutas.js';

/* [por que] RAIZ_REPO y no `import.meta.dirname`: esa propiedad no existe en todos los Node
 * (el de la 89 por fnm en algunos entornos la deja indefinida) y tumbaba al importar. */
const RAIZ_WM = RAIZ_REPO;
const RUTA_TALLER = join(RAIZ_WM, 'config', 'taller.json');
const RUTA_REGISTRO = join(RAIZ_WM, 'config', 'registro.json');

/* Dónde corre el análisis. [por que] `taller` y no el alias de la máquina: el modo
 * describe el papel, no el nombre de un host concreto. */
export type ModoAnalisis = 'local' | 'taller';

/* ¿`analisisEn` del registro pide el taller? Vale el papel (`taller`) o el alias del
 * host que declara taller.json. [por qué] Antes el conjunto llevaba el alias de una
 * máquina concreta incrustado: en otro entorno ese alias no existe, y una
 * configuración ya escrita con él dejaba de entenderse. El papel siempre vale; el
 * alias, solo si es el del taller declarado. */
function pideTaller(valor: string, taller: TallerAnalisis | null): boolean {
  return valor === 'taller' || valor === hostTaller(taller);
}

export interface ConfigRemota {
  host: string;
  dirRemotoBase: string;
  nodeRemoto: string;
  mutagen: string;
}

const RUTA_ABSOLUTA_SEGURA = /^\/[A-Za-z0-9._/-]+$/;

/* Valida la parte de taller.json que usa el análisis. Las rutas remotas van a una
 * línea de comandos del shell de la 89: solo se admiten caracteres seguros. */
export function configRemotaDe(t: {
  host?: unknown;
  dirRemotoBase?: unknown;
  nodeRemoto?: unknown;
  sync?: { binario?: unknown };
}): ConfigRemota {
  const { host, dirRemotoBase, nodeRemoto } = t;
  const mutagen = t.sync?.binario;
  if (typeof host !== 'string' || typeof dirRemotoBase !== 'string' || typeof nodeRemoto !== 'string' || typeof mutagen !== 'string') {
    throw new Error('taller.json: faltan host, dirRemotoBase, nodeRemoto o sync.binario');
  }
  if (!RUTA_ABSOLUTA_SEGURA.test(dirRemotoBase)) throw new Error(`taller.json: dirRemotoBase '${dirRemotoBase}' debe ser una ruta absoluta simple`);
  if (!RUTA_ABSOLUTA_SEGURA.test(nodeRemoto)) throw new Error(`taller.json: nodeRemoto '${nodeRemoto}' debe ser una ruta absoluta simple`);
  return { host, dirRemotoBase, nodeRemoto, mutagen };
}

export function leerConfigRemota(): ConfigRemota {
  return configRemotaDe(JSON.parse(readFileSync(RUTA_TALLER, 'utf8')));
}

/* Parte de taller.json que decide DÓNDE se analiza: el host del taller y si es el modo
 * por defecto. Son dos fuentes distintas y no se mezclan: el registro dice de qué
 * proyecto se trata y en qué máquina corre, el taller si esa máquina se usa por defecto. */
export interface TallerAnalisis {
  host?: unknown;
  modoPorDefecto?: unknown;
}

/* Lee taller.json, o null si no existe o no es JSON. [por que] Sin taller el manager
 * tiene que seguir entero en local: la ausencia de este fichero es una configuración
 * válida (un clon recién hecho no lo trae), no un error. */
export function leerTallerSiExiste(): TallerAnalisis | null {
  try {
    return JSON.parse(readFileSync(RUTA_TALLER, 'utf8')) as TallerAnalisis;
  } catch {
    return null;
  }
}

/* Host SSH del taller, o null si no hay taller configurado. [por que] Antes era la
 * constante 'dev89' repartida por el código: el alias de la máquina de una persona
 * concreta. El nombre lo declara taller.json, que es privado y no se versiona. */
export function hostTaller(t: TallerAnalisis | null = leerTallerSiExiste()): string | null {
  const host = t?.host;
  return typeof host === 'string' && host.trim() ? host.trim() : null;
}

/* Modo de análisis de un proyecto. [por que] Antes solo miraba `analisisEn` del
 * registro, así que un proyecto del taller se analizaba en el portátil por omisión:
 * el análisis es trabajo pesado y el reparto del área lo manda a la 89. Ahora, si hay
 * taller y el proyecto corre en él, el análisis va a la 89. `analisisEn` del registro
 * sigue mandando en los dos sentidos (`"dev89"` y `"local"`), para poder forzar uno
 * concreto. Sin taller —o con el proyecto fuera de él— local: el manager funciona
 * igual sin VPS.
 * [por que `host` y no el bloque `proyectos` de taller.json] Ese bloque declara la BD
 * del taller, no el alta: un proyecto puede correr allí sin base de datos. RESTAURANTE
 * era justo eso — `host: "dev89"` en el registro y sin entrada en `proyectos`— y se
 * analizaba en el portátil. La señal de «vive en el taller» es la misma que usa la
 * conformidad (`leerRegistroConformidad`): el `host` del registro. */
export function modoAnalisisEn(
  registro: { proyectos?: Array<{ id?: unknown; analisisEn?: unknown; host?: unknown }> },
  clave: string,
  taller: TallerAnalisis | null = null,
): ModoAnalisis {
  const entrada = registro.proyectos?.find((x) => x.id === clave);
  if (entrada?.analisisEn === 'local') return 'local';
  if (typeof entrada?.analisisEn === 'string' && pideTaller(entrada.analisisEn, taller)) return 'taller';
  if (taller?.modoPorDefecto !== 'remoto') return 'local';
  return typeof entrada?.host === 'string' && entrada.host.trim() ? 'taller' : 'local';
}

export function modoAnalisis(clave: string): ModoAnalisis {
  return modoAnalisisEn(JSON.parse(readFileSync(RUTA_REGISTRO, 'utf8')), clave, leerTallerSiExiste());
}

/* Ruta remota del proyecto: <dirRemotoBase>/<clave>. La clave no puede traer barras ni
 * metacaracteres. [por que] Se admiten espacios (carpetas como «PROYECTO TASKS» existen
 * en la 89); las rutas van siempre entrecomilladas con `comillas` y el nombre de la
 * sesión Mutagen pasa por `slugSesion`, así que no hay riesgo de inyección. */
export function rutaRemota(cfg: ConfigRemota, clave: string): string {
  if (!/^[A-Za-z0-9._ -]+$/.test(clave) || /^\.+$/.test(clave)) throw new Error(`clave '${clave}' no válida para una ruta remota`);
  return `${cfg.dirRemotoBase.replace(/\/+$/, '')}/${clave}`;
}

/* Runtime de una herramienta para un proyecto, FUERA de su réplica:
 * <dirRemotoBase>/_quality-tools/<clave>/<tool>. [por que] Dentro de la réplica no
 * puede vivir: la sincronización es unidireccional y borra todo lo que no esté en el
 * portátil, así que el runtime copiado desaparecería en el siguiente flush. Y el
 * checkout compartido (`<area>/.quality-tools`) queda fuera de la raíz de cualquier
 * proyecto, así que ninguna sesión lo lleva. El prefijo `_` sigue la convención de
 * `_logs`/`_datos` para lo que no es réplica. */
export function rutaRuntimeRemota(cfg: ConfigRemota, clave: string, tool: string): string {
  rutaRemota(cfg, clave);
  return `${cfg.dirRemotoBase.replace(/\/+$/, '')}/_quality-tools/${clave}/${tool}`;
}
