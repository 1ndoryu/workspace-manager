/* Panel lateral izquierdo con el detalle del proyecto seleccionado.
 * [por que] El usuario pidio que al seleccionar una caja NO aparezca un
 * \"cuadro\" sobre ella, sino un panel lateral con la misma estetica de caja
 * del mapa (monocromo, wireframe). La seleccion es estado global del store.
 * [299A-11] Estado en `usePanelDetalle`: el componente renderiza. */
import { usePanelDetalle } from '../../hooks/usePanelDetalle.js';
import { verticesParedDer, verticesParedIzq, verticesTecho } from '../mapa/tiles.js';
import { Button } from '../ui/form/Button.js';
import './detalle.css';

/* Cubo decorativo de la cabecera: la MISMA caja iso del mapa (mismas
 * funciones de vertices) en una celda cualquiera. Asi el panel \"es una caja\n * igual que el mapa\". */
const CUBO = {
  paredDer: verticesParedDer(0, 0),
  paredIzq: verticesParedIzq(0, 0),
  techo: verticesTecho(0, 0),
};

const ETIQUETA_ESTADO: Record<string, string> = {
  repo: 'repo limpio',
  dirty: 'repo con cambios',
  gate: 'repo con gate',
  carpeta: 'carpeta (no git)',
};

export function PanelDetalle() {
  const {
    proyecto,
    seleccionar,
    estado,
    filas,
    resumen,
    resumenAudit,
    analizadoEn,
    auditoriaEn,
    escaneando,
    escanearProyecto,
  } = usePanelDetalle();

  if (!proyecto) return null;

  return (
    <aside className="panelCaja panelDetalle" aria-label={`Detalle de ${proyecto.id}`}>
      <header className="panelCajaCabecera">
        <svg className="panelCajaCubo" viewBox="-19 -21 38 31" aria-hidden="true">
          <polygon points={CUBO.paredDer} />
          <polygon points={CUBO.paredIzq} />
          <polygon points={CUBO.techo} />
        </svg>
        <div className="panelCajaTitulo">
          <div className="panelCajaNombre" title={proyecto.id}>
            {proyecto.id}
          </div>
          <div className="panelCajaSubtitulo">{ETIQUETA_ESTADO[estado]}</div>
        </div>
        {/* [299A-7] Cierre canonico: el unico × del v2 es
         * <Button cuadrado pequeno> (ver Caja.tsx). */}
        <Button
          cuadrado
          pequeno
          onClick={() => seleccionar(null)}
          aria-label="Cerrar detalle"
          title="Cerrar detalle"
        >
          ×
        </Button>
      </header>
      <dl className="panelDetalleFilas">
        {filas.map((f) => (
          <div className="panelDetalleFila" key={f.k}>
            <dt>{f.k}</dt>
            <dd>{f.v}</dd>
          </div>
        ))}
      </dl>

      {/* Un solo 'escanear' por proyecto: analisis (solo con puerta
        * sentinel) + auditoria de dependencias en secuencia. */}
      <div className="panelDetalleScan" aria-label="Escaneo del proyecto">
        <Button
          className="excBoton"
          disabled={escaneando}
          onClick={() => void escanearProyecto(proyecto.clave, proyecto.gate?.puerta === 'sentinel')}
        >
          {escaneando ? 'escaneando…' : 'escanear'}
        </Button>
        {resumen && (
          <div className="panelDetalleScanMeta" title={analizadoEn}>
            {resumen}
          </div>
        )}
        {resumenAudit && (
          <div className="panelDetalleScanMeta" title={auditoriaEn}>
            {resumenAudit}
          </div>
        )}
      </div>
    </aside>
  );
}
