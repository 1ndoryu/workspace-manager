/* Persistencia en localStorage (0110A-2 F3).
 * [por que] 7 claves dispersas repetian el mismo try/catch + warn 7 veces
 * (layout, seleccion, ui, historial/rango vps, fila:*, mapa). Un solo dueño:
 * texto plano o JSON, con aviso opcional (algunas lecturas prefieren
 * silencio y valor por defecto). */
import { logger } from './logger.js';

export function leerTexto(clave: string, aviso?: string): string | null {
  try {
    return localStorage.getItem(clave);
  } catch (err) {
    if (aviso) logger.warn(aviso, err);
    return null;
  }
}

export function guardarTexto(clave: string, valor: string, aviso?: string): void {
  try {
    localStorage.setItem(clave, valor);
  } catch (err) {
    if (aviso) logger.warn(aviso, err);
  }
}

export function leerJson<T>(clave: string, aviso?: string): T | null {
  try {
    const raw = localStorage.getItem(clave);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch (err) {
    if (aviso) logger.warn(aviso, err);
    return null;
  }
}

export function guardarJson(clave: string, valor: unknown, aviso?: string): void {
  try {
    localStorage.setItem(clave, JSON.stringify(valor));
  } catch (err) {
    if (aviso) logger.warn(aviso, err);
  }
}

export function borrarClave(clave: string, aviso?: string): void {
  try {
    localStorage.removeItem(clave);
  } catch (err) {
    if (aviso) logger.warn(aviso, err);
  }
}
