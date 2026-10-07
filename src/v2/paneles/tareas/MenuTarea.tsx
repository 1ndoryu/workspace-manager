/* Menu contextual de una tarjeta del kanban (07AA-15): lo mismo que la
 * tarea abierta en TASKS, sin repetir su logica (el menu solo cablea el
 * proxy via los callbacks del hook).
 * [por que] Espeja el `MenuContextual` de TASKS
 * (`opcionesMenuTarea.tsx`: fila con icono + etiqueta + check del valor
 * actual + flecha de submenu + separadores + pie) con el diseno v2
 * (monocromo estricto: inversion de relleno en hover/activo, sin sombras
 * ni radios; el peligro se marca por inversion permanente, nunca por
 * color). Prioridad (5 niveles) y urgencia (4) son submenus al hover como
 * en TASKS; `Abrir en TASKS` va en el pie con separador (precedente
 * `footer` de TASKS), no como enlace suelto.
 * (07AA-16) Flota en un portal al body con posicion fija: dentro de la
 * tarjeta se recortaba por el `overflow-x:auto` de las columnas
 * (precedente `EtiquetaDeRuta.tsx`); la posicion llega por CSS vars. */
import { useState, type CSSProperties } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronRight,
  ExternalLink,
  Flag,
  Pencil,
  Trash2,
  Zap,
} from 'lucide-react';
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

type SubmenuTarea = 'prioridad' | 'urgencia' | null;

export function MenuTarea(p: MenuTareaProps) {
  const hecha = completadoTarea(p.tarea);
  const pri = prioridadTarea(p.tarea);
  const urg = urgenciaTarea(p.tarea);
  /* (07AA-17) Unico estado: que submenu esta abierto (hover como en TASKS,
   * clic lo alterna para teclado/tactil). El resto sigue siendo render. */
  const [submenu, setSubmenu] = useState<SubmenuTarea>(null);
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
          className="tareasMenuOpcion"
          role="menuitem"
          onClick={cerrarCon(() => p.acciones.completar(!hecha))}
          onMouseEnter={() => setSubmenu(null)}
        >
          <span className="tareasMenuIcono">
            <Check size={12} />
          </span>
          <span className="tareasMenuEtiqueta">{hecha ? 'reabrir' : 'completar'}</span>
        </Button>
        <div
          className="tareasMenuEnvoltorio"
          onMouseEnter={() => setSubmenu('prioridad')}
        >
          <Button
            pequeno
            className="tareasMenuOpcion"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={submenu === 'prioridad'}
            onClick={() => setSubmenu(submenu === 'prioridad' ? null : 'prioridad')}
          >
            <span className="tareasMenuIcono">
              <Flag size={12} />
            </span>
            <span className="tareasMenuEtiqueta">prioridad</span>
            <span className="tareasMenuFlecha">
              <ChevronRight size={12} />
            </span>
          </Button>
          {submenu === 'prioridad' && (
            <div className="tareasMenuSub v2Superficie" role="menu" aria-label="prioridad">
              {PRIORIDADES_TAREA.map((nivel) => (
                <Button
                  key={nivel}
                  pequeno
                  className="tareasMenuOpcion"
                  role="menuitemradio"
                  aria-checked={pri === nivel}
                  onClick={cerrarCon(() => p.acciones.prioridad(pri === nivel ? null : nivel))}
                >
                  <span className="tareasMenuIcono" />
                  <span className="tareasMenuEtiqueta">{ETIQUETAS_PRIORIDAD[nivel]}</span>
                  {pri === nivel && (
                    <span className="tareasMenuMarca">
                      <Check size={12} />
                    </span>
                  )}
                </Button>
              ))}
            </div>
          )}
        </div>
        <div
          className="tareasMenuEnvoltorio"
          onMouseEnter={() => setSubmenu('urgencia')}
        >
          <Button
            pequeno
            className="tareasMenuOpcion"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={submenu === 'urgencia'}
            onClick={() => setSubmenu(submenu === 'urgencia' ? null : 'urgencia')}
          >
            <span className="tareasMenuIcono">
              <Zap size={12} />
            </span>
            <span className="tareasMenuEtiqueta">urgencia</span>
            <span className="tareasMenuFlecha">
              <ChevronRight size={12} />
            </span>
          </Button>
          {submenu === 'urgencia' && (
            <div className="tareasMenuSub v2Superficie" role="menu" aria-label="urgencia">
              {URGENCIAS_TAREA.map((nivel) => (
                <Button
                  key={nivel}
                  pequeno
                  className="tareasMenuOpcion"
                  role="menuitemradio"
                  aria-checked={urg === nivel}
                  onClick={cerrarCon(() => p.acciones.urgencia(nivel))}
                >
                  <span className="tareasMenuIcono" />
                  <span className="tareasMenuEtiqueta">{ETIQUETAS_URGENCIA[nivel]}</span>
                  {urg === nivel && (
                    <span className="tareasMenuMarca">
                      <Check size={12} />
                    </span>
                  )}
                </Button>
              ))}
            </div>
          )}
        </div>
        <div className="tareasMenuSeparador" />
        <Button
          pequeno
          className="tareasMenuOpcion"
          role="menuitem"
          disabled={!p.puedeMoverAtras}
          onClick={cerrarCon(() => p.acciones.moverVecina(-1))}
          onMouseEnter={() => setSubmenu(null)}
        >
          <span className="tareasMenuIcono">
            <ArrowLeft size={12} />
          </span>
          <span className="tareasMenuEtiqueta">columna anterior</span>
        </Button>
        <Button
          pequeno
          className="tareasMenuOpcion"
          role="menuitem"
          disabled={!p.puedeMoverAdelante}
          onClick={cerrarCon(() => p.acciones.moverVecina(1))}
          onMouseEnter={() => setSubmenu(null)}
        >
          <span className="tareasMenuIcono">
            <ArrowRight size={12} />
          </span>
          <span className="tareasMenuEtiqueta">columna siguiente</span>
        </Button>
        <Button
          pequeno
          className="tareasMenuOpcion"
          role="menuitem"
          onClick={cerrarCon(p.acciones.renombrar)}
          onMouseEnter={() => setSubmenu(null)}
        >
          <span className="tareasMenuIcono">
            <Pencil size={12} />
          </span>
          <span className="tareasMenuEtiqueta">renombrar</span>
        </Button>
        <Button
          pequeno
          className="tareasMenuOpcion tareasMenuOpcion--peligro"
          role="menuitem"
          onClick={cerrarCon(p.acciones.pedirEliminar)}
          onMouseEnter={() => setSubmenu(null)}
        >
          <span className="tareasMenuIcono">
            <Trash2 size={12} />
          </span>
          <span className="tareasMenuEtiqueta">eliminar</span>
        </Button>
        <div className="tareasMenuSeparador" />
        <div className="tareasMenuPie" role="none">
          <a
            className="tareasMenuOpcion"
            role="menuitem"
            href={p.urlTareas}
            target="_blank"
            rel="noreferrer"
            title="Abrir el dashboard de TASKS en pestaña nueva (el frente no tiene URL por tarea)"
          >
            <span className="tareasMenuIcono">
              <ExternalLink size={12} />
            </span>
            <span className="tareasMenuEtiqueta">abrir en TASKS</span>
          </a>
        </div>
      </div>
    </>
  );
}
