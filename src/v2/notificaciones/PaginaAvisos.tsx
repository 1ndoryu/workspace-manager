/* Página de avisos (20AA-29): todas las notificaciones del área, al lado de «taller» en el nav.
 * [por que una página y no sólo la campana] La campana es para lo que acaba de pasar: se abre,
 * se lee lo de hoy y se cierra. Buscar «qué pasó con este sitio la semana pasada» no cabe en un
 * panel de 360 px. Misma fuente, misma agrupación y mismos componentes: la página no tiene estado
 * propio de avisos, lee el mismo store.
 * [por que dos Cajas hermanas y no una con el detalle dentro] La primitiva `Caja` es el panel
 * externo; meter una caja dentro de otra es justo lo que el diseño prohíbe. La lista y el detalle
 * son dos paneles de la misma fila redimensionable (`FilaCajas`), como en vps o repos.
 * [por que aquí y no en `paneles/`] Vive junto a la campana porque comparten fila, detalle, iconos
 * y estilos; `paneles/` es para los paneles del tablero con su propio cliente de API.
 * Solo JSX: el estado vive en `usePaginaAvisos` (gate: componente-sin-hook-glory). */
import { ListFilter } from 'lucide-react';
import { ETIQUETA, TIPOS } from '../../shared/notificaciones/tipos.js';
import { Caja } from '../ui/caja/Caja.js';
import { FilaCajas } from '../ui/caja/FilaCajas.js';
import { Button } from '../ui/form/Button.js';
import { FilaAviso, DetalleAviso, ICONO } from './FilaAviso.js';
import { usePaginaAvisos } from './usePaginaAvisos.js';
import './Campana.css';
import './PaginaAvisos.css';

export function PaginaAvisos() {
  const {
    campana,
    gruposVisibles,
    quedan,
    total,
    noLeidos,
    lista,
    error,
    fuentesRotas,
    filtro,
    setFiltro,
    marcando,
    marcarTodas,
    seleccion,
    abrir,
    cerrar,
    refLista,
    alDesplazar,
    verMas,
  } = usePaginaAvisos();

  return (
    <FilaCajas fila="avisos" ids={seleccion !== null ? ['lista', 'detalle'] : ['lista']} defectos={[2, 1]}>
      <Caja
        titulo="avisos"
        meta={`${total} en total · ${noLeidos} sin leer`}
        acciones={
          <>
            {noLeidos > 0 && (
              <Button pequeno onClick={() => void marcarTodas()} disabled={marcando}>
                marcar todo leído
              </Button>
            )}
            <Button pequeno onClick={() => setFiltro(null)} activo={filtro === null} aria-pressed={filtro === null}>
              todos
            </Button>
            {TIPOS.map((t) => {
              const Icono = ICONO[t];
              return (
                <Button
                  key={t}
                  pequeno
                  cuadrado
                  activo={filtro === t}
                  aria-pressed={filtro === t}
                  onClick={() => setFiltro(filtro === t ? null : t)}
                  title={filtro === t ? 'quitar filtro' : `filtrar por ${ETIQUETA[t]}`}
                  aria-label={filtro === t ? 'quitar filtro' : `filtrar por ${ETIQUETA[t]}`}
                >
                  <Icono size={13} aria-hidden />
                </Button>
              );
            })}
          </>
        }
        columna
      >
        {/* Apagada (20AA-32): la lista que hay es la última de cuando estaba encendida. Decirlo
         * evita leerla como «no ha pasado nada desde entonces». */}
        {!campana.activa && (
          <div className="v2CampanaBanda" role="status">
            avisos apagados{campana.motivo !== null ? `: ${campana.motivo}` : ''}; esto es lo último que se guardó
          </div>
        )}
        {error !== null && (
          <div className="v2CampanaBanda" role="status">
            avisos sin conexión: {error}
          </div>
        )}
        {fuentesRotas.length > 0 && (
          <div className="v2CampanaBanda" role="status">
            {fuentesRotas.map((f) => f.fuente).join(', ')}: sin lectura, puede faltar algo
          </div>
        )}
        {/* El filtro se elige por icono: sin esta línea habría que adivinar cuál está activo. */}
        {filtro !== null && (
          <div className="v2CampanaModalPie avisosFiltro">
            <ListFilter size={12} aria-hidden />
            <span>filtrando por {ETIQUETA[filtro]}</span>
          </div>
        )}
        {!lista && total === 0 && <div className="v2CampanaVacio">cargando…</div>}
        {lista && total === 0 && (
          <div className="v2CampanaVacio">{filtro !== null ? 'nada de ese tipo' : 'nada nuevo'}</div>
        )}

        {/* Scroll propio: la página no crece con 500 avisos. Al llegar al final se suma el tramo
         * siguiente; el botón es el mismo camino para quien no quiera desplazar. */}
        <div className="avisosLista" ref={refLista} onScroll={alDesplazar}>
          {gruposVisibles.map((g) => (
            <div className="v2CampanaGrupo" key={g.clave}>
              <span className="v2CampanaDia">{g.etiqueta}</span>
              {g.avisos.map((a) => (
                <FilaAviso
                  key={a.id}
                  aviso={a}
                  /* Todas las filas entran en el tabulador: en una página se recorre con Tab, no
                   * con una sola parada como en la campana. */
                  tabIndex={0}
                  refFila={() => undefined}
                  onAbrir={abrir}
                />
              ))}
            </div>
          ))}
          {quedan > 0 && (
            <div className="avisosMas">
              <Button pequeno onClick={verMas}>
                ver más ({quedan})
              </Button>
            </div>
          )}
          {total > 0 && quedan === 0 && <div className="v2CampanaVacio">no hay más</div>}
        </div>
      </Caja>

      {/* Detalle: Caja hermana, no contenido dentro de la lista. Se cierra con la × de su cabecera
       * o abriendo otro aviso, que la sustituye. */}
      {seleccion !== null && (
        <Caja titulo="detalle" className="avisosDetalle" onCerrar={cerrar} cerrarTitulo="cerrar detalle">
          <DetalleAviso aviso={seleccion} />
        </Caja>
      )}
    </FilaCajas>
  );
}
