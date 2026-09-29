/* Vista 'scan' del PanelConfig: config del auto-escaneo + un solo boton
 * 'escanear' (analisis + vulnerabilidades) con sus resumenes.
 * [por que] Salio de PanelConfig.tsx para que el componente quede bajo el
 * limite-lineas (300): recibe el paquete `datos` del hook, sin logica propia. */
import { Button } from '../../ui/form/Button.js';
import type { DatosPanelConfig } from './usePanelConfig.js';

export function VistaScan({ datos }: { datos: DatosPanelConfig }) {
  const {
    auto, setAuto, intervalo, setIntervalo, scanOcupado, scanAviso,
    escanearTodoUnificado, analisis, vulnerabilidades,
    totales, tVuln, tieneVuln, ultimaActualizacion,
    guardarScan,
  } = datos;

  return (
    /* [299A-7] Sin cabecera propia: el titulo vive en la Caja contenido
     * de PanelConfig (panelDocsVisor* no tenia estilo). */
    <>
      <section className="scanCfg" aria-label="Escaneo">
        <div className="scanCfgFila">
          <label className="scanCfgEtiqueta" htmlFor="scan-auto">
            análisis automático
          </label>
          <input
            id="scan-auto"
            type="checkbox"
            className="scanCfgCheck"
            checked={auto}
            onChange={(ev) => {
              const v = ev.target.checked;
              setAuto(v);
              guardarScan(v, intervalo);
            }}
          />
          <span className="scanCfgIntervalo">cada</span>
          <input
            type="number"
            className="scanCfgNum"
            min={1}
            max={1440}
            value={intervalo}
            disabled={!auto}
            onChange={(ev) => setIntervalo(Number(ev.target.value) || 30)}
            onBlur={() => guardarScan(auto, intervalo)}
          />
          <span className="scanCfgIntervalo">min</span>
        </div>
        <div className="scanCfgAcciones">
          {/* Un solo 'escanear': analisis + vulnerabilidades en secuencia.
            * [por que] El usuario pidio unificar ambos botones; el detalle
            * por herramienta sigue abajo en sus resumenes. */}
          <Button
            className="excBoton"
            onClick={() => void escanearTodoUnificado()}
            disabled={scanOcupado}
          >
            {scanOcupado ? 'escaneando…' : 'escanear'}
          </Button>
          <span
            className="scanCfgMeta"
            title={Object.entries(analisis)
              .map(([k, a]) => `${k}: ${a.estado}`)
              .join('\n')}
          >
            {Object.keys(analisis).length} analizados · {Object.keys(vulnerabilidades).length} auditados
          </span>
        </div>
        {(totales.error > 0 || totales.warning > 0) && (
          <div className="scanCfgResumen">
            <span className="scanCfgBadge scanCfgBadge--error">{totales.error} error{totales.error === 1 ? '' : 'es'}</span>
            <span className="scanCfgBadge scanCfgBadge--warn">{totales.warning} aviso{totales.warning === 1 ? '' : 's'}</span>
            {ultimaActualizacion > 0 && (
              <span className="scanCfgMeta">última: {new Date(ultimaActualizacion).toLocaleTimeString()}</span>
            )}
          </div>
        )}
        {scanAviso && <div className="scanCfgAviso">{scanAviso}</div>}

        {/* Vulnerabilidades de dependencias (308A-4 V1): resumen por
          * severidad de la cache; el boton unico de arriba las audita. */}
        <div className="scanCfgSeparador">vulnerabilidades</div>
        {tieneVuln && (
          <div className="scanCfgResumen">
            <span className="scanCfgBadge scanCfgBadge--crit">{tVuln.critical} crític{tVuln.critical === 1 ? 'a' : 'as'}</span>
            <span className="scanCfgBadge scanCfgBadge--high">{tVuln.high} alta{tVuln.high === 1 ? '' : 's'}</span>
            <span className="scanCfgBadge scanCfgBadge--mod">{tVuln.moderate} moderada{tVuln.moderate === 1 ? '' : 's'}</span>
            <span className="scanCfgBadge scanCfgBadge--low">{tVuln.low} baja{tVuln.low === 1 ? '' : 's'}</span>
          </div>
        )}
      </section>
    </>
  );
}
