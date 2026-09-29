/* Panel de repositorios: estados de los repos (git/github) desde el
 * snapshot, sin llamadas extra al server.
 * [por que] El usuario pidio un panel central para ver los estados de los
 * repositorios: remoto, rama, push pendiente (ahead/behind), dirty y ultimo
 * commit. El remoto github se enlaza para abrirlo.
 * [299A-7] Dos CAJAS externas (primitiva `Caja`) en `.cajaFila`: la lista
 * (titulo + meta + ⟳ canonico) y el lateral del diff (solo al elegir
 * archivo, con × que limpia la eleccion; al cerrarse, la lista se expande
 * por flex). Sin cabeceras ni botones ad-hoc. */
import { useMemo, useState } from 'react';
import { useWorkspaceStore } from '../../hooks/useWorkspace.js';
import type { DetalleRepoSync, Proyecto } from '../../shared/types.js';
import { archivosRepo, detalleRepo, invalidarDetallesRepos } from '../repos/apiRepos.js';
import { separarEntradas } from '../repos/gitDiff.js';
import { Button } from '../ui/Button.js';
import { Caja } from '../ui/Caja.js';
import { DetalleRepo, fechaCorta, type StatsArchivo } from './DetalleRepo.js';
import { PanelCambiosRepo } from './PanelCambiosRepo.js';
import './paneles.css';

/* Extrae el nombre corto "org/repo" de una URL de remoto para el enlace.
 * [por que] github.com es redundante en la etiqueta (el href ya lleva la URL
 * completa y el icono/dominio se sobreentiende); se conserva el host cuando
 * el remoto NO es de GitHub para que el enlace siga siendo identificable. */
