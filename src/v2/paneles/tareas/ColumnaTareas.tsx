/* Columna del kanban: una Caja por proyecto TASKS (07AA-5 F3, DnD 07AA-15).
 * [por que] Casi render puro (un useState para el indicador de destino):
 * todo lo decide usePanelTareas. El arrastre es DnD nativo sin librerias:
 * la tarjeta arrastra {origen, legacyId} y la columna suelta
 * delante de otra tarjeta (o al final en zona vacia); el hook hace el bulk
 * transaccional + relectura. Sin botones de flechas: el arrastre y el menu
 * (mover a vecina por teclado) los sustituyen. */
import { useState } from 'react';
import { ArrowLeft, ArrowRight, X } from 'lucide-react';
import { Button } from '../../ui/form/Button.js';
import { Caja } from '../../ui/caja/Caja.js';
import type { ParcheTareaTab, TareaTab } from '../../../shared/tareasTab.js';
import { TarjetaTarea } from './TarjetaTarea.js';

/* Carga util del arrastre (misma tab: el drop ajeno se ignora). */
const TIPO_ARRASTRE = 'text/tarea-kanban';

export function leerArrastre(ev: React.DragEvent): { origen: number; legacyId: number } | null {
  try {
    const v = JSON.parse(ev.dataTransfer.getData(TIPO_ARRASTRE)) as unknown;
    if (typeof v !== 'object' || v === null) return null;
    const { origen, legacyId } = v as Record<string, unknown>;
    if (!Number.isInteger(origen) || !Number.isInteger(legacyId)) return null;
    return { origen: origen as number, legacyId: legacyId as number };
  } catch {
    return null;
  }
}

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
  urlTareas: string;
}

/* Gestos (los ejecuta el hook; aqui solo se cablean al DnD y al menu). */
interface ColumnaGestos {
  onSoltar: (origen: number, legacyId: number, antesDe: number | null) => void;
  onEditar: (legacyId: number, parche: ParcheTareaTab) => void;
  onEliminar: (legacyId: number) => void;
  onMoverVecina: (legacyId: number, dir: -1 | 1) => void;
  onMoverColumna: (dir: -1 | 1) => void;
  onQuitar: () => void;
}

interface ColumnaTareasProps extends ColumnaIdentidad, ColumnaDatos, ColumnaGestos {}

export function ColumnaTareas(p: ColumnaTareasProps) {
  const lista = p.tareas ?? [];
  const ocupada = p.moviendo !== null || p.cargando;
  /* Tarjeta bajo el cursor (id) o 'fin' (zona vacia): solo indicador. */
  const [sobre, setSobre] = useState<number | 'fin' | null>(null);

  const soltar = (ev: React.DragEvent, antesDe: number | null) => {
    ev.preventDefault();
    ev.stopPropagation();
    setSobre(null);
    const arrastre = leerArrastre(ev);
    if (arrastre === null || ocupada) return;
    p.onSoltar(arrastre.origen, arrastre.legacyId, antesDe);
  };

  return (
    <Caja
      titulo={`columna ${p.legacyId}`}
      meta={`${lista.length} tareas`}
      etiqueta={`Columna ${p.legacyId} del kanban`}
      acciones={
        <>
          <Button pequeno cuadrado onClick={() => p.onMoverColumna(-1)} disabled={p.primera} title={`mover la columna ${p.legacyId} a la izquierda`} aria-label={`mover la columna ${p.legacyId} a la izquierda`}>
            <ArrowLeft size={12} aria-hidden />
          </Button>
          <Button pequeno cuadrado onClick={() => p.onMoverColumna(1)} disabled={p.ultima} title={`mover la columna ${p.legacyId} a la derecha`} aria-label={`mover la columna ${p.legacyId} a la derecha`}>
            <ArrowRight size={12} aria-hidden />
          </Button>
          <Button pequeno cuadrado onClick={p.onQuitar} title={`quitar la columna ${p.legacyId} (solo la oculta en esta tab)`} aria-label={`quitar la columna ${p.legacyId}`}>
            <X size={12} aria-hidden />
          </Button>
        </>
      }
    >
      {p.tareas === null && <div className="docsVacio">{p.cargando ? 'cargando…' : 'sin datos'}</div>}
      {p.tareas !== null && lista.length === 0 && (
        <div
          className="tareasVacia"
          onDragOver={(ev) => {
            ev.preventDefault();
            setSobre('fin');
          }}
          onDragLeave={() => setSobre(null)}
          onDrop={(ev) => soltar(ev, null)}
        >
          columna vacía — suelta aquí
        </div>
      )}
      {lista.length > 0 && (
        <div
          className="tareasLista"
          role="list"
          aria-label={`Tareas de la columna ${p.legacyId} (arrastra para mover)`}
          onDragOver={(ev) => {
            ev.preventDefault();
            setSobre('fin');
          }}
          onDragLeave={() => setSobre(null)}
          onDrop={(ev) => soltar(ev, null)}
        >
          {lista.map((t) => (
            <TarjetaTarea
              key={t.legacyId}
              tarea={t}
              gestos={{
                arrastrable: !ocupada,
                resaltada: sobre === t.legacyId,
                enVuelo: p.moviendo === `${p.legacyId}:${t.legacyId}`,
                vecina: {atras: !p.primera, adelante: !p.ultima},
                urlTareas: p.urlTareas,
                arrastre: {
                  inicio: (ev) => {
                    ev.dataTransfer.effectAllowed = 'move';
                    ev.dataTransfer.setData(TIPO_ARRASTRE, JSON.stringify({ origen: p.legacyId, legacyId: t.legacyId }));
                  },
                  encima: (ev) => soltar(ev, t.legacyId),
                  pasar: () => setSobre(t.legacyId),
                },
                onEditar: (parche) => p.onEditar(t.legacyId, parche),
                onEliminar: () => p.onEliminar(t.legacyId),
                onMoverVecina: (dir) => p.onMoverVecina(t.legacyId, dir),
              }}
            />
          ))}
          {sobre === 'fin' && <div className="tareasDestino" aria-hidden="true">soltar al final</div>}
        </div>
      )}
    </Caja>
  );
}
