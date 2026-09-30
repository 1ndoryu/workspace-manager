/* Panel lateral de recursos de la VPS en tiempo real (2026-10-01): cpu,
 * ram, red y disco agregados del snapshot de pulse + minigráficos SVG
 * dibujados a mano (sin librerías; monocromo: serie 1 sólida, serie 2
 * punteada).
 * [por que] Los gráficos no se reinician al recargar: el historial se
 * persiste en localStorage (tuplas compactas, tope 25 000 ≈ 34 h a tick
 * de 5 s, poda >7 días) y el rango lo elige el usuario (30 min/1 h/4 h/
 * 1 día/1 semana). Red y disco-IO son contadores acumulados: la cifra
 * grande es la velocidad (delta entre muestras = tiempo real) y el
 * acumulado va etiquetado como tal. El % de disco del host no sale de
 * pulse (sus blk llegan a cero) y entra por prop desde el audit. */
import { useEffect, useRef, useState } from 'react';
import type { VpsAgenteSnapshot } from '../../shared/types.js';
import { Caja } from '../ui/caja/Caja.js';
import { logger } from '../../shared/logger.js';
import { fmtBytes } from './PanelVps.js';

/* Muestra como tupla [t, cpu, mem, rx, tx, br, bw]: compacta en el
 * localStorage (≈50 caracteres por muestra). */
type Muestra = [number, number, number, number, number, number, number];

const CLAVE_HISTORIAL = 'workspaceManager:vps-recursos-historial-v1';
const CLAVE_RANGO = 'workspaceManager:vps-recursos-rango-v1';
const MAX_MUESTRAS = 25000;
const RETENCION_MS = 7 * 24 * 3600 * 1000;
const MAX_PUNTOS = 240;

const RANGOS = [
  { id: '30m', etiqueta: '30 min', ms: 30 * 60 * 1000 },
  { id: '1h', etiqueta: '1 h', ms: 3600 * 1000 },
  { id: '4h', etiqueta: '4 h', ms: 4 * 3600 * 1000 },
  { id: '1d', etiqueta: '1 día', ms: 24 * 3600 * 1000 },
  { id: '1sem', etiqueta: '1 semana', ms: 7 * 24 * 3600 * 1000 },
] as const;

function leerHistorial(): Muestra[] {
  try {
    const raw = localStorage.getItem(CLAVE_HISTORIAL);
    if (!raw) return [];
    const lista = JSON.parse(raw) as unknown;
    if (!Array.isArray(lista)) return [];
    const corte = Date.now() - RETENCION_MS;
    const limpias: Muestra[] = [];
    for (const x of lista) {
      if (
        Array.isArray(x) &&
        x.length === 7 &&
        x.every((v) => typeof v === 'number' && Number.isFinite(v)) &&
        (x[0] as number) >= corte
      ) {
        limpias.push(x as Muestra);
      }
    }
    return limpias.slice(-MAX_MUESTRAS);
  } catch (err) {
    logger.warn('no se pudo leer el historial de recursos:', err);
    return [];
  }
}

function leerRango(): string {
  try {
    const r = localStorage.getItem(CLAVE_RANGO);
    if (r && RANGOS.some((x) => x.id === r)) return r;
  } catch {
    /* Sin almacenamiento: rango por defecto. */
  }
  return '30m';
}

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

/* Velocidades por segundo entre muestras consecutivas (contadores que se
 * reinician —p. ej. reinicio del host— sujetan a cero, nunca negativas).
 * Vale con muestras separadas (el dt normaliza), así que sirve sobre la
 * serie diezmada del rango. */
function ritmos(m: Muestra[]): { rx: number[]; tx: number[]; br: number[]; bw: number[] } {
  const rx: number[] = [];
  const tx: number[] = [];
  const br: number[] = [];
  const bw: number[] = [];
  for (let i = 1; i < m.length; i++) {
    const dt = Math.max(1, (m[i][0] - m[i - 1][0]) / 1000);
    rx.push(Math.max(0, (m[i][3] - m[i - 1][3]) / dt));
    tx.push(Math.max(0, (m[i][4] - m[i - 1][4]) / dt));
    br.push(Math.max(0, (m[i][5] - m[i - 1][5]) / dt));
    bw.push(Math.max(0, (m[i][6] - m[i - 1][6]) / dt));
  }
  return { rx, tx, br, bw };
}

/* Diezmado por paso para no pintar más de MAX_PUNTOS (el dt de `ritmos`
 * absorbe el hueco: la velocidad sigue siendo válida). */
function diezmar(m: Muestra[]): Muestra[] {
  if (m.length <= MAX_PUNTOS) return m;
  const paso = Math.ceil(m.length / MAX_PUNTOS);
  const fuera: Muestra[] = [];
  for (let i = 0; i < m.length; i += paso) fuera.push(m[i]);
  const ultima = m[m.length - 1];
  if (fuera[fuera.length - 1] !== ultima) fuera.push(ultima);
  return fuera;
}

