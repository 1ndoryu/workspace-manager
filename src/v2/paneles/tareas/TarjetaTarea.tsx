/* Tarjeta arrastrable del kanban (07AA-15): casilla cuadrada propia +
 * texto (renombrable inline) + chips de nivel + boton de menu
 * (MoreHorizontal) con MenuTarea.
 * [por que] Un solo useState objeto (vista: editando / borrador /
 * confirmarBorrado) para no rozar usestate-excesivo. La casilla es un
 * <Button> con el compuesto `.botonV2.tareasCasilla` (cuadrado de 14px sin
 * radio, inversion monocroma al completar: diseno propio a pedido del
 * usuario, sin checkbox nativo). El menu flota en un
 * portal al body (07AA-16: dentro de la tarjeta lo recortaba el scroll-X)
 * con ancla del hook `useMenuTarjeta`. El arrastre es DnD
 * nativo sin librerias: la columna pone los datos (origen + id) y el
 * destino (delante de que tarjeta). Cada gesto escribe via el hook (proxy
 * + relectura); aqui solo se cablea. (08AA-5) Sin mover a vecina: ni las
 * flechas de la tarjeta ni las filas del menu son necesarias, el
 * arrastre cubre el cambio de columna. */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, CornerDownRight, MoreHorizontal, X } from 'lucide-react';
import { cuerpoDocumento } from '../../../shared/platform/plataforma.js';
import { Button } from '../../ui/form/Button.js';
import {
  ETIQUETAS_PRIORIDAD,
  ETIQUETAS_URGENCIA,
  completadoTarea,
  prioridadTarea,
  textoTarea,
  urgenciaTarea,
  type ParcheTareaTab,
  type TareaTab,
} from '../../../shared/tareas/tareasTab.js';
import { MenuTarea } from './MenuTarea.js';
import { ModalPropiedadesTarea } from './ModalPropiedadesTarea.js';
import { useMenuTarjeta } from './useMenuTarjeta.js';

interface VistaTarjeta {
  editando: boolean;
  borrador: string;
  confirmarBorrado: boolean;
}

/* Gestos de la tarjeta agrupados (07AA-15): el arrastre viaja en
 * sub-objeto para no rozar large-interface-isp; la columna los construye. */

export interface ArrastreTarjeta {
  inicio: (ev: React.DragEvent) => void;
  encima: (ev: React.DragEvent) => void;
  pasar: () => void;
}

export interface TarjetaGestos {
  arrastrable: boolean;
  /* Hay una operacion en vuelo: la casilla no admite otra. [por que no basta
   * `arrastrable`] Una subtarea no se arrastra nunca, pero si se marca: atar el
   * `disabled` de la casilla al arrastre dejaba las subtareas sin poder completar. */
  ocupada: boolean;
  resaltada: boolean;
  enVuelo: boolean;
  urlTareas: string | null;
  arrastre: ArrastreTarjeta;
  onEditar: (parche: ParcheTareaTab) => void;
  onEliminar: () => void;
  /* Solo en una tarea raiz (20AA-10 F4): abre la entrada de subtarea debajo. */
  onNuevaSubtarea: () => void;
}

interface TarjetaTareaProps {
  tarea: TareaTab;
  gestos: TarjetaGestos;
  /* Es una subtarea: se pinta sangrada, no se arrastra y no admite subtareas
   * propias (TASK solo tiene dos niveles: `parentId` vale si el padre es raiz
   * y la tarea escrita no tiene hijos). */
  sub?: boolean;
  /* Se llego a esta tarea desde la consola (20AA-10 F5): se marca y se trae a la vista. Es un
   * estado de lectura, no un gesto: no viaja en `gestos` y no se confunde con el resaltado del
   * arrastre (`.tareasFila--destino`). */
  destacada?: boolean;
}

