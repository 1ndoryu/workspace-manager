/* Panel central de navegacion de archivos: lista lateral para moverse entre
 * las carpetas del area y visor a la derecha para ver el contenido de un
 * archivo. [por que] El usuario pidio una pagina tipo documentacion pero con
 * la navegacion de carpetas separada de la vista de archivos. La lista
 * cambia de directorio al entrar/salir de carpetas; el visor muestra el
 * archivo seleccionado (texto; los binarios se marcan como no visibles). */
import { useEffect, useState } from 'react';
import axios from 'axios';
import type { EntradaArchivo, ListadoDirectorio } from '../../shared/types.js';
import { useWorkspaceStore } from '../../hooks/useWorkspace.js';
import './paneles.css';

interface ArchivoAbierto {
  ruta: string;
  nombre: string;
  binario: boolean;
  contenido: string | null;
}

/* Extensiones de texto conocidas; el resto se intenta leer igual y el
 * servidor detecta binarios por byte NUL. */
function esArchivoTexto(nombre: string): boolean {
  return /\.(md|txt|ts|tsx|js|jsx|json|css|html|rs|toml|yml|yaml|py|sh|ps1|bat|mjs|cjs|xml|svg|env|gitignore)$/i.test(
    nombre,
  ) || ['AGENTS.md', 'README.md', 'package.json'].includes(nombre);
}

function formatearTamano(bytes: number | null): string {
  if (bytes === null) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* Convierte una ruta relativa ('a/b/c') en segmentos para el breadcrumb. */
function segmentos(ruta: string): string[] {
  return ruta === '' ? [] : ruta.split('/');
}

export function PanelNavegador() {
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

  const partes = segmentos(dir);

  return (
    <div className="panelDocs" aria-label="Navegación de archivos">
      <div className="panelDocsLista">
        <section className="panelDocsSeccion">
          <header className="panelDocsCabecera">archivos</header>
          <div className="panelDocsEntradas">
            {/* Breadcrumb: raiz + cada segmento; click en uno navega ahi. */}
            <div className="navegadorRuta">
              <button
                type="button"
                className={`navegadorRutaChip${dir === '' ? ' navegadorRutaChip--activo' : ''}`}
                onClick={() => void cargarDir('')}
              >
                area-trabajo
              </button>
              {partes.map((seg, i) => {
                const destino = partes.slice(0, i + 1).join('/');
                const activo = i === partes.length - 1;
                return (
                  <span key={destino} className="navegadorRutaSeg">
                    <span className="navegadorRutaSep">/</span>
                    <button
                      type="button"
                      className={`navegadorRutaChip${activo ? ' navegadorRutaChip--activo' : ''}`}
                      onClick={() => void cargarDir(destino)}
                    >
                      {seg}
                    </button>
                  </span>
                );
              })}
              {padre !== '' && (
                <button
                  type="button"
                  className="navegadorSubir"
                  onClick={() => void cargarDir(padre)}
                  title={`Subir a ${padre === '' ? 'area-trabajo' : padre}`}
                >
                  ↑
                </button>
              )}
            </div>
            {cargando && <div className="docsVacio">cargando…</div>}
            {!cargando && error && <div className="docsVacio">{error}</div>}
            {!cargando && !error && entradas.length === 0 && (
              <div className="docsVacio">carpeta vacía</div>
            )}
            {!cargando &&
              !error &&
              entradas.map((e) => {
                const activa = abierto !== null && e.tipo === 'archivo' && e.ruta === abierto.ruta;
                return (
                  <button
                    key={e.ruta}
                    type="button"
                    className={`navegadorFila${activa ? ' navegadorFila--activa' : ''}`}
                    onClick={() => {
                      if (e.tipo === 'carpeta') void cargarDir(e.ruta);
                      else void abrirArchivo(e);
                    }}
                    title={e.tipo === 'carpeta' ? `Abrir ${e.nombre}` : `Ver ${e.nombre}`}
                  >
                    <span className="navegadorFilaEtiqueta">
                      {e.tipo === 'carpeta' ? 'dir' : esArchivoTexto(e.nombre) ? 'txt' : 'bin'}
                    </span>
                    <span className="docsFilaNombre">{e.nombre}</span>
                    <span className="docsFilaMeta">{formatearTamano(e.tamano)}</span>
                  </button>
                );
              })}
          </div>
        </section>
      </div>
      <div className="panelDocsContenido">
        {!abierto && !cargandoArchivo && <div className="docsVacio">elige un archivo para verlo</div>}
        {cargandoArchivo && <div className="docsVacio">cargando…</div>}
        {!cargandoArchivo && abierto && (
          <>
            <header className="panelDocsVisorCabecera">
              <span className="panelDocsVisorTitulo">{abierto.nombre}</span>
              <span className="panelDocsVisorMeta">{abierto.ruta}</span>
              {mensaje && <span className="docsMensaje">{mensaje}</span>}
            </header>
            {abierto.binario || abierto.contenido === null ? (
              <div className="docsVacio">
                archivo binario o no legible — no se puede mostrar como texto
              </div>
            ) : (
              <pre className="panelDocsPre">{abierto.contenido}</pre>
            )}
          </>
        )}
      </div>
    </div>
  );
}
