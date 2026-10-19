/* Barra de navegacion del front v2.
 * [por que] El usuario pidio un nav como otro panel: un menu para cambiar el
 * panel central (mapa, documentacion, repos) y botones para controlar la
 * visibilidad de cada panel lateral/consola. Iconos lucide-react.
 * [por que] Los 11 destinos con etiqueta no caben en ventanas estrechas y se
 * recortaban contra el borde: se recortan por medida real (useRecorteNav) y
 * los que sobran pasan a un desplegable anclado al final del grupo, para que
 * el boton de sobra no baile de sitio segun cuantos caben.
 * [por que] Los toggles de paneles no se pliegan nunca (pedido del usuario,
 * 2026-10-17): son control de lo que se ve y tienen que estar siempre a mano.
 * El recorte es solo de destinos. */
import { useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent, type Ref } from 'react';
import { BookOpen, Boxes, Ellipsis, FolderOpen, GitBranch, HardDrive, Kanban, Network, PanelLeft, PanelRight, Server, Settings, ShieldAlert, ShieldCheck, SquareTerminal, type LucideIcon } from 'lucide-react';
import { useWorkspaceStore, type PanelCentral, type VisibilidadPaneles } from '../../../hooks/useWorkspace.js';
import { Button } from '../form/Button.js';
import { useDesplegable } from './useDesplegable.js';
import { useRecorteNav } from './useRecorteNav.js';
import './NavBar.css';

const CENTRALES: { clave: PanelCentral; icono: LucideIcon; etiqueta: string }[] = [
  { clave: 'mapa', icono: Boxes, etiqueta: 'mapa' },
  { clave: 'docs', icono: BookOpen, etiqueta: 'documentación' },
  { clave: 'repos', icono: GitBranch, etiqueta: 'repos' },
  { clave: 'tareas', icono: Kanban, etiqueta: 'tareas' },
  { clave: 'navegador', icono: FolderOpen, etiqueta: 'archivos' },
  { clave: 'config', icono: Settings, etiqueta: 'config' },
  { clave: 'sentinel', icono: ShieldCheck, etiqueta: 'sentinel' },
  { clave: 'guardian', icono: ShieldAlert, etiqueta: 'guardián' },
  { clave: 'pc', icono: HardDrive, etiqueta: 'pc' },
  { clave: 'vps', icono: Server, etiqueta: 'vps' },
  { clave: 'taller', icono: Network, etiqueta: 'taller' },
];

const TOGGLES: {
  clave: keyof VisibilidadPaneles;
  icono: LucideIcon;
  etiqueta: string;
}[] = [
  { clave: 'detalle', icono: PanelLeft, etiqueta: 'panel de detalle' },
  { clave: 'lista', icono: PanelRight, etiqueta: 'panel de lista' },
  { clave: 'consola', icono: SquareTerminal, etiqueta: 'consola de problemas' },
];

type Destino = (typeof CENTRALES)[number];
type Toggle = (typeof TOGGLES)[number];

/* [por que] Un solo render de cada boton para la fila real y la fila de
 * medida: si divergieran, la medida no valdria. */
function BotonDestino({ destino, activo, onClick }: { destino: Destino; activo: boolean; onClick: () => void }) {
  return (
    <Button
      role="tab"
      aria-selected={activo}
      activo={activo}
      onClick={onClick}
      title={`Mostrar ${destino.etiqueta}`}
    >
      <destino.icono size={14} />
      <span>{destino.etiqueta}</span>
    </Button>
  );
}

function BotonToggle({ toggle, activo, onClick }: { toggle: Toggle; activo: boolean; onClick: () => void }) {
  return (
    <Button
      activo={activo}
      onClick={onClick}
      aria-pressed={activo}
      title={`${activo ? 'Ocultar' : 'Mostrar'} ${toggle.etiqueta}`}
    >
      <toggle.icono size={14} />
    </Button>
  );
}

function BotonSobra({ onClick, abierto, activo, titulo, refBoton }: { onClick?: () => void; abierto?: boolean; activo?: boolean; titulo?: string; refBoton?: Ref<HTMLButtonElement> }) {
  return (
    <Button
      ref={refBoton}
      className="v2NavSobraTrigger"
      onClick={onClick}
      tabIndex={onClick ? undefined : -1}
      activo={activo}
      aria-haspopup={onClick ? 'menu' : undefined}
      aria-expanded={onClick ? abierto : undefined}
      /* [por que] Sin acción no es un control: fuera del árbol de accesibilidad, para que no quede un botón sin nombre. */
      aria-hidden={onClick ? undefined : true}
      title={titulo}
    >
      {/* Decorativo: el nombre del boton lo da su `title` (y el aria-label del
       * contenedor); sin aria-hidden, el lector no tiene nada que anunciar. */}
      <Ellipsis size={14} aria-hidden />
    </Button>
  );
}