export function PanelVpsRecursos({
  snap,
  discoPct,
}: {
  snap: VpsAgenteSnapshot | null;
  discoPct: number | null;
}) {
  const muestras = useRef<Muestra[]>([]);
  const ultimoTs = useRef<number | null>(null);
  const ultimoGuardado = useRef(0);
  const [rangoId, setRangoId] = useState<string>(() => leerRango());
  /* Contador para repintar cuando entra una muestra o cambia el rango
   * (el ref no repinta solo). */
  const [, setVersion] = useState(0);

  /* Historial previo (sobrevive a recargas) + volcado al cerrar. */
  useEffect(() => {
    muestras.current = leerHistorial();
    setVersion((v) => v + 1);
    const alCerrar = () => {
      try {
        localStorage.setItem(CLAVE_HISTORIAL, JSON.stringify(muestras.current.slice(-MAX_MUESTRAS)));
      } catch {
        /* Cierre sin almacenamiento: se pierde la cola sin romper nada. */
      }
    };
    window.addEventListener('beforeunload', alCerrar);
    return () => window.removeEventListener('beforeunload', alCerrar);
  }, []);

  /* Muestra nueva por tick de pulse (guardada como tupla redondeada;
   * el localStorage se escribe como mucho cada 30 s para no atascar). */
  useEffect(() => {
    if (!snap) return;
    if (ultimoTs.current === snap.ts) return;
    ultimoTs.current = snap.ts;
    const cpu = Math.round(snap.contenedores.reduce((a, c) => a + c.cpuPct, 0) * 10) / 10;
    const mem = Math.round(snap.contenedores.reduce((a, c) => a + c.memMiB, 0));
    const rx = Math.round(snap.contenedores.reduce((a, c) => a + c.redRxBytes, 0));
    const tx = Math.round(snap.contenedores.reduce((a, c) => a + c.redTxBytes, 0));
    const br = Math.round(snap.contenedores.reduce((a, c) => a + c.blkReadBytes, 0));
    const bw = Math.round(snap.contenedores.reduce((a, c) => a + c.blkWriteBytes, 0));
    const nueva: Muestra = [Date.now(), cpu, mem, rx, tx, br, bw];
    muestras.current = [...muestras.current, nueva].slice(-MAX_MUESTRAS);
    if (Date.now() - ultimoGuardado.current > 30000) {
      ultimoGuardado.current = Date.now();
      try {
        localStorage.setItem(CLAVE_HISTORIAL, JSON.stringify(muestras.current));
      } catch (err) {
        logger.warn('no se pudo guardar el historial de recursos:', err);
      }
    }
    setVersion((v) => v + 1);
  }, [snap?.ts]); // eslint-disable-line react-hooks/exhaustive-deps

  function elegirRango(id: string) {
    setRangoId(id);
    try {
      localStorage.setItem(CLAVE_RANGO, id);
    } catch {
      /* Sin almacenamiento: el rango vive solo la sesión. */
    }
    setVersion((v) => v + 1);
  }

  const rango = RANGOS.find((x) => x.id === rangoId) ?? RANGOS[0];
  const corte = Date.now() - rango.ms;
  const enRango = diezmar(muestras.current.filter((x) => x[0] >= corte));
  const r = ritmos(enRango);
  const actual = enRango[enRango.length - 1] ?? null;
  /* El límite por contenedor es la RAM del host (no se suma: se toma el
   * mayor no nulo). */
  const limite = snap
    ? snap.contenedores.reduce((a, c) => Math.max(a, c.memLimiteMiB ?? 0), 0)
    : 0;
  /* El agente no trae contadores de bloques (todo a cero): se dice, no
   * se pintan ceros que parecen dato. */
  const hayDiscoIo = actual !== null && actual[5] + actual[6] > 0;

  return (
    <Caja
      titulo="recursos"
      meta={`${rango.etiqueta} · ${enRango.length} muestras`}
      etiqueta="Recursos de la VPS"
    >
      <div className="vpsLinea">
        <div className="vpsRangos" role="group" aria-label="Rango del historial">
          {RANGOS.map((x) => (
            <button
              key={x.id}
              type="button"
              className={`navegadorRutaChip${x.id === rangoId ? ' navegadorRutaChip--activo' : ''}`}
              onClick={() => elegirRango(x.id)}
              title={`Muestra ${x.etiqueta} de historial`}
            >
              {x.etiqueta}
            </button>
          ))}
        </div>
      </div>
      {!snap || !actual || enRango.length < 2 ? (
        <div className="docsVacio">recopilando historial…</div>
      ) : (
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
              'sin respuesta del audit…'
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
                  <div className="vpsBarraRelleno" style={{ width: `${discoPct}%` }} />
                </div>
              </>
            )}
          </div>
          <div className="vpsLinea">
            <div className="vpsFilaDominio">disco IO · contenedores</div>
            {hayDiscoIo ? (
              <>
                R {fmtBytes(r.br[r.br.length - 1] ?? 0)}/s W {fmtBytes(r.bw[r.bw.length - 1] ?? 0)}/s
                <div className="vpsFilaDominio">
                  acumulado R {fmtBytes(actual[5])} W {fmtBytes(actual[6])}
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
