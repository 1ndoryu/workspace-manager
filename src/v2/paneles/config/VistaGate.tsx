/* Vista 'gate' del PanelConfig: estado del checkout compartido del runtime
 * (plan 308A-1 F7). [por que] Muestra en la UI que cada consumidor apunta al
 * checkout compartido con el MISMO commit, con badges verde/desync y boton
 * 'verificar' para refrescarlo. Reusa la validacion de quality-sync (el server
 * la expone por GET, no duplica logica).
 * Salio de PanelConfig.tsx para el limite-lineas (300): recibe `datos`. */
import { Button } from '../../ui/Button.js';
import type { DatosPanelConfig } from './usePanelConfig.js';

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
          </div>
        )}
      </section>
    </>
  );
}
