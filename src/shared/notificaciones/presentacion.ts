/* Cómo se enseña un aviso (20AA-25 N3, rework 20AA-28): bloques de 6 horas, fecha absoluta y
 * contador. [por que sin «hace 4 min» por fila] La hora en cada aviso estorbaba; el bloque de 6 h
 * sitúa el aviso en el tiempo una sola vez por tramo y el detalle da la hora exacta.
 * Puro y sin DOM: la campana pinta lo que esto devuelve, y así se puede probar con una tabla en
 * vez de con un navegador. `ahora` entra como argumento por el mismo motivo: nada lee el reloj a
 * escondidas y las pruebas no dependen de cuándo se ejecuten. */
import type { Aviso, TipoAviso } from './tipos.js';

/* Máximo que se enseña en el punto de la campana; a partir de ahí, «9+». [por que] Un número de
 * tres cifras no cabe en un círculo de 8 px y no aporta: lo que importa es «hay muchos». */
export const TOPE_CONTADOR = 9;

export function etiquetaContador(noLeidos: number): string {
  if (noLeidos <= 0) return '';
  return noLeidos > TOPE_CONTADOR ? `${TOPE_CONTADOR}+` : String(noLeidos);
}

/* Día local en formato ISO corto (`2026-10-21`). [por que local y no UTC] La usuaria lee la hora
 * de su reloj: un aviso de las 23:30 de ayer no puede caer en «hoy» porque en UTC ya es hoy. */
