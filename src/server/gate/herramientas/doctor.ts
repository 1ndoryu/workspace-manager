/* `sentinel doctor` bajo demanda, en la máquina que corresponda. [por que] El doctor
 * resuelve el runtime del proyecto y mira su evidencia de release: para un proyecto del
 * taller eso es trabajo de la 89, igual que el análisis. Antes corría siempre en el
 * portátil con `execFileSync`, ignorando la decisión de modo, y encima bloqueaba el
 * event loop; y como devolvía `null` tanto si fallaba como si no había runtime, el
 * panel no podía distinguir «no se pudo» de «no se pidió». Aquí vive la decisión, y el
 * portátil sigue siendo la red: si la 89 no responde, se hace en local y se dice. */
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

/* Corre el doctor donde el modo diga, con el portátil como red. [por que] La VPS del
 * taller no es un requisito duro: si el proyecto está dado de alta allí pero el doctor
 * remoto no arranca (sin taller.json, sin sesión Mutagen, sin red, sin runtime), se hace
 * en local y lo dice en `aviso`. Mismo patrón que `analizarConModo`. El punto de
 * inyección existe para poder probar las dos ramas sin una VPS delante. */
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
  } catch {
    /* Sin registro no hay proyecto que consultar: local y sin ruido. */
    return local(ruta);
  }
  if (modo !== 'taller') return local(ruta);

  /* Sin taller.json no hay VPS: es una configuración válida (un clon recién hecho no
   * lo trae), no un fallo. Se dice —el proyecto pidió el taller y no lo hay— pero sin
   * soltar la ruta de un fichero que falta, que se lee como avería. */
  if (leerTallerSiExiste() === null) {
    return local(ruta, 'hecho en local, no hay taller configurado');
  }

  let cfg: ConfigRemota;
  try {
    cfg = leerConfigRemota();
  } catch (err) {
    return local(ruta, `hecho en local, el taller está mal configurado (${mensaje(err)})`);
  }

  try {
    const salida = await (inyectado.remoto ?? correrDoctorRemoto)(clave, cfg, ruta);
    return { salida, modo: 'taller' };
  } catch (err) {
    return local(ruta, `hecho en local, el taller no respondió (${mensaje(err)})`);
  }
}

async function local(ruta: string, aviso?: string): Promise<DoctorSentinel> {
  const salida = await correrDoctorLocal(ruta);
  return { salida, modo: 'local', ...(aviso ? { aviso } : {}) };
}
