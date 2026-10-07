/* Menu contextual de una tarjeta del kanban (07AA-15): lo mismo que la
 * tarea abierta en TASKS, sin repetir su logica (el menu solo cablea el
 * proxy via los callbacks del hook).
 * [por que] Componente puro sin estado: lo abre/cierra la tarjeta. Las
 * opciones espejean el frente (TareaItem + CampoPrioridad/CampoUrgencia):
 * completar, prioridad (5 niveles), urgencia (4), mover a columna vecina
 * (via de teclado del DnD), renombrar, eliminar y abrir en TASKS. El
 * cierre es render puro: fondo que captura el clic + Escape, sin efectos.
 * (07AA-16) Flota en un portal al body con posicion fija: dentro de la
 * tarjeta se recortaba por el `overflow-x:auto` de las columnas
 * (precedente `EtiquetaDeRuta.tsx`); la posicion llega por CSS vars. */
import type { CSSProperties } from 'react';
import { Button } from '../../ui/form/Button.js';
import {
  ETIQUETAS_PRIORIDAD,
  ETIQUETAS_URGENCIA,
  PRIORIDADES_TAREA,
  URGENCIAS_TAREA,
  completadoTarea,
  prioridadTarea,
  textoTarea,
  urgenciaTarea,
  type TareaTab,
} from '../../../shared/tareasTab.js';

/* Acciones del menu agrupadas (07AA-15): seis callbacks en un objeto para
 * no rozar large-interface-isp; el menu solo cablea el proxy via el hook. */
export interface AccionesTareaMenu {
  completar: (completado: boolean) => void;
  prioridad: (prioridad: string | null) => void;
  urgencia: (urgencia: string) => void;
  renombrar: () => void;
  moverVecina: (dir: -1 | 1) => void;
  pedirEliminar: () => void;
}

/* Posicion fija del menu en el viewport (07AA-16): la calcula el hook
 * `useMenuTarjeta` desde la tarjeta; el CSS la consume por vars. */
export interface PosMenuTarea {
  x: number;
  y: number;
}

export interface MenuTareaProps {
  tarea: TareaTab;
  puedeMoverAtras: boolean;
  puedeMoverAdelante: boolean;
  urlTareas: string;
  pos: PosMenuTarea;
  onCerrar: () => void;
  acciones: AccionesTareaMenu;
}

export function MenuTarea(p: MenuTareaProps) {
  const hecha = completadoTarea(p.tarea);
  const pri = prioridadTarea(p.tarea);
  const urg = urgenciaTarea(p.tarea);
  const cerrarCon = (fn: () => void) => () => {
    fn();
    p.onCerrar();
  };
  return (
    <>
      <button
        type="button"
        className="tareasMenuFondo"
        aria-label="cerrar el menú"
        onClick={p.onCerrar}
      />
      <div
        className="tareasMenu v2Superficie"
        role="menu"
        style={{ '--tareas-menu-x': `${p.pos.x}px`, '--tareas-menu-y': `${p.pos.y}px` } as CSSProperties}
        aria-label={`Acciones de ${textoTarea(p.tarea)}`}
        onKeyDown={(ev) => {
          if (ev.key === 'Escape') p.onCerrar();
        }}
      >
        <Button
          pequeno
          className="tareasMenuItem"
          role="menuitem"
          onClick={cerrarCon(() => p.acciones.completar(!hecha))}
        >
          {hecha ? '○ reabrir' : '● completar'}
        </Button>
        <div className="tareasMenuGrupo" role="group" aria-label="prioridad">
          <span className="tareasMenuTitulo">prioridad</span>
          {PRIORIDADES_TAREA.map((nivel) => (
            <Button
              key={nivel}
              pequeno
              activo={pri === nivel}
              className="tareasMenuItem"
              role="menuitemradio"
              aria-checked={pri === nivel}
              onClick={cerrarCon(() => p.acciones.prioridad(pri === nivel ? null : nivel))}
            >
              {pri === nivel ? '●' : '○'} {ETIQUETAS_PRIORIDAD[nivel]}
            </Button>
          ))}
        </div>
        <div className="tareasMenuGrupo" role="group" aria-label="urgencia">
          <span className="tareasMenuTitulo">urgencia</span>
          {URGENCIAS_TAREA.map((nivel) => (
            <Button
              key={nivel}
              pequeno
              activo={urg === nivel}
              className="tareasMenuItem"
              role="menuitemradio"
              aria-checked={urg === nivel}
              onClick={cerrarCon(() => p.acciones.urgencia(nivel))}
            >
              {urg === nivel ? '●' : '○'} {ETIQUETAS_URGENCIA[nivel]}
            </Button>
          ))}
        </div>
        <Button
          pequeno
          className="tareasMenuItem"
          role="menuitem"
          disabled={!p.puedeMoverAtras}
          onClick={cerrarCon(() => p.acciones.moverVecina(-1))}
        >
          ← columna anterior
        </Button>
        <Button
          pequeno
          className="tareasMenuItem"
          role="menuitem"
          disabled={!p.puedeMoverAdelante}
          onClick={cerrarCon(() => p.acciones.moverVecina(1))}
        >
          columna siguiente →
        </Button>
        <Button pequeno className="tareasMenuItem" role="menuitem" onClick={cerrarCon(p.acciones.renombrar)}>
          renombrar
        </Button>
        <Button
          pequeno
          className="tareasMenuItem"
          role="menuitem"
          onClick={cerrarCon(p.acciones.pedirEliminar)}
        >
          × eliminar
        </Button>
        <a
          className="tareasMenuItem tareasMenuEnlace"
          role="menuitem"
          href={p.urlTareas}
          target="_blank"
          rel="noreferrer"
          title="Abrir el dashboard de TASKS en pestaña nueva (el frente no tiene URL por tarea)"
        >
          ↗ abrir en TASKS
        </a>
      </div>
    </>
  );
}
