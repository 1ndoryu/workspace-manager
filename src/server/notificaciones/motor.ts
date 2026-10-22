/* Motor de notificaciones (20AA-25 N0): compara lo que hay ahora con lo que había y produce los
 * avisos nuevos. Sin E/S, sin reloj propio y sin red: entra el estado, sale el diff. Se prueba
 * con tablas.
 * [por que así] Toda la inteligencia del sistema está aquí y es pura; las fuentes solo dicen qué
 * existe y el almacén solo guarda. Eso es lo que hace que añadir una fuente no toque el motor. */
import {
  NIVEL,
  type Aviso,
  type Entidad,
  type Fuente,
} from '../../shared/notificaciones/tipos.js';

/* Lo que el motor recuerda de cada fuente entre pasadas: qué claves había y qué texto tenía
 * cada una (para poder anunciar lo que desaparece sin volver a leerlo). */
export type MemoriaFuente = Record<string, { titulo: string; detalle: string }>;

/* Amortiguación de caídas: una fuente que dice «desapareció» puede estar mintiendo (un pulse que
 * no contesta un ciclo). [por que 2 y 1] Dos lecturas seguidas sin la entidad para declararla
 * ida, y una sola lectura buena para darla por vuelta: una red que parpadea no genera veinte
 * avisos, y volver se nota al instante. */
export interface Amortiguacion {
  /* Claves que llevan 1 lectura ausente: todavía no se declaran idas. */
  dudosas: Record<string, number>;
}

export interface EstadoMotor {
  /* Última pasada terminada con éxito por fuente. `null` = nunca: la primera pasada de una
   * fuente es línea base y no emite. */
  memorias: Record<string, MemoriaFuente>;
  amortiguaciones: Record<string, Amortiguacion>;
  /* Mayor id emitido. Los ids se asignan aquí, no en el almacén. */
  ultimoId: number;
}

export function estadoMotorInicial(): EstadoMotor {
  return { memorias: {}, amortiguaciones: {}, ultimoId: 0 };
}

/* Umbral de la amortiguación. Exportado para que la prueba lo use con nombre, no con un número
 * suelto. El alta no tiene umbral: una sola presencia basta (`PRESENCIAS_PARA_ALTA` = 1). */
export const AUSENCIAS_PARA_BAJA = 2;

export interface ResultadoPasada {
  estado: EstadoMotor;
  /* Avisos nuevos, ya con id y en orden de emisión. Vacío en la primera pasada de una fuente. */
  avisos: Aviso[];
  /* Fuentes que no se pudieron leer en esta pasada; se informa y no se toca su memoria. */
  rotas: { fuente: string; problema: string }[];
  /* Líneas para el registro del servidor (nunca para la UI). */
  notas: string[];
}

interface LecturaFuente {
  fuente: Fuente;
  entidades: Entidad[] | null;
  problema: string | null;
  /* Prefijos de clave que esta lectura NO cubre: sus entidades no se dan de baja. */
  sinVer: string[];
}

/* Una pasada completa. `leerTodas` las lee en paralelo: una fuente lenta no retrasa a las
 * demás, y una que falla no impide las otras.
 * [por que los avisos se agrupan] Lo que sale de una misma pasada es «lo que acaba de pasar»:
 * cuarenta tareas nuevas son un hecho, no cuarenta. Se agrupa por fuente y tipo en un aviso
 * contable, con el detalle de la primera entidad para que se entienda de qué va. */
export async function pasada(
  fuentes: Fuente[],
  estado: EstadoMotor,
  ahora: () => Date = () => new Date(),
): Promise<ResultadoPasada> {
  const lecturas: LecturaFuente[] = await Promise.all(
    fuentes.map(async (fuente) => {
      try {
        const r = await fuente.leer();
        /* Una fuente que no pudo leer es tan rota como una que lanza (ver `Fuente.sinLectura`). */
        return {
          fuente,
          entidades: r.sinLectura === true ? null : r.entidades,
          problema: r.problema,
          sinVer: r.sinVer ?? [],
        };
      } catch (e) {
        /* [por que] Una fuente que lanza se trata como rota, no como vacía: si no, la pasada
         * declararía que todo desapareció. */
        return {
          fuente,
          entidades: null,
          problema: e instanceof Error ? e.message : String(e),
          sinVer: [],
        };
      }
    }),
  );

  const siguiente: EstadoMotor = {
    memorias: { ...estado.memorias },
    amortiguaciones: { ...estado.amortiguaciones },
    ultimoId: estado.ultimoId,
  };
  const rotas: LecturaFuente[] = [];
  const crudos: Omit<Aviso, 'id' | 'leido'>[] = [];
  const notas: string[] = [];
  const cuando = ahora().toISOString();

  for (const lectura of lecturas) {
    const { fuente } = lectura;
    if (lectura.entidades === null) {
      rotas.push(lectura);
      notas.push(`fuente '${fuente.nombre}' sin leer: ${lectura.problema ?? 'motivo desconocido'}`);
      continue;
    }
    if (lectura.problema !== null) notas.push(`fuente '${fuente.nombre}': ${lectura.problema}`);

    const previa = siguiente.memorias[fuente.nombre];
    const anteriores = siguiente.amortiguaciones[fuente.nombre] ?? { dudosas: {} };
    const nuevas = diffDe(fuente, previa ?? null, lectura.entidades, lectura.sinVer, anteriores, cuando);
    siguiente.memorias[fuente.nombre] = nuevas.memoria;
    siguiente.amortiguaciones[fuente.nombre] = nuevas.amortiguacion;
    crudos.push(...nuevas.avisos);
  }

  const agrupados = agrupar(crudos);
  const avisos: Aviso[] = agrupados.map((a) => {
    siguiente.ultimoId += 1;
    return { ...a, id: siguiente.ultimoId, leido: false };
  });

  return { estado: siguiente, avisos, rotas: rotas.map((r) => ({ fuente: r.fuente.nombre, problema: r.problema ?? 'motivo desconocido' })), notas };
}

