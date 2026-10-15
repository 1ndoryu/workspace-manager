/* Panel del taller remoto (S3, plan sucesor 2026-10-14): conformidad de la VPS 89, de los
 * hostnames públicos y del laptop, con los hallazgos que la fundamentan. Solo JSX: la lógica
 * está en usePanelTaller.ts. */
import { Caja, Seccion } from '../../ui/caja/Caja.js';
import { Button } from '../../ui/form/Button.js';
import { ETIQUETA_VEREDICTO, usePanelTaller, type Fila } from './usePanelTaller.js';
import './taller.css';

function Filas({ filas }: { filas: Fila[] }) {
  return (
    <dl className="tallerLista">
      {filas.map(([etiqueta, valor]) => (
        <div key={etiqueta} className="tallerFila">
          <dt>{etiqueta}</dt>
          <dd>{valor}</dd>
        </div>
      ))}
    </dl>
  );
}

export function PanelTaller() {
  const {
    datos,
    cargando,
    error,
    hallazgos,
    veredicto,
    comprobaciones,
    fallos,
    filasVps,
    filasPublico,
    filasLaptop,
    recargar,
  } = usePanelTaller();

  return (
    <Caja
      titulo="taller remoto"
      meta={`${ETIQUETA_VEREDICTO[veredicto]} · ${comprobaciones} comprobaciones`}
      acciones={
        <Button pequeno disabled={cargando} onClick={() => void recargar()} title="Evaluar de nuevo, sin caché">
          recargar
        </Button>
      }
      etiqueta="Taller remoto"
      className="tallerPanel"
    >
      {error && <div className="tallerAviso">no se pudo consultar: {error}</div>}
      <div className="tallerRejilla">
        <Seccion titulo="VPS 89 (dev89)" fallo={fallos.vps}>
          <Filas filas={filasVps} />
        </Seccion>
        <Seccion titulo="HTTP público" fallo={fallos.publico}>
          <Filas filas={filasPublico} />
        </Seccion>
        <Seccion titulo="Laptop" fallo={fallos.laptop}>
          <Filas filas={filasLaptop} />
        </Seccion>
      </div>
      <Seccion titulo={`Conformidad (${hallazgos.length})`} fallo={veredicto === 'errores'}>
        {hallazgos.length === 0 ? (
          <p className="tallerDato">{datos ? 'Ninguna comprobación falla.' : 'Sin datos todavía.'}</p>
        ) : (
          <ul className="tallerHallazgos">
            {hallazgos.map((h) => (
              <li key={`${h.id}-${h.detalle}`} className={`tallerHallazgo tallerHallazgo--${h.severidad}`}>
                <span className="tallerId">{h.id}</span> {h.detalle}
                <div className="tallerRemedio">{h.remedio}</div>
              </li>
            ))}
          </ul>
        )}
      </Seccion>
      {datos && <p className="tallerDato">tomado {new Date(datos.tomadoEn).toLocaleString()}</p>}
    </Caja>
  );
}
