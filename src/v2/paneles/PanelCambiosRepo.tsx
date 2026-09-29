/* Visor lateral del diff de un archivo del repo (299A-4). [por que] El
 * usuario pidió revisar los cambios individuales por archivo con la forma de
 * verlos de glory-harness, pero con una sola lista: la del acordeón
 * (`DetalleRepo`, que ya enumera los archivos) es la que se clica; este
 * lateral solo muestra el diff del archivo elegido (sin cabecera ni lista
 * duplicada). Se copia la lógica de harness (`gitDiff.ts`: reparto de
 * patches y pintado línea a línea con nº vieja/nueva y hunks), portada a
 * React con identidad v2 (monocromo estricto, tokens --v2-*, sin
 * radios/sombras/bold). Solo lectura: sin stage/commit/discard. */
import { useEffect, useMemo, useState } from 'react';
import type { ArchivosRepo } from '../../shared/types.js';
import { archivosRepo } from '../repos/apiRepos.js';
import { separarEntradas, type ArchivoCambio } from '../repos/gitDiff.js';

interface LineaDiff {
  tipo: 'hunk' | 'aviso' | 'adicion' | 'eliminacion' | 'contexto';
  vieja: string;
  nueva: string;
  marca: string;
  texto: string;
}

/* Port de `pintarDiff` de harness a datos (el render lo hace DiffArchivo):
 * hunks `@@` con sus nº iniciales, aviso `No newline`, binarios como aviso
 * (v2: monocromo, sin verde/rojo), +/-/contexto con sus contadores. */
function parsearPatch(patch: string): LineaDiff[] {
  const lineas: LineaDiff[] = [];
  let lineaAntigua = 0;
  let lineaNueva = 0;
  for (const linea of patch.split(/\r?\n/)) {
    if (linea.startsWith('@@')) {
      const hunk = linea.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      if (hunk) {
        lineaAntigua = Number(hunk[1]);
        lineaNueva = Number(hunk[2]);
      }
      lineas.push({ tipo: 'hunk', vieja: '', nueva: '', marca: '', texto: linea });
      continue;
    }
    if (
      linea.startsWith('diff --git ') ||
      linea.startsWith('index ') ||
      linea.startsWith('--- ') ||
      linea.startsWith('+++ ')
    ) {
      continue;
    }
    if (linea === '\\ No newline at end of file' || linea.startsWith('Binary files ')) {
      lineas.push({ tipo: 'aviso', vieja: '', nueva: '', marca: '', texto: linea });
      continue;
    }
    if (linea.startsWith('+')) {
      lineas.push({
        tipo: 'adicion',
        vieja: '',
        nueva: String(lineaNueva++),
        marca: '+',
        texto: linea.slice(1),
      });
    } else if (linea.startsWith('-')) {
      lineas.push({
        tipo: 'eliminacion',
        vieja: String(lineaAntigua++),
        nueva: '',
        marca: '−',
        texto: linea.slice(1),
      });
    } else {
      lineas.push({
        tipo: 'contexto',
        vieja: String(lineaAntigua++),
        nueva: String(lineaNueva++),
        marca: ' ',
        texto: linea.startsWith(' ') ? linea.slice(1) : linea,
      });
    }
  }
  return lineas;
}

function DiffArchivo({ archivo }: { archivo: ArchivoCambio }) {
  const lineas = useMemo(() => parsearPatch(archivo.patch), [archivo.patch]);
  return (
    <div className="cambiosDiffCaja">
      <div className="cambiosDiffCabecera">
        <span className="cambiosDiffRuta" title={archivo.ruta}>
          {archivo.ruta}
        </span>
        <span className="cambiosDiffStats">
          <span className="cambiosDiffMas">+{archivo.adiciones}</span>
          <span className="cambiosDiffMenos">−{archivo.eliminaciones}</span>
        </span>
      </div>
      <div className="cambiosDiffCuerpo">
        {!archivo.patch.trim() && (
          <div className="cambiosDiffAviso">sin diff disponible para este archivo</div>
        )}
        {lineas.map((l, i) =>
          l.tipo === 'hunk' || l.tipo === 'aviso' ? (
            <div key={i} className={`cambiosDiffFila cambiosDiffFila--${l.tipo}`}>
              {l.texto}
            </div>
          ) : (
            <div key={i} className={`cambiosDiffFila cambiosDiffFila--${l.tipo}`}>
              <span className="cambiosDiffNum">{l.vieja}</span>
              <span className="cambiosDiffNum">{l.nueva}</span>
              <span className="cambiosDiffMarca">{l.marca}</span>
              <span className="cambiosDiffTexto">{l.texto}</span>
            </div>
          ),
        )}
      </div>
    </div>
  );
}

/* Solo el diff del archivo elegido en la lista del acordeón: sin
 * cabecera de repo ni lista propia (esa duplicaba la de `DetalleRepo`). */
export function PanelCambiosRepo({ clave, ruta }: { clave: string; ruta: string }) {
  const [datos, setDatos] = useState<ArchivosRepo | null>(null);
  const [fallo, setFallo] = useState(false);

  /* [por que] La clave puede cambiar (o desmontarse) con el fetch en vuelo:
   * bandera de cancelado como la `secuencia` del cargar() de harness. El
   * archivo elegido (`ruta`) es prop y se resuelve en render: cambiar de
   * archivo no refetchea (la caché de `archivosRepo` lo sirve). */
  useEffect(() => {
    let vivo = true;
    setDatos(null);
    setFallo(false);
    archivosRepo(clave).then(
      (d) => {
        if (vivo) setDatos(d);
      },
      () => {
        if (vivo) setFallo(true);
      },
    );
    return () => {
      vivo = false;
    };
  }, [clave]);

  const archivo: ArchivoCambio | undefined = useMemo(() => {
    if (!datos) return undefined;
    const grupos = separarEntradas(datos.entradas, datos.diffStaged, datos.diffUnstaged);
    return (
      grupos.staged.find((a) => a.ruta === ruta) ?? grupos.changes.find((a) => a.ruta === ruta)
    );
  }, [datos, ruta]);

  return (
    <aside className="cambiosLateral" aria-label={`Diff de ${ruta}`}>
      {!datos && !fallo && <div className="docsVacio">leyendo diff…</div>}
      {fallo && <div className="docsVacio">no se pudo leer el diff (¿repo con bloqueo?)</div>}
      {datos && (
        <div className="cambiosDiff">
          {archivo ? (
            <DiffArchivo key={ruta} archivo={archivo} />
          ) : (
            <div className="docsVacio">sin diff disponible para este archivo</div>
          )}
        </div>
      )}
    </aside>
  );
}
