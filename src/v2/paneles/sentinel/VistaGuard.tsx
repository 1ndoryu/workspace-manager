/* Sección Guard del tope físico anti-espiral (07AA-6 F6): quién/qué/cuándo/
 * por qué por proyecto, con controles mínimos (modo + ampliación).
 * [por que] Vive dentro de VistaProyecto (sin pestaña nueva): la lógica está
 * en useVistaGuard (patrón usePanelSentinel) y aquí solo JSX con clases
 * gate/config/fj existentes (nada de CSS nuevo ni estilos inline). Si el
 * proyecto no usa sentinel (elegible:false) la sección se oculta: el aviso ya
 * lo da VistaProyecto. */
import { Button } from '../../ui/form/Button.js';
import { useVistaGuard } from './useVistaGuard.js';

export function VistaGuard({ clave }: { clave: string }) {
  const { estado, error, actuando, puntos, setPuntos, motivo, setMotivo, cambiarModo, ampliar } =
    useVistaGuard(clave);

  if (error) return <div className="ejError">guard: {error}</div>;
  if (!estado) return <div className="docsVacio">cargando guard…</div>;
  if (!estado.elegible || !estado.politica) return null;

  const { politica, override, tareas, totalBloqueados } = estado;
  const modoContrario = politica.modo === 'enforce' ? 'observe' : 'enforce';

  return (
    <section className="gateEditor">
      <header className="gateEditorCabecera">
        <span className="gateEditorNombre">guard · tope anti-espiral</span>
        <span className={`configBadge ${politica.modo === 'enforce' ? 'badge' : 'configBadge--sin'}`}>
          {politica.modo}
        </span>
        {(totalBloqueados ?? 0) > 0 && (
          <span className="configBadge configBadge--sin">{totalBloqueados} bloqueos</span>
        )}
        <Button
          pequeno
          onClick={() => void cambiarModo(modoContrario)}
          disabled={actuando}
          title={`pasar el tope a ${modoContrario}`}
        >
          {actuando ? '…' : `a ${modoContrario}`}
        </Button>
      </header>

      {politica.config !== 'ok' && (
        <div className="ejError">
          {politica.config === 'ausente'
            ? 'sin sentinel.config.json: rigen defaults observe (tope 5)'
            : 'sentinel.config.json ilegible: Sentinel aplica defaults en silencio'}
        </div>
      )}
      {politica.limitesExtra.length > 0 && (
        <div className="configMeta">límites de clases desconocidas: {politica.limitesExtra.join(', ')}</div>
      )}
      <div className="configMeta">
        límites{Object.keys(politica.limites).length === 0 ? ': defecto 5 por clase' : ''}
        {Object.entries(politica.limites).map(([k, v]) => ` · ${k}: ${v}`).join('')}
        {override?.existe ? ` · override +${override.extra} (${override.primeraLinea})` : ' · sin ampliación'}
      </div>

      {/* Ampliación auditable del cupo (lote-extra.md). [por que] El motivo es
       * obligatorio en el backend: la ampliación queda justificada en el
       * propio fichero, nunca silenciosa. */}
      <div className="fjAgregar">
        <input
          type="number"
          min={1}
          max={100}
          value={puntos}
          onChange={(ev) => setPuntos(ev.target.value)}
          aria-label="puntos a ampliar (1..100)"
          className="fjInput fjInput--num"
        />
        <input
          type="text"
          value={motivo}
          onChange={(ev) => setMotivo(ev.target.value)}
          placeholder="motivo de la ampliación"
          aria-label="motivo de la ampliación"
          className="fjInput fjInput--nuevo"
        />
        <Button pequeno onClick={() => void ampliar()} disabled={actuando} title="escribe lote-extra.md (+N auditable)">
          {actuando ? '…' : 'ampliar'}
        </Button>
      </div>

      {(tareas ?? []).length === 0 ? (
        <div className="docsVacio">sin intentos registrados (runs.jsonl vacío)</div>
      ) : (
        <div className="configBadges">
          {(tareas ?? []).map((t) => (
            <span key={`${t.etapa}/${t.tarea}`} className="configBadge" title={t.ultimoTs ?? ''}>
              {t.tarea}:{' '}
              {Object.entries(t.clases)
                .map(([k, c]) => `${k} ${c.iniciados}/${c.limite + c.extra}${c.bloqueados > 0 ? ` [${c.bloqueados} bloqueos]` : ''}`)
                .join(' · ')}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