/* Diff de una fuente. [por que las dudosas] Una baja no es un hecho hasta la segunda lectura:
 * a la primera se apunta y la entidad sigue contando como presente. Así una lectura vacía
 * accidental no borra el estado ni anuncia una hecatombe. */
function diffDe(
  fuente: Fuente,
  previa: MemoriaFuente | null,
  entidades: Entidad[],
  sinVer: string[],
  amortiguacion: Amortiguacion,
  cuando: string,
): { memoria: MemoriaFuente; amortiguacion: Amortiguacion; avisos: Omit<Aviso, 'id' | 'leido'>[] } {
  const memoria: MemoriaFuente = {};
  const dudosas: Record<string, number> = {};
  const avisos: Omit<Aviso, 'id' | 'leido'>[] = [];
  const presentes = new Set<string>();

  for (const e of entidades) {
    presentes.add(e.clave);
    memoria[e.clave] = { titulo: e.titulo, detalle: e.detalle };
    /* Primera pasada (sin memoria): línea base, no se anuncia nada. */
    if (previa !== null && previa[e.clave] === undefined) {
      avisos.push(avisoDe(fuente.tipoAlta, fuente.nombre, e.clave, e.titulo, e.detalle, cuando));
    }
  }

  if (previa !== null) {
    for (const clave of Object.keys(previa)) {
      if (presentes.has(clave)) continue;
      /* Fuera de lo que esta lectura alcanza a ver: no es una baja, es una incógnita. La clave
       * sigue en la memoria con su texto, así que cuando vuelva a verse no se anunciará como
       * nueva ni habrá anunciado antes una resolución que no ocurrió (20AA-31). */
      if (sinVer.some((prefijo) => clave.startsWith(prefijo))) {
        memoria[clave] = previa[clave];
        continue;
      }
      const faltas = (amortiguacion.dudosas[clave] ?? 0) + 1;
      if (faltas < AUSENCIAS_PARA_BAJA) {
        /* Todavía no es una baja: la entidad sigue contando y no se anuncia. */
        dudosas[clave] = faltas;
        memoria[clave] = previa[clave];
        continue;
      }
      const memo = previa[clave];
      avisos.push(avisoDe(fuente.tipoBaja, fuente.nombre, clave, memo.titulo, memo.detalle, cuando));
    }
  }
  return { memoria, amortiguacion: { dudosas }, avisos };
}

function avisoDe(
  tipo: Aviso['tipo'],
  fuente: string,
  clave: string,
  titulo: string,
  detalle: string,
  cuando: string,
): Omit<Aviso, 'id' | 'leido'> {
  return { tipo, nivel: NIVEL[tipo], titulo, detalle, fuente, clave, cuando, agrupados: 1 };
}

/* Agrupa por fuente+tipo lo producido en la misma pasada. [por que] Es la regla anti-ruido más
 * importante: el escaneo del taller puede soltar veinte avisos de golpe y un toast por cada uno
 * sería insufrible. Se cuenta y se conserva la primera entidad como ejemplo. */
export function agrupar(crudos: Omit<Aviso, 'id' | 'leido'>[]): Omit<Aviso, 'id' | 'leido'>[] {
  const porClave = new Map<string, { aviso: Omit<Aviso, 'id' | 'leido'>; primero: string }>();
  for (const a of crudos) {
    const k = `${a.fuente}|${a.tipo}`;
    const previo = porClave.get(k);
    if (!previo) {
      porClave.set(k, { aviso: { ...a }, primero: `${a.titulo}${a.detalle === '' ? '' : ` (${a.detalle})`}` });
      continue;
    }
    previo.aviso.agrupados += 1;
  }
  /* El texto del grupo se arma aquí para que un grupo se entienda de un vistazo y la primera
   * entidad quede como ejemplo; con una sola, el aviso se lee igual que antes. */
  return [...porClave.values()].map(({ aviso, primero }) => {
    if (aviso.agrupados <= 1) return aviso;
    return { ...aviso, titulo: `${aviso.agrupados} ${plural(aviso.tipo)}`, detalle: `empezando por «${primero}»` };
  });
}

/* Texto en plural por tipo. [por que aquí y no en la UI] El motor ya sabe el tipo y el número;
 * que la campana y el toast digan lo mismo sale de una sola tabla. */
const PLURAL: Record<Aviso['tipo'], string> = {
  'tarea-nueva': 'tareas nuevas',
  'tarea-completada': 'tareas completadas',
  'problema-detectado': 'problemas nuevos',
  'problema-resuelto': 'problemas resueltos',
  'sitio-caido': 'sitios caídos',
  'sitio-recuperado': 'sitios recuperados',
  'proyecto-caido': 'proyectos parados',
  'proyecto-recuperado': 'proyectos arriba',
};

function plural(tipo: Aviso['tipo']): string {
  return PLURAL[tipo];
}
