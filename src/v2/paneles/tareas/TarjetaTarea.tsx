/* Tarjeta arrastrable del kanban (07AA-15): checkbox completar + texto
 * (renombrable inline) + chips de nivel + boton de menu (MoreHorizontal)
 * con MenuTarea.
 * [por que] Un solo useState objeto (vista: editando / borrador /
 * confirmarBorrado) para no rozar usestate-excesivo. El menu flota en un
 * portal al body (07AA-16: dentro de la tarjeta lo recortaba el scroll-X)
 * con ancla del hook `useMenuTarjeta`. El arrastre es DnD
 * nativo sin librerias: la columna pone los datos (origen + id) y el
 * destino (delante de que tarjeta). Cada gesto escribe via el hook (proxy
 * + relectura); aqui solo se cablea. Las flechas ↑↓⇤⇥ se jubilaron: el
 * arrastre y el menu (con mover a vecina por teclado) las sustituyen. */
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal, X } from 'lucide-react';
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
} from '../../../shared/tareasTab.js';
import { MenuTarea } from './MenuTarea.js';
import { useMenuTarjeta } from './useMenuTarjeta.js';

interface VistaTarjeta {
  editando: boolean;
  borrador: string;
  confirmarBorrado: boolean;
}

/* Gestos de la tarjeta agrupados (07AA-15): vecina y arrastre viajan en
 * sub-objetos para no rozar large-interface-isp; la columna los construye. */
export interface VecinaTarjeta {
  atras: boolean;
  adelante: boolean;
}

export interface ArrastreTarjeta {
  inicio: (ev: React.DragEvent) => void;
  encima: (ev: React.DragEvent) => void;
  pasar: () => void;
}

export interface TarjetaGestos {
  arrastrable: boolean;
  resaltada: boolean;
  enVuelo: boolean;
  vecina: VecinaTarjeta;
  urlTareas: string;
  arrastre: ArrastreTarjeta;
  onEditar: (parche: ParcheTareaTab) => void;
  onEliminar: () => void;
  onMoverVecina: (dir: -1 | 1) => void;
}

interface TarjetaTareaProps {
  tarea: TareaTab;
  gestos: TarjetaGestos;
}

export function TarjetaTarea({ tarea, gestos: g }: TarjetaTareaProps) {
  const [vista, setVista] = useState<VistaTarjeta>({ editando: false, borrador: '', confirmarBorrado: false });
  const menu = useMenuTarjeta();
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

  const clases = ['tareasFila', g.resaltada ? 'tareasFila--destino' : '', hecha ? 'tareasFila--hecha' : '']
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={clases}
      role="listitem"
      draggable={g.arrastrable}
      onDragStart={g.arrastre.inicio}
      onDragOver={(ev) => {
        ev.preventDefault();
        g.arrastre.pasar();
      }}
      onDrop={(ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        g.arrastre.encima(ev);
      }}
      onContextMenu={(ev) => {
        ev.preventDefault();
        menu.abrir(ev.currentTarget);
      }}
    >
      <input
        type="checkbox"
        className="tareasCheck"
        checked={hecha}
        disabled={!g.arrastrable}
        aria-label={hecha ? `reabrir ${texto}` : `completar ${texto}`}
        onChange={() => g.onEditar(conTexto({ completado: !hecha }))}
      />
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
        <span className="tareasTexto" title={`#${tarea.legacyId} · orden ${tarea.orden}`}>
          {texto}
        </span>
      )}
      {pri && <span className="tareasChip" title={`prioridad ${ETIQUETAS_PRIORIDAD[pri]}`}>{ETIQUETAS_PRIORIDAD[pri]}</span>}
      {urg !== 'normal' && <span className="tareasChip" title={`urgencia ${ETIQUETAS_URGENCIA[urg]}`}>{ETIQUETAS_URGENCIA[urg]}</span>}
      <span className="tareasMeta">#{tarea.legacyId}</span>
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
            puedeMoverAtras={g.vecina.atras}
            puedeMoverAdelante={g.vecina.adelante}
            urlTareas={g.urlTareas}
            pos={menu.ancla}
            onCerrar={menu.cerrar}
            acciones={{
              completar: (completado) => g.onEditar(conTexto({ completado })),
              prioridad: (prioridad) => g.onEditar(conTexto({ prioridad })),
              urgencia: (urgencia) => g.onEditar(conTexto({ urgencia })),
              renombrar: () => setVista((v) => ({ ...v, editando: true, borrador: texto })),
              moverVecina: g.onMoverVecina,
              pedirEliminar: () => setVista((v) => ({ ...v, confirmarBorrado: true })),
            }}
          />,
          cuerpoDocumento(),
        )}
    </div>
  );
}
