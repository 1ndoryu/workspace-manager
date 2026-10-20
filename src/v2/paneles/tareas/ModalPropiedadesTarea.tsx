/* Propiedades de una tarea del roadmap (20AA-10 F4): prioridad, urgencia,
 * fechas, etiquetas y dependencias.
 * [por que un modal y no el menu] Las dos primeras caben en un submenu (y el
 * menu las sigue teniendo, para lo rapido); las otras tres son listas y
 * fechas, que no se eligen de una lista cerrada: aqui se ven todas juntas y
 * se guarda una vez.
 * [por que manda los campos que el roadmap guarda] Etiquetas, dependencias y
 * fechas no existen en TASK: viajan como claves del parche y el proxy las
 * mete en el payload. Lo vacio se manda como lista vacia y el proxy borra la
 * clave (no se guarda una etiqueta en blanco). */
import { useState, type CSSProperties } from 'react';
import { Button } from '../../ui/form/Button.js';
import {
  ETIQUETAS_PRIORIDAD,
  ETIQUETAS_URGENCIA,
  FECHAS_TAREA,
  PRIORIDADES_TAREA,
  URGENCIAS_TAREA,
  fechaValida,
  listaATexto,
  listaTecleada,
  type ParcheTareaTab,
  type TareaTab,
} from '../../../shared/tareas/tareasTab.js';

interface ModalPropiedadesTareaProps {
  tarea: TareaTab;
  /* Nombre de la tarea tal como se lee, para el titulo del dialogo. */
  texto: string;
  onCerrar: () => void;
  onGuardar: (parche: ParcheTareaTab) => void;
}

/* Lo que dice cada fecha en el formulario, con su nombre del protocolo. */
const NOMBRE_FECHA: Record<string, string> = {
  creada: 'creada',
  pospuesta: 'pospuesta',
  completada: 'completada',
};

export function ModalPropiedadesTarea(p: ModalPropiedadesTareaProps) {
  const [campos, setCampos] = useState(() => ({
    prioridad: (typeof p.tarea.campos.prioridad === 'string' ? (p.tarea.campos.prioridad as string) : ''),
    urgencia: (typeof p.tarea.campos.urgencia === 'string' ? (p.tarea.campos.urgencia as string) : 'normal'),
    etiquetas: listaATexto(Array.isArray(p.tarea.campos.etiquetas) ? (p.tarea.campos.etiquetas as string[]) : []),
    dependeDe: listaATexto(Array.isArray(p.tarea.campos.dependeDe) ? (p.tarea.campos.dependeDe as string[]) : []),
    fechas: Object.fromEntries(
      FECHAS_TAREA.map((k) => [k, typeof p.tarea.campos[k] === 'string' ? (p.tarea.campos[k] as string) : '']),
    ) as Record<string, string>,
  }));

  const guardar = () => {
    const parche: ParcheTareaTab = {
      texto: p.texto,
      prioridad: campos.prioridad === '' ? null : campos.prioridad,
      urgencia: campos.urgencia === '' ? 'normal' : campos.urgencia,
      etiquetas: listaTecleada(campos.etiquetas),
      dependeDe: listaTecleada(campos.dependeDe),
    };
    for (const k of FECHAS_TAREA) {
      /* Un campo de fecha a medio escribir no es una fecha: se manda como «quitar», no como texto
       * que el parser rechazaria. */
      parche[k] = fechaValida(campos.fechas[k] ?? '');
    }
    p.onGuardar(parche);
  };

  const set = (cambio: Partial<typeof campos>) => setCampos((c) => ({ ...c, ...cambio }));

  return (
    <div className="tareasModalFondo" onClick={p.onCerrar}>
      <div
        className="tareasModal tareasModal--ancho v2Superficie"
        role="dialog"
        aria-label={`Propiedades de ${p.texto}`}
        onClick={(ev) => ev.stopPropagation()}
        onKeyDown={(ev) => {
          if (ev.key === 'Escape') p.onCerrar();
          if (ev.key === 'Enter' && ev.target instanceof HTMLInputElement) guardar();
        }}
        style={{ '--tareas-modal-ancho': '26rem' } as CSSProperties}
      >
        <div className="tareasModalFila">
          <span className="tareasModalTitulo">propiedades — {p.texto}</span>
          <Button cuadrado pequeno onClick={p.onCerrar} title="Cerrar" aria-label="Cerrar">
            ×
          </Button>
        </div>
        <div className="tareasPropiedades">
          <label className="tareasCampo">
            <span className="tareasCampoNombre">prioridad</span>
            <select
              className="tareasCampoEntrada"
              value={campos.prioridad}
              onChange={(ev) => set({ prioridad: ev.target.value })}
            >
              <option value="">sin prioridad</option>
              {PRIORIDADES_TAREA.map((n) => (
                <option key={n} value={n}>
                  {ETIQUETAS_PRIORIDAD[n]}
                </option>
              ))}
            </select>
          </label>
          <label className="tareasCampo">
            <span className="tareasCampoNombre">urgencia</span>
            <select
              className="tareasCampoEntrada"
              value={campos.urgencia}
              onChange={(ev) => set({ urgencia: ev.target.value })}
            >
              {URGENCIAS_TAREA.map((n) => (
                <option key={n} value={n}>
                  {ETIQUETAS_URGENCIA[n]}
                </option>
              ))}
            </select>
          </label>
          <label className="tareasCampo">
            <span className="tareasCampoNombre">etiquetas</span>
            <input
              className="tareasCampoEntrada"
              type="text"
              value={campos.etiquetas}
              placeholder="separadas por comas"
              aria-label="etiquetas, separadas por comas"
              onChange={(ev) => set({ etiquetas: ev.target.value })}
            />
          </label>
          <label className="tareasCampo">
            <span className="tareasCampoNombre">depende-de</span>
            <input
              className="tareasCampoEntrada"
              type="text"
              value={campos.dependeDe}
              placeholder="IDs separados por comas (20AA-8)"
              aria-label="dependencias, IDs separados por comas"
              onChange={(ev) => set({ dependeDe: ev.target.value })}
            />
          </label>
          {FECHAS_TAREA.map((k) => (
            <label className="tareasCampo" key={k}>
              <span className="tareasCampoNombre">{NOMBRE_FECHA[k]}</span>
              <input
                className="tareasCampoEntrada"
                type="date"
                value={campos.fechas[k] ?? ''}
                aria-label={k}
                onChange={(ev) => set({ fechas: { ...campos.fechas, [k]: ev.target.value } })}
              />
            </label>
          ))}
        </div>
        <div className="tareasModalOpciones">
          <Button pequeno onClick={guardar} title="Guardar las propiedades en TASK y en el roadmap">
            guardar
          </Button>
        </div>
      </div>
    </div>
  );
}
