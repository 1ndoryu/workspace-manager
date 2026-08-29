/* Shell v2 del workspace-manager.
 * [por que] Front v2 en monocromo estricto (blanco/negro, sin radios, sin
 * sombras, sin bold). Nav superior: menu para cambiar el panel central
 * (mapa / documentacion / repos) y botones de visibilidad de los paneles
 * laterales y la consola. Detalle (izquierda), central, lista (derecha) y
 * consola (abajo) con divisores arrastrables; anchos/alto y la UI del nav
 * se persisten en localStorage. */
import { useEffect, useState, type CSSProperties } from 'react';
import { useWorkspaceStore } from '../hooks/useWorkspace.js';
import { MapaV2 } from './mapa/MapaV2.js';
import { NavBar } from './NavBar.js';
import { PanelConsola } from './paneles/PanelConsola.js';
import { PanelDetalle } from './paneles/PanelDetalle.js';
import { PanelDocs } from './paneles/PanelDocs.js';
import { PanelLista } from './paneles/PanelLista.js';
import { PanelRepos } from './paneles/PanelRepos.js';
import { Resizer } from './Resizer.js';
import './styles/v2.css';

interface LayoutGuardado {
  anchoDetalle: number;
  anchoLista: number;
  altoConsola: number;
}

const CLAVE_LAYOUT = 'workspaceManager:layout';
const LAYOUT_DEFECTO: LayoutGuardado = { anchoDetalle: 300, anchoLista: 260, altoConsola: 200 };

const MIN_ANCHO = 160;
const MAX_ANCHO = 600;
const MIN_ALTO = 120;
const MAX_ALTO = 500;

function layoutGuardado(): LayoutGuardado {
  try {
    const raw = localStorage.getItem(CLAVE_LAYOUT);
    if (!raw) return LAYOUT_DEFECTO;
    const d = JSON.parse(raw) as Partial<LayoutGuardado>;
    if (
      typeof d.anchoDetalle !== 'number' ||
      typeof d.anchoLista !== 'number' ||
      typeof d.altoConsola !== 'number'
    ) {
      return LAYOUT_DEFECTO;
    }
    return { anchoDetalle: d.anchoDetalle, anchoLista: d.anchoLista, altoConsola: d.altoConsola };
  } catch (err) {
    console.warn('[appV2] no se pudo leer el layout guardado:', err);
    return LAYOUT_DEFECTO;
  }
}

/* Leido una sola vez por carga de pagina para inicializar el layout. */
const layoutInicial = layoutGuardado();

export function AppV2() {
  const cargar = useWorkspaceStore((s) => s.cargar);
  const snapshot = useWorkspaceStore((s) => s.snapshot);
  const cargando = useWorkspaceStore((s) => s.cargando);
  const error = useWorkspaceStore((s) => s.error);
  const seleccionadoId = useWorkspaceStore((s) => s.proyectoSeleccionado);
  const panelCentral = useWorkspaceStore((s) => s.panelCentral);
  const visibles = useWorkspaceStore((s) => s.visibles);

  const [anchoDetalle, setAnchoDetalle] = useState(layoutInicial.anchoDetalle);
  const [anchoLista, setAnchoLista] = useState(layoutInicial.anchoLista);
  const [altoConsola, setAltoConsola] = useState(layoutInicial.altoConsola);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  /* Persiste el layout en cada cambio para sobrevivir a recargas. */
  useEffect(() => {
    try {
      localStorage.setItem(
        CLAVE_LAYOUT,
        JSON.stringify({ anchoDetalle, anchoLista, altoConsola } satisfies LayoutGuardado),
      );
    } catch (err) {
      console.warn('[appV2] no se pudo guardar el layout:', err);
    }
  }, [anchoDetalle, anchoLista, altoConsola]);

  const conDetalle = seleccionadoId !== null && snapshot !== null && visibles.detalle;

  const panelCentralRender = {
    mapa: <MapaV2 />,
    docs: <PanelDocs />,
    repos: <PanelRepos />,
  }[panelCentral];

  /* [por que] El marco con borde solo envuelve al mapa (el usuario pidio el
   * mapa dentro de un cuadro). En docs y repos cada panel interno es su
   * propia caja (lista y visor en docs; cabecera+contenido en repos), asi
   * que el contenedor no lleva borde exterior. */
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
                onArrastrar={(_dx, dy) =>
                  setAltoConsola((a) => Math.min(MAX_ALTO, Math.max(MIN_ALTO, a - dy)))
                }
              />
            )}
            {visibles.consola && <PanelConsola />}
          </>
        )}
      </main>
    </div>
  );
}
