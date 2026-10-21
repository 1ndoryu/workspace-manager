/* Contrato de las notificaciones del tablero (20AA-25). Solo tipos y tablas: sin E/S, sin
 * React, sin Node. Lo comparten el motor del servidor, sus fuentes y la campana del frente.
 * [por que] El motor no sabe qué es una tarea ni un sitio: cada fuente declara qué entidades
 * «están» y qué significan aparecer y desaparecer. Añadir una fuente nueva no toca nada de
 * aquí más allá de una entrada en `NIVEL`. */

/* Lo que se puede avisar. Un tipo por cada transición observable de una fuente. */
export type TipoAviso =
  | 'tarea-nueva'
  | 'tarea-completada'
  | 'problema-detectado'
  | 'problema-resuelto'
  | 'sitio-caido'
  | 'sitio-recuperado'
  | 'proyecto-caido'
  | 'proyecto-recuperado';

/* Cuánto pesa un aviso. `alta` justifica salir del tablero (toast del sistema, 20AA-27);
 * `media` se queda en la campana. */
export type NivelAviso = 'alta' | 'media';

export const NIVEL: Record<TipoAviso, NivelAviso> = {
  'tarea-nueva': 'media',
  'tarea-completada': 'media',
  'problema-detectado': 'alta',
  'problema-resuelto': 'media',
  'sitio-caido': 'alta',
  'sitio-recuperado': 'media',
  'proyecto-caido': 'alta',
  'proyecto-recuperado': 'media',
};

/* Todos los tipos, en orden de presentación. [por que aquí] Antes cada módulo repetía su propia
 * lista, así que añadir un tipo obligaba a tocar cinco sitios y el que se olvidaba rechazaba el
 * aviso en silencio al releerlo del disco. */
export const TIPOS: readonly TipoAviso[] = [
  'tarea-nueva',
  'tarea-completada',
  'problema-detectado',
  'problema-resuelto',
  'sitio-caido',
  'sitio-recuperado',
  'proyecto-caido',
  'proyecto-recuperado',
];

/* Nombre legible del tipo, para la UI y para el toast. */
export const ETIQUETA: Record<TipoAviso, string> = {
  'tarea-nueva': 'Tarea nueva',
  'tarea-completada': 'Tarea completada',
  'problema-detectado': 'Problema detectado',
  'problema-resuelto': 'Problema resuelto',
  'sitio-caido': 'Sitio caído',
  'sitio-recuperado': 'Sitio recuperado',
  'proyecto-caido': 'Proyecto del taller parado',
  'proyecto-recuperado': 'Proyecto del taller arriba',
};

/* Un aviso ya emitido y guardado. `id` es estable y monótono: sirve para deduplicar en el
 * cliente y para `Last-Event-ID` al reconectar el SSE. */
export interface Aviso {
  id: number;
  tipo: TipoAviso;
  nivel: NivelAviso;
  /* Una línea: lo que se lee en la campana y en el toast. */
  titulo: string;
  /* Contexto corto: proyecto, sitio o máquina. Puede ir vacío. */
  detalle: string;
  /* Fuente que lo produjo ('tareas', 'problemas', 'sitios', 'taller'). */
  fuente: string;
  /* Clave estable de la entidad dentro de su fuente. Dos avisos con la misma fuente+clave
   * son el mismo asunto visto dos veces (aparece, desaparece, vuelve). */
  clave: string;
  /* ISO 8601. */
  cuando: string;
  /* Cuántas entidades cuenta este aviso (1 = una). La agrupación por pasada lo sube. */
  agrupados: number;
  leido: boolean;
}

/* Una entidad presente AHORA en una fuente. Su presencia es lo que el motor compara con la
 * pasada anterior; el texto es lo que se enseña si hay que anunciarla. */
export interface Entidad {
  /* Estable entre pasadas. Dos lecturas con la misma clave son la misma cosa. */
  clave: string;
  /* Descripción de una línea, ya en español y sin secretos. */
  titulo: string;
  /* Contexto: proyecto, máquina, sitio. */
  detalle: string;
}

/* Lo mínimo que una fuente tiene que saber hacer. [por que] Leer y declarar: el diff, el
 * almacén, la entrega y la UI son comunes y no se reescriben por fuente. */
export interface Fuente {
  nombre: string;
  /* Tipo de aviso cuando una clave aparece. */
  tipoAlta: TipoAviso;
  /* Tipo de aviso cuando una clave deja de estar. */
  tipoBaja: TipoAviso;
  /* Entidades presentes ahora mismo. [por que] Nunca lanza hacia el motor: si su origen falla
   * devuelve lo último bueno que tenga (o nada) y lo dice en `problema`. Una fuente rota no
   * puede tumbar el resto de avisos. */
  leer(): Promise<{ entidades: Entidad[]; problema: string | null }>;
}

/* Ajustes de la usuaria, persistidos junto a los avisos. */
export interface PreferenciasNotificaciones {
  /* Tipos apagados: siguen entrando en la campana, pero no salen como toast del sistema. */
  silenciados: TipoAviso[];
}

export interface EstadoNotificaciones {
  avisos: Aviso[];
  preferencias: PreferenciasNotificaciones;
  /* Fuentes que no pudieron leer en la última pasada, con su motivo. Vacío = todo bien. */
  fuentesRotas: { fuente: string; problema: string }[];
  /* ISO de la última pasada terminada, o null. */
  pasadaEn: string | null;
}
