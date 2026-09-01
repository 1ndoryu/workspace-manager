/* Panel central de navegacion de archivos: lista lateral para moverse entre
 * las carpetas del area y visor a la derecha para ver el contenido de un
 * archivo. [por que] El usuario pidio una pagina tipo documentacion pero con
 * la navegacion de carpetas separada de la vista de archivos. La lista
 * cambia de directorio al entrar/salir de carpetas; el visor muestra el
 * archivo seleccionado (texto; los binarios se marcan como no visibles). */
import { Button } from '../Button.js';
import { usePanelNavegador } from '../../hooks/usePanelNavegador.js';
import './paneles.css';

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

export function PanelNavegador() {
  const {
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
  } = usePanelNavegador();

  return (
    <div className="panelDocs" aria-label="Navegación de archivos">
      <div className="panelDocsLista">
        <section className="panelDocsSeccion">
          <header className="panelDocsCabecera">archivos</header>
          <div className="panelDocsEntradas">
            {/* Breadcrumb: raiz + cada segmento; click en uno navega ahi. */}
            <div className="navegadorRuta">
              <Button
                className={`navegadorRutaChip${dir === '' ? ' navegadorRutaChip--activo' : ''}`}
                onClick={() => void cargarDir('')}
              >
                area-trabajo
              </Button>
              {partes.map((seg, i) => {
                const destino = partes.slice(0, i + 1).join('/');
                const activo = i === partes.length - 1;
                return (
                  <span key={destino} className="navegadorRutaSeg">
                    <span className="navegadorRutaSep">/</span>
                    <Button
                      className={`navegadorRutaChip${activo ? ' navegadorRutaChip--activo' : ''}`}
                      onClick={() => void cargarDir(destino)}
                    >
                      {seg}
                    </Button>
                  </span>
                );
              })}
              {padre !== '' && (
                <Button
                  className="navegadorSubir"
                  onClick={() => void cargarDir(padre)}
                  title={`Subir a ${padre === '' ? 'area-trabajo' : padre}`}
                >
                  ↑
                </Button>
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
                  <Button
                    key={e.ruta}
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
                  </Button>
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
