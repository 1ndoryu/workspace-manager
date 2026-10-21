/* Shell v2 del workspace-manager.
 * [por que] Front v2 en monocromo estricto (blanco/negro, sin radios, sin
 * sombras, sin bold). Nav superior: menu para cambiar el panel central
 * (mapa / documentacion / repos) y botones de visibilidad de los paneles
 * laterales y la consola. Detalle (izquierda), central, lista (derecha) y
 * consola (abajo) con divisores arrastrables; anchos/alto y la UI del nav
 * se persisten en localStorage. */
import { useEffect, type CSSProperties } from 'react';
import { useWorkspaceStore } from '../hooks/useWorkspace.js';
import { abrirCanal } from './canal/canalEventos.js';
import { MapaV2 } from './mapa/MapaV2.js';
import { useLayoutV2, MAX_ANCHO, MAX_ALTO, MIN_ANCHO, MIN_ALTO } from './useLayoutV2.js';
import { NavBar } from './ui/menu/NavBar.js';
import { PanelConsola } from './paneles/consola/PanelConsola.js';
import { PanelDetalle } from './paneles/PanelDetalle.js';
import { PanelDocs } from './paneles/PanelDocs.js';
import { PanelConfig } from './paneles/config/PanelConfig.js';
import { PanelSentinel } from './paneles/sentinel/PanelSentinel.js';
import { PanelGuardian } from './paneles/guardian/PanelGuardian.js';
import { PanelLista } from './paneles/PanelLista.js';
import { PanelNavegador } from './paneles/PanelNavegador.js';
import { PanelPc } from './paneles/PanelPc.js';
import { MenuContextual } from './ui/menu/MenuContextual.js';
import { PanelRepos } from './paneles/PanelRepos.js';
import { PanelTareas } from './paneles/tareas/PanelTareas.js';
import { PanelVps } from './paneles/vps/PanelVps.js';
import { PanelTaller } from './paneles/taller/PanelTaller.js';
import { Resizer } from './ui/overlay/Resizer.js';
import { Toaster } from './ui/overlay/Toaster.js';
import './styles/v2.css';

