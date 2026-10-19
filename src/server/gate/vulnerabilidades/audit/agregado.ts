/* Partes de un análisis de vulnerabilidades: construirlas cuando no hay datos y
 * unirlas por proyecto. [por qué] Funciones puras, sin procesos ni disco: así la
 * regla de estado (qué gana a qué) se prueba sin lanzar ningún audit. */
import type { AnalisisVulnerabilidades, HallazgoVulnerabilidad } from '../../../../shared/types.js';

/* Parte de un análisis sin datos: sin lockfile, CLI ausente o CLI fallido. */
export function sinDatos(
  base: Pick<AnalisisVulnerabilidades, 'clave' | 'gestor' | 'lockfile'>,
  estado: 'noAuditable' | 'error',
  error: string,
  aviso?: string,
): AnalisisVulnerabilidades {
  return {
    ...base,
    estado,
    analizadoEn: new Date().toISOString(),
    resumen: { critical: 0, high: 0, moderate: 0, low: 0 },
    hallazgos: [],
    noAlcanzables: [],
    error,
    ...(aviso ? { aviso } : {}),
  };
}

const SEVERIDADES = ['critical', 'high', 'moderate', 'low'] as const;

/* Une las partes de un proyecto (una por lockfile) en un solo análisis. Estado,
 * de mayor a menor: conHallazgos > error > noAuditable (si alguna parte no se
 * pudo auditar) > ok. [por que] conHallazgos gana a error: las vulnerabilidades
 * ya obtenidas son reales y no deben esconderse porque otra parte fallara; el
 * fallo queda en `error`. */
export function agregarAnalisis(
  clave: string,
  partes: AnalisisVulnerabilidades[],
): AnalisisVulnerabilidades {
  const resumen = { critical: 0, high: 0, moderate: 0, low: 0 };
  const hallazgos: HallazgoVulnerabilidad[] = [];
  const noAlcanzables: HallazgoVulnerabilidad[] = [];
  const avisos: string[] = [];
  /* Un proyecto con varios lockfile puede degradar en unos y no en otros: el
   * aviso se deduplica para no repetir la misma frase por cada parte. */
  const degradados = new Set<string>();
  for (const p of partes) {
    for (const s of SEVERIDADES) resumen[s] += p.resumen[s];
    hallazgos.push(...p.hallazgos);
    noAlcanzables.push(...(p.noAlcanzables ?? []));
    if (p.error) avisos.push(`${p.lockfile}: ${p.error}`);
    if (p.aviso) degradados.add(p.aviso);
  }
  const estados = partes.map((p) => p.estado);
  const estado: AnalisisVulnerabilidades['estado'] = estados.includes('conHallazgos')
    ? 'conHallazgos'
    : estados.includes('error')
      ? 'error'
      : estados.includes('noAuditable')
        ? 'noAuditable'
        : 'ok';
  return {
    clave,
    gestor: partes.find((p) => p.gestor)?.gestor ?? null,
    lockfile: partes.map((p) => p.lockfile).join(', '),
    estado,
    analizadoEn: new Date().toISOString(),
    resumen,
    hallazgos: hallazgos.slice(0, 300),
    noAlcanzables,
    ...(avisos.length ? { error: avisos.join('; ').slice(0, 300) } : {}),
    ...(degradados.size ? { aviso: [...degradados].join('; ').slice(0, 300) } : {}),
  };
}
