/* Tab kanban de tareas: columnas = proyectos TASKS via proxy F2 (07AA-5 F3).
 * [por que] Componente fino (un useState para el alta): estado y red en
 * usePanelTareas. Degradado visible, nunca verde ambiguo: si el puente no
 * esta disponible se pinta el motivo + reintentar, no un kanban vacio. El
 * orden de columnas es presentacion WM (localStorage); el de tareas vive en
 * TASKS y cada movimiento relee (sobrevive a recargas). */
import { useState } from 'react';
import { Button } from '../../ui/form/Button.js';
import { Caja } from '../../ui/caja/Caja.js';
import { FilaCajas } from '../../ui/caja/FilaCajas.js';
import { usePanelTareas } from '../../../hooks/usePanelTareas.js';
import { parsearLegacyId } from '../../../shared/tareasTab.js';
import { ColumnaTareas } from './ColumnaTareas.js';
import './tareas.css';

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

  const ids = [...t.columnas.map(String), 'nueva'];
  const agregar = () => {
    const id = parsearLegacyId(nueva);
    if (id === null) return;
    t.agregarColumna(id);
    setNueva('');
  };

  return (
    <div className="tareasContenedor">
      {t.error && <div className="tareasError" role="alert">{t.error}</div>}
      <FilaCajas fila="tareas" ids={ids} defectos={t.columnas.map(() => 1).concat(1)}>
        {t.columnas.map((col, ci) => (
          <ColumnaTareas
            key={col}
            legacyId={col}
            primera={ci === 0}
            ultima={ci === t.columnas.length - 1}
            tareas={t.tareas[col] ?? null}
            cargando={t.cargando}
            moviendo={t.moviendo}
            onSubir={(i) => void t.reordenar(col, i, i - 1)}
            onBajar={(i) => void t.reordenar(col, i, i + 1)}
            onMigrar={(id, dir) => void t.migrar(col, id, dir)}
            onMoverColumna={(dir) => t.moverColumna(col, dir)}
            onQuitar={() => t.quitarColumna(col)}
          />
        ))}
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
      </FilaCajas>
    </div>
  );
}
