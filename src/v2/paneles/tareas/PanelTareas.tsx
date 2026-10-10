/* Tab kanban de tareas: columnas fijas = repos WM via proxy (07AA-5 F3,
 * DnD + menu 07AA-15, columnas fijas 08AA-6, alta por modal 08AA-7).
 * [por que] Componente fino (sin estado): estado y red en usePanelTareas.
 * Degradado visible, nunca verde ambiguo: si el puente no esta disponible
 * se pinta el motivo + reintentar, no un kanban vacio. El orden de columnas
 * lo fija el snapshot WM y el de tareas vive en TASKS; cada movimiento o
 * alta relee (sobrevive a recargas). Las columnas van en fila con scroll
 * horizontal propio (ancho fijo por columna, como un kanban): FilaCajas
 * reparte el ancho y las aplasta, no sirve aqui. */
import { RotateCw } from 'lucide-react';
import { Button } from '../../ui/form/Button.js';
import { Caja } from '../../ui/caja/Caja.js';
import { usePanelTareas } from '../../../hooks/usePanelTareas.js';
import { ColumnaTareas } from './ColumnaTareas.js';
import './tareas.css';

/* Dashboard del permanente TASKS (Vite 4191): el frente no tiene URL por
 * tarea ni por proyecto (main.tsx solo declara /, /arbitraje/,
 * /privacidad/, /terminos/, /prueba/), asi que "abrir en TASKS" abre el
 * dashboard en pestana nueva, no un deep-link inventado. */
export const URL_TABLERO_TAREAS = 'http://127.0.0.1:4191/';

export function PanelTareas() {
  const t = usePanelTareas();

  if (!t.estado) {
    return (
      <Caja titulo="tareas" etiqueta="Kanban de tareas">
        <div className="docsVacio">{t.error ?? 'cargando…'}</div>
        {t.error && (
          <Button pequeno onClick={t.recargar} title="Reintentar la conexión con PROYECTO TASKS">
            <RotateCw size={12} aria-hidden /> reintentar
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
          para probarla: define TASKS_EMAIL y TASKS_PASSWORD en logs/.tareas-env (workspace-manager)
          y reinicia el backend (puerto 8787); las columnas las sincroniza el servidor (una por
          proyecto no-ignorado)
        </div>
        <Button pequeno onClick={t.recargar} title="Reintentar la conexión con PROYECTO TASKS">
          <RotateCw size={12} aria-hidden /> reintentar
        </Button>
      </Caja>
    );
  }

  return (
    <div className="tareasContenedor">
      {t.error && <div className="tareasError" role="alert">{t.error}</div>}
      <div className="tareasColumnas">
        {t.columnas.map((col) => (
          <div key={col.clave} className="tareasColumna">
            <ColumnaTareas
              legacyId={col.legacyId}
              nombre={col.nombre}
              tareas={t.tareas[col.legacyId] ?? null}
              cargando={t.cargando}
              moviendo={t.moviendo}
              urlTareas={URL_TABLERO_TAREAS}
              onSoltar={(origen, legacyId, antesDe) => void t.soltar(origen, col.legacyId, legacyId, antesDe)}
              onEditar={(legacyId, parche) => void t.editar(col.legacyId, legacyId, parche)}
              onEliminar={(legacyId) => void t.eliminar(col.legacyId, legacyId)}
              onCrear={(datos) => t.crear(col, datos)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
