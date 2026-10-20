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

export interface ConfigRemota {
  host: string;
  dirRemotoBase: string;
  nodeRemoto: string;
  mutagen: string;
  /* Carpeta temporal de la 89 donde la auditoría deja el árbol de cada gestor. */
  tmpAudit: string;
}

/* [por que] Una ruta del taller, no del código: se fija con WM_AUDIT_REMOTO y, si no
 * está, vale el /tmp de cualquier Linux. */
export const TMP_AUDIT_DEFECTO = '/tmp/wm-audit';

const RUTA_ABSOLUTA_SEGURA = /^\/[A-Za-z0-9._/-]+$/;

/* Valida la parte de taller.json que usa el análisis. Las rutas remotas van a una
 * línea de comandos del shell de la 89: solo se admiten caracteres seguros. */
export function configRemotaDe(t: {
  host?: unknown;
  dirRemotoBase?: unknown;
  nodeRemoto?: unknown;
  sync?: { binario?: unknown };
}, tmpAudit: string = TMP_AUDIT_DEFECTO): ConfigRemota {
  const { host, dirRemotoBase, nodeRemoto } = t;
  const mutagen = t.sync?.binario;
  if (typeof host !== 'string' || typeof dirRemotoBase !== 'string' || typeof nodeRemoto !== 'string' || typeof mutagen !== 'string') {
    throw new Error('taller.json: faltan host, dirRemotoBase, nodeRemoto o sync.binario');
  }
  if (!RUTA_ABSOLUTA_SEGURA.test(dirRemotoBase)) throw new Error(`taller.json: dirRemotoBase '${dirRemotoBase}' debe ser una ruta absoluta simple`);
  if (!RUTA_ABSOLUTA_SEGURA.test(nodeRemoto)) throw new Error(`taller.json: nodeRemoto '${nodeRemoto}' debe ser una ruta absoluta simple`);
  return { host, dirRemotoBase, nodeRemoto, mutagen, tmpAudit };
}

/* El entorno se lee aquí, al componer la configuración, no al cargar el módulo. */
export function leerConfigRemota(entorno: NodeJS.ProcessEnv = process.env): ConfigRemota {
  const tmpAudit = entorno.WM_AUDIT_REMOTO?.trim() || TMP_AUDIT_DEFECTO;
  /* [por que] Sin taller.json el error dice el motivo, no el ENOENT de la ruta: es el texto
   * que ven el análisis y la auditoría de un proyecto del taller. */
  const taller = leerTallerSiExiste();
  if (!taller) throw new Error('sin VPS configurada (falta config/taller.json o no es JSON válido)');
  return configRemotaDe(taller, tmpAudit);
}

/* Parte de taller.json que lee el manager: el alias del host del taller (dónde se
 * analiza) y los datos del dev público (dónde vive el token de su túnel). El registro
 * dice de qué proyecto se trata y en qué máquina corre. */
export interface TallerAnalisis {
  host?: unknown;
  proyectos?: unknown;
  devPublico?: unknown;
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
 * constante 'taller-ejemplo' repartida por el código: el alias de la máquina de una persona
 * concreta. El nombre lo declara taller.json, que es privado y no se versiona. */
export function hostTaller(t: TallerAnalisis | null = leerTallerSiExiste()): string | null {
  const host = t?.host;
  return typeof host === 'string' && host.trim() ? host.trim() : null;
}

/* BD de trabajo del taller: la `basedatos` del primer proyecto con `bdDesdeLocal` (copia
 * de trabajo, D-taller). [por que] Antes el nombre estaba escrito en la sonda de la 89; ahora
 * sale de la config privada. Solo se acepta un identificador simple: va a una consulta SQL. */
export function bdTrabajoDe(t: TallerAnalisis | null = leerTallerSiExiste()): string | null {
  const proyectos = t?.proyectos;
  if (!proyectos || typeof proyectos !== 'object') return null;
  for (const p of Object.values(proyectos as Record<string, { basedatos?: unknown; bdDesdeLocal?: unknown }>)) {
    const bd = p?.basedatos;
    if (p?.bdDesdeLocal !== undefined && typeof bd === 'string' && /^[A-Za-z0-9_]+$/.test(bd)) return bd;
  }
  return null;
}

/* Fichero de entorno del túnel de cloudflared del taller (`devPublico.envToken`). La ruta
 * la declara la config privada porque es de la máquina, no del código. [por que] 20AA-21: la
 * sonda de la 89 ya sabía leerlo por `WM_CLOUDFLARED_ENV`, pero el manager no se lo pasaba,
 * así que publicaba `tokenModo: null` siempre y la conformidad marcaba «sin fichero de token»
 * aunque el fichero existiera con modo 600. Ruta absoluta: la sonda hace `stat` sin expandir
 * la virgulilla. Solo se acepta si es una ruta absoluta: va a la línea de comandos de un `ssh`. */
export function cloudflaredEnvDe(t: TallerAnalisis | null = leerTallerSiExiste()): string | null {
  const d = t?.devPublico as { envToken?: unknown } | undefined;
  const ruta = d?.envToken;
  return typeof ruta === 'string' && ruta.startsWith('/') && !ruta.includes('\n') ? ruta : null;
}

/* Modo de análisis de un proyecto: la 89 ('taller') salvo que el registro diga `analisisEn: "local"`.
 * [por que] El análisis es trabajo pesado y AGENTS §1 lo manda a la 89. Antes, un proyecto sin
 * marca caía en el portátil y cada análisis nuevo cargaba la laptop. Ahora la única vía al portátil
 * es esa marca explícita en el registro. Sin VPS no baja: el análisis queda en error con su motivo
 * («sin VPS configurada») y el tablero lo muestra. */
export function modoAnalisisEn(
  registro: { proyectos?: Array<{ id?: unknown; analisisEn?: unknown }> },
  clave: string,
): ModoAnalisis {
  const entrada = registro.proyectos?.find((x) => x.id === clave);
  return entrada?.analisisEn === 'local' ? 'local' : 'taller';
}

export function modoAnalisis(clave: string): ModoAnalisis {
  return modoAnalisisEn(JSON.parse(readFileSync(RUTA_REGISTRO, 'utf8')), clave);
}

/* Ruta remota del proyecto: <dirRemotoBase>/<clave>. La clave no puede traer barras ni
 * metacaracteres. [por que] Se admiten espacios (hay carpetas con espacios en el nombre)
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