function remotoCorto(remoto: string): string {
  const limpia = remoto
    .replace(/^git@[^:]+:/, '')
    .replace(/^https?:\/\//, '')
    .replace(/\.git$/, '');
  return limpia.replace(/^(www\.)?github\.com\//, '');
}

export function PanelRepos() {
  const snapshot = useWorkspaceStore((s) => s.snapshot);
  const seleccionadoId = useWorkspaceStore((s) => s.proyectoSeleccionado);
  const seleccionar = useWorkspaceStore((s) => s.seleccionar);
  /* [por que] El snapshot se sirve cacheado (desdeCache) y solo se re-escanea
   * pidiendo forzar=1; sin boton, el panel quedaba desactualizado tras un
   * cambio en disco (p. ej. rama/remote) hasta recargar la pagina. */
  const cargar = useWorkspaceStore((s) => s.cargar);
  const cargando = useWorkspaceStore((s) => s.cargando);
  const desdeCache = useWorkspaceStore((s) => s.desdeCache);

  /* Orden: primero los que tienen algo (dirty/por subir/por traer), al
   * final los sin cambios (además atenuados); dentro de cada grupo por
   * fecha del último commit descendente, sin fecha al final. [por que] Lo
   * pide el usuario: lo activo arriba, lo quieto abajo. Límite honesto: el
   * snapshot no trae mtime del árbol de trabajo, así que un repo dirty con
   * commit viejo no "flota" por ensuciarse. */
  function conAlgo(p: Proyecto): boolean {
    const g = p.git;
    return !!g && (g.dirty || g.ahead > 0 || g.behind > 0);
  }
  const repos = useMemo(() => {
    if (!snapshot) return [];
    const porFecha = (a: Proyecto, b: Proyecto) => {
      const fa = a.git?.ultimoCommit?.fecha ?? '';
      const fb = b.git?.ultimoCommit?.fecha ?? '';
      if (fa !== fb) return fb.localeCompare(fa);
      return a.id.localeCompare(b.id);
    };
    const git = [...snapshot.proyectos].filter((p) => p.esGit && p.git);
    return [...git.filter(conAlgo).sort(porFecha), ...git.filter((p) => !conAlgo(p)).sort(porFecha)];
  }, [snapshot]);

  /* Acordeon estricto (289A-6): una sola expandida (por id) o ninguna; el
   * detalle se pide bajo demanda y se cachea por clave hasta el recargar. */
  const [expandida, setExpandida] = useState<string | null>(null);
  const [detalles, setDetalles] = useState<Record<string, DetalleRepoSync>>({});
  const [cargandoClave, setCargandoClave] = useState<string | null>(null);
  const [errorClave, setErrorClave] = useState<string | null>(null);
  /* Lista única clicable (299A-4): el archivo elegido en el acordeón abre
   * su diff en el lateral; sin archivo elegido no hay lateral. */
  const [archivoSel, setArchivoSel] = useState<{ clave: string; ruta: string } | null>(null);
  /* Numeración +N −M de la lista: viene del endpoint de archivos (el
   * detalle no trae stats); se pide al expandir y se cachea por clave. */
  const [stats, setStats] = useState<{ clave: string; mapa: Record<string, StatsArchivo> } | null>(
    null,
  );

  /* Trae la numeración sin bloquear el acordeón: si el usuario plegó o
   * cambió de repo antes de que llegue, el mapa se guarda igual por clave
   * y solo se muestra si coincide con la expandida. */
  function pedirStats(clave: string) {
    archivosRepo(clave).then(
      (d) => {
        /* Las entradas no traen stats: se derivan de los patches ya
         * repartidos por ruta (staged + changes se suman por archivo). */
        const grupos = separarEntradas(d.entradas, d.diffStaged, d.diffUnstaged);
        const mapa: Record<string, StatsArchivo> = {};
        for (const a of [...grupos.staged, ...grupos.changes]) {
          const previo = mapa[a.ruta];
          mapa[a.ruta] = {
            adds: (previo?.adds ?? 0) + a.adiciones,
            dels: (previo?.dels ?? 0) + a.eliminaciones,
          };
        }
        setStats({ clave, mapa });
      },
      () => {},
    );
  }

  /* El detalle dice si hay algo que mostrar (289A-6): por subir, por
   * traer o sin commitear. Vacio = la fila no se expande, ni mensaje. */
  function tieneContenido(d: DetalleRepoSync): boolean {
    if (d.locales.archivos.length > 0) return true;
    if (d.sinUpstream) return false;
    return d.salientes.commits.length > 0 || d.entrantes.commits.length > 0;
  }

  async function alternar(id: string, clave: string) {
    if (expandida === id) {
      setExpandida(null);
      if (archivoSel?.clave === clave) setArchivoSel(null);
      return;
    }
    seleccionar(id);
    setErrorClave(null);
    const conocido = detalles[clave];
    if (conocido) {
      if (tieneContenido(conocido)) {
        setExpandida(id);
        if (conocido.locales.archivos.length > 0) pedirStats(clave);
      }
      return;
    }
    /* Primero se trae el detalle y solo se expande si hay algo: al día
     * = no se abre nada. El error sí se muestra (no es "vacío"). */
    setCargandoClave(clave);
    try {
      const d = await detalleRepo(clave);
      setDetalles((prev) => ({ ...prev, [clave]: d }));
      if (tieneContenido(d)) {
        setExpandida(id);
        if (d.locales.archivos.length > 0) pedirStats(clave);
      }
    } catch {
      setErrorClave(clave);
      setExpandida(id);
    } finally {
      setCargandoClave(null);
    }
  }

  /* Clic en un archivo de la lista: abre su diff; segundo clic lo cierra.
   * Cambiar de repo limpia la elección anterior. */
  function elegirArchivo(clave: string, ruta: string) {
    setArchivoSel((prev) => (prev?.clave === clave && prev.ruta === ruta ? null : { clave, ruta }));
  }

  function recargar() {
    setExpandida(null);
    setDetalles({});
    setErrorClave(null);
    setArchivoSel(null);
    setStats(null);
    invalidarDetallesRepos();
    cargar(true);
  }

  if (!snapshot) return null;

  const conRemoto = repos.filter((p) => p.git?.remoto).length;
  const conPush = repos.filter((p) => (p.git?.ahead ?? 0) > 0).length;

  /* Lateral solo-diff (299A-4): aparece al elegir un archivo de la lista
   * del repo expandido; es el visor, la lista única vive en el acordeón. */
  const lateralArchivo =
    archivoSel && expandida && repos.some((p) => p.id === expandida && p.clave === archivoSel.clave)
      ? archivoSel
      : null;

  return (
    <div className="cajaFila">
      <Caja
        titulo={`repositorios (${repos.length})`}
        meta={`${conRemoto} con remoto · ${conPush} con push pendiente${desdeCache ? ' · desde caché' : ''}`}
        className="panelReposCajaLista"
        etiqueta="Estados de los repositorios"
        acciones={
          <Button pequeno onClick={recargar} disabled={cargando} title="Re-escanea los repositorios (ignora la caché)">
            {cargando ? '…' : '⟳ recargar'}
          </Button>
        }
      >
        {repos.length === 0 && <div className="docsVacio">no hay repositorios</div>}
        {repos.map((p) => {
          const g = p.git!;
          const seleccionado = p.id === seleccionadoId;
          const abierta = expandida === p.id;
          /* Total sin commitear para el badge ~N de la fila (conteo ya
           * disponible en el snapshot, sin pedir el detalle). */
          const sinCommitear = g.cambios.staged + g.cambios.unstaged + g.cambios.untracked;
          /* Sin cambios = limpio y al día (nada que subir/traer/commitear):
           * opacidad reducida para no distraer; la seleccionada se mantiene
           * plena para que siga legible. */
          const sinCambios = !g.dirty && g.ahead === 0 && g.behind === 0;
          const detalle = detalles[p.clave];
          return (
            <div key={p.id} className="reposGrupo">
              <button
                type="button"
                className={`reposFila${seleccionado ? ' reposFila--seleccionada' : ''}${abierta ? ' reposFila--abierta' : ''}${sinCambios && !seleccionado ? ' reposFila--sin-cambios' : ''}`}
                onClick={() => alternar(p.id, p.clave)}
                title={`${p.ruta} — clic para ${abierta ? 'plegar' : 'ver cambios (si los hay)'}`}
                aria-expanded={abierta}
              >
                <span className="reposFilaNombre">{p.id}</span>
                <span className="reposFilaRama">{g.rama}</span>
                <span className="reposFilaPush">
                  {g.ahead > 0 ? `${g.ahead}↑` : '·'}
                  {g.behind > 0 ? `${g.behind}↓` : ''}
                  {sinCommitear > 0 ? ` ~${sinCommitear}` : ''}
                  {cargandoClave === p.clave ? ' …' : ''}
                </span>
                <span className="reposFilaDirty" aria-label={g.dirty ? 'con cambios' : 'limpio'}>
                  {g.dirty ? 'dirty' : 'limpio'}
                </span>
                <span className="reposFilaCommit">
                  {g.ultimoCommit ? g.ultimoCommit.hash.slice(0, 7) : '—'}
                </span>
                <span className="reposFilaFecha" title={g.ultimoCommit?.mensaje ?? 'sin commits'}>
                  {g.ultimoCommit ? fechaCorta(g.ultimoCommit.fecha) : '—'}
                </span>
                {g.remoto ? (
                  <a
                    className="reposFilaRemoto"
                    href={g.remoto}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(ev) => ev.stopPropagation()}
                    title={g.remoto}
                  >
                    {remotoCorto(g.remoto)}
                  </a>
                ) : (
                  <span className="reposFilaRemoto reposFilaRemoto--sin">sin remoto</span>
                )}
              </button>
              {abierta && (
                <div className="reposDetalleContenedor">
                  {detalle ? (
                    <DetalleRepo
                      detalle={detalle}
                      archivoSeleccionado={archivoSel?.clave === p.clave ? archivoSel.ruta : null}
                      alElegirArchivo={(ruta) => elegirArchivo(p.clave, ruta)}
                      stats={stats?.clave === p.clave ? stats.mapa : undefined}
                    />
                  ) : errorClave === p.clave ? (
                    <div className="docsVacio">no se pudo leer el detalle (¿repo con bloqueo?)</div>
                  ) : (
                    <div className="docsVacio">{cargandoClave === p.clave ? 'leyendo cambios…' : '…'}</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </Caja>
      {lateralArchivo && (
        <Caja
          titulo={lateralArchivo.ruta}
          className="panelReposCajaLateral"
          etiqueta={`Diff de ${lateralArchivo.ruta}`}
          onCerrar={() => setArchivoSel(null)}
          cerrarTitulo="cerrar el diff"
        >
          <PanelCambiosRepo key={lateralArchivo.clave} clave={lateralArchivo.clave} ruta={lateralArchivo.ruta} />
        </Caja>
      )}
    </div>
  );
}
