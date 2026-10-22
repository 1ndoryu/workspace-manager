/* Interruptor de la campana de avisos (20AA-32). [por que existe] La usuaria pidió poder apagarla
 * mientras no esté a punto: encendida cuesta una lectura de las fuentes cada 10 s con una pestaña
 * abierta, más una pasada por cada escaneo. Un ajuste en `config/area.json` (configuración de
 * nuestra área, no del producto) la apaga sin tocar código.
 *
 * [por que el defecto es ACTIVA] Un tablero sin campana no avisa de nada y no se nota que falta;
 * la usuaria tiene que enterarse de que existe. El apagado se declara a propósito:
 * `"notificaciones": false`. Cualquier otro valor se lee como activa, para que un JSON mal escrito
 * no apague en silencio.
 * [por que se lee al arrancar y no en cada pasada] El fichero es de ~1 KiB y se lee una vez: el
 * estado que ve el frente (`GET /api/notificaciones`) es el que el servidor está aplicando, sin
 * que un cambio a medias deje el interruptor y las pasadas desalineados. */
import { readFileSync } from 'node:fs';
import { rutaConfigPrivada } from '../plataforma/rutas.js';

export interface AjustesNotificaciones {
  /** false = campana apagada: sin pasadas, sin latido y sin análisis que la alimenten. */
  activa: boolean;
  /** Por qué está apagada, para la UI. `null` cuando está activa. */
  motivo: string | null;
}

/* Lee el interruptor de un objeto ya parseado. [por que inyectable] Se prueba sin disco. */
export function ajustesDe(valor: unknown): AjustesNotificaciones {
  if (valor === false) return { activa: false, motivo: 'desactivada en config/area.json' };
  return { activa: true, motivo: null };
}

/* El interruptor tal como está en el fichero. [por que nunca lanza] Un `area.json` ausente o roto
 * deja la campana activa, que es el defecto: un fallo de configuración no puede apagar avisos en
 * silencio. */
export function campanaActiva(): AjustesNotificaciones {
  try {
    const crudo = JSON.parse(readFileSync(rutaConfigPrivada('area.json'), 'utf8')) as Record<string, unknown>;
    return ajustesDe(crudo?.['notificaciones']);
  } catch {
    return ajustesDe(undefined);
  }
}
