/* Panel lateral de recursos de la VPS en tiempo real (2026-10-01): cpu,
 * ram, red y disco agregados del snapshot de pulse + minigráficos SVG
 * dibujados a mano (sin librerías; monocromo: serie 1 sólida, serie 2
 * punteada).
 * [por que] Los gráficos no se reinician al recargar: el historial se
 * persiste en localStorage (tuplas compactas, tope 25 000 ≈ 34 h a tick
 * de 5 s, poda >7 días) y el rango lo elige el usuario (30 min/1 h/4 h/
 * 1 día/1 semana). Red y disco-IO son contadores acumulados: la cifra
 * grande es la velocidad (delta entre muestras = tiempo real) y el
 * acumulado va etiquetado como tal. El disco-IO es del host (`discoHost`
 * de pulse 0110A-1; antes por contenedor, siempre a cero en cgroup v2).
 * El % de disco del host no sale de pulse y entra por prop desde el audit. */
import { useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { VpsAgenteSnapshot } from '../../../shared/types.js';
import { Caja } from '../../ui/caja/Caja.js';
import { Button } from '../../ui/form/Button.js';
import { guardarJson, guardarTexto, leerJson, leerTexto } from '../../../shared/vista/storage.js';
import { fmtBytes } from '../../../shared/vista/format.js';
import { bajarVentana, suscribirVentana } from '../../../shared/platform/plataforma.js';

import type { Muestra } from './vpsRecursosSeries.js';
import { RANGOS, diezmar, ritmos } from './vpsRecursosSeries.js';
import { Chispa } from './Chispa.js';

/* Sector diskstats = 512 B (el kernel cuenta en sectores de 512 aunque el
 * disco físico use otro tamaño). */
const SECTOR_BYTES = 512;

const CLAVE_HISTORIAL = 'workspaceManager:vps-recursos-historial-v1';
const CLAVE_RANGO = 'workspaceManager:vps-recursos-rango-v1';
const MAX_MUESTRAS = 25000;
const RETENCION_MS = 7 * 24 * 3600 * 1000;

function leerHistorial(): Muestra[] {
  const lista = leerJson<unknown>(CLAVE_HISTORIAL, 'no se pudo leer el historial de recursos:');
  if (!Array.isArray(lista)) return [];
  const corte = Date.now() - RETENCION_MS;
  const limpias: Muestra[] = [];
  for (const x of lista) {
    if (
      Array.isArray(x) &&
      (x.length === 7 || x.length === 9) &&
      x.every((v) => typeof v === 'number' && Number.isFinite(v)) &&
      (x[0] as number) >= corte
    ) {
      /* [0110A-1] Migración: tuplas de 7 (sin IO del host) se rellenan
       * con dr/dw a cero; las de contenedor ya eran cero, sin distorsión. */
      const t = x.length === 7 ? [...(x as number[]), 0, 0] : x;
      limpias.push(t as Muestra);
    }
  }
  return limpias.slice(-MAX_MUESTRAS);
}

function leerRango(): string {
  const r = leerTexto(CLAVE_RANGO);
  if (r && RANGOS.some((x) => x.id === r)) return r;
  return '30m';
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
  /* [0110A-1] Último IO del host visto: mientras pulse no lo trae (null)
   * se repite el anterior para no inventar deltas (plano = sin dato,
   * no cero). */
  const ultimoDisco = useRef<{ r: number; w: number } | null>(null);
  const [rangoId, setRangoId] = useState<string>(() => leerRango());
  /* Contador para repintar cuando entra una muestra o cambia el rango
   * (el ref no repinta solo). */
  const [, setVersion] = useState(0);

  /* Historial previo (sobrevive a recargas) + volcado al cerrar. */
  useEffect(() => {
    muestras.current = leerHistorial();
    setVersion((v) => v + 1);
    const alCerrar = () => {
      /* Cierre sin almacenamiento: se pierde la cola sin romper nada. */
      guardarJson(CLAVE_HISTORIAL, muestras.current.slice(-MAX_MUESTRAS));
    };
    suscribirVentana('beforeunload', alCerrar);
    return () => bajarVentana('beforeunload', alCerrar);
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
    if (snap.discoHost) {
      ultimoDisco.current = {
        r: snap.discoHost.sectoresLeidos * SECTOR_BYTES,
        w: snap.discoHost.sectoresEscritos * SECTOR_BYTES,
      };
    }
    const dr = Math.round(ultimoDisco.current?.r ?? 0);
    const dw = Math.round(ultimoDisco.current?.w ?? 0);
    const nueva: Muestra = [Date.now(), cpu, mem, rx, tx, br, bw, dr, dw];
    muestras.current = [...muestras.current, nueva].slice(-MAX_MUESTRAS);
    if (Date.now() - ultimoGuardado.current > 30000) {
      ultimoGuardado.current = Date.now();
      guardarJson(CLAVE_HISTORIAL, muestras.current, 'no se pudo guardar el historial de recursos:');
    }
    setVersion((v) => v + 1);
  }, [snap?.ts]); // eslint-disable-line react-hooks/exhaustive-deps

  function elegirRango(id: string) {
    setRangoId(id);
    /* Sin almacenamiento: el rango vive solo la sesión. */
    guardarTexto(CLAVE_RANGO, id);
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
  /* [0110A-1] La fila de IO es del host (`discoHost` de pulse 0.3+):
   * sin él se dice, no se pintan ceros que parecen dato. */
  const hayDiscoHost = snap?.discoHost != null;

  return (
    <Caja
      titulo="recursos"
      meta={`${rango.etiqueta} · ${enRango.length} muestras`}
      etiqueta="Recursos de la VPS"
    >
      <div className="vpsLinea">
        <div className="vpsRangos" role="group" aria-label="Rango del historial">
          {RANGOS.map((x) => (
            <Button
              key={x.id}
              className={`navegadorRutaChip${x.id === rangoId ? ' navegadorRutaChip--activo' : ''}`}
              onClick={() => elegirRango(x.id)}
              title={`Muestra ${x.etiqueta} de historial`}
            >
              {x.etiqueta}
            </Button>
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
      )}
    </Caja>
  );
}
