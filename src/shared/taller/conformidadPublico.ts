/* Reglas públicas del taller (P0–P2): qué hostnames hay que comprobar ahora y si el conector
 * de Cloudflare vive. [por que] Va aparte de conformidad.ts para que cada módulo quede bajo el
 * límite de líneas. Igual que él: funciones puras, sin E/S, importables desde cliente y servidor. */
import type { EntradaConformidad, EstadoPublico, EstadoTaller89, Hallazgo, RegistroConformidad } from './conformidad-tipos.js';

/* Hostnames públicos que hay que comprobar ahora. [por que] Un dev parado no tiene conector
 * de Cloudflare (el conector arranca con el dev) y no debe sondearse: exigirlo daba un
 * falso positivo con el taller en su estado correcto. Sin sesiones conocidas para un host se
 * mantiene la exigencia. Sin lectura de la 89 no se sabe qué está parado: se comprueban todos. */
export function hostsActivos(registro: RegistroConformidad, t89: EstadoTaller89 | null): string[] {
  if (!t89) return [...registro.hostsPublicos];
  const vivas = new Set(t89.tmux);
  return registro.hostsPublicos.filter((h) => {
    const sesiones = registro.sesionesDevPorHost[h] ?? [];
    return sesiones.length === 0 || sesiones.some((s) => vivas.has(s));
  });
}

/* Motivo por el que un hostname público no pasa, o null si pasa. [por que] Lo usan la regla P1 y
 * el panel del taller: una sola definición de «este host está bien», sin copias que se separen.
 * Nunca devuelve la URL de Access: nombra el hostname y el estado. */
export function fallaHostPublico(
  host: string,
  r: EstadoPublico['hosts'][number] | undefined,
): string | null {
  if (!r) return `${host} no comprobado`;
  if (r.status === 200) return `${host} sirve la app sin Access (200)`;
  if (!r.location || !/cloudflareaccess\.com/.test(r.location)) {
    return `${host} no redirige a Access (status ${r.status ?? 'sin respuesta'}${r.error ? `, ${r.error}` : ''})`;
  }
  return null;
}

/* Reglas públicas que dependen de la sonda P1 (HTTP sin credenciales). */
export function fallaPublico(e: EntradaConformidad): Hallazgo[] {
  const out: Hallazgo[] = [];
  const activos = hostsActivos(e.registro, e.t89);
  if (activos.length === 0) return out;
  if (!e.publico) {
    out.push({ id: 'P0', ambito: 'publico', severidad: 'advertencia', detalle: 'hostnames públicos no comprobados', remedio: 'Reintentar la comprobación (forzar).' });
    return out;
  }
  const malos: string[] = [];
  for (const host of activos) {
    const motivo = fallaHostPublico(host, e.publico.hosts.find((h) => h.host === host));
    if (motivo) malos.push(motivo);
  }
  if (malos.length) out.push({
    id: 'P1', ambito: 'publico', severidad: 'error', detalle: malos.join('; '),
    remedio: 'Crear la app de Access para el hostname antes de publicarlo (plan sucesor S6.1); no hay servicio sin Access.',
  });
  return out;
}

/* P2: el conector de Cloudflare vive en la 89 y su token va con modo 0600. Solo se exige
 * si hay hostnames públicos con dev levantado; sin ellos no hay túnel que vigilar.
 * [por que] 20AA-21: `tokenModo: null` no significa «no hay fichero» —la sonda también lo
 * publica null cuando no recibe la ruta por entorno—, así que el detalle no lo afirma. */
export function fallaConector(e: EntradaConformidad, t: EstadoTaller89): Hallazgo | null {
  if (hostsActivos(e.registro, t).length === 0) return null;
  const av: string[] = [];
  if (!t.cloudflared.viva) av.push('cloudflared no está vivo');
  if (t.cloudflared.tokenModo === null) av.push('modo del token del túnel sin leer');
  else if (t.cloudflared.tokenModo !== '600') av.push(`token con modo ${t.cloudflared.tokenModo}`);
  if (!av.length) return null;
  return {
    id: 'P2', ambito: 'publico', severidad: 'error', detalle: av.join('; '),
    remedio: 'Token de cloudflared en ~/.config/cloudflared/*.env con modo 0600, declarado en taller.json (`devPublico.envToken`) para que la sonda lo lea; conector vivo con Arranque up.',
  };
}
