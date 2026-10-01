/* Consola de problemas del workspace (panel inferior).
 * [por que] El usuario pidio una consola para ver problemas con filtros:
 * todos, sin git, sin push, sin sentinel o con sentinel/varsense
 * desactualizado. La clasificacion se deriva del snapshot, sin llamada extra
 * al server. El filtro es un Selector del sistema (no botones sueltos). */
import { useState } from 'react';
import { usePanelConsola } from './usePanelConsola.js';
import { useEscanear } from '../../../hooks/useEscanear.js';
import { Button } from '../../ui/form/Button.js';
import { Selector } from '../../ui/selector/Selector.js';
import {
  type Categoria,
  type Problema,
  type SeveridadSentinel,
} from './clasificacionConsola.js';
import type { AccionDevNombre } from '../../../hooks/workspace/tipos.js';
import './consola.css';

const SEV_ETIQUETA: Record<SeveridadSentinel, string> = {
  error: 'error',
  warning: 'warning',
  information: 'info',
  hint: 'hint',
};

const FILTROS: { clave: 'todos' | Categoria; etiqueta: string }[] = [
  { clave: 'todos', etiqueta: 'todos' },
  { clave: 'sinGit', etiqueta: 'sin git' },
  { clave: 'sinCommit', etiqueta: 'sin commit' },
  { clave: 'sinPush', etiqueta: 'sin push' },
  { clave: 'gate', etiqueta: 'sentinel/varsense' },
  { clave: 'config', etiqueta: 'config' },
  { clave: 'sentinel', etiqueta: 'análisis' },
  { clave: 'vulnerabilidad', etiqueta: 'vulnerabilidades' },
  { clave: 'dev', etiqueta: 'dev' },
  { clave: 'huerfano', etiqueta: 'huérfanos' },
];

/* Botones del mando dev por linea con entrada (F3): arrancar (up),
 * detener (stop), bitacora (logs) y abrir (open, pestana nueva).
 * [por que] El tablero opera en vez de adivinar: el server reusa el CLI
 * (mismas garantias: stop nunca toca protegidos, up nunca duplica) y aqui
 * solo se invoca y se pinta el resultado. Sin devId no hay botones. */
const BOTONES_DEV: { accion: AccionDevNombre; etiqueta: string; titulo: string }[] = [
  { accion: 'up', etiqueta: 'arrancar', titulo: 'dev up: verifica o arranca (nunca duplica)' },
  { accion: 'stop', etiqueta: 'detener', titulo: 'dev stop: solo propio no-protegido (nunca 8787/5174/5175)' },
  { accion: 'logs', etiqueta: 'bitácora', titulo: 'dev logs: ultimas 50 lineas del arranque' },
  { accion: 'open', etiqueta: 'abrir', titulo: 'dev open: abre las URLs servidas' },
];

