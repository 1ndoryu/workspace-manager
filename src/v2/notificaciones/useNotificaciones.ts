/* Store de la campana (20AA-25 N3).
 * [por que zustand y no estado local] El contador del botón y la lista del panel son dos
 * componentes distintos, y el canal SSE es un tercero: el estado tiene que vivir por encima de
 * los tres. Mismo patrón que `toast.ts`.
 * [por que el store NO es la fuente de verdad] La fuente es el servidor: aquí se guarda una copia
 * para pintar. Por eso la carga inicial manda sobre lo local, y un aviso que llega por SSE se
 * añade sin preguntar. Marcar leído sí es optimista: el POST es de ida y el usuario ya vio el
 * clic; si falla, la siguiente carga lo corrige.
 * [por que se deduplica por id] El canal entrega la historia al conectar y la carga inicial puede
 * llegar después; sin deduplicar, el mismo aviso saldría dos veces. */
import { create } from 'zustand';
import { CAMPANA_ACTIVA } from '../../shared/notificaciones/tipos.js';
import type {
  Aviso,
  EstadoNotificaciones,
  InterruptorCampana,
  TipoAviso,
} from '../../shared/notificaciones/tipos.js';
import { sinLeer } from '../../shared/notificaciones/presentacion.js';
import { cargarEstado, marcarLeidas, silenciar } from './apiNotificaciones.js';
import { ahoraMs } from '../../shared/platform/plataforma.js';

/* Tope local: el servidor guarda 500; aquí basta para pintar y evita crecer sin fin si una
 * pestaña vive días con el canal abierto. */
const TOPE_LOCAL = 500;

interface EstadoCampana {
  /** Avisos, el más nuevo primero. */
  avisos: Aviso[];
  /** Tipos que no salen como toast del sistema (lo decide el servidor). */
  silenciados: TipoAviso[];
  /** Fuentes que no pudieron leer en la última pasada. */
  fuentesRotas: { fuente: string; problema: string }[];
  /** ISO de la última pasada, para saber si el dato está fresco. */
  pasadaEn: string | null;
  /** Interruptor de la función (20AA-32), tal como lo aplica el servidor. Apagada, la campana no
   * se pinta y no se abre el canal. */
  campana: InterruptorCampana;
  /** Cargada al menos una vez (para distinguir «vacía» de «todavía no»). */
  lista: boolean;
  /** Error de la última carga, si lo hubo. */
  error: string | null;
  /** Filtro de tipo del panel; `null` = todos. */
  filtro: TipoAviso | null;
  /** Reloj para «hace 4 min»: se refresca al abrir el panel, no con un temporizador. */
  ahora: number;

  cargar: () => Promise<void>;
  recibir: (aviso: Aviso) => void;
  actualizarReloj: () => void;
  setFiltro: (tipo: TipoAviso | null) => void;
  marcarTodas: () => Promise<void>;
  marcar: (ids: number[]) => Promise<void>;
  alternarSilencio: (tipo: TipoAviso) => Promise<void>;
}

/* Fusiona sin duplicar y deja el más nuevo primero. [por que se ordena aquí] Un aviso que llega
 * por SSE puede tener un id menor que el último de la carga inicial (llegó mientras se pintaba);
 * el orden por id es lo que hace que la lista no baile. */
function fusionar(previos: Aviso[], nuevos: Aviso[]): Aviso[] {
  const porId = new Map<number, Aviso>();
  for (const a of previos) porId.set(a.id, a);
  for (const a of nuevos) porId.set(a.id, a);
  return [...porId.values()].sort((a, b) => b.id - a.id).slice(0, TOPE_LOCAL);
}

/* La carga en vuelo, fuera del store: no es estado que se pinte. */
let cargaEnVuelo: Promise<void> | null = null;