export function diaLocal(cuando: string | number | Date): string {
  const d = new Date(cuando);
  const dos = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/* «hoy», «ayer» o la fecha corta. */
export function etiquetaDia(dia: string, ahora: number | Date): string {
  const hoy = diaLocal(ahora);
  if (dia === hoy) return 'hoy';
  const ayer = new Date(new Date(ahora).getTime() - 24 * 3600 * 1000);
  if (dia === diaLocal(ayer)) return 'ayer';
  const [, mes, d] = dia.split('-');
  const indice = Number(mes) - 1;
  return `${Number(d)} ${MESES[indice] ?? mes}`;
}

/* Hora local `HH:MM`. Se usa en el pie del detalle y en las etiquetas de grupo de días pasados. */
export function horaLocal(cuando: string | number | Date): string {
  const d = new Date(cuando);
  if (!Number.isFinite(d.getTime())) return '';
  const dos = (n: number): string => String(n).padStart(2, '0');
  return `${dos(d.getHours())}:${dos(d.getMinutes())}`;
}

/* Cada cuántas horas se corta un grupo. [por que 6] La usuaria lo pidió así: la hora por aviso
 * estorba, y un bloque hace el mismo trabajo —situar el aviso en el tiempo— sin repetir la hora
 * en cada fila. */
export const HORAS_POR_GRUPO = 6;

export interface GrupoTiempo {
  /* Clave estable del bloque: instante de su hora de inicio, en ms. */
  clave: number;
  /* Etiqueta centrada sobre el bloque: «hoy 06:00–12:00», «ayer 18:00–00:00», «3 oct 00:00–06:00». */
  etiqueta: string;
  avisos: Aviso[];
}

/* Bloque de 6 horas al que pertenece un instante, en hora local. `null` si la fecha no se puede
 * leer: un aviso con fecha rota no puede partir la lista en tramos inventados.
 * [por que se corta por la hora local y no cada 6 h desde el epoch] El bloque tiene que empezar
 * donde empieza el día para que «hoy 00:00–06:00» signifique eso y no un tramo que cruza la
 * medianoche y se anuncia mal. Un desfase de huso de media hora sigue cortando limpio: se corta
 * sobre la hora entera local, no sobre UTC. */
function bloqueLocal(cuando: string | number | Date): Date | null {
  const d = new Date(cuando);
  if (!Number.isFinite(d.getTime())) return null;
  /* `setHours` normaliza el desbordamiento (p. ej. -1 h → 23:00 del día anterior), así que no hace
   * falta aritmética propia a caballo de la medianoche. */
  d.setHours(Math.floor(d.getHours() / HORAS_POR_GRUPO) * HORAS_POR_GRUPO, 0, 0, 0);
  return d;
}

/* Etiqueta legible del bloque que empieza en `inicio`. */
function etiquetaBloque(inicio: Date, ahora: number | Date): string {
  const fin = new Date(inicio.getTime());
  fin.setHours(inicio.getHours() + HORAS_POR_GRUPO, 0, 0, 0);
  /* El día se pone cuando el tramo cruza la medianoche o cuando no es de hoy: «00:00–06:00» a
   * secas se confundiría con la madrugada de hoy aunque sea del 3 de octubre. */
  const esDeHoy = diaLocal(inicio) === diaLocal(ahora);
  const diceDia = diaLocal(inicio) !== diaLocal(fin) || !esDeHoy;
  const desde = `${diceDia ? etiquetaDia(diaLocal(inicio), ahora) + ' ' : ''}${horaLocal(inicio)}`;
  /* Un bloque que termina a las 00:00 del día siguiente («ayer 18:00–00:00») se lee mejor con la
   * medianoche que con la fecha repetida. */
  const hasta = horaLocal(fin) === '00:00' ? '00:00' : horaLocal(fin);
  return `${desde}–${hasta}`;
}

/* Agrupa en bloques de `HORAS_POR_GRUPO` conservando el orden de entrada (el almacén sirve el más
 * nuevo primero). Un bloque nuevo sólo se abre cuando el aviso anterior ya cayó en otro tramo, así
 * que una lista ordenada sale con tantos grupos como tramos, no uno por aviso. */
export function agruparPorTiempo(avisos: readonly Aviso[], ahora: number | Date): GrupoTiempo[] {
  const grupos: GrupoTiempo[] = [];
  for (const aviso of avisos) {
    const inicio = bloqueLocal(aviso.cuando);
    /* Sin fecha legible, bloque propio y etiqueta propia: se ve que algo raro pasó, no se esconde. */
    const clave = inicio === null ? Number.NaN : inicio.getTime();
    const etiqueta = inicio === null ? 'sin fecha' : etiquetaBloque(inicio, ahora);
    const ultimo = grupos[grupos.length - 1];
    /* `NaN !== NaN`: dos avisos sin fecha no se juntan, y eso es lo que se quiere. */
    if (ultimo !== undefined && ultimo.clave === clave) ultimo.avisos.push(aviso);
    else grupos.push({ clave, etiqueta, avisos: [aviso] });
  }
  return grupos;
}

/* Cuántos avisos no se han leído. */
export function sinLeer(avisos: readonly Aviso[]): number {
  return avisos.reduce((n, a) => (a.leido ? n : n + 1), 0);
}

/* Filtro por tipo de la cabecera: `null` = todos. */
export function filtrarPorTipo(avisos: readonly Aviso[], tipo: TipoAviso | null): Aviso[] {
  return tipo === null ? [...avisos] : avisos.filter((a) => a.tipo === tipo);
}

/* Cuántos avisos se pintan de entrada y cuántos se suman al llegar al final.
 * [por que por tramos de bloque] La página de avisos puede tener 500 filas; pintarlas todas de golpe
 * es medio segundo de bloqueo y 500 nodos que nadie mira. Se corta en bloques de 6 h completos para
 * que un tramo no aparezca a medias y se complete al bajar, que se leería como si se reordenara. */
export const AVISOS_POR_TRAMO = 40;

/* Lo que se pinta con un tope de avisos: los grupos completos que caben, sus avisos en orden y
 * cuántos faltan. Se corta por grupo entero —un tramo a medias se completaría al bajar y parecería
 * que la lista se reordena—, así que un grupo puede pasarse del tope. */
export interface Tramo {
  grupos: GrupoTiempo[];
  avisos: Aviso[];
  quedan: number;
}

export function tramoVisible(grupos: readonly GrupoTiempo[], tope: number): Tramo {
  const elegidos: GrupoTiempo[] = [];
  const avisos: Aviso[] = [];
  for (const grupo of grupos) {
    if (avisos.length >= tope) break;
    elegidos.push(grupo);
    avisos.push(...grupo.avisos);
  }
  const total = grupos.reduce((n, g) => n + g.avisos.length, 0);
  return { grupos: elegidos, avisos, quedan: total - avisos.length };
}

/* Cuántos avisos hay en total, repartidos en esos grupos. */
export function contarAvisos(grupos: readonly GrupoTiempo[]): number {
  return grupos.reduce((n, g) => n + g.avisos.length, 0);
}
