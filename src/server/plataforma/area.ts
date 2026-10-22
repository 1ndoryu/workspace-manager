/* Papeles del área: qué proyecto NUESTRO hace cada cosa que el manager no puede
 * adivinar por sí solo.
 * [por qué] El código decidía con literales nuestros: el motor de calidad, el
 * gestor de despliegues, el limpiador y el proyecto excluido del bump eran
 * nombres de carpeta incrustados. Eso ata el repo a nuestra área: un tercero que
 * lo clone no puede decir quién es quién, y renombrar una carpeta rompía
 * funciones enteras. Los papeles son configuración nuestra, no del producto, así
 * que viven en `config/area.json` (privado, ver
 * `config/ejemplos/area.example.json`).
 *
 * [por qué sin caché] El fichero es de ~1 KiB y se consulta como mucho una vez
 * por petición o al arrancar un mando. Cachearlo solo añadiría el riesgo de
 * servir un papel viejo tras editarlo.
 *
 * Sin el fichero no se rompe nada: cada papel ausente es `null` y quien lo usa
 * desactiva su función diciéndolo. */
import { readFileSync } from 'node:fs';
import { rutaConfigPrivada } from './rutas.js';

export type NombrePapel = 'sentinel' | 'despliegue' | 'limpiador';

export interface PapelesArea {
  sentinel: string | null;
  despliegue: string | null;
  /** Nombre base del ejecutable que instala el proyecto de `despliegue`, si no
   * coincide con el de su carpeta (el nuestro es `coolify-manager-rs` en disco
   * y produce `coolify-manager`). Sin declararlo vale el del papel. */
  despliegueBin: string | null;
  limpiador: string | null;
  /** URL base del servicio de métricas (pulse) del área. [por qué] Antes el
   * código asumía `http://127.0.0.1:3000`: un host y un puerto incrustados que
   * en otra máquina apuntan a cualquier cosa. Sin declararlo, esa pestaña dice
   * «sin configurar» en vez de inventarse un destino. */
  pulseUrl: string | null;
  /** Igual, para el pulse del taller (el que se lee por el túnel). */
  pulseTallerUrl: string | null;
  /** Proyectos que el propagador de pins (`quality:bump`) no debe tocar. */
  bumpExcluidos: string[];
}

const VACIOS: PapelesArea = {
  sentinel: null,
  despliegue: null,
  despliegueBin: null,
  limpiador: null,
  pulseUrl: null,
  pulseTallerUrl: null,
  bumpExcluidos: [],
};

function texto(v: unknown): string | null {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Papeles declarados. Nunca lanza: un fichero ausente o ilegible da `VACIOS`. */
export function papelesDeArea(): PapelesArea {
  let crudo: unknown;
  try {
    crudo = JSON.parse(readFileSync(rutaConfigPrivada('area.json'), 'utf8'));
  } catch {
    return VACIOS;
  }
  if (!crudo || typeof crudo !== 'object') return VACIOS;
  const d = crudo as Record<string, unknown>;
  const bump = (d.bump ?? {}) as Record<string, unknown>;
  return {
    sentinel: texto(d.sentinel),
    despliegue: texto(d.despliegue),
    despliegueBin: texto(d.despliegueBin),
    limpiador: texto(d.limpiador),
    pulseUrl: texto(d.pulseUrl),
    pulseTallerUrl: texto(d.pulseTallerUrl),
    bumpExcluidos: Array.isArray(bump.excluidos)
      ? bump.excluidos.filter((x): x is string => texto(x) !== null)
      : [],
  };
}

/** El proyecto que hace `nombre`, o `null` si no está declarado. */
export function papelDeArea(nombre: NombrePapel): string | null {
  return papelesDeArea()[nombre];
}

/** Remite a la config cuando falta un papel. Un solo texto para todos los
 * sitios: el remedio es siempre el mismo fichero. */
export function avisoSinPapel(nombre: NombrePapel): string {
  return `no hay '${nombre}' declarado en config/area.json (copia config/ejemplos/area.example.json y ajústalo)`;
}
