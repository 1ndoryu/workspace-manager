/* Columna del kanban: una Caja por repo WM con su proyecto TASKS (07AA-5
 * F3, DnD 07AA-15, columnas fijas 08AA-6, alta por modal 08AA-7).
 * [por que] Casi render puro (dos useState: indicador de destino + modal de
 * alta abierto): todo lo decide usePanelTareas. El arrastre es DnD nativo sin
 * librerias: la tarjeta arrastra {origen, legacyId} y la columna suelta
 * delante de otra tarjeta (o al final en zona vacia); el hook hace el bulk
 * transaccional + relectura. (08AA-5) Sin botones de mover: ni las flechas
 * de la cabecera ni las filas del menu de la tarjeta son necesarias; el
 * arrastre cubre el cambio de columna y el orden de columnas es fijo.
 * (08AA-6) Sin X de quitar (columnas fijas del servidor). (08AA-7) Sin
 * contador y sin alta inline: la cabecera lleva solo `+` (donde estaba el
 * contador) que abre el modal de alta rapida estilo TASKS; la zona vacia
 * es texto sin bordes (sigue siendo destino de drop). */
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '../../ui/form/Button.js';
import { Caja } from '../../ui/caja/Caja.js';
import type { ParcheTareaTab, TareaTab } from '../../../shared/tareasTab.js';
import { TarjetaTarea } from './TarjetaTarea.js';
import { ModalAltaTarea, type DatosAltaTarea } from './ModalAltaTarea.js';

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

/* Identidad de la columna dentro de la fila. */
interface ColumnaIdentidad {
  legacyId: number;
  nombre: string;
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
  onCrear: (datos: DatosAltaTarea) => Promise<void>;
}

interface ColumnaTareasProps extends ColumnaIdentidad, ColumnaDatos, ColumnaGestos {}

export function ColumnaTareas(p: ColumnaTareasProps) {
  const lista = p.tareas ?? [];
  const ocupada = p.moviendo !== null || p.cargando;
  /* Tarjeta bajo el cursor (id) o 'fin' (zona vacia): solo indicador. */
  const [sobre, setSobre] = useState<number | 'fin' | null>(null);
  /* Modal de alta rapida (08AA-7): una sola instancia por columna. */
  const [altaAbierta, setAltaAbierta] = useState(false);

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
      titulo={p.nombre}
      acciones={
        <Button
          cuadrado
          pequeno
          onClick={() => setAltaAbierta(true)}
          title={`Crear tarea en ${p.nombre}`}
          aria-label={`Crear tarea en ${p.nombre}`}
        >
          <Plus size={12} aria-hidden />
        </Button>
      }
      etiqueta={`Columna ${p.nombre} del kanban`}
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
          aria-label={`Tareas de la columna ${p.nombre} (arrastra para mover)`}
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
              }}
            />
          ))}
          {sobre === 'fin' && <div className="tareasDestino" aria-hidden="true">soltar al final</div>}
        </div>
      )}
      {altaAbierta && (
        <ModalAltaTarea
          nombreColumna={p.nombre}
          onCerrar={() => setAltaAbierta(false)}
          onGuardar={p.onCrear}
        />
      )}
    </Caja>
  );
}
