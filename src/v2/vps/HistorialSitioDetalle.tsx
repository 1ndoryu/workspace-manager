import { Chispa, RANGOS } from '../paneles/PanelVpsRecursos.js';
import type { MuestraSitio } from './historialSitios.js';

/* [0110A-3 F2] Bloque de historial dentro del detalle por sitio:
 * selector de rango + chispas CPU/RAM con la historia guardada (el vivo
 * ya va en la línea de arriba del detalle). Componente aparte para no
 * engordar PanelVps (gate: limite-lineas). */
export function HistorialSitioDetalle({ serie, rangoId, onRango }: {
  serie: MuestraSitio[];
  rangoId: string;
  onRango: (id: string) => void;
}) {
  const rango = RANGOS.find((x) => x.id === rangoId) ?? RANGOS[0];
  /* [07AA-4] Última muestra con sus porcentajes: el gráfico ya dibujaba la
   * forma pero no decía el valor. */
  const ultima = serie.length > 0 ? serie[serie.length - 1] : null;
  return (
    <>
      <div className="vpsLinea">
        <div className="vpsRangos" role="group" aria-label="Rango del historial del despliegue">
          {RANGOS.map((x) => (
            <button
              key={x.id}
              type="button"
              className={`navegadorRutaChip${x.id === rangoId ? ' navegadorRutaChip--activo' : ''}`}
              onClick={() => onRango(x.id)}
              title={`Muestra ${x.etiqueta} de historial`}
            >
              {x.etiqueta}
            </button>
          ))}
        </div>
      </div>
      {ultima && (
        <div className="vpsLinea">
          <div className="vpsFilaDominio">
            última · {ultima[1].toFixed(1)}% cpu · {Math.round(ultima[2])} MiB ram
          </div>
        </div>
      )}
      {serie.length < 2 ? (
        <div className="vpsLinea">
          <div className="vpsFilaDominio">historial · recopilando…</div>
        </div>
      ) : (
        <>
          <div className="vpsLinea">
            <div className="vpsFilaDominio">cpu · {rango.etiqueta}</div>
            <Chispa series={[serie.map((m) => m[1])]} />
          </div>
          <div className="vpsLinea">
            <div className="vpsFilaDominio">ram · {rango.etiqueta}</div>
            <Chispa series={[serie.map((m) => m[2])]} />
          </div>
        </>
      )}
    </>
  );
}