export function AppV2() {
  const cargar = useWorkspaceStore((s) => s.cargar);
  const cargarAnalisis = useWorkspaceStore((s) => s.cargarAnalisis);
  const cargarVulnerabilidades = useWorkspaceStore((s) => s.cargarVulnerabilidades);
  const cargarSalud = useWorkspaceStore((s) => s.cargarSalud);
  const snapshot = useWorkspaceStore((s) => s.snapshot);
  const cargando = useWorkspaceStore((s) => s.cargando);
  const error = useWorkspaceStore((s) => s.error);
  const seleccionadoId = useWorkspaceStore((s) => s.proyectoSeleccionado);
  const panelCentral = useWorkspaceStore((s) => s.panelCentral);
  const visibles = useWorkspaceStore((s) => s.visibles);

  const { anchoDetalle, setAnchoDetalle, anchoLista, setAnchoLista, altoConsola, setAltoConsola } =
    useLayoutV2();

  useEffect(() => {
    void cargar();
    /* Rehidrata la info de analisis y vulnerabilidades guardada del server
     * (no se pierde al recargar). Se lanzan en paralelo a cargar(). */
    void cargarAnalisis();
    void cargarVulnerabilidades();
    void cargarSalud();
  }, [cargar, cargarAnalisis, cargarVulnerabilidades, cargarSalud]);

  /* Canal vivo del tablero (20AA-24 F3.2): una sola conexión por pestaña. El tema `workspace`
   * sustituye al snapshot cargado una vez al montar —hasta ahora la única forma de ver un cambio
   * hecho fuera del tablero era recargar— y el tema `vivos` alimenta el mapa y la lista. Al
   * reabrirse tras un corte o al volver la pestaña, el servidor ya mandó lo que faltaba.
   * [por que se lee el store con `getState`] El efecto corre una vez: suscribirse a `cargar` volvería
   * a abrir el canal en cada cambio de identidad sin ganar nada. */
  useEffect(() => {
    const canal = abrirCanal({
      workspace: (snapshot) => useWorkspaceStore.setState({ snapshot, cargando: false, desdeCache: false }),
      vivos: (vivos) => useWorkspaceStore.getState().aplicarVivos(vivos.laptop, vivos.produccion),
      /* Un corte pudo dejar un cambio sin ver: se pide la foto de ahora sin abrir otro canal.
       * [20AA-24 F4] Análisis, vulnerabilidades y salud no viajan en el tema `workspace` (son
       * caros y cambian poco), así que sólo se refrescaban al montar: se revalidan junto al
       * snapshot cada vez que la pestaña vuelve o el canal reconecta. */
      alVolver: () => {
        const s = useWorkspaceStore.getState();
        void s.cargar();
        void s.cargarAnalisis();
        void s.cargarVulnerabilidades();
        void s.cargarSalud();
      },
    });
    return () => canal.cerrar();
  }, []);

  const conDetalle = seleccionadoId !== null && snapshot !== null && visibles.detalle;

  const panelCentralRender = {
    mapa: <MapaV2 />,
    docs: <PanelDocs />,
    repos: <PanelRepos />,
    tareas: <PanelTareas />,
    navegador: <PanelNavegador />,
    config: <PanelConfig />,
    sentinel: <PanelSentinel />,
    guardian: <PanelGuardian />,
    pc: <PanelPc />,
    vps: <PanelVps />,
    taller: <PanelTaller />,
  }[panelCentral];

  /* [por que] El marco con borde solo envuelve al mapa (el usuario pidio el
   * mapa dentro de un cuadro). En docs, repos y vps cada panel es una `Caja`
   * externa (primitiva central en ui/caja/Caja.tsx; las subdivisiones dentro de
   * una Caja son `Seccion`, panel interno sin borde), asi que el contenedor
   * no lleva borde exterior. */
  const claseCentral =
    panelCentral === 'mapa' ? 'v2CentralMarco' : 'v2CentralMarco v2CentralMarco--contenido';

  return (
    <div
      className="v2App"
      style={
        {
          '--ancho-detalle': `${anchoDetalle}px`,
          '--ancho-lista': `${anchoLista}px`,
          '--alto-consola': `${altoConsola}px`,
        } as CSSProperties
      }
    >
      <main className="v2Contenido">
        {/* [por que] Un unico h1 oculto a la vista: da a lectores de pantalla el titulo
         * de la pagina sin cambiar la apariencia. */}
        <h1 className="v2SoloLector">Workspace Manager</h1>
        {/* [por que] Nav dentro del contenido (con el padding del marco) para
         * que quede alineado con los demas paneles y sea un panel con caja,
         * no una barra pegada al borde superior. */}
        <NavBar />
        {error && <div className="v2Error">{error}</div>}
        {!snapshot && cargando && <div className="v2Cargando">Cargando workspace…</div>}
        {!snapshot && !cargando && !error && <div className="v2Cargando">Sin datos. Reintenta.</div>}
        {snapshot && (
          <>
            <div className="v2Columnas">
              {/* [por que] Detalle y lista solo existen en el modo mapa; en
               * documentacion y repos no se renderizan aunque el estado de
               * visibilidad persistido los tenga activos. */}
              {panelCentral === 'mapa' && visibles.detalle && seleccionadoId !== null && (
                <PanelDetalle />
              )}
              {panelCentral === 'mapa' && visibles.detalle && seleccionadoId !== null && (
                <Resizer
                  orientacion="vertical"
                  ariaLabel="Ajustar ancho del panel de detalle"
                  valor={anchoDetalle}
                  min={MIN_ANCHO}
                  max={MAX_ANCHO}
                  onArrastrar={(dx) =>
                    setAnchoDetalle((a) => Math.min(MAX_ANCHO, Math.max(MIN_ANCHO, a + dx)))
                  }
                />
              )}
              <div className={claseCentral}>{panelCentralRender}</div>
              {panelCentral === 'mapa' && visibles.lista && (
                <Resizer
                  orientacion="vertical"
                  ariaLabel="Ajustar ancho del panel de lista"
                  valor={anchoLista}
                  min={MIN_ANCHO}
                  max={MAX_ANCHO}
                  onArrastrar={(dx) =>
                    setAnchoLista((a) => Math.min(MAX_ANCHO, Math.max(MIN_ANCHO, a - dx)))
                  }
                />
              )}
              {panelCentral === 'mapa' && visibles.lista && <PanelLista />}
            </div>
            {visibles.consola && (
              <Resizer
                orientacion="horizontal"
                ariaLabel="Ajustar alto de la consola"
                valor={altoConsola}
                min={MIN_ALTO}
                max={MAX_ALTO}
                onArrastrar={(_dx, dy) =>
                  setAltoConsola((a) => Math.min(MAX_ALTO, Math.max(MIN_ALTO, a - dy)))
                }
              />
            )}
            {visibles.consola && <PanelConsola />}
          </>
        )}
      </main>
      <MenuContextual />
      {/* [por que] Toaster fuera del main para que no se vea afectado por
       * el scroll ni el padding del contenido; flota por encima de todo. */}
      <Toaster />
    </div>
  );
}
