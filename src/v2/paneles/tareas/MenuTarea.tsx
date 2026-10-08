/* Menu contextual de una tarjeta del kanban (07AA-15): lo mismo que la
 * tarea abierta en TASKS, sin repetir su logica (el menu solo cablea el
 * proxy via los callbacks del hook).
 * [por que] Espeja el `MenuContextual` de TASKS
 * (`opcionesMenuTarea.tsx`: fila con icono + etiqueta + check del valor
 * actual + flecha de submenu + separadores + pie) con el diseno v2
 * (monocromo estricto: inversion de relleno en hover/activo, sin sombras
 * ni radios; el peligro se marca por inversion permanente, nunca por
 * color). Prioridad (5 niveles) y urgencia (4) vuelan en un portal al body
 * con posicion fija medida de la fila (08AA-2: dentro del menu las
 * recortaba el `overflow-y:auto`); `Abrir en TASKS` va en el pie con
 * separador (precedente `footer` de TASKS), con las mismas clases de fila
 * que el resto (08AA-2: el `<a>` suelto desentonaba).
 * (07AA-16) Flota en un portal al body con posicion fija: dentro de la
 * tarjeta se recortaba por el `overflow-x:auto` de las columnas
 * (precedente `EtiquetaDeRuta.tsx`); la posicion llega por CSS vars. */
import { useState, type CSSProperties, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
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
import { cuerpoDocumento, anchoVentana, altoVentana } from '../../../shared/platform/plataforma.js';
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
  /* (08AA-2) Posicion del submenu volador, medida de la fila que lo abre:
   * hover abre (como en TASKS) y clic alterna (teclado/tactil). */
  const [posSub, setPosSub] = useState<PosMenuTarea | null>(null);
  const abrirSub = (id: Exclude<SubmenuTarea, null>) => (ev: MouseEvent<HTMLElement>) => {
    const r = ev.currentTarget.getBoundingClientRect();
    setPosSub({
      x: Math.max(8, Math.min(r.right + 4, anchoVentana() - 196)),
      y: Math.max(8, Math.min(r.top, altoVentana() - 180)),
    });
    setSubmenu(id);
  };
  const pulsarSub = (id: Exclude<SubmenuTarea, null>) => (ev: MouseEvent<HTMLElement>) => {
    if (submenu === id) {
      setSubmenu(null);
      return;
    }
    abrirSub(id)(ev);
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
          onMouseEnter={abrirSub('prioridad')}
        >
          <Button
            pequeno
            className="tareasMenuOpcion"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={submenu === 'prioridad'}
            onClick={pulsarSub('prioridad')}
          >
            <span className="tareasMenuIcono">
              <Flag size={12} />
            </span>
            <span className="tareasMenuEtiqueta">prioridad</span>
            <span className="tareasMenuFlecha">
              <ChevronRight size={12} />
            </span>
          </Button>
        </div>
        <div
          className="tareasMenuEnvoltorio"
          onMouseEnter={abrirSub('urgencia')}
        >
          <Button
            pequeno
            className="tareasMenuOpcion"
            role="menuitem"
            aria-haspopup="menu"
            aria-expanded={submenu === 'urgencia'}
            onClick={pulsarSub('urgencia')}
          >
            <span className="tareasMenuIcono">
              <Zap size={12} />
            </span>
            <span className="tareasMenuEtiqueta">urgencia</span>
            <span className="tareasMenuFlecha">
              <ChevronRight size={12} />
            </span>
          </Button>
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
            className="botonV2 botonV2--pequeno tareasMenuOpcion"
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
      {/* (08AA-2) Submenu volador en portal: fuera del `.tareasMenu` para
        * que su `overflow-y:auto` no lo recorte; posicion fija de `posSub`. */}
      {submenu !== null && posSub !== null && createPortal(
        <div
          className="tareasMenuSub v2Superficie"
          role="menu"
          aria-label={submenu}
          style={{ '--tareas-sub-x': `${posSub.x}px`, '--tareas-sub-y': `${posSub.y}px` } as CSSProperties}
        >
          {(submenu === 'prioridad' ? PRIORIDADES_TAREA : URGENCIAS_TAREA).map((nivel) => {
            const marcado = submenu === 'prioridad' ? pri === nivel : urg === nivel;
            const etiqueta = (submenu === 'prioridad' ? ETIQUETAS_PRIORIDAD : ETIQUETAS_URGENCIA)[nivel];
            return (
              <Button
                key={nivel}
                pequeno
                className="tareasMenuOpcion"
                role="menuitemradio"
                aria-checked={marcado}
                onClick={cerrarCon(() =>
                  submenu === 'prioridad'
                    ? p.acciones.prioridad(pri === nivel ? null : nivel)
                    : p.acciones.urgencia(nivel),
                )}
              >
                <span className="tareasMenuIcono" />
                <span className="tareasMenuEtiqueta">{etiqueta}</span>
                {marcado && (
                  <span className="tareasMenuMarca">
                    <Check size={12} />
                  </span>
                )}
              </Button>
            );
          })}
        </div>,
        cuerpoDocumento(),
      )}
    </>
  );
}