export const useNotificaciones = create<EstadoCampana>((set, get) => ({
  avisos: [],
  silenciados: [],
  fuentesRotas: [],
  pasadaEn: null,
  /* Activa hasta que el servidor diga lo contrario: si el GET falla, la campana se pinta y la
   * banda de error explica por qué está vacía. */
  campana: CAMPANA_ACTIVA,
  lista: false,
  error: null,
  filtro: null,
  ahora: ahoraMs(),

  async cargar() {
    /* Una sola carga en vuelo. [por que] Desde 20AA-32 el shell también pregunta por el
     * interruptor, y la campana y la página cargan al montar: tres GET simultáneos del mismo dato
     * sobraban. Quien llega tarde espera a la que hay. */
    if (cargaEnVuelo !== null) return cargaEnVuelo;
    cargaEnVuelo = (async () => {
      try {
        const estado = await cargarEstado();
        set((s) => ({
          /* La copia del servidor manda, pero lo que ya llegó por SSE y es más nuevo no se pierde. */
          avisos: fusionar(estado.avisos, s.avisos),
          silenciados: estado.preferencias.silenciados,
          fuentesRotas: estado.fuentesRotas,
          pasadaEn: estado.pasadaEn,
          campana: estado.campana ?? CAMPANA_ACTIVA,
          lista: true,
          error: null,
        }));
      } catch (err) {
        set({ lista: true, error: mensaje(err) });
      } finally {
        cargaEnVuelo = null;
      }
    })();
    return cargaEnVuelo;
  },

  recibir(aviso) {
    set((s) => {
      /* Ya conocido (historia del canal + carga inicial): sólo se actualiza su estado de leído. */
      const yaEsta = s.avisos.some((a) => a.id === aviso.id);
      return {
        avisos: fusionar(s.avisos, [aviso]),
        /* Un aviso que llega es señal de que el servidor está vivo. */
        error: yaEsta ? s.error : null,
      };
    });
  },

  actualizarReloj: () => set({ ahora: ahoraMs() }),
  setFiltro: (filtro) => set({ filtro }),

  async marcarTodas() {
    const sinAbrir = get().avisos.filter((a) => !a.leido);
    if (sinAbrir.length === 0) return;
    set((s) => ({ avisos: s.avisos.map((a) => (a.leido ? a : { ...a, leido: true })) }));
    try {
      await marcarLeidas();
    } catch {
      /* Optimista: si el POST falla, la próxima carga pinta la verdad del servidor. */
    }
  },

  async marcar(ids) {
    if (ids.length === 0) return;
    const objetivo = new Set(ids);
    set((s) => ({ avisos: s.avisos.map((a) => (objetivo.has(a.id) ? { ...a, leido: true } : a)) }));
    try {
      await marcarLeidas(ids);
    } catch {
      /* Igual que en marcarTodas. */
    }
  },

  async alternarSilencio(tipo) {
    const previos = get().silenciados;
    const siguientes = previos.includes(tipo) ? previos.filter((t) => t !== tipo) : [...previos, tipo];
    /* Optimista: el clic se ve al instante; el servidor confirma o la siguiente carga corrige. */
    set({ silenciados: siguientes });
    try {
      await silenciar(siguientes);
    } catch {
      set({ silenciados: previos });
    }
  },
}));

/** Cuántos avisos quedan sin leer (para el punto del botón). */
export function useSinLeer(): number {
  return useNotificaciones((s) => sinLeer(s.avisos));
}

/* [por que no `err.message`] «Request failed with status code 500» es jerga de axios que no dice
 * nada a quien lee la banda: lo que importa es que el tablero no contesta. El detalle técnico
 * queda en la consola. */
function mensaje(err: unknown): string {
  const bruto = err instanceof Error ? err.message : '';
  const codigo = /status code (\d{3})/.exec(bruto)?.[1];
  if (codigo) return `el tablero no contesta (${codigo})`;
  return 'no se pudo cargar';
}

export type { EstadoNotificaciones };
