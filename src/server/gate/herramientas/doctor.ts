/* `sentinel doctor` bajo demanda, en la máquina que corresponda. [por que] El doctor
 * resuelve el runtime del proyecto y mira su evidencia de release: para un proyecto del
 * taller eso es trabajo de la 89, igual que el análisis. Antes corría siempre en el
 * portátil con `execFileSync`, ignorando la decisión de modo, y encima bloqueaba el
 * event loop; y como devolvía `null` tanto si fallaba como si no había runtime, el
 * panel no podía distinguir «no se pudo» de «no se pidió». Aquí vive la decisión, y el
 * portátil no suple a la 89: si no responde, `salida` queda null y `aviso` lo dice. */
import { correrDoctorLocal } from './ejecucion.js';
import { correrDoctorRemoto } from './remoto.js';
import { leerConfigRemota, leerTallerSiExiste, modoAnalisis } from './config.js';
import { mensaje } from './ssh.js';
import type { ConfigRemota, ModoAnalisis } from './config.js';

export interface DoctorSentinel {
  /* Diagnóstico del doctor, o null si no se pudo obtener en ningún sitio. */
  salida: string | null;
  /* Dónde se ejecutó DE VERDAD (no dónde se pidió). */
  modo: ModoAnalisis;
  /* Por qué se cayó al portátil, o por qué no hay diagnóstico. Sin esto, `salida: null`
   * es indistinguible de «no se pidió». */
  aviso?: string;
}

/* Corre el doctor donde el modo diga. [por que] Un proyecto de taller no se diagnostica
 * en el portátil: si la 89 no responde, `salida` queda en null y `aviso` dice el motivo
 * (AGENTS §1: la laptop no ejecuta proyectos). Mismo criterio que `analizarConModo`. El
 * punto de inyección existe para poder probar las ramas sin una VPS delante. */
export async function doctorConModo(
  clave: string,
  ruta: string,
  inyectado: {
    modo?: ModoAnalisis;
    remoto?: (clave: string, cfg: ConfigRemota, rutaLocal: string) => Promise<string>;
  } = {},
): Promise<DoctorSentinel> {
  let modo: ModoAnalisis;
  try {
    modo = inyectado.modo ?? modoAnalisis(clave);
  } catch (err) {
    /* [por que] Antes caía a local en silencio. Sin registro legible no se sabe si el proyecto es
     * del taller, así que no se ejecuta aquí (AGENTS §1) y el motivo queda visible. */
    return { salida: null, modo: 'local', aviso: `no se pudo leer el registro (${mensaje(err)})` };
  }
  if (modo !== 'taller') return local(ruta);

  /* Sin taller.json no hay VPS: es una configuración válida (un clon recién hecho no
   * lo trae), no un fallo. Se dice sin soltar la ruta de un fichero que falta. El mismo
   * null cubre un JSON inválido, así que el mensaje lo nombra también. */
  if (leerTallerSiExiste() === null) {
    return sinDiagnostico('sin VPS configurada (o taller.json no es JSON válido)');
  }

  let cfg: ConfigRemota;
  try {
    cfg = leerConfigRemota();
  } catch (err) {
    return sinDiagnostico(`el taller está mal configurado (${mensaje(err)})`);
  }

  try {
    const salida = await (inyectado.remoto ?? correrDoctorRemoto)(clave, cfg, ruta);
    return { salida, modo: 'taller' };
  } catch (err) {
    return sinDiagnostico(`el taller no respondió (${mensaje(err)})`);
  }
}

/* Caché de respuesta por proyecto. [por que] Medido en la 89: cada handshake SSH cuesta
 * ~2,3 s (Windows OpenSSH no admite ControlMaster) y el doctor hace 2 o 3; el panel
 * pide el doctor cada vez que se abre un proyecto. Se guarda solo un diagnóstico con
 * salida, 60 s, y la respuesta dice cuántos ms tiene (`edadMs`) para no pasar por
 * fresca una cifra vieja. `fresco` la salta. Las promesas en vuelo también se comparten. */
const TTL_DOCTOR_MS = 60_000;
const cache = new Map<string, { hecho: number; promesa: Promise<DoctorSentinel> }>();

export type DoctorRespuesta = DoctorSentinel & { edadMs: number };

export async function doctorCacheado(
  clave: string,
  ruta: string,
  opciones: { fresco?: boolean; inyectado?: Parameters<typeof doctorConModo>[2] } = {},
): Promise<DoctorRespuesta> {
  const ahora = Date.now();
  const previa = cache.get(clave);
  if (!opciones.fresco && previa && ahora - previa.hecho < TTL_DOCTOR_MS) {
    return { ...(await previa.promesa), edadMs: ahora - previa.hecho };
  }
  const entrada = { hecho: ahora, promesa: doctorConModo(clave, ruta, opciones.inyectado) };
  cache.set(clave, entrada);
  const valor = await entrada.promesa;
  /* Sin salida no hay nada que reutilizar: se olvida para que la próxima pregunta reintente. */
  if (valor.salida === null && cache.get(clave) === entrada) cache.delete(clave);
  return { ...valor, edadMs: 0 };
}

/* Solo para pruebas: vacía la caché entre casos. */
export function vaciarCacheDoctor(): void {
  cache.clear();
}

/* El doctor de un proyecto de taller no tiene salida en el portátil: queda null con el motivo. */
function sinDiagnostico(aviso: string): DoctorSentinel {
  return { salida: null, modo: 'taller', aviso };
}

async function local(ruta: string): Promise<DoctorSentinel> {
  const salida = await correrDoctorLocal(ruta);
  return { salida, modo: 'local' };
}