export function NavBar() {
  const panelCentral = useWorkspaceStore((s) => s.panelCentral);
  const setPanelCentral = useWorkspaceStore((s) => s.setPanelCentral);
  const visibles = useWorkspaceStore((s) => s.visibles);
  const setPanelVisible = useWorkspaceStore((s) => s.setPanelVisible);

  /* [por que] En documentacion y repos no existen paneles detalle/lista: solo
   * la consola tiene sentido. Por eso los toggles de detalle y lista solo se
   * muestran en el modo mapa. */
  const togglesVisibles =
    panelCentral === 'mapa'
      ? TOGGLES
      : TOGGLES.filter((t) => t.clave === 'consola');

  const { nav, toggles, medidor, cuantos } = useRecorteNav(CENTRALES.length);
  const menu = useDesplegable();

  const destinosFuera = CENTRALES.slice(cuantos);
  const fuera = destinosFuera.length;

  /* Teclado del desplegable. [por que] Llevaba `role="menu"` con
   * `role="menuitem"` y ninguna tecla: el rol promete el modelo de un menu y el
   * modelo no estaba. Aqui se cumple: el foco entra en la primera opcion al
   * abrir, las flechas recorren en ciclo, Home/End van a los extremos, Tab
   * cierra y Escape cierra devolviendo el foco al disparador. */
  const refTrigger = useRef<HTMLButtonElement>(null);
  const refsItems = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (menu.abierto) refsItems.current[0]?.focus();
  }, [menu.abierto]);

  function teclasMenu(ev: ReactKeyboardEvent<HTMLSpanElement>) {
    const items = refsItems.current.filter((n): n is HTMLButtonElement => n !== null);
    if (items.length === 0) return;
    if (ev.key === 'Tab') {
      menu.cerrar();
      return;
    }
    if (ev.key === 'Escape') {
      ev.preventDefault();
      menu.cerrar();
      refTrigger.current?.focus();
      return;
    }
    const desde = items.indexOf(document.activeElement as HTMLButtonElement);
    const salto =
      ev.key === 'ArrowDown' ? desde + 1
      : ev.key === 'ArrowUp' ? desde - 1
      : ev.key === 'Home' ? 0
      : ev.key === 'End' ? items.length - 1
      : null;
    if (salto === null) return;
    ev.preventDefault();
    items[(salto + items.length) % items.length]?.focus();
  }

  /* [por que] El recorte es un prefijo, asi que la pagina activa puede caer
   * dentro del desplegable: sin marcarlo, el usuario no veria en cual esta.
   * El boton de sobra se invierte y dice la pagina activa. */
  const indiceActivo = CENTRALES.findIndex((c) => c.clave === panelCentral);
  const activaOculta = indiceActivo >= cuantos;
  const etiquetaActiva = CENTRALES[indiceActivo]?.etiqueta;
  const tituloSobra = `${fuera} ${fuera === 1 ? 'botón más' : 'botones más'}${activaOculta ? ` (estás en ${etiquetaActiva})` : ''}`;

  return (
    <nav className="v2Nav" aria-label="Navegación principal" ref={nav}>
      <div className="v2NavCentral" role="tablist" aria-label="Panel central">
        {CENTRALES.slice(0, cuantos).map((c) => (
          <BotonDestino
            key={c.clave}
            destino={c}
            activo={panelCentral === c.clave}
            onClick={() => setPanelCentral(c.clave)}
          />
        ))}
        {fuera > 0 && (
          <span className="v2NavSobra" ref={menu.raiz}>
            <BotonSobra
              refBoton={refTrigger}
              onClick={menu.alternar}
              abierto={menu.abierto}
              activo={activaOculta}
              titulo={tituloSobra}
            />
            {menu.abierto && (
              <span
                className="v2NavSobraLista v2Superficie"
                role="menu"
                aria-label="Más botones"
                onKeyDown={teclasMenu}
              >
                {destinosFuera.map((c, i) => (
                  <Button
                    key={c.clave}
                    ref={(el) => {
                      refsItems.current[i] = el;
                    }}
                    role="menuitem"
                    /* Roving tabindex: un solo parada de tabulador para todo el
                     * menu; dentro se navega con flechas, como manda el rol. */
                    tabIndex={i === 0 ? 0 : -1}
                    className="v2SelectorOpcion"
                    activo={panelCentral === c.clave}
                    onClick={() => {
                      setPanelCentral(c.clave);
                      menu.cerrar();
                      /* Elegir con Enter quema el elemento enfocado: sin
                       * devolver el foco al disparador, el tabulador
                       * siguiente arrancaria desde el <body>. */
                      refTrigger.current?.focus();
                    }}
                  >
                    <c.icono size={14} aria-hidden />
                    <span>{c.etiqueta}</span>
                  </Button>
                ))}
              </span>
            )}
          </span>
        )}
      </div>
      {/* Los toggles de paneles van SIEMPRE visibles, fuera del recorte. */}
      <div className="v2NavVisible" role="group" aria-label="Visibilidad de paneles" ref={toggles}>
        {togglesVisibles.map((t) => (
          <BotonToggle
            key={t.clave}
            toggle={t}
            activo={visibles[t.clave]}
            onClick={() => setPanelVisible(t.clave, !visibles[t.clave])}
          />
        ))}
      </div>
      {/* Fila de medida: fuera de flujo, sin pintar y fuera del arbol de
       * accesibilidad. Nunca se recorta, asi que sus anchos son los naturales.
       * Lleva los destinos y, de ultimo, el boton de sobra: tambien ocupa. */}
      <div className="v2NavMedidor" aria-hidden="true" ref={medidor}>
        {CENTRALES.map((c) => (
          <BotonDestino key={c.clave} destino={c} activo={false} onClick={() => {}} />
        ))}
        <span className="v2NavMedidorSobra">
          <BotonSobra />
        </span>
      </div>
    </nav>
  );
}