export function TarjetaTarea({ tarea, gestos: g, sub = false, destacada = false }: TarjetaTareaProps) {
  const [vista, setVista] = useState<VistaTarjeta>({ editando: false, borrador: '', confirmarBorrado: false });
  const [propiedades, setPropiedades] = useState(false);
  const menu = useMenuTarjeta();
  const fila = useRef<HTMLDivElement>(null);
  const texto = textoTarea(tarea);
  const hecha = completadoTarea(tarea);
  const pri = prioridadTarea(tarea);
  const urg = urgenciaTarea(tarea);
  const conTexto = (cambio: Partial<ParcheTareaTab>): ParcheTareaTab => ({ texto, ...cambio });

  const guardarBorrador = () => {
    const limpio = vista.borrador.trim();
    setVista((v) => ({ ...v, editando: false }));
    if (limpio !== '' && limpio !== texto) g.onEditar({ texto: limpio });
  };

  const clases = [
    'tareasFila',
    sub ? 'tareasFila--sub' : '',
    g.resaltada ? 'tareasFila--destino' : '',
    destacada ? 'tareasFila--destacada' : '',
    hecha ? 'tareasFila--hecha' : '',
  ]
    .filter(Boolean)
    .join(' ');

  /* Traer a la vista la tarjeta abierta desde la consola (F5). [por que hace falta] La columna
   * tiene scroll propio: sin esto la tarjeta puede quedar fuera de vista y el destaque no se ve.
   * `block: 'center'` la deja centrada en la columna; `inline: 'nearest'` evita arrastrar el
   * scroll horizontal del kanban. */
  useEffect(() => {
    if (!destacada) return;
    fila.current?.scrollIntoView({ block: 'center', inline: 'nearest' });
  }, [destacada]);

  return (
    <div
      ref={fila}
      className={clases}
      role="listitem"
      draggable={!sub && g.arrastrable}
      onDragStart={sub ? undefined : g.arrastre.inicio}
      onDragOver={
        sub
          ? undefined
          : (ev) => {
              ev.preventDefault();
              g.arrastre.pasar();
            }
      }
      onDrop={
        sub
          ? undefined
          : (ev) => {
              ev.preventDefault();
              ev.stopPropagation();
              g.arrastre.encima(ev);
            }
      }
      onContextMenu={(ev) => {
        ev.preventDefault();
        menu.abrir(ev.currentTarget);
      }}
    >
      {sub && (
        <span className="tareasSangria" aria-hidden title="subtarea">
          <CornerDownRight size={10} />
        </span>
      )}
      <Button
        className="tareasCasilla"
        activo={hecha}
        disabled={g.ocupada}
        aria-pressed={hecha}
        aria-label={hecha ? `reabrir ${texto}` : `completar ${texto}`}
        title={hecha ? `reabrir ${texto}` : `completar ${texto}`}
        onClick={() => g.onEditar(conTexto({ completado: !hecha }))}
      >
        {hecha && <Check size={8} aria-hidden />}
      </Button>
      {vista.editando ? (
        <input
          className="tareasRenombre"
          value={vista.borrador}
          autoFocus
          aria-label="nuevo texto de la tarea"
          onChange={(ev) => setVista((v) => ({ ...v, borrador: ev.target.value }))}
          onBlur={guardarBorrador}
          onKeyDown={(ev) => {
            if (ev.key === 'Enter') guardarBorrador();
            if (ev.key === 'Escape') setVista((v) => ({ ...v, editando: false }));
          }}
        />
      ) : (
        <span className="tareasTexto">
          {texto}
        </span>
      )}
      {pri && <span className="tareasChip" title={`prioridad ${ETIQUETAS_PRIORIDAD[pri]}`}>{ETIQUETAS_PRIORIDAD[pri]}</span>}
      {urg !== 'normal' && <span className="tareasChip" title={`urgencia ${ETIQUETAS_URGENCIA[urg]}`}>{ETIQUETAS_URGENCIA[urg]}</span>}
      {g.enVuelo && <span className="tareasVolando" aria-hidden="true">…</span>}
      {vista.confirmarBorrado ? (
        <span className="tareasBotones" role="group" aria-label={`confirmar borrado de ${texto}`}>
          <Button
            pequeno
            onClick={g.onEliminar}
            title="eliminar definitivo en TASKS"
          >
            eliminar
          </Button>
          <Button
            pequeno
            cuadrado
            onClick={() => setVista((v) => ({ ...v, confirmarBorrado: false }))}
            title="cancelar el borrado"
            aria-label="cancelar el borrado"
          >
            <X size={12} aria-hidden />
          </Button>
        </span>
      ) : (
        <Button
          pequeno
          cuadrado
          className="tareasPuntos"
          onClick={(ev) => menu.abrir(ev.currentTarget)}
          aria-haspopup="menu"
          aria-expanded={menu.abierto}
          title="acciones de la tarea (también con clic derecho)"
          aria-label={`acciones de ${texto}`}
        >
          <MoreHorizontal size={12} aria-hidden />
        </Button>
      )}
      {menu.abierto &&
        menu.ancla &&
        createPortal(
          <MenuTarea
            tarea={tarea}
            urlTareas={g.urlTareas}
            pos={menu.ancla}
            /* En una subtarea no se ofrecen subtareas (TASK solo tiene dos niveles) ni el enlace al
             * tablero del roadmap, que es de la tarea. */
            admiteSubtareas={!sub}
            onCerrar={menu.cerrar}
            acciones={{
              completar: (completado) => g.onEditar(conTexto({ completado })),
              prioridad: (prioridad) => g.onEditar(conTexto({ prioridad })),
              urgencia: (urgencia) => g.onEditar(conTexto({ urgencia })),
              renombrar: () => setVista((v) => ({ ...v, editando: true, borrador: texto })),
              pedirEliminar: () => setVista((v) => ({ ...v, confirmarBorrado: true })),
              propiedades: () => setPropiedades(true),
              nuevaSubtarea: g.onNuevaSubtarea,
            }}
          />,
          cuerpoDocumento(),
        )}
      {/* Propiedades del roadmap (20AA-10 F4): el modal se pinta en el arbol como el de alta
        * (overlay `position:fixed`, ningun ancestro lo recorta). */}
      {propiedades && (
        <ModalPropiedadesTarea
          tarea={tarea}
          texto={texto}
          onCerrar={() => setPropiedades(false)}
          onGuardar={(parche) => {
            setPropiedades(false);
            g.onEditar(parche);
          }}
        />
      )}
    </div>
  );
}
