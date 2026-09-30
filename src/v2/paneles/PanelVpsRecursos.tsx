/* Panel lateral de recursos de la VPS en tiempo real (2026-10-01): cpu,
 * ram, red y disco agregados del snapshot de pulse + minigráficos SVG
 * dibujados a mano (sin librerías; monocromo: serie 1 sólida, serie 2
 * punteada). El historial vive aquí (últimas 60 muestras del tick de 5 s
 * ≈ 5 min); red/disco son contadores acumulados y se pintan como
 * velocidad (delta entre muestras). */
import { useEffect, useRef, useState } from 'react';
import type { VpsAgenteSnapshot } from '../../shared/types.js';
import { Caja } from '../ui/caja/Caja.js';
import { fmtBytes } from './PanelVps.js';

interface Muestra {
  t: number;
  cpu: number;
  mem: number;
  rx: number;
  tx: number;
  br: number;
  bw: number;
}

const MAX_MUESTRAS = 60;

/* Minigráfico: una o dos series normalizadas al máximo. */
function Chispa({ series, alto = 36 }: { series: number[][]; alto?: number }) {
  const plano = series.flat();
  const max = Math.max(1, ...plano);
  const n = Math.max(...series.map((s) => s.length), 1);
  const W = 120;
  const H = alto;
  const puntos = (s: number[]) =>
    s
      .map(
        (v, i) =>
          `${((i / Math.max(n - 1, 1)) * W).toFixed(1)},${(H - 2 - (v / max) * (H - 4)).toFixed(1)}`,
      )
      .join(' ');
  return (
    <svg
      className="vpsChispa"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {series.map((s, i) => (
        <polyline
          key={i}
          points={puntos(s)}
          fill="none"
          stroke="currentColor"
          strokeWidth={i === 0 ? 1.5 : 1}
          strokeDasharray={i === 0 ? undefined : '3 2'}
        />
      ))}
    </svg>
  );
}

/* Velocidades por segundo entre las últimas muestras (contadores que se
 * reinician —p. ej. reinicio del host— sujetan a cero, nunca negativas). */
function ritmos(m: Muestra[]): { rx: number[]; tx: number[]; br: number[]; bw: number[] } {
  const rx: number[] = [];
  const tx: number[] = [];
  const br: number[] = [];
  const bw: number[] = [];
  for (let i = 1; i < m.length; i++) {
    const dt = Math.max(1, (m[i].t - m[i - 1].t) / 1000);
    rx.push(Math.max(0, (m[i].rx - m[i - 1].rx) / dt));
    tx.push(Math.max(0, (m[i].tx - m[i - 1].tx) / dt));
    br.push(Math.max(0, (m[i].br - m[i - 1].br) / dt));
    bw.push(Math.max(0, (m[i].bw - m[i - 1].bw) / dt));
  }
  return { rx, tx, br, bw };
}

export function PanelVpsRecursos({ snap }: { snap: VpsAgenteSnapshot | null }) {
  const muestras = useRef<Muestra[]>([]);
  /* Contador para repintar cuando entra una muestra nueva (el ref no
   * repinta solo). */
  const [, setVersion] = useState(0);

  useEffect(() => {
    if (!snap) return;
    const cpu = snap.contenedores.reduce((a, c) => a + c.cpuPct, 0);
    const mem = snap.contenedores.reduce((a, c) => a + c.memMiB, 0);
    const rx = snap.contenedores.reduce((a, c) => a + c.redRxBytes, 0);
    const tx = snap.contenedores.reduce((a, c) => a + c.redTxBytes, 0);
    const br = snap.contenedores.reduce((a, c) => a + c.blkReadBytes, 0);
    const bw = snap.contenedores.reduce((a, c) => a + c.blkWriteBytes, 0);
    muestras.current = [...muestras.current, { t: Date.now(), cpu, mem, rx, tx, br, bw }].slice(
      -MAX_MUESTRAS,
    );
    setVersion((v) => v + 1);
  }, [snap?.ts]); // eslint-disable-line react-hooks/exhaustive-deps

  const m = muestras.current;
  const r = ritmos(m);
  const actual = m[m.length - 1] ?? null;
  /* El límite por contenedor es la RAM del host (no se suma: se toma el
   * mayor no nulo). */
  const limite = snap
    ? snap.contenedores.reduce((a, c) => Math.max(a, c.memLimiteMiB ?? 0), 0)
    : 0;
  /* El agente no trae contadores de bloques (todo a cero): se dice, no
   * se pintan ceros que parecen dato. */
  const hayDisco = actual !== null && actual.br + actual.bw > 0;

  return (
    <Caja titulo="recursos" meta="tiempo real" etiqueta="Recursos de la VPS">
      {!snap || !actual ? (
        <div className="docsVacio">sin muestras todavía…</div>
      ) : (
        <>
          <div className="vpsLinea">
            <div className="vpsFilaDominio">cpu · {m.length} muestras</div>
            {actual.cpu.toFixed(1)}%
            <Chispa series={[m.map((x) => x.cpu)]} />
          </div>
          <div className="vpsLinea">
            <div className="vpsFilaDominio">
              ram · {Math.round(actual.mem)} MiB{limite > 0 ? ` / ${Math.round(limite)}` : ''}
            </div>
            {limite > 0 ? `${((actual.mem / limite) * 100).toFixed(1)}%` : '—'}
            <Chispa series={[m.map((x) => x.mem)]} />
          </div>
          <div className="vpsLinea">
            <div className="vpsFilaDominio">
              red · ↓{fmtBytes(r.rx[r.rx.length - 1] ?? 0)}/s ↑{fmtBytes(r.tx[r.tx.length - 1] ?? 0)}/s
            </div>
            ↓{fmtBytes(actual.rx)} ↑{fmtBytes(actual.tx)}
            <Chispa series={[r.rx, r.tx]} />
          </div>
          <div className="vpsLinea">
            <div className="vpsFilaDominio">disco</div>
            {hayDisco ? (
              <>
                R {fmtBytes(r.br[r.br.length - 1] ?? 0)}/s W {fmtBytes(r.bw[r.bw.length - 1] ?? 0)}/s
                <div className="vpsFilaDominio">
                  R {fmtBytes(actual.br)} W {fmtBytes(actual.bw)}
                </div>
                <Chispa series={[r.br, r.bw]} />
              </>
            ) : (
              'sin datos del agente'
            )}
          </div>
        </>
      )}
    </Caja>
  );
}
