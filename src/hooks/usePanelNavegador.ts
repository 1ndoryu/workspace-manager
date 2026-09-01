/* Hook del PanelNavegador: estado + logica de navegacion de archivos.
 * [por que] Extraido de PanelNavegador para resolver componente-sin-hook-glory
 * y usestate-excesivo: el componente renderiza, el hook posee estado/efectos. */
import { useEffect, useState } from 'react';
import axios from 'axios';
import type { EntradaArchivo, ListadoDirectorio } from '../shared/types.js';
import { useWorkspaceStore } from './useWorkspace.js';

export interface ArchivoAbierto {
  ruta: string;
  nombre: string;
  binario: boolean;
  contenido: string | null;
}

export function usePanelNavegador() {
  const navegadorRuta = useWorkspaceStore((s) => s.navegadorRuta);
  const consumirNavegadorRuta = useWorkspaceStore((s) => s.consumirNavegadorRuta);
  const [dir, setDir] = useState('');
  const [padre, setPadre] = useState('');
  const [entradas, setEntradas] = useState<EntradaArchivo[]>([]);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<ArchivoAbierto | null>(null);
  const [cargandoArchivo, setCargandoArchivo] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  async function cargarDir(ruta: string) {
    setCargando(true);
    setError(null);
    try {
      const { data } = await axios.get<ListadoDirectorio>('/api/archivos', {
        params: { ruta },
      });
      setDir(data.ruta);
      setPadre(data.padre);
      /* [por que] Fallback defensivo: si la API no incluye 'entradas', la
       * lista queda vacia en lugar de romper con undefined. */
      setEntradas(data.entradas ?? []);
    } catch (err) {
      setError(`no se pudo listar: ${err instanceof Error ? err.message : 'error'}`);
      setEntradas([]);
    } finally {
      setCargando(false);
    }
  }

  async function abrirArchivo(entrada: EntradaArchivo) {
    setCargandoArchivo(true);
    setMensaje(null);
    try {
      const { data } = await axios.get<ArchivoAbierto>('/api/archivos/contenido', {
        params: { ruta: entrada.ruta },
      });
      setAbierto(data);
      if (data.binario) setMensaje('archivo binario: no se puede mostrar como texto');
    } catch (err) {
      setAbierto(null);
      setMensaje(`no se pudo leer: ${err instanceof Error ? err.message : 'error'}`);
    } finally {
      setCargandoArchivo(false);
    }
  }

  /* Al montar, listar la raiz del area (si hay una ruta objetivo pendiente
   * viene de la consola y la gestiona el efecto de abajo). */
  useEffect(() => {
    if (navegadorRuta === null) void cargarDir('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* Cuando la consola pide abrir la carpeta de un proyecto, navegar ahi. */
  useEffect(() => {
    if (navegadorRuta !== null) {
      void cargarDir(navegadorRuta);
      consumirNavegadorRuta();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navegadorRuta]);

  const partes = dir === '' ? [] : dir.split('/');

  return {
    dir,
    padre,
    entradas,
    cargando,
    error,
    abierto,
    cargandoArchivo,
    mensaje,
    cargarDir,
    abrirArchivo,
    partes,
  };
}
