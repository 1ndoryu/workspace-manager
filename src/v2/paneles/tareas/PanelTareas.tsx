/* Tab kanban de tareas: columnas = proyectos TASKS via proxy F2 (07AA-5 F3,
 * DnD + menu 07AA-15).
 * [por que] Componente fino (un useState para el alta): estado y red en
 * usePanelTareas. Degradado visible, nunca verde ambiguo: si el puente no
 * esta disponible se pinta el motivo + reintentar, no un kanban vacio. El
 * orden de columnas es presentacion WM (localStorage); el de tareas vive en
 * TASKS y cada movimiento relee (sobrevive a recargas). Las columnas van en
 * fila con scroll horizontal propio (ancho fijo por columna, como un
 * kanban): FilaCajas reparte el ancho y las aplasta, no sirve aqui. */
import { useState } from 'react';
import { Button } from '../../ui/form/Button.js';
import { Caja } from '../../ui/caja/Caja.js';
import { usePanelTareas } from '../../../hooks/usePanelTareas.js';
import { parsearLegacyId } from '../../../shared/tareasTab.js';
import { ColumnaTareas } from './ColumnaTareas.js';
import './tareas.css';

/* Dashboard del permanente TASKS (Vite 4191): el frente no tiene URL por
 * tarea ni por proyecto (main.tsx solo declara /, /arbitraje/,
 * /privacidad/, /terminos/, /prueba/), asi que "abrir en TASKS" abre el
 * dashboard en pestana nueva, no un deep-link inventado. */
export const URL_TABLERO_TAREAS = 'http://127.0.0.1:4191/';

export function PanelTareas() {
  const t = usePanelTareas();
  const [nueva, setNueva] = useState('');

  if (!t.estado) {
    return (
      <Caja titulo="tareas" etiqueta="Kanban de tareas">
        <div className="docsVacio">{t.error ?? 'cargando…'}</div>
        {t.error && (
          <Button pequeno onClick={t.recargar} title="Reintentar la conexión con PROYECTO TASKS">
            ⟳ reintentar
          </Button>
        )}
      </Caja>
    );
  }

  if (!t.estado.disponible) {
    return (
      <Caja titulo="tareas" etiqueta="Kanban de tareas">
        <div className="docsVacio">
          no disponible{t.estado.motivo ? `: ${t.estado.motivo}` : ''} (el puente informa, no inventa)
        </div>
        <div className="docsVacio">
          para probarla: define TASKS_EMAIL y TASKS_PASSWORD en el entorno del backend (puerto
          8787) y reinícialo; las columnas por defecto (9001/9002) son el seed F1 en BD de rama
        </div>
        <Button pequeno onClick={t.recargar} title="Reintentar la conexión con PROYECTO TASKS">
          ⟳ reintentar
        </Button>
      </Caja>
    );
  }

  const agregar = () => {
    const id = parsearLegacyId(nueva);
    if (id === null) return;
    t.agregarColumna(id);
    setNueva('');
  };

  /* Via de teclado del DnD (el menu la ofrece): suelta al final de la
   * columna vecina. */
  const moverVecina = (col: number, legacyId: number, dir: -1 | 1) => {
    const j = t.columnas.indexOf(col) + dir;
    if (j < 0 || j >= t.columnas.length) return;
    void t.soltar(col, t.columnas[j], legacyId, null);
  };

  return (
    <div className="tareasContenedor">
      {t.error && <div className="tareasError" role="alert">{t.error}</div>}
      <div className="tareasColumnas">
        {t.columnas.map((col, ci) => (
          <div key={col} className="tareasColumna">
            <ColumnaTareas
              legacyId={col}
              primera={ci === 0}
              ultima={ci === t.columnas.length - 1}
              tareas={t.tareas[col] ?? null}
              cargando={t.cargando}
              moviendo={t.moviendo}
              urlTareas={URL_TABLERO_TAREAS}
              onSoltar={(origen, legacyId, antesDe) => void t.soltar(origen, col, legacyId, antesDe)}
              onEditar={(legacyId, parche) => void t.editar(col, legacyId, parche)}
              onEliminar={(legacyId) => void t.eliminar(col, legacyId)}
              onMoverVecina={(legacyId, dir) => moverVecina(col, legacyId, dir)}
              onMoverColumna={(dir) => t.moverColumna(col, dir)}
              onQuitar={() => t.quitarColumna(col)}
            />
          </div>
        ))}
        <div className="tareasColumna">
          <Caja titulo="agregar" etiqueta="Agregar columna por legacy_id">
            <div className="tareasAlta">
              <input
                className="tareasAltaEntrada"
                value={nueva}
                onChange={(ev) => setNueva(ev.target.value)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter') agregar();
                }}
                placeholder="legacy_id (p. ej. 9001)"
                inputMode="numeric"
                aria-label="legacy_id del proyecto a agregar como columna"
              />
              <Button pequeno onClick={agregar} disabled={parsearLegacyId(nueva) === null} title="Agregar la columna">
                + agregar
              </Button>
            </div>
            <div className="docsVacio">las columnas son proyectos TASKS; quitarlas solo las oculta aquí</div>
          </Caja>
        </div>
      </div>
    </div>
  );
}
