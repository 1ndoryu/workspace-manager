/* Almacén por clave con frescura: memoria + un JSON en disco (`data/cache/*.json`).
 * [por que] Los dos almacenes del gate (análisis de Sentinel y vulnerabilidades)
 * hacían lo mismo con la misma forma: cargar al arrancar, guardar solo lo cacheable,
 * podar las claves que ya no existen y servir por frescura. Solo cambiaban el
 * fichero y la regla de qué merece guardarse; esa regla entra como parámetro. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

interface EntradaPersistida<T> {
  fresco: string;
  dato: T;
}

export interface AlmacenPersistido<T> {
  /** Dato guardado con esa misma clave de frescura, o `null`. */
  frescos(clave: string, fresco: string): T | null;
  /** Guarda el dato si la regla lo admite; si no, deja intacto lo que hubiera. */
  guardar(clave: string, fresco: string, dato: T): void;
  /** Evicción: las claves que ya no existen se podan, o el fichero crece para siempre. */
  podar(vivas: Set<string>): void;
  /** Dato de una clave, sea cual sea su frescura. */
  leer(clave: string): T | null;
  /** Todos los datos (rehidratar el cliente al recargar sin volver a analizar). */
  leerTodas(): T[];
}

export function crearAlmacenPersistido<T>(
  rutaFichero: string,
  esCacheable: (dato: T) => boolean,
): AlmacenPersistido<T> {
  /* [por que] El filtro también se aplica al cargar: un fichero escrito con una
   * regla anterior no debe seguir sirviendo lo que hoy se consideraría no válido. */
  const cache = new Map<string, EntradaPersistida<T>>();
  try {
    const obj = JSON.parse(readFileSync(rutaFichero, 'utf8')) as Record<string, EntradaPersistida<T>>;
    for (const clave of Object.keys(obj)) {
      const entrada = obj[clave];
      if (entrada?.dato !== undefined && esCacheable(entrada.dato)) cache.set(clave, entrada);
    }
  } catch (err) {
    /* [por que] Sin fichero es el arranque normal. Cualquier otro fallo (JSON corrupto,
     * permisos) se avisa: arrancar vacío es seguro, pero no debe pasar en silencio. */
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      process.emitWarning(`${rutaFichero} no se pudo leer; se arranca vacío: ${(err as Error).message}`, 'AlmacenPersistido');
    }
  }

  /* [por que] Escritura atómica: se escribe a un temporal y se renombra. Un corte a mitad
   * deja el fichero anterior intacto en vez de un JSON truncado que se perdería al cargar. */
  function persistir(): void {
    try {
      const obj: Record<string, EntradaPersistida<T>> = {};
      for (const [clave, entrada] of cache) obj[clave] = entrada;
      mkdirSync(dirname(rutaFichero), { recursive: true });
      const temporal = `${rutaFichero}.tmp-${process.pid}`;
      writeFileSync(temporal, JSON.stringify(obj, null, 2), 'utf8');
      renameSync(temporal, rutaFichero);
    } catch (err) {
      /* Best-effort: la caché en memoria sigue valiendo, pero el fallo se avisa. */
      process.emitWarning(`${rutaFichero} no se pudo guardar: ${(err as Error).message}`, 'AlmacenPersistido');
    }
  }

  return {
    frescos(clave, fresco) {
      const entrada = cache.get(clave);
      return entrada && entrada.fresco === fresco ? entrada.dato : null;
    },
    guardar(clave, fresco, dato) {
      if (!esCacheable(dato)) return;
      cache.set(clave, { fresco, dato });
      persistir();
    },
    podar(vivas) {
      let huboPoda = false;
      for (const clave of [...cache.keys()]) {
        if (!vivas.has(clave)) {
          cache.delete(clave);
          huboPoda = true;
        }
      }
      if (huboPoda) persistir();
    },
    leer(clave) {
      return cache.get(clave)?.dato ?? null;
    },
    leerTodas() {
      return [...cache.values()].map((e) => e.dato);
    },
  };
}
