/* Clasificación de los hallazgos de análisis de un proyecto: sentinel y vulnerabilidades
 * de dependencias. Pura: recibe los análisis ya cargados y devuelve sus entradas. */
import type { AnalisisSentinel, AnalisisVulnerabilidades, Proyecto } from '../../types.js';
import type { Entrada, Problema } from './consola-tipos.js';

/* Vulnerabilidades sin version corregida upstream: no hay accion que tomar en
 * el repo, asi que se muestran sin seriedad (ni error ni advertencia). Clave = nombre del paquete.
 * [por que] `rsa` (Cargo.lock de coolify-manager-rs y glory-agent) no tiene
 * parche publicado; la decision es aceptar el riesgo y revisarlo al publicarse
 * una version corregida. */
const VULN_SIN_PARCHE_UPSTREAM: Record<string, string> = {
  rsa: 'sin version corregida upstream; riesgo aceptado, revisar si sale parche',
};

/* Hallazgos de sentinel de un proyecto (si ya se analizo y hay algo). Cada
 * hallazgo es una entrada propia en la categoria 'sentinel'. [por que] La
 * consola se entera del analisis por el store (resultado de escanearUno/Todo);
 * NO mezcla estos hallazgos con 'todos' (decision del usuario: el total de la
 * cabecera no suma analyze; cada filtro conserva su conteo). Desde la fase G
 * el analisis fusiona varsense: los hallazgos con `fuente: 'varsense'` se
 * etiquetan en la linea para distinguir la tool que los emitio. */
export function problemasSentinelDe(p: Proyecto, a: AnalisisSentinel | undefined): Problema | null {
  if (!a || a.estado !== 'conHallazgos' || a.hallazgos.length === 0) return null;
  const entradas: Entrada[] = a.hallazgos.map((h) => {
    /* [por que] hint/information son sugerencias de estilo, no defectos: se
     * ven en la linea sin seriedad (ni "advertencia" ni error). */
    const sugerencia = h.severidad === 'hint' || h.severidad === 'information';
    return {
      categoria: 'sentinel',
      /* [por que] el prefijo permite distinguir la tool que emitio el hallazgo
       * (fase G: el analisis fusiona sentinel + varsense) sin tocar el render. */
      motivo: `${h.fuente === 'varsense' ? '[varsense] ' : ''}${h.archivo || p.id}${h.linea != null ? `:${h.linea}` : ''} — ${h.ruleId} — ${h.mensaje}`,
      seriedad: sugerencia ? null : h.severidad === 'error' ? 'error' : 'advertencia',
      sentinelSeveridad: h.severidad,
    };
  });
  return { p, entradas };
}

/* Vulnerabilidades de dependencias de un proyecto (308A-4). Cada hallazgo es
 * una entrada propia en la categoria 'vulnerabilidad'. El server resuelve el
 * lockfile/gestor; aqui solo se enlistan los paquetes afectados. Los proyectos
 * 'noAuditable' (sin lockfile o cargo-audit ausente) NO generan problema. */
export function problemasVulnerabilidadDe(
  p: Proyecto,
  v: AnalisisVulnerabilidades | undefined,
): Problema | null {
  if (!v || v.estado !== 'conHallazgos' || v.hallazgos.length === 0) return null;
  const entradas: Entrada[] = v.hallazgos.map((h) => {
    const sinParche = VULN_SIN_PARCHE_UPSTREAM[h.paquete];
    /* El aviso se identifica por su id y su titulo, no solo por el paquete:
     * cuatro avisos distintos de `rustls` se parchean en la misma version y sin
     * esto salian como cuatro lineas identicas. El rango se mantiene detras. */
    const aviso = h.id ? ` — ${h.id}${h.titulo ? `: ${h.titulo}` : ''}` : '';
    const nota = h.sinSeveridad ? ' — severidad no declarada en el aviso' : '';
    return {
      categoria: 'vulnerabilidad',
      motivo: `${h.paquete} (${h.origen ?? v.gestor})${aviso}${h.rango ? ` — ${h.rango}` : ''}${sinParche ? ` — ${sinParche}` : ''}${nota}`,
      seriedad: sinParche ? null : h.severidad === 'critical' || h.severidad === 'high' ? 'error' : 'advertencia',
      vulnSeveridad: h.severidad,
    };
  });
  return { p, entradas };
}
