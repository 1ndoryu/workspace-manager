/* Panel del changelog (2026-10-22): se abre desde el indicador de versión del nav.
 * [por que un parser mínimo y no una librería markdown] El fichero lo escribimos nosotros con tres
 * formas fijas (`#`, `##` y listas con `-`); meter una dependencia para eso sería más código de
 * configuración que de lectura, y una librería pintaría HTML arbitrario (sanitización obligatoria).
 * Aquí no hay HTML: cada línea se convierte en un elemento de React, así que no hay nada que sanear.
 * [por que modal y no panel central] Es una consulta corta que no debe sacarte del mapa ni cambiar
 * el estado de la navegación. */
import { useEffect, useRef, useState } from 'react';
import type { InfoVersion } from './useVersion.js';
import { interpretar, trozos } from './changelog.js';

/* Líneas por tanda. Con 40, un changelog de un año cabe en cuatro scrolls y la primera
 * pintada sigue siendo instantánea. */
const LOTE = 40;

interface PanelChangelogProps {
  info: InfoVersion;
  desactualizada: boolean | null;
  onCerrar: () => void;
}

export function PanelChangelog({ info, desactualizada, onCerrar }: PanelChangelogProps) {
  const [texto, setTexto] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refDialogo = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctrl = new AbortController();
    fetch('/api/version/changelog', { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`status ${r.status}`))))
      .then(({ texto }: { texto: string }) => setTexto(texto))
      .catch((e: unknown) => {
        if (!ctrl.signal.aborted) setError(e instanceof Error ? e.message : String(e));
      });
    return () => ctrl.abort();
  }, []);

  /* Foco al abrir: sin él, el modal se abre y el tabulador sigue donde estaba, detrás del velo. */
  useEffect(() => {
    refDialogo.current?.focus();
  }, []);

  const lineas = texto === null ? [] : interpretar(texto);

  /* Cuántas líneas del historial se han pedido ya. Sin botón «cerrar» el panel se lee de
   * arriba abajo; el resto de entradas entra cuando el scroll llega al final. */
  const [visibles, setVisibles] = useState(LOTE);
  const refCuerpo = useRef<HTMLDivElement>(null);
  const alRodar = () => {
    const c = refCuerpo.current;
    if (!c || visibles >= lineas.length) return;
    if (c.scrollTop + c.clientHeight >= c.scrollHeight - 80) setVisibles(visibles + LOTE);
  };

  return (
    <div className="tareasModalFondo" onClick={onCerrar}>
      <div
        className="tareasModal v2Superficie v2Changelog"
        role="dialog"
        aria-modal="true"
        aria-label={`Changelog de la versión ${info.version}`}
        tabIndex={-1}
        ref={refDialogo}
        onClick={(ev) => ev.stopPropagation()}
        onKeyDown={(ev) => {
          if (ev.key === 'Escape') {
            ev.stopPropagation();
            onCerrar();
          }
        }}
      >
        <header className="v2ChangelogCabecera">
          <div>
            <p className="v2ChangelogVersion">versión {info.version}</p>
            <p className="v2ChangelogMeta">
              {info.commit ? `${info.rama ?? 'sin rama'} · ${info.commit}` : 'sin commit legible'}
              {info.fecha ? ` · ${new Date(info.fecha).toLocaleString('es-ES')}` : ''}
            </p>
          </div>
        </header>
        {/* [por que el aviso va arriba] Es la razón por la que la usuaria abre esto: si el proceso va
            por detrás del código, decirlo antes del historial ahorra buscar el dato. */}
        {desactualizada === true && (
          <p className="v2ChangelogAviso">
            El backend arrancó antes del último commit: el proceso en marcha no sirve el código actual.
            Reinícialo para ver los cambios.
          </p>
        )}
        {error && <p className="v2ChangelogAviso">no se pudo leer el changelog: {error}</p>}
        {texto !== null && texto.trim() === '' && <p className="v2ChangelogAviso">el fichero del changelog está vacío</p>}
        {/* [por que carga diferida] El changelog crece con cada versión y el panel se abre para
            mirar lo último: se pintan 40 líneas y el resto entra al llegar al final del scroll. */}
        <div className="v2ChangelogCuerpo" ref={refCuerpo} onScroll={alRodar}>
          {lineas.slice(0, visibles).map((l, i) => (
            <p key={i} className={`v2Changelog${l.tipo[0].toUpperCase()}${l.tipo.slice(1)}`}>
              {trozos(l.texto).map((t, j) => (t.codigo ? <code key={j}>{t.texto}</code> : t.texto))}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
