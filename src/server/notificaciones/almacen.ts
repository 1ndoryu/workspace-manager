/* Almacén de notificaciones (20AA-25 N0): los avisos emitidos, la memoria del motor y las
 * preferencias, en un JSON.
 * [por que un fichero y no una base] Son cientos de filas, el proyecto no tiene ORM y una base
 * nativa añadiría un binario al portátil. El techo está en el motor (`TOPE_AVISOS`): un fichero
 * que solo crece es una fuga, y el límite no puede depender de que alguien pulse «borrar».
 * [por que la escritura se agrupa] Cada aviso no puede costar un `rename`: con un escaneo que
 * suelta cuarenta, eso son cuarenta escrituras en el camino de una petición. Se marca sucio y un
 * temporizador escribe una vez; `volcar()` fuerza la escritura (cierre ordenado y pruebas).
 * [por que propio y no `almacenPersistido`] Aquel guarda un dato por clave con frescura; aquí lo
 * que se guarda es una cola ordenada con tope y una memoria de diff. Forzarlo sería pelearse con
 * su forma. La escritura atómica (temporal + rename) sí se copia: es la parte que importa. */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  TIPOS as TIPOS_AVISO,
  type Aviso,
  type EstadoNotificaciones,
  type PreferenciasNotificaciones,
  type TipoAviso,
} from '../../shared/notificaciones/tipos.js';
import { estadoMotorInicial, type EstadoMotor, type MemoriaFuente } from './motor.js';

/* Tope duro de avisos guardados. [por que 500] Es lo que la campana puede enseñar sin paginar y
 * lo que mantiene el fichero por debajo de ~200 KB. */
export const TOPE_AVISOS = 500;

/* Retención: lo más viejo que esto se poda aunque no se haya llegado al tope. */
export const RETENCION_MS = 30 * 24 * 60 * 60 * 1000;

/* Ventana de agrupación de escrituras. */
export const ESCRITURA_MS = 2000;

interface Persistido {
  version: 1;
  motor: EstadoMotor;
  avisos: Aviso[];
  preferencias: PreferenciasNotificaciones;
  /* ISO de la última pasada terminada. */
  pasadaEn: string | null;
  /* Fuentes que fallaron en la última pasada. */
  fuentesRotas: { fuente: string; problema: string }[];
}

export interface AlmacenNotificaciones {
  /* Lee el estado para la UI (avisos más nuevos primero). */
  estado(): EstadoNotificaciones;
  /* Añade avisos nuevos delante, aplica tope y retención y programa la escritura. */
  anadir(avisos: Aviso[]): void;
  /* Estado del motor para la siguiente pasada. */
  motor(): EstadoMotor;
  /* Guarda lo que el motor dejó tras una pasada. */
  guardarPasada(motor: EstadoMotor, pasadaEn: string, rotas: { fuente: string; problema: string }[]): void;
  /* Marca leídos (todos, o uno por id). */
  marcarLeidos(ids?: number[]): void;
  /* Cambia los tipos silenciados (toast del sistema). */
  silenciar(tipos: TipoAviso[]): void;
  /* Fuerza la escritura pendiente; devuelve cuando el fichero está al día. */
  volcar(): void;
  /* Para pruebas: escritura en cada cambio y sin temporizador. */
  cerrar(): void;
}

export function crearAlmacenNotificaciones(
  rutaFichero: string,
  ahora: () => number = Date.now,
): AlmacenNotificaciones {
  const cargado = cargar(rutaFichero);
  let motor = cargado.motor;
  let avisos: Aviso[] = cargado.avisos;
  let preferencias = cargado.preferencias;
  let pasadaEn = cargado.pasadaEn;
  let fuentesRotas = cargado.fuentesRotas;
  let sucio = false;
  let temporizador: ReturnType<typeof setTimeout> | null = null;

  function escribible(): Persistido {
    return { version: 1, motor, avisos, preferencias, pasadaEn, fuentesRotas };
  }

  function escribir(): void {
    try {
      mkdirSync(dirname(rutaFichero), { recursive: true });
      const temporal = `${rutaFichero}.tmp-${process.pid}`;
      writeFileSync(temporal, JSON.stringify(escribible(), null, 2), 'utf8');
      renameSync(temporal, rutaFichero);
      sucio = false;
    } catch (err) {
      /* Best-effort: perder el fichero no puede tumbar el tablero, pero no se calla. */
      process.emitWarning(`${rutaFichero} no se pudo guardar: ${(err as Error).message}`, 'Notificaciones');
    }
  }

  function programar(): void {
    sucio = true;
    if (temporizador !== null) return;
    temporizador = setTimeout(() => {
      temporizador = null;
      if (sucio) escribir();
    }, ESCRITURA_MS);
    /* Un temporizador de fondo no mantiene vivo el proceso. */
    (temporizador as { unref?: () => void }).unref?.();
  }

  /* Poda: primero por antigüedad, después por tope. Los avisos llegan del más nuevo al más
   * viejo, así que la cola es lo descartable. */
  function podar(lista: Aviso[]): Aviso[] {
    const limite = ahora() - RETENCION_MS;
    const vigentes = lista.filter((a) => Date.parse(a.cuando) >= limite);
    return vigentes.slice(0, TOPE_AVISOS);
  }

  return {
    estado: () => ({ avisos: [...avisos], preferencias: { ...preferencias }, fuentesRotas: [...fuentesRotas], pasadaEn }),
    anadir(nuevos) {
      if (nuevos.length === 0) return;
      /* El más nuevo primero: la campana no reordena y el tope corta por el final. */
      avisos = podar([...nuevos.slice().sort((a, b) => b.id - a.id), ...avisos]);
      programar();
    },
    motor: () => motor,
    guardarPasada(nuevoMotor, cuando, rotas) {
      motor = nuevoMotor;
      pasadaEn = cuando;
      fuentesRotas = rotas;
      programar();
    },
    marcarLeidos(ids) {
      const objetivo = ids === undefined ? null : new Set(ids);
      let cambio = false;
      avisos = avisos.map((a) => {
        if (a.leido) return a;
        if (objetivo !== null && !objetivo.has(a.id)) return a;
        cambio = true;
        return { ...a, leido: true };
      });
      if (cambio) programar();
    },
    silenciar(tipos) {
      preferencias = { ...preferencias, silenciados: [...new Set(tipos)] };
      programar();
    },
    volcar() {
      if (temporizador !== null) {
        clearTimeout(temporizador);
        temporizador = null;
      }
      if (sucio) escribir();
    },
    cerrar() {
      if (temporizador !== null) {
        clearTimeout(temporizador);
        temporizador = null;
      }
      if (sucio) escribir();
    },
  };
}

