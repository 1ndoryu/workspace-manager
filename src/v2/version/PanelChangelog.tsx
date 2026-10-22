/* Panel del changelog (2026-10-22): se abre desde el indicador de versión del nav.
 * [por que un parser mínimo y no una librería markdown] El fichero lo escribimos nosotros con tres
 * formas fijas (`#`, `##` y listas con `-`); meter una dependencia para eso sería más código de
 * configuración que de lectura, y una librería pintaría HTML arbitrario (sanitización obligatoria).
 * Aquí no hay HTML: cada línea se convierte en un elemento de React, así que no hay nada que sanear.
 * [por que modal y no panel central] Es una consulta corta que no debe sacarte del mapa ni cambiar
 * el estado de la navegación. */
import { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/form/Button.js';
import type { InfoVersion } from './useVersion.js';

/* Una línea del changelog ya interpretada. `seccion` = `##`, `titulo` = `#`, `punto` = `- …`. */
type Linea = { tipo: 'titulo' | 'seccion' | 'subtitulo' | 'punto' | 'texto'; texto: string };

/* Marcas inline: `código` y [texto](url). [por que quitarlas y no pintarlas] El panel es de
 * lectura; ver «`package.json`» con las comillas invertidas puestas parece un fallo del panel.
 * El código se pinta en un `<code>` y el enlace se queda con su texto: aquí no se navega. */
function trozos(texto: string): Array<{ codigo: boolean; texto: string }> {
  const salida: Array<{ codigo: boolean; texto: string }> = [];
  for (const parte of texto.split(/(`[^`]*`)/g)) {
    if (parte === '') continue;
    if (parte.startsWith('`') && parte.endsWith('`') && parte.length > 2) {
      salida.push({ codigo: true, texto: parte.slice(1, -1) });
    } else {
      salida.push({ codigo: false, texto: parte.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') });
    }
  }
  return salida;
}

function interpretar(markdown: string): Linea[] {
  const salida: Linea[] = [];
  /* Todo lo anterior a la primera sección es la nota de cabecera del fichero (formato,
   * dónde vive la versión): contexto de quien lo edita, ruido para quien lo lee. */
  const desde = markdown.search(/^## /m);
  const cuerpo = desde >= 0 ? markdown.slice(desde) : markdown;
  for (const cruda of cuerpo.split('\n')) {
    const linea = cruda.trimEnd();
    if (linea.startsWith('### ')) salida.push({ tipo: 'subtitulo', texto: linea.slice(4) });
    else if (linea.startsWith('## ')) salida.push({ tipo: 'seccion', texto: linea.slice(3) });
    else if (linea.startsWith('# ')) salida.push({ tipo: 'titulo', texto: linea.slice(2) });
    else if (linea.startsWith('- ') || linea.startsWith('  - ')) salida.push({ tipo: 'punto', texto: linea.replace(/^-\s+|^\s+-\s+/, '') });
    else if (linea.trim() !== '') salida.push({ tipo: 'texto', texto: linea });
    /* Las líneas en blanco separan bloques en markdown; el espacio lo pone el CSS. */
  }
  return salida;
}

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
          <Button onClick={onCerrar} aria-label="Cerrar changelog">
            cerrar
          </Button>
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
        <div className="v2ChangelogCuerpo">
          {lineas.map((l, i) => (
            <p key={i} className={`v2Changelog${l.tipo[0].toUpperCase()}${l.tipo.slice(1)}`}>
              {trozos(l.texto).map((t, j) => (t.codigo ? <code key={j}>{t.texto}</code> : t.texto))}
            </p>
          ))}
        </div>
      </div>
    </div>
  );
}
