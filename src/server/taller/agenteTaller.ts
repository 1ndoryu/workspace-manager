/* Cliente del pulse del taller (20AA-16): la misma glory-pulse de la tab vps, pero la de la VPS 89
 * en modo `procesos` (sin Docker), donde un «contenedor» es un proyecto del taller.
 * [por que] Es una instancia aparte y no una reconfiguración de la de vps: en producción el tablero
 * habla a la vez con el pulse de la 66 (`PULSE_URL`) y con el de la 89 por el túnel local, y son
 * tokens distintos. La del snapshot se crea con `crearAgente` (misma caché, mismo breaker); las
 * piezas van a demanda y sin breaker, porque las pide un clic y no un sondeo.
 * El token no sale de este módulo: jamás se registra ni se devuelve. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { VpsAgenteRespuesta } from '../../shared/types.js';
import { RAIZ_AREA } from '../plataforma/rutas.js';
import { leerRegistroOpcional } from '../registro.js';
import { crearAgente } from '../vps/agente.js';

/* Timeout de la pieza: pulse lee `/proc` en cada petición (barato), pero el host puede estar
 * cargado compilando; el frente aborta a los 25 s y aquí se corta antes para contestar código. */
const TIMEOUT_PIEZA_MS = 20_000;

export interface ConfigTaller {
  base: string;
  token: string;
}

/* Token del pulse del taller. [por que] No está en el entorno del portátil: vive en el `.env` del
 * proyecto que declara `tokenPulse` en su ficha (el mismo archivo que `envRemoto` copia a la 89, así
 * que el del taller y el de la 89 no pueden divergir), y solo se lee esa clave. Sin token, la ruta
 * responde `sin-configurar` y el panel lo dice, en vez de inventarse un estado. */
function leerTokenDelProyecto(): string {
  const registro = leerRegistroOpcional() as { proyectos?: { id?: unknown; tokenPulse?: unknown }[] };
  const ficha = (registro.proyectos ?? []).find(
    (p) => p?.tokenPulse === true && typeof p.id === 'string' && p.id !== '',
  );
  if (!ficha) return '';
  try {
    const texto = readFileSync(join(RAIZ_AREA, String(ficha.id), '.env'), 'utf8');
    const linea = /^\s*PULSE_TOKEN\s*=\s*(.+)$/m.exec(texto);
    return linea ? linea[1].trim().replace(/^["']|["']$/g, '') : '';
  } catch {
    /* Sin `.env` (o ilegible): sin token, y quien llama decide qué decir. */
    return '';
  }
}

/* Configuración efectiva. El entorno llega como parámetro para probar sin tocar variables reales.
 * El puerto local por defecto es el del túnel de glory-pulse (`Arranque up glory-pulse`). */
export function configTaller(entorno: NodeJS.ProcessEnv = process.env): ConfigTaller | null {
  const base = (entorno['PULSE_TALLER_URL'] ?? '').trim() || 'http://127.0.0.1:3000';
  const token =
    (entorno['PULSE_TALLER_TOKEN'] ?? '').trim() || leerTokenDelProyecto();
  if (token.length < 32) return null;
  return { base: base.replace(/\/+$/, ''), token };
}

/* Singleton perezoso (el null no se cachea: reintenta cuando el `.env` aparezca). */
let snap: ReturnType<typeof crearAgente> | null = null;

export function agenteTaller(entorno: NodeJS.ProcessEnv = process.env): {
  snapshot: () => Promise<VpsAgenteRespuesta>;
  pieza: (sitio: string, nombre: string, lineas: number) => Promise<unknown>;
} | null {
  const cfg = configTaller(entorno);
  if (!cfg) return null;
  /* Se copian los dos campos antes de `pieza`: TypeScript no conserva el estrechamiento de `cfg`
   * dentro de una función declarada (y `pieza` se llama más tarde). */
  const { base, token } = cfg;
  if (!snap) snap = crearAgente({ baseUrl: base, token });

  /* Una pieza bajo demanda: `GET /pieza` (solo existe en modo procesos). Devuelve el JSON crudo de
   * pulse o lanza con un código corto; el saneo de secretos es de quien responde. */
  async function pieza(sitio: string, nombre: string, lineas: number): Promise<unknown> {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_PIEZA_MS);
    try {
      const url = `${base}/pieza?sitio=${encodeURIComponent(sitio)}&nombre=${encodeURIComponent(nombre)}&lineas=${lineas}`;
      const res = await fetch(url, {
        headers: { authorization: `Bearer ${token}` },
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`pulse-http-${res.status}`);
      return (await res.json()) as unknown;
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') throw new Error('pulse-timeout');
      throw err;
    } finally {
      clearTimeout(t);
    }
  }

  return { snapshot: snap.snapshot, pieza };
}
