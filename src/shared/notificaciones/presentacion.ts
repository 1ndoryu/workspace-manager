/* Cómo se enseña un aviso (20AA-25 N3): agrupación por día, hora relativa y contador.
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

/* Minutos, horas o días; nunca «hace 0 min» ni cifras crudas. */
export function hace(cuando: string | number | Date, ahora: number | Date): string {
  const t = new Date(cuando).getTime();
  if (!Number.isFinite(t)) return '';
  const a = new Date(ahora).getTime();
  const segundos = Math.round((a - t) / 1000);
  /* Un aviso del futuro (reloj del servidor adelantado) se lee como «ahora», no como «en -3 min». */
  if (segundos < 45) return 'ahora';
  const minutos = Math.round(segundos / 60);
  if (minutos < 60) return `hace ${minutos} min`;
  const horas = Math.round(minutos / 60);
  if (horas < 24) return `hace ${horas} h`;
  const dias = Math.round(horas / 24);
  if (dias < 7) return `hace ${dias} d`;
  const semanas = Math.round(dias / 7);
  return `hace ${semanas} sem`;
}

/* Día local en formato ISO corto (`2026-10-21`). [por que local y no UTC] La usuaria lee la hora
 * de su reloj: un aviso de las 23:30 de ayer no puede caer en «hoy» porque en UTC ya es hoy. */
export function diaLocal(cuando: string | number | Date): string {
  const d = new Date(cuando);
  const dos = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

/* «hoy», «ayer» o la fecha corta. */
export function etiquetaDia(dia: string, ahora: number | Date): string {
  const hoy = diaLocal(ahora);
  if (dia === hoy) return 'hoy';
  const ayer = new Date(new Date(ahora).getTime() - 24 * 3600 * 1000);
  if (dia === diaLocal(ayer)) return 'ayer';
  const [, mes, d] = dia.split('-');
  const MESES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  const indice = Number(mes) - 1;
  return `${Number(d)} ${MESES[indice] ?? mes}`;
}

export interface GrupoDia {
  /* Clave del grupo (`YYYY-MM-DD`). */
  dia: string;
  /* Etiqueta legible: «hoy», «ayer», «3 oct». */
  etiqueta: string;
  avisos: Aviso[];
}

/* Agrupa por día conservando el orden de entrada (el almacén sirve el más nuevo primero). */
export function agruparPorDia(avisos: readonly Aviso[], ahora: number | Date): GrupoDia[] {
  const grupos: GrupoDia[] = [];
  for (const aviso of avisos) {
    const dia = diaLocal(aviso.cuando);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo?.dia === dia) ultimo.avisos.push(aviso);
    else grupos.push({ dia, etiqueta: etiquetaDia(dia, ahora), avisos: [aviso] });
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
