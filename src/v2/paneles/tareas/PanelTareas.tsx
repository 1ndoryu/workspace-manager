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

/* Dashboard del permanente TASKS: el frente no tiene URL por tarea ni por
 * proyecto (main.tsx solo declara /, /arbitraje/, /privacidad/, /terminos/,
 * /prueba/), asi que "abrir en TASKS" abre el dashboard en pestana nueva, no un
 * deep-link inventado.
 * [por qué] El enlace bueno lo dice el propio puente (`estado.base`, que sale de
 * TASKS_BASE_URL del taller y en el portátil apunta al túnel a la 89). No hay puerto
 * fijo en el código: un valor por defecto sería el de un proyecto concreto y, sin el
 * puente, daría un enlace muerto. Si no hay base ni VITE_TAREAS_TABLERO_URL, el menú
 * no muestra «abrir en TASKS» (degradado explícito, no un enlace inventado). */
export const URL_TABLERO_TAREAS: string | null = import.meta.env.VITE_TAREAS_TABLERO_URL || null;

export function PanelTareas() {
  const t = usePanelTareas();

  if (!t.estado) {
    return (
      <Caja titulo="tareas" etiqueta="Kanban de tareas">
        <div className="docsVacio">{t.error ?? 'cargando…'}</div>
        {t.error && (
          <Button pequeno onClick={t.recargar} title="Reintentar la conexión con el servidor de tareas">
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
          si sigue así: define TASKS_BASE_URL y TASKS_EMAIL/TASKS_PASSWORD en logs/.tareas-env
          (workspace-manager); el puente lo lee en cada llamada, sin reiniciar nada. Las columnas
          las sincroniza el servidor (una por proyecto no-ignorado)
        </div>
        <Button pequeno onClick={t.recargar} title="Reintentar la conexión con el servidor de tareas">
          <RotateCw size={12} aria-hidden /> reintentar
        </Button>
      </Caja>
    );
  }

  // [por que] Se resuelve fuera del map: `t.estado` ya paso los guardas de arriba,
  // pero dentro del callback el tipo vuelve a ser anulable.
  const urlTareas = t.estado.base ?? URL_TABLERO_TAREAS;

  return (
    <div className="tareasContenedor">
      {t.error && <div className="tareasError" role="alert">{t.error}</div>}
      {/* La tarjeta se guardo y el roadmap no (20AA-10 F3b): se dice, no se esconde. */}
      {t.aviso && <div className="tareasAviso" role="status">{t.aviso}</div>}
      {/* Se llego desde la consola y no hay tarjeta que abrir (20AA-10 F5): el roadmap y TASK no
        * coinciden. Se dice en vez de dejar el clic en silencio. */}
      {t.avisoDestacada && <div className="tareasAviso" role="status">{t.avisoDestacada}</div>}
      <div className="tareasColumnas">
        {t.columnas.map((col) => (
          <div key={col.clave} className="tareasColumna">
            <ColumnaTareas
              legacyId={col.legacyId}
              nombre={col.nombre}
              tareas={t.tareas[col.legacyId] ?? null}
              cargando={t.cargando}
              moviendo={t.moviendo}
              urlTareas={urlTareas}
              destacadaId={t.destacada?.columna === col.legacyId ? t.destacada.legacyId : null}
              onSoltar={(origen, legacyId, antesDe) => void t.soltar(origen, col.legacyId, legacyId, antesDe)}
              onEditar={(legacyId, parche) => void t.editar(col.legacyId, legacyId, parche)}
              onEliminar={(legacyId) => void t.eliminar(col.legacyId, legacyId)}
              onCrear={(datos) => t.crear(col, datos)}
              onCrearSubtarea={(padre, texto) => t.crearSubtarea(col, padre, texto)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
