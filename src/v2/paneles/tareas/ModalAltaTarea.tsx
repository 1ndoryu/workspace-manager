/* Modal de alta rapida de tarea (08AA-7): espejo minimalista del
 * ModalCreacionRapida de TASKS, adaptado al proxy WM y a la estetica
 * monocroma v2 (sin radios, sin sombras, sin velos de color).
 * [por que] El usuario pidio el alta por modal "como en TASKS": mismo
 * contrato (overlay que cierra al clic, Escape, autofocus, submit ->
 * guardar -> cerrar, proyecto prefijado por la columna) y mismo layout
 * spotlight (caja ancha centrada, entrada sin bordes, fila de iconos de
 * opcion con menus desplegables, flecha de envio fantasma). Recortes
 * honestos: el PUT-upsert del proxy solo soporta texto+prioridad+urgencia
 * (sin proyecto elegible —lo fija la columna—, fecha, adjuntos ni
 * frecuencia, que TASKS guarda en su BD), asi que la fila de opciones solo
 * lleva Flag (prioridad) y Zap (urgencia). Se pinta en el arbol (sin
 * portal): el overlay es `position:fixed` (relativo al viewport, ningun
 * ancestro crea containing block) asi que ningun `overflow` de las
 * columnas lo recorta; la fuente v2 se fija aqui (07AA-18: lo portaleado
 * la necesitaba por lo mismo). Estado en useModalAltaTarea (08AA-8).
 * (08AA-8) Cierre instantaneo con alta optimista: guardar cierra y dispara
 * sin esperar (la tarjeta fantasma la pinta el hook de la tab). */
import { ArrowRight, Check, Flag, Zap } from 'lucide-react';
import { Button } from '../../ui/form/Button.js';
import {
  ETIQUETAS_PRIORIDAD,
  ETIQUETAS_URGENCIA,
  PRIORIDADES_TAREA,
  URGENCIAS_TAREA,
} from '../../../shared/tareasTab.js';
import { useModalAltaTarea, type DatosAltaTarea } from './useModalAltaTarea.js';

export type { DatosAltaTarea };

interface ModalAltaTareaProps {
  nombreColumna: string;
  onCerrar: () => void;
  onGuardar: (datos: DatosAltaTarea) => Promise<void>;
}

export function ModalAltaTarea(p: ModalAltaTareaProps) {
  const m = useModalAltaTarea(p);

  return (
    <div className="tareasModalFondo" onClick={p.onCerrar}>
      <div
        className="tareasModal v2Superficie"
        role="dialog"
        aria-label={`Crear tarea en ${p.nombreColumna}`}
        onClick={(ev) => ev.stopPropagation()}
      >
        <form
          onSubmit={(ev) => {
            ev.preventDefault();
            m.guardar();
          }}
        >
          <div className="tareasModalFila">
            <input
              ref={m.entradaRef}
              className="tareasModalEntrada"
              type="text"
              value={m.texto}
              onChange={(ev) => m.setTexto(ev.target.value)}
              onKeyDown={m.teclaEntrada}
              placeholder={`Nueva tarea en ${p.nombreColumna}…`}
              maxLength={1000}
              aria-label={`Texto de la tarea en ${p.nombreColumna}`}
            />
            <Button
              type="submit"
              className="tareasModalEnviar"
              disabled={!m.puedeGuardar}
              title={`Crear tarea en ${p.nombreColumna}`}
              aria-label={`Crear tarea en ${p.nombreColumna}`}
            >
              <ArrowRight size={20} aria-hidden />
            </Button>
          </div>
          <div className="tareasModalOpciones">
            <Button
              type="button"
              className="tareasModalFantasma"
              activo={m.prioridad !== null}
              onClick={() => m.setMenu(m.menu === 'prioridad' ? null : 'prioridad')}
              onKeyDown={(ev) => {
                if (ev.key === 'Escape') m.setMenu(null);
              }}
              title={m.tituloPrioridad}
              aria-label={m.tituloPrioridad}
              aria-expanded={m.menu === 'prioridad'}
            >
              <Flag size={14} aria-hidden />
            </Button>
            <Button
              type="button"
              className="tareasModalFantasma"
              activo={m.urgencia !== 'normal'}
              onClick={() => m.setMenu(m.menu === 'urgencia' ? null : 'urgencia')}
              onKeyDown={(ev) => {
                if (ev.key === 'Escape') m.setMenu(null);
              }}
              title={m.tituloUrgencia}
              aria-label={m.tituloUrgencia}
              aria-expanded={m.menu === 'urgencia'}
            >
              <Zap size={14} aria-hidden />
            </Button>
          </div>
        </form>
        {m.menu === 'prioridad' && (
          <div className="tareasModalMenu v2Superficie" role="menu" aria-label="Prioridad">
            <Button
              type="button"
              className="tareasMenuOpcion"
              onClick={() => m.elegir({ texto: m.texto, prioridad: null, urgencia: m.urgencia })}
            >
              <span className="tareasMenuEtiqueta">sin prioridad</span>
              <span className="tareasMenuMarca">{m.prioridad === null && <Check size={12} aria-hidden />}</span>
            </Button>
            {PRIORIDADES_TAREA.map((nivel) => (
              <Button
                key={nivel}
                type="button"
                className="tareasMenuOpcion"
                onClick={() => m.elegir({ texto: m.texto, prioridad: nivel, urgencia: m.urgencia })}
              >
                <span className="tareasMenuEtiqueta">{ETIQUETAS_PRIORIDAD[nivel]}</span>
                <span className="tareasMenuMarca">{m.prioridad === nivel && <Check size={12} aria-hidden />}</span>
              </Button>
            ))}
          </div>
        )}
        {m.menu === 'urgencia' && (
          <div className="tareasModalMenu v2Superficie" role="menu" aria-label="Urgencia">
            {URGENCIAS_TAREA.map((nivel) => (
              <Button
                key={nivel}
                type="button"
                className="tareasMenuOpcion"
                onClick={() => m.elegir({ texto: m.texto, prioridad: m.prioridad, urgencia: nivel })}
              >
                <span className="tareasMenuEtiqueta">{ETIQUETAS_URGENCIA[nivel]}</span>
                <span className="tareasMenuMarca">{m.urgencia === nivel && <Check size={12} aria-hidden />}</span>
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
