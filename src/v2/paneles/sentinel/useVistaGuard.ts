/* Lógica de la sección Guard (07AA-6 F6): fetch del estado + controles.
 * [por que] Hook dedicado (patrón usePanelSentinel): VistaGuard.tsx queda en
 * JSX y el estado/efectos viven aquí. */
import { useCallback, useEffect, useState } from 'react';
import axios from 'axios';
import { mensajeDeError, toastError, toastOk } from '../../toast.js';

/* Espejo mínimo de src/server/guard/lector.ts (el front no importa server). */
export interface ClaseGuard {
  iniciados: number;
  bloqueados: number;
  ultimoTs: string | null;
  usado: number;
  limite: number;
  extra: number;
  modo: 'observe' | 'enforce';
}

export interface TareaGuard {
  tarea: string;
  etapa: string;
  clases: Record<string, ClaseGuard>;
  totalBloqueados: number;
  ultimoTs: string | null;
}

export interface EstadoGuard {
  elegible: boolean;
  clave: string;
  politica?: {
    config: 'ok' | 'ausente' | 'ilegible';
    modo: 'observe' | 'enforce';
    limites: Record<string, number>;
    limitesExtra: string[];
  };
  override?: { existe: boolean; extra: number; primeraLinea: string };
  tareas?: TareaGuard[];
  totalBloqueados?: number;
}

export function useVistaGuard(clave: string) {
  const [estado, setEstado] = useState<EstadoGuard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actuando, setActuando] = useState(false);
  const [puntos, setPuntos] = useState('1');
  const [motivo, setMotivo] = useState('');

  const cargar = useCallback(async () => {
    try {
      const { data } = await axios.get<EstadoGuard>(`/api/guard/estado?clave=${encodeURIComponent(clave)}`);
      setEstado(data);
      setError(null);
    } catch (err) {
      setError(mensajeDeError(err));
    }
  }, [clave]);

  useEffect(() => {
    setEstado(null);
    setError(null);
    void cargar();
  }, [cargar]);

  const cambiarModo = async (mode: 'observe' | 'enforce') => {
    setActuando(true);
    try {
      await axios.post('/api/guard/modo', { clave, mode });
      toastOk(`tope en ${mode}`);
      await cargar();
    } catch (err) {
      toastError(mensajeDeError(err));
    } finally {
      setActuando(false);
    }
  };

  const ampliar = async () => {
    const n = Number.parseInt(puntos, 10);
    if (!Number.isInteger(n) || n < 1 || n > 100) {
      toastError('puntos: entero 1..100');
      return;
    }
    if (!motivo.trim()) {
      toastError('motivo requerido (ampliación auditable)');
      return;
    }
    setActuando(true);
    try {
      await axios.post('/api/guard/lote-extra', { clave, puntos: n, motivo: motivo.trim() });
      toastOk(`cupo +${n}`);
      setMotivo('');
      await cargar();
    } catch (err) {
      toastError(mensajeDeError(err));
    } finally {
      setActuando(false);
    }
  };

  return { estado, error, actuando, puntos, setPuntos, motivo, setMotivo, cambiarModo, ampliar };
}