export function PanelConsola() {
  const {
    snapshot,
    filtro,
    setFiltro,
    visibles,
    contar,
    seleccionadoId,
    seleccionar,
    abrirMenuContextual,
    devOcupado,
    devResultado,
    accionDev,
  } = usePanelConsola();

  /* Acceso rapido al escaneo unificado (el mismo de la configuracion).
   * [por que] El usuario lo pidio junto al filtro: no ir a config para
   * re-escanear tras commitear/pushear. */
  const { ocupado: escaneando, escanearTodoUnificado } = useEscanear();
  /* Grupos plegados por id de proyecto: el clic pliega/despliega los
   * motivos sin navegar a archivos. [por que] Estado local de UI; por
   * defecto desplegado como antes. */
  const [colapsados, setColapsados] = useState<ReadonlySet<string>>(new Set());
  const alternarColapso = (id: string) => {
    setColapsados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  /* Plegar/desplegar todo lo visible de una vez (botones junto al filtro).
   * [por que] Con 12+ grupos, plegarlos uno a uno no es viable. */
  const plegarTodo = () => setColapsados(new Set(visibles.map((pr) => pr.p.id)));
  const desplegarTodo = () => setColapsados(new Set());

  if (!snapshot) return null;

  const etiquetas = FILTROS.map((f) => `${f.etiqueta} (${contar(f.clave)})`);
  const actual = FILTROS.find((f) => f.clave === filtro) ?? FILTROS[0];

  return (
    <aside className="panelConsola" aria-label="Consola de problemas">
      <header className="panelConsolaCabecera">
        <span className="panelConsolaTitulo">problemas ({contar('todos')})</span>
        <Button cuadrado pequeno onClick={plegarTodo} title="Plegar todos los grupos">
          −
        </Button>
        <Button cuadrado pequeno onClick={desplegarTodo} title="Desplegar todos los grupos">
          +
        </Button>
        <Button
          pequeno
          onClick={() => void escanearTodoUnificado()}
          disabled={escaneando}
          title="Escanear: análisis + vulnerabilidades (como en configuración)"
        >
          {escaneando ? 'escaneando…' : 'escanear'}
        </Button>
        <Selector
          valor={`${actual.etiqueta} (${contar(actual.clave)})`}
          opciones={etiquetas}
          onChange={(v) => {
            const i = etiquetas.indexOf(v);
            if (i >= 0) setFiltro(FILTROS[i].clave);
          }}
          titulo="Filtro de problemas"
        />
      </header>
      {/* Ultimo resultado del mando dev (F3): fail-loud tambien al operar.
        [por que] up/stop tardan y pueden rehusar; sin esta linea el clic
        pareceria no hacer nada. Se trunca a una linea legible. */}
      {devResultado ? (
        <div
          className={`consolaDevResultado v2Guia${devResultado.codigo !== 0 ? ' consolaMotivo--error' : ''}`}
          title={`${devResultado.accion} ${devResultado.id} (exit ${devResultado.codigo}) — ${devResultado.en}`}
        >
          {devResultado.accion} {devResultado.id} (exit {devResultado.codigo}):{' '}
          {devResultado.salida.split(/\r?\n/)[0].slice(0, 140)}
        </div>
      ) : null}
      <div className="panelConsolaContenido">
        {visibles.length === 0 ? (
          <div className="consolaVacio">sin problemas en esta categoría</div>
        ) : (
          visibles.map((pr) => (
            /* [por que] Problemas AGRUPADOS por proyecto: cabecera con el
             * nombre (clic = seleccionar) y cada motivo en su propia linea
             * debajo, indentada con borde izquierdo. Antes se mostraba en una
             * sola fila con badges y motivo a la derecha. */
            <div className="consolaGrupo" key={pr.p.id}>
              <button
                type="button"
                className={`consolaFila${pr.p.id === seleccionadoId ? ' consolaFila--seleccionada' : ''}${colapsados.has(pr.p.id) ? ' consolaFila--colapsado' : ''}`}
                aria-expanded={!colapsados.has(pr.p.id)}
                onClick={() => {
                  seleccionar(pr.p.id);
                  alternarColapso(pr.p.id);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  abrirMenuContextual({ x: e.clientX, y: e.clientY, id: pr.p.id, clave: pr.p.clave });
                }}
                title={pr.p.ruta}
              >
                {/* [por que] Sin spans ni badges: la cabecera solo dice el
                  * total de problemas del proyecto; el detalle ya vive en
                  * los motivos de abajo. */}
                {pr.p.id} ({pr.entradas.length})
              </button>
              {colapsados.has(pr.p.id) ? null : (
              <ul className="consolaMotivos">
                {pr.entradas.map((e, i) => (
                  <li
                    key={`${e.motivo}-${i}`}
                    className={`consolaMotivo v2Guia${e.seriedad ? ` consolaMotivo--${e.seriedad === 'error' ? 'error' : 'warn'}` : ''}`}
                  >
                    {e.sentinelSeveridad ? (
                      <span className={`consolaSeveridad consolaSeveridad--${e.sentinelSeveridad}`}>
                        {SEV_ETIQUETA[e.sentinelSeveridad]}
                      </span>
                    ) : null}
                    {e.vulnSeveridad ? (
                      <span className={`consolaSeveridad consolaSeveridad--${e.vulnSeveridad}`}>
                        {e.vulnSeveridad}
                      </span>
                    ) : null}
                    {e.motivo}
                    {/* Botones del mando (F3): solo lineas dev con entrada. */}
                    {e.categoria === 'dev' && e.devId ? (
                      <span className="consolaDevBotones">
                        {BOTONES_DEV.map((b) => (
                          <Button
                            key={b.accion}
                            pequeno
                            onClick={() => void accionDev(b.accion, e.devId as string)}
                            disabled={devOcupado}
                            title={b.titulo}
                          >
                            {devOcupado ? '…' : b.etiqueta}
                          </Button>
                        ))}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
              )}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
