/* Vista 'gate' del PanelConfig: estado del checkout compartido del runtime
 * (plan 308A-1 F7) + alineacion pin/runtime/publicado por consumidor y vigencia
 * upstream (219A-1, script 308A-7V19 cableado). [por que] F7 solo valida
 * consistencia interna (manifest<>checkout); la vigencia (pin<>binario real y
 * checkout<>upstream) la mide V19 y el panel la muestra con el mismo boton
 * 'verificar'. Reusa la validacion del server por GET, no duplica logica.
 * Salio de PanelConfig.tsx para el limite-lineas (300): recibe `datos`. */
import { Button } from '../../ui/Button.js';
import type { DatosPanelConfig } from './usePanelConfig.js';

/* Acorta un hash para display, igual que corto() de los scripts. */
function corto(h: string | null): string {
  return h ? h.slice(0, 9) : '--';
}

export function VistaGate({ datos }: { datos: DatosPanelConfig }) {
  const { sincronizacion, cargarSincronizacion } = datos;

  return (
    <>
      <header className="panelDocsVisorCabecera">
        <span className="panelDocsVisorTitulo">gate centralizado</span>
      </header>
      <section className="syncVista" aria-label="Centralización del gate">
        <div className="scanCfgAcciones">
          <Button
            className="excBoton"
            onClick={() => void cargarSincronizacion()}
          >
            verificar alineación
          </Button>
          <span className="scanCfgMeta">
            {sincronizacion
              ? `${sincronizacion.consumidores.length} consumidores · ${sincronizacion.problemas} desync`
              : 'pulsá verificar para comprobar el checkout compartido'}
          </span>
        </div>
        {sincronizacion && (
          <div className="syncLista">
            {(sincronizacion.checkout_sentinel || sincronizacion.checkout_varsense) && (
              <div className="syncCheckout">
                <span className="syncTitulo">checkout compartido {sincronizacion.checkout}</span>
                {sincronizacion.checkout_sentinel && (
                  <span className="syncMeta">
                    sentinel@{sincronizacion.checkout_sentinel.head ?? 'no-provisto'}
                    {sincronizacion.checkout_sentinel.sucio ? ` (sucio ${sincronizacion.checkout_sentinel.sucio})` : ''}
                  </span>
                )}
                {sincronizacion.checkout_varsense && (
                  <span className="syncMeta">
                    varsense@{sincronizacion.checkout_varsense.head ?? 'no-provisto'}
                    {sincronizacion.checkout_varsense.sucio ? ` (sucio ${sincronizacion.checkout_varsense.sucio})` : ''}
                  </span>
                )}
              </div>
            )}
            {sincronizacion.consumidores.map((c) => (
              <div key={c.nombre} className="syncFila">
                <span
                  className={`syncBadge syncBadge--${c.estado === 'ok' ? 'ok' : 'warn'}`}
                  title={c.detalle || c.problemas?.join('; ') || c.estado}
                >
                  {c.estado === 'ok' ? '✓' : c.estado}
                </span>
                <span className="syncNombre">{c.nombre}</span>
                {c.sentinel && (
                  <span className={`syncMeta syncMeta--${c.sentinel.estado === 'ok' ? 'ok' : 'warn'}`}>
                    sentinel={c.sentinel.estado}
                  </span>
                )}
                {c.varsense && (
                  <span className={`syncMeta syncMeta--${c.varsense.estado === 'ok' ? 'ok' : 'warn'}`}>
                    varsense={c.varsense.estado}
                  </span>
                )}
              </div>
            ))}
            {/* Alineacion pin/runtime/publicado + vigencia upstream (219A-1).
             * [por que] Mismas clases sync* del bloque F7: sin CSS nuevo. Solo
             * filas con tool (las notas '(sin quality-tools.json)' ya las cubre
             * el bloque F7 de arriba). */}
            {sincronizacion.alineacion && (
              <div className="syncCheckout">
                <span className="syncTitulo">
                  alineación pin/runtime{' '}
                  {sincronizacion.alineacion.ok
                    ? '✓'
                    : `${sincronizacion.alineacion.desalineados}/${sincronizacion.alineacion.total} desalineado`}
                </span>
                {sincronizacion.alineacion.remotos
                  .filter((r) => r.desactualizado === true)
                  .map((r) => (
                    <span
                      key={r.dir}
                      className="syncMeta syncMeta--warn"
                      title={`${r.tool ?? '?'}: local ${r.headLocal} <> remoto ${r.headRemoto} (${r.url ?? 'sin remoto'})`}
                    >
                      {r.tool ?? '?'}: hay actualización ({corto(r.headLocal)}→{corto(r.headRemoto)}
                      {r.tags.length ? ` · ${r.tags.map((t) => t.tag).join(',')}` : ''})
                    </span>
                  ))}
              </div>
            )}
            {sincronizacion.alineacion?.filas
              .filter((f) => f.tool)
              .map((f, i) => {
                const bien = f.estado === 'ALINEADO' || f.estado === 'SIN-PROVISION';
                return (
                  <div key={`${f.proyecto}-${f.tool}-${i}`} className="syncFila">
                    <span
                      className={`syncBadge syncBadge--${bien ? 'ok' : 'warn'}`}
                      title={(f.problemas ?? []).join('; ') || f.estado}
                    >
                      {bien ? '✓' : f.estado}
                    </span>
                    <span className="syncNombre">
                      {f.proyecto} · {f.tool}
                    </span>
                    <span className="syncMeta">
                      pin={corto(f.pin)} runtime={corto(f.runtime)}
                      {f.publicado === true ? ' publicado' : f.publicado === false ? ' NO-publicado' : ''}
                    </span>
                  </div>
                );
              })}
          </div>
        )}
      </section>
    </>
  );
}
