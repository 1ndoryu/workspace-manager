/* Shell v2 del workspace-manager.
 * [por que] Front v2 en monocromo estricto (blanco/negro, sin radios, sin
 * sombras, sin bold). Layout: detalle (izquierda, aparece al seleccionar),
 * mapa (centro) y lista (derecha), con divisores arrastrables para cambiar
 * el ancho, y una consola de problemas abajo (alto tambien arrastrable).
 * Anchos/alto se persisten en localStorage igual que zoom/pan y seleccion. */
import { useEffect, useState, type CSSProperties } from 'react';
import { useWorkspaceStore } from '../hooks/useWorkspace.js';
import { MapaV2 } from './mapa/MapaV2.js';
import { PanelConsola } from './paneles/PanelConsola.js';
import { PanelDetalle } from './paneles/PanelDetalle.js';
import { PanelLista } from './paneles/PanelLista.js';
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

  const conDetalle = seleccionadoId !== null && snapshot !== null;

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
        {error && <div className="v2Error">{error}</div>}
        {!snapshot && cargando && <div className="v2Cargando">Cargando workspace…</div>}
        {!snapshot && !cargando && !error && <div className="v2Cargando">Sin datos. Reintenta.</div>}
        {snapshot && (
          <>
            <div className="v2Columnas">
              {conDetalle && <PanelDetalle />}
              {conDetalle && (
                <Resizer
                  orientacion="vertical"
                  ariaLabel="Ajustar ancho del panel de detalle"
                  onArrastrar={(dx) =>
                    setAnchoDetalle((a) => Math.min(MAX_ANCHO, Math.max(MIN_ANCHO, a + dx)))
                  }
                />
              )}
              <div className="v2MapaMarco">
                <MapaV2 />
              </div>
              <Resizer
                orientacion="vertical"
                ariaLabel="Ajustar ancho del panel de lista"
                onArrastrar={(dx) =>
                  setAnchoLista((a) => Math.min(MAX_ANCHO, Math.max(MIN_ANCHO, a - dx)))
                }
              />
              <PanelLista />
            </div>
            <Resizer
              orientacion="horizontal"
              ariaLabel="Ajustar alto de la consola"
              onArrastrar={(_dx, dy) =>
                setAltoConsola((a) => Math.min(MAX_ALTO, Math.max(MIN_ALTO, a - dy)))
              }
            />
            <PanelConsola />
          </>
        )}
      </main>
    </div>
  );
}
