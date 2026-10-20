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
 * El % de disco del host no sale de pulse y entra por prop desde el audit.
 * Historial en `useRecursosVps.ts` y filas en `VpsRecursosFilas.tsx` (19AA-13). */
import type { VpsAgenteSnapshot } from '../../../shared/types.js';
import { Caja } from '../../ui/caja/Caja.js';
import { Button } from '../../ui/form/Button.js';
import { RANGOS, ritmos } from './vpsRecursosSeries.js';
import { useRecursosVps } from './useRecursosVps.js';
import { VpsRecursosFilas } from './VpsRecursosFilas.js';

export function PanelVpsRecursos({
  snap,
  discoPct,
}: {
  snap: VpsAgenteSnapshot | null;
  discoPct: number | null;
}) {
  const { rango, rangoId, enRango, elegirRango } = useRecursosVps(snap);
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
        <VpsRecursosFilas
          actual={actual}
          r={r}
          limite={limite}
          discoPct={discoPct}
          hayDiscoHost={hayDiscoHost}
          enRango={enRango}
        />
      )}
    </Caja>
  );
}
