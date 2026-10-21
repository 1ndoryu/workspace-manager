/* Qué se publica en el canal y cuándo (20AA-24 F3.1).
 * [por que vive aparte del bus] El bus reparte; esto sabe leer. Cada publicador se engancha al
 * ciclo que YA existe para ese dato (el escaneo, la vigilancia, la caché de sitios), así que el
 * canal no añade lecturas propias: sólo decide si el dato cambió.
 * [por que se compara aquí y no en el cliente] Un snapshot entero cada latido aunque nada haya
 * cambiado son ~70 KB por pestaña y por tick. Comparar cuesta un hash y deja el canal en silencio
 * cuando no hay noticia. */
import { createHash } from 'node:crypto';
import type { BusEventos } from './bus.js';
import { obtenerVigilancia } from '../dev/vigilancia.js';
import { snapshotArea } from '../snapshot.js';
import { leerSitios } from '../vps/rutas/rutasVps.js';
import { estaVivo } from '../../shared/vps/salud.js';

/* Cada cuánto se mira si el estado vivo cambió, mientras haya canal abierto. [por que 15 s] Las
 * dos fuentes tienen caché (doctor 60 s, sitios 20 s): mirar más a menudo sólo devuelve lo mismo.
 * El escaneo del área NO se repite aquí —cuesta minutos de la 89—; se publica cuando acaba. */
export const CADENCIA_VIVOS_MS = 15_000;

/* Cada cuánto se vuelve a mirar el área (proyectos, git, gate, roadmap) con canal abierto. [por
 * que 30 s] La caché relee git justo a esa cadencia, así que sondear más a menudo devolvería el
 * mismo objeto y gastaría hashes; y el criterio del plan (un cambio hecho fuera del tablero se ve
 * en ≤ 10 s) lo cubre holgado la noticia de los proyectos que sí arrancan y paran al instante. */
export const CADENCIA_AREA_MS = 30_000;

/** Huella estable de un valor: basta para saber si cambió y no guarda el dato. */
export function huella(valor: unknown): string {
  return createHash('sha1').update(JSON.stringify(valor) ?? '').digest('hex');
}

/* Tema `vivos`: lo mínimo que el mapa necesita para pintar líneas y bordes, con las MISMAS claves
 * que consume `destinosDe`. `null` = no se pudo preguntar, que no es «no hay nada vivo»: el mapa
 * no apaga un nodo porque una VPS no conteste.
 * [por que claves y no informes] El mapa no necesita sesiones, puertos ni motivos; y la campana ya
 * tiene su propio canal. Un array de claves es lo único que cambia cuando algo arranca o para. */
export interface Vivos {
  /* Claves de proyecto con servicio en marcha en la laptop (doctor: `bajo-mando`). */
  laptop: string[] | null;
  /* Nombres de sitio vivos en producción (Coolify). */
  produccion: string[] | null;
}

export interface Publicadores {
  /* Publica el snapshot si cambió. Devuelve true si hubo evento. */
  publicarWorkspace: () => Promise<boolean>;
  /* Publica los vivos si cambiaron. */
  publicarVivos: () => Promise<boolean>;
  /* Enciende o apaga el ciclo según haya suscriptores. Idempotente. */
  ajustarLatido: () => void;
  detener: () => void;
}

export function crearPublicadores(bus: BusEventos): Publicadores {
  let huellaWorkspace: string | null = null;
  let huellaVivos: string | null = null;
  let latido: ReturnType<typeof setInterval> | null = null;
  let latidoArea: ReturnType<typeof setInterval> | null = null;

  async function publicarWorkspace(): Promise<boolean> {
    try {
      /* Sin forzar: si el escaneo acaba de correr, esto es la misma foto; si no, la caché. */
      const { snapshot } = await snapshotArea(false);
      const h = huella(snapshot);
      if (h === huellaWorkspace) return false;
      huellaWorkspace = h;
      bus.publicar('workspace', snapshot);
      return true;
    } catch {
      /* Un escaneo que falla no se anuncia: el cliente ya tiene la última foto buena y el
       * siguiente latido lo reintenta. */
      return false;
    }
  }

  async function publicarVivos(): Promise<boolean> {
    /* Las MISMAS funciones que alimentan el mapa hoy: el doctor dev (`bajo-mando`) y la caché de
     * sitios de Coolify. Sin duplicar lectura ni criterio. Cada una en su try: que una VPS no
     * conteste no puede borrar el estado de la otra. */
    const [laptop, produccion] = await Promise.all([
      obtenerVigilancia()
        .then(({ informe }) => informe.proyectos.filter((p) => p.estado === 'bajo-mando').map((p) => p.clave).sort())
        .catch(() => null),
      /* `sinLectura` = no se pudo preguntar: `null`, nunca «nada vivo». Y el criterio de vivo es el
       * MISMO (`estaVivo`) que usaba el mapa antes: una segunda regex acabaría discrepando. */
      leerSitios()
        .then(({ sitios, sinLectura }) =>
          sinLectura === null ? sitios.filter((s) => estaVivo(s.estadoReal)).map((s) => s.nombre).sort() : null,
        )
        .catch(() => null),
    ]);
    const vivos: Vivos = { laptop, produccion };
    const h = huella(vivos);
    if (h === huellaVivos) return false;
    huellaVivos = h;
    bus.publicar('vivos', vivos);
    return true;
  }

  /* Los dos latidos son los únicos temporizadores nuevos. [por que el del área] Las obras del
   * tablero se cambiaban a mano (un roadmap, un commit, un proyecto nuevo) y el mapa no lo veía
   * hasta recargar: `publicarWorkspace` sólo corría al final de un escaneo y nadie volvía a
   * escanear. `snapshotArea(false)` ya relee git cada 30 s y comparte la lectura entre quienes
   * llegan a la vez; forzar aquí sería pagar un escaneo completo cada tick.
   * [por que sólo con canal abierto] Sin pestaña no hay a quién avisar, y el tablero nunca ha
   * gastado recursos con la app cerrada. */
  function ajustarLatido(): void {
    const hay = bus.suscriptores() > 0;
    if (hay && latido === null) {
      latido = setInterval(() => void publicarVivos(), CADENCIA_VIVOS_MS);
      (latido as { unref?: () => void }).unref?.();
      latidoArea = setInterval(() => void publicarWorkspace(), CADENCIA_AREA_MS);
      (latidoArea as { unref?: () => void }).unref?.();
      /* Primera foto en cuanto alguien escucha: el mapa no espera 30 s a la primera noticia. */
      void publicarVivos();
      void publicarWorkspace();
    } else if (!hay && latido !== null) {
      clearInterval(latido);
      latido = null;
      if (latidoArea !== null) {
        clearInterval(latidoArea);
        latidoArea = null;
      }
    }
  }

  return {
    publicarWorkspace,
    publicarVivos,
    ajustarLatido,
    detener() {
      if (latido !== null) {
        clearInterval(latido);
        latido = null;
      }
      if (latidoArea !== null) {
        clearInterval(latidoArea);
        latidoArea = null;
      }
    },
  };
}
