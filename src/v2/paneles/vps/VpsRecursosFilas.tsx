/* Filas de PanelVpsRecursos: cpu, ram, red, disco del host y disco IO (19AA-13).
 * [por que] Sacadas del componente para que cada fila se lea por si sola; el
 * panel decide cuándo hay historial y estas filas solo pintan lo que reciben. */
import type { CSSProperties } from 'react';
import { fmtBytes } from '../../../shared/vista/format.js';
import { Chispa } from './Chispa.js';
import type { Muestra, ritmos } from './vpsRecursosSeries.js';

type Ritmos = ReturnType<typeof ritmos>;

export function VpsRecursosFilas({
  actual,
  r,
  limite,
  discoPct,
  notaDisco = 'sin respuesta del audit…',
  hayDiscoHost,
  enRango,
}: {
  actual: Muestra;
  r: Ritmos;
  limite: number;
  discoPct: number | null;
  /* Qué decir sin % de disco: el origen del dato cambia con la tab (audit de Coolify en vps,
   * sonda del taller en la 89), así que el texto lo pone quien lo conoce. */
  notaDisco?: string;
  hayDiscoHost: boolean;
  enRango: Muestra[];
}) {
  return (
    <>
      <div className="vpsLinea">
        <div className="vpsFilaDominio">cpu · tiempo real</div>
        {actual[1].toFixed(1)}%
        <Chispa series={[enRango.map((x) => x[1])]} />
      </div>
      <div className="vpsLinea">
        <div className="vpsFilaDominio">
          ram · {Math.round(actual[2])} MiB{limite > 0 ? ` / ${Math.round(limite)}` : ''}
        </div>
        {limite > 0 ? `${((actual[2] / limite) * 100).toFixed(1)}%` : '—'}
        <Chispa series={[enRango.map((x) => x[2])]} />
      </div>
      <div className="vpsLinea">
        <div className="vpsFilaDominio">red · tiempo real</div>
        ↓{fmtBytes(r.rx[r.rx.length - 1] ?? 0)}/s ↑{fmtBytes(r.tx[r.tx.length - 1] ?? 0)}/s
        <div className="vpsFilaDominio">
          acumulado ↓{fmtBytes(actual[3])} ↑{fmtBytes(actual[4])}
        </div>
        <Chispa series={[r.rx, r.tx]} />
      </div>
      <div className="vpsLinea">
        <div className="vpsFilaDominio">disco del host · audit</div>
        {discoPct === null ? (
          notaDisco
        ) : (
          <>
            {discoPct}% en uso
            <div
              className="vpsBarra"
              role="progressbar"
              aria-valuenow={discoPct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Uso de disco del host"
            >
              <div
                className="vpsBarraRelleno"
                /* Solo variable CSS, nunca valor en línea (varsense
                 * cssInlineReact + gate inline-style-prohibido). */
                style={{ '--vps-barra': `${discoPct}%` } as CSSProperties}
              />
            </div>
          </>
        )}
      </div>
      <div className="vpsLinea">
        <div className="vpsFilaDominio">disco IO · host</div>
        {hayDiscoHost ? (
          <>
            R {fmtBytes(r.dr[r.dr.length - 1] ?? 0)}/s W {fmtBytes(r.dw[r.dw.length - 1] ?? 0)}/s
            <div className="vpsFilaDominio">
              acumulado R {fmtBytes(actual[7])} W {fmtBytes(actual[8])}
            </div>
            <Chispa series={[r.dr, r.dw]} />
          </>
        ) : (
          'sin datos del agente'
        )}
      </div>
    </>
  );
}
