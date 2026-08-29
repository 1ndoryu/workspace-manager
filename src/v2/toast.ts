/* Sistema de toasts: avisos flotantes transitorios (ok/error/info).
 * [por que] El usuario pidio que los errores no aparezcan crudos en el
 * contenido (p. ej. "Request failed with status code 500") sino como toast.
 * Estado global en zustand, igual que el resto; los errores axios se
 * desempaquetan para mostrar el detalle real del server. */
import axios from 'axios';
import { create } from 'zustand';

export type TipoToast = 'ok' | 'error' | 'info';

export interface Toast {
  id: number;
  tipo: TipoToast;
  mensaje: string;
}

interface EstadoToast {
  toasts: Toast[];
  push: (tipo: TipoToast, mensaje: string) => void;
  descartar: (id: number) => void;
}

let siguienteId = 1;

/* Duracion antes de que el toast se descarte solo. */
const DURACION_MS = 4000;

export const useToasts = create<EstadoToast>((set) => ({
  toasts: [],
  push: (tipo, mensaje) => {
    const id = siguienteId++;
    set((s) => ({ toasts: [...s.toasts, { id, tipo, mensaje }] }));
    /* Autodescarte: nada de cumulos sin fin. */
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, DURACION_MS);
  },
  descartar: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

/* Accesos directos para el resto del front. */
export function toastOk(mensaje: string): void {
  useToasts.getState().push('ok', mensaje);
}
export function toastError(mensaje: string): void {
  useToasts.getState().push('error', mensaje);
}
export function toastInfo(mensaje: string): void {
  useToasts.getState().push('info', mensaje);
}

/* Extrae un mensaje legible de un error axios: prioriza el { error, detalle }
 * que devuelve el server (no el generico "Request failed with status code
 * 500"), y cae a un texto simple si no hay contexto util. */
export function mensajeDeError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const cuerpo = err.response?.data as { error?: string; detalle?: string } | undefined;
    if (cuerpo?.error) {
      return cuerpo.detalle ? `${cuerpo.error}: ${cuerpo.detalle}` : cuerpo.error;
    }
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}