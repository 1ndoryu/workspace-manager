/* Columna del kanban: una Caja por proyecto TASKS (07AA-5 F3).
 * [por que] Render puro (sin estado): todo lo decide usePanelTareas. Los
 * movimientos son botones (teclado nativo + contraste monocromo), no
 * drag-and-drop: misma operacion, cero dependencias y accesible. */
import { Button } from '../../ui/form/Button.js';
import { Caja } from '../../ui/caja/Caja.js';
import { textoTarea, type TareaTab } from '../../../shared/tareasTab.js';

/* Identidad de la columna dentro de la fila (posicion para las flechas). */
interface ColumnaIdentidad {
  legacyId: number;
  primera: boolean;
  ultima: boolean;
}

/* Datos que pinta: tareas ya ordenadas por la API + flags de vuelo. */
interface ColumnaDatos {
  tareas: TareaTab[] | null;
  cargando: boolean;
  moviendo: string | null;
}

/* Gestos (los ejecuta el hook; aqui solo se cablean a botones). */
interface ColumnaGestos {
  onSubir: (indice: number) => void;
  onBajar: (indice: number) => void;
  onMigrar: (legacyId: number, dir: -1 | 1) => void;
  onMoverColumna: (dir: -1 | 1) => void;
  onQuitar: () => void;
}

interface ColumnaTareasProps extends ColumnaIdentidad, ColumnaDatos, ColumnaGestos {}

export function ColumnaTareas(p: ColumnaTareasProps) {
  const lista = p.tareas ?? [];
  const ocupada = p.moviendo !== null || p.cargando;
  return (
    <Caja
      titulo={`columna ${p.legacyId}`}
      meta={`${lista.length} tareas`}
      etiqueta={`Columna ${p.legacyId} del kanban`}
      acciones={
        <>
          <Button pequeno cuadrado onClick={() => p.onMoverColumna(-1)} disabled={p.primera} title={`mover la columna ${p.legacyId} a la izquierda`} aria-label={`mover la columna ${p.legacyId} a la izquierda`}>
            ←
          </Button>
          <Button pequeno cuadrado onClick={() => p.onMoverColumna(1)} disabled={p.ultima} title={`mover la columna ${p.legacyId} a la derecha`} aria-label={`mover la columna ${p.legacyId} a la derecha`}>
            →
          </Button>
          <Button pequeno cuadrado onClick={p.onQuitar} title={`quitar la columna ${p.legacyId} (solo la oculta en esta tab)`} aria-label={`quitar la columna ${p.legacyId}`}>
            ×
          </Button>
        </>
      }
    >
      {p.tareas === null && <div className="docsVacio">{p.cargando ? 'cargando…' : 'sin datos'}</div>}
      {p.tareas !== null && lista.length === 0 && <div className="docsVacio">columna vacía</div>}
      {lista.length > 0 && (
        <div className="tareasLista" role="list" aria-label={`Tareas de la columna ${p.legacyId}`}>
          {lista.map((t, i) => {
            const enVuelo = p.moviendo === `${p.legacyId}:${t.legacyId}`;
            return (
              <div key={t.legacyId} className="tareasFila" role="listitem">
                <span className="tareasTexto" title={`#${t.legacyId} · orden ${t.orden}`}>
                  {textoTarea(t)}
                </span>
                <span className="tareasMeta">#{t.legacyId}</span>
                <span className="tareasBotones" role="group" aria-label={`Mover ${textoTarea(t)}`}>
                  <Button pequeno cuadrado onClick={() => p.onSubir(i)} disabled={ocupada || i === 0} title="subir en la columna" aria-label="subir en la columna">
                    ↑
                  </Button>
                  <Button pequeno cuadrado onClick={() => p.onBajar(i)} disabled={ocupada || i === lista.length - 1} title="bajar en la columna" aria-label="bajar en la columna">
                    ↓
                  </Button>
                  <Button pequeno cuadrado onClick={() => p.onMigrar(t.legacyId, -1)} disabled={ocupada || p.primera} title="mover a la columna anterior" aria-label="mover a la columna anterior">
                    ⇤
                  </Button>
                  <Button pequeno cuadrado onClick={() => p.onMigrar(t.legacyId, 1)} disabled={ocupada || p.ultima} title="mover a la columna siguiente" aria-label="mover a la columna siguiente">
                    ⇥
                  </Button>
                  {enVuelo && <span className="tareasVolando" aria-hidden="true">…</span>}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </Caja>
  );
}
