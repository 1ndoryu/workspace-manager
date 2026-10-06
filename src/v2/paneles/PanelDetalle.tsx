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

/* Etiquetas del mando dev (05AA-4): mismas 4 acciones que la consola
 * (BOTONES_DEV en PanelConsola.tsx, canonico). Duplicado intencional de
 * 4 literales estaticos para no crear modulo compartido por esto. */
const BOTONES_DETALLE_DEV = [
  { accion: 'up', etiqueta: 'arrancar', titulo: 'dev up: verifica o arranca (nunca duplica)' },
  { accion: 'stop', etiqueta: 'detener', titulo: 'dev stop: solo propio no-protegido (nunca 8787/5174/5175)' },
  { accion: 'logs', etiqueta: 'bitácora', titulo: 'dev logs: ultimas 50 lineas del arranque' },
  { accion: 'open', etiqueta: 'abrir', titulo: 'dev open: abre las URLs servidas' },
] as const;

const ETIQUETA_DEV: Record<string, string> = {
  'bajo-mando': 'en marcha',
  parado: 'detenido',
  deriva: 'deriva',
};

export function PanelDetalle() {
  const {
    proyecto,
    seleccionar,
    estado,
    filas,
    devInfo,
    devOcupado,
    accionDev,
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
      {/* Mando dev PEGADO a la cabecera [05AA-4]: al clicar la caja los
        * botones quedan los primeros, arriba de la seccion. Solo con
        * entrada (id); sin-boton/no-aplica no operan y no muestran
        * seccion. */}
      {devInfo ? (
        <div className="panelDetalleDev" aria-label="Mando dev del proyecto">
          <div className="panelDetalleDevEstado" title={devInfo.motivo}>
            dev: {ETIQUETA_DEV[devInfo.estado] ?? devInfo.estado} · {devInfo.motivo}
          </div>
          <div className="panelDetalleDevBotones">
            {BOTONES_DETALLE_DEV.map((b) => (
              <Button
                key={b.accion}
                pequeno
                onClick={() => void accionDev(b.accion, devInfo.id as string)}
                disabled={devOcupado}
                title={b.titulo}
              >
                {devOcupado ? '…' : b.etiqueta}
              </Button>
            ))}
          </div>
        </div>
      ) : null}
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