/* Carga tolerante: un fichero ausente es el arranque normal; uno corrupto avisa y se empieza
 * vacío, pero nunca se pierde en silencio. */
function cargar(ruta: string): Persistido {
  const vacío: Persistido = {
    version: 1,
    motor: estadoMotorInicial(),
    avisos: [],
    preferencias: { silenciados: [] },
    pasadaEn: null,
    fuentesRotas: [],
  };
  let crudo: string;
  try {
    crudo = readFileSync(ruta, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      process.emitWarning(`${ruta} no se pudo leer; se arranca vacío: ${(err as Error).message}`, 'Notificaciones');
    }
    return vacío;
  }
  try {
    const obj = JSON.parse(crudo) as Partial<Persistido>;
    if (obj?.version !== 1) return vacío;
    return {
      version: 1,
      motor: sanearMotor(obj.motor),
      avisos: Array.isArray(obj.avisos) ? obj.avisos.filter(esAviso) : [],
      preferencias: {
        silenciados: Array.isArray(obj.preferencias?.silenciados)
          ? obj.preferencias.silenciados.filter((t): t is TipoAviso => typeof t === 'string')
          : [],
      },
      pasadaEn: typeof obj.pasadaEn === 'string' ? obj.pasadaEn : null,
      fuentesRotas: Array.isArray(obj.fuentesRotas) ? obj.fuentesRotas.filter(esRota) : [],
    };
  } catch (err) {
    process.emitWarning(`${ruta} ilegible; se arranca vacío: ${(err as Error).message}`, 'Notificaciones');
    return vacío;
  }
}

/* La memoria del motor es lo único cuya pérdida provoca avisos falsos: si viene malformada se
 * descarta entera, que equivale a una línea base nueva (nada de anunciar el mundo entero). */
function sanearMotor(v: unknown): EstadoMotor {
  if (!v || typeof v !== 'object') return estadoMotorInicial();
  const m = v as Partial<EstadoMotor>;
  const memorias: Record<string, MemoriaFuente> = {};
  if (m.memorias && typeof m.memorias === 'object') {
    for (const [fuente, mem] of Object.entries(m.memorias)) {
      if (!mem || typeof mem !== 'object') continue;
      const limpio: MemoriaFuente = {};
      for (const [clave, valor] of Object.entries(mem)) {
        const entrada = valor as { titulo?: unknown; detalle?: unknown };
        if (typeof entrada?.titulo === 'string') {
          limpio[clave] = { titulo: entrada.titulo, detalle: typeof entrada.detalle === 'string' ? entrada.detalle : '' };
        }
      }
      memorias[fuente] = limpio;
    }
  }
  const amortiguaciones: EstadoMotor['amortiguaciones'] = {};
  if (m.amortiguaciones && typeof m.amortiguaciones === 'object') {
    for (const [fuente, am] of Object.entries(m.amortiguaciones)) {
      const dudosas: Record<string, number> = {};
      const crudas = (am as { dudosas?: unknown })?.dudosas;
      if (crudas && typeof crudas === 'object') {
        for (const [clave, n] of Object.entries(crudas)) if (typeof n === 'number') dudosas[clave] = n;
      }
      amortiguaciones[fuente] = { dudosas };
    }
  }
  return {
    memorias,
    amortiguaciones,
    ultimoId: typeof m.ultimoId === 'number' && Number.isFinite(m.ultimoId) ? m.ultimoId : 0,
  };
}

/* Lista única del contrato: un tipo nuevo no puede quedar fuera de la relectura del disco. */
const TIPOS: ReadonlySet<string> = new Set<string>(TIPOS_AVISO);

function esAviso(v: unknown): v is Aviso {
  const a = v as Partial<Aviso>;
  return Boolean(
    a &&
      typeof a.id === 'number' &&
      typeof a.tipo === 'string' &&
      TIPOS.has(a.tipo) &&
      typeof a.titulo === 'string' &&
      typeof a.cuando === 'string' &&
      typeof a.fuente === 'string' &&
      typeof a.clave === 'string',
  );
}

function esRota(v: unknown): v is { fuente: string; problema: string } {
  const r = v as { fuente?: unknown; problema?: unknown };
  return typeof r?.fuente === 'string' && typeof r.problema === 'string';
}
