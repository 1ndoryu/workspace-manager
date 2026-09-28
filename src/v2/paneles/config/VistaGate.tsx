/* Vista 'gate' del PanelConfig: veredicto + cadena por herramienta + chips.
 * [por que] Rediseno compacto: antes eran 3 bloques de filas tecnicas con
 * hashes y estados escondidos en tooltips. Ahora se responde "todo bien?"
 * con un banner, cada herramienta muestra su cadena (checkout -> pin ->
 * runtime) resumida en una linea, y cada proyecto es un chip verde/rojo: el
 * detalle (hashes, motivo) solo se abre al clicar un rojo. */
import { useState } from 'react';
import { Button } from '../../ui/Button.js';
import type { DatosPanelConfig } from './usePanelConfig.js';
import type { ReporteSincronizacion } from '../../../server/gate/sincronizacion.js';

/* Acorta un hash para display, igual que corto() de los scripts. */
function corto(h: string | null): string {
  return h ? h.slice(0, 9) : '--';
}

type Tool = 'sentinel' | 'varsense';
const TOOLS: Tool[] = ['sentinel', 'varsense'];

interface Punto {
  proyecto: string;
  ok: boolean;
  sinDatos: boolean;
  detalle: string;
}

/* Un punto por proyecto+herramienta: cruza F7 (manifest<>checkout) con la
 * fila de alineacion (pin<>runtime<>publicado). Solo es rojo si hay un
 * problema concreto; sin datos de esa herramienta queda neutro. */
function puntosDe(rep: ReporteSincronizacion, tool: Tool): Punto[] {
  const nombres = new Set<string>();
  for (const c of rep.consumidores) nombres.add(c.nombre);
  for (const f of rep.alineacion?.filas ?? []) {
    if ((f.tool ?? f.herramienta) === tool) nombres.add(f.proyecto);
  }
  return [...nombres].sort().map((proyecto) => {
    const cons = rep.consumidores.find((c) => c.nombre === proyecto);
    const f7 = cons?.[tool];
    const fila = rep.alineacion?.filas.find(
      (f) => f.proyecto === proyecto && (f.tool ?? f.herramienta) === tool,
    );
    const prob: string[] = [];
    if (fila && fila.estado !== 'ALINEADO' && fila.estado !== 'SIN-PROVISION') {
      prob.push(...(fila.problemas?.length ? fila.problemas : [fila.estado]));
    }
    if (f7 && f7.estado !== 'ok') prob.push(f7.detalle);
    if (!f7 && !fila && cons && cons.estado !== 'ok') prob.push(cons.detalle ?? cons.estado);
    const partes: string[] = [];
    if (fila) {
      partes.push(`pin ${corto(fila.pin)} → runtime ${corto(fila.runtime)}`);
      if (fila.publicado === false) partes.push('NO publicado');
    }
    return {
      proyecto,
      ok: prob.length === 0,
      sinDatos: !f7 && !fila,
      detalle: [...partes, ...prob].filter(Boolean).join(' · ') || 'sin datos de esta herramienta',
    };
  });
}

export function VistaGate({ datos }: { datos: DatosPanelConfig }) {
  const { sincronizacion, errorSincronizacion, cargarSincronizacion } = datos;
  /* Un solo detalle abierto (clave herramienta:proyecto); el contenido se
   * calcula del reporte actual, asi que nunca queda rancio al re-verificar. */
  const [abierto, setAbierto] = useState<string | null>(null);

  const rojos = sincronizacion
    ? TOOLS.flatMap((t) => puntosDe(sincronizacion, t)).filter((p) => !p.ok && !p.sinDatos)
    : [];

  return (
    <>
      <header className="panelDocsVisorCabecera">
        <span className="panelDocsVisorTitulo">gate centralizado</span>
        <Button
          pequeno
          className="excBoton"
          onClick={() => void cargarSincronizacion()}
        >
          verificar alineación
        </Button>
      </header>
      <section className="syncVista" aria-label="Centralización del gate">
        <div className="scanCfgAcciones">
          <span className="scanCfgMeta">
            {sincronizacion
              ? `${sincronizacion.consumidores.length} consumidores · ${sincronizacion.problemas} desync`
              : (errorSincronizacion ?? 'pulsá verificar para comprobar el checkout compartido')}
          </span>
        </div>
        {sincronizacion && (
          <div className="syncLista">
            <div className="syncVeredicto">
              <span className={`syncBadge syncBadge--${rojos.length === 0 ? 'ok' : 'warn'}`}>
                {rojos.length === 0 ? '✓' : '!'}
              </span>
              <span className="syncNombre">
                {rojos.length === 0 ? 'todo alineado' : `${rojos.length} problema${rojos.length === 1 ? '' : 's'} (clicá el chip rojo)`}
              </span>
            </div>
            {TOOLS.map((tool) => {
              /* El head del checkout compartido sale del remoto (headLocal =
               * rev-parse del checkout; checkout_sentinel/_varsense no los
               * puebla ningun script). */
              const remoto = sincronizacion.alineacion?.remotos.filter((r) => r.tool === tool) ?? [];
              /* Head del checkout compartido (.quality-tools); la vigencia es
               * agregada: basta UN checkout por detras para avisar update. */
              const compartido = remoto.find((r) => r.dir.includes('.quality-tools')) ?? remoto[0];
              const atrasado = remoto.find((r) => r.desactualizado === true);
              const puntos = puntosDe(sincronizacion, tool);
              const update = atrasado
                ? `hay update${atrasado.tags.length ? ` (${atrasado.tags.slice(0, 3).map((t) => t.tag).join(',')})` : ''}`
                : remoto.length && remoto.every((r) => r.desactualizado === false)
                  ? 'al día'
                  : 'sin dato upstream';
              return (
                <div key={tool} className="syncTool">
                  <div className="syncToolCabecera">
                    <span className="syncNombre">{tool}</span>
                    <span className="syncMeta" title={compartido?.headLocal ?? ''}>
                      checkout {corto(compartido?.headLocal ?? null)}
                    </span>
                    <span
                      className={`syncMeta${atrasado ? ' syncMeta--warn' : ''}`}
                      title={atrasado?.dir ?? ''}
                    >
                      upstream: {update}
                    </span>
                  </div>
                  <div className="syncChips">
                    {puntos.map((p) => (
                      p.ok && !p.sinDatos ? (
                        <span key={p.proyecto} className="syncChip syncChip--ok" title={p.detalle}>
                          {p.proyecto}
                        </span>
                      ) : p.sinDatos ? (
                        <span key={p.proyecto} className="syncChip syncChip--vacio" title={p.detalle}>
                          {p.proyecto}
                        </span>
                      ) : (
                        <button
                          key={p.proyecto}
                          type="button"
                          className="syncChip syncChip--warn"
                          aria-expanded={abierto === `${tool}:${p.proyecto}`}
                          onClick={() => setAbierto((a) => (a === `${tool}:${p.proyecto}` ? null : `${tool}:${p.proyecto}`))}
                        >
                          {p.proyecto} !
                        </button>
                      )
                    ))}
                  </div>
                  {puntos
                    .filter((p) => !p.ok && !p.sinDatos && abierto === `${tool}:${p.proyecto}`)
                    .map((p) => (
                      <div key={p.proyecto} className="syncDetalle">{p.detalle}</div>
                    ))}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
