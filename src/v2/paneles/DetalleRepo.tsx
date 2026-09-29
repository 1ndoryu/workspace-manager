/* Detalle maximizado de un repo: que se va a subir, que hay por traer y
 * que hay sin commitear (289A-6). [por que] El snapshot solo trae conteos
 * (ahead/behind/dirty); el contenido se pide bajo demanda y se muestra en 3
 * secciones plegables con su resumen en 1 linea para no abrir a ciegas.
 * Cálculo local sin fetch: el pie lo dice para no mentir. */
import { useState, type ReactNode } from 'react';
import type { ArchivoLocal, CommitResumen, DetalleRepoSync, LadoSync } from '../../shared/types.js';

const MAX_COMMITS_VISIBLES = 25;
const MAX_ARCHIVOS_VISIBLES = 100;

function Seccion({
  titulo,
  resumen,
  extra,
  abiertaPorDefecto,
  children,
}: {
  titulo: string;
  resumen: string;
  /* Total +A −D a la derecha del resumen (lo pide el usuario): solo la
   * sección SIN COMMITEAR lo trae (sale de las stats de archivos). */
  extra?: string;
  abiertaPorDefecto: boolean;
  children: ReactNode;
}) {
  const [abierta, setAbierta] = useState(abiertaPorDefecto);
  return (
    <div className="reposDetalleSeccion">
      <button
        type="button"
        className="reposDetalleSeccionCabecera"
        onClick={() => setAbierta((a) => !a)}
        aria-expanded={abierta}
      >
        <span className="reposDetalleFlecha">{abierta ? '▲' : '▼'}</span>
        <span className="reposDetalleSeccionTitulo">{titulo}</span>
        <span className="reposDetalleSeccionResumen">{resumen}</span>
        {extra && <span className="reposDetalleSeccionTotal">{extra}</span>}
      </button>
      {abierta && <div className="reposDetalleSeccionCuerpo">{children}</div>}
    </div>
  );
}

/* "14 archivos +1204 −88" o "vacio". */
function resumenStat(lado: LadoSync): string {
  if (lado.commits.length === 0) return 'vacío';
  return `${lado.commits.length} commits · ${lado.archivos} archivos +${lado.inserciones} −${lado.borrados}`;
}

export function fechaCorta(fecha: string): string {
  /* "2026-09-28 12:00:00 +0200" -> "28-09". */
  const m = fecha.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}` : '';
}

function ListaCommits({ commits }: { commits: CommitResumen[] }) {
  return (
    <ol className="reposDetalleCommits">
      {commits.slice(0, MAX_COMMITS_VISIBLES).map((c) => (
        <li key={c.hash} className="reposDetalleCommit" title={c.hash}>
          <span className="reposDetalleHash">{c.hash.slice(0, 7)}</span>
          <span className="reposDetalleFecha">{fechaCorta(c.fecha)}</span>
          <span className="reposDetalleMensaje">{c.mensaje}</span>
        </li>
      ))}
      {commits.length > MAX_COMMITS_VISIBLES && (
        <li className="reposDetalleMas">+{commits.length - MAX_COMMITS_VISIBLES} más</li>
      )}
    </ol>
  );
}

const ETIQUETA_ESTADO: Record<ArchivoLocal['estado'], string> = {
  staged: 'S',
  unstaged: 'M',
  untracked: '?',
  mixto: 'S+M',
};

/* Numeración +N −M por archivo (viene del endpoint de archivos, no del
 * detalle): la pide el usuario para la lista única clicable. */
export interface StatsArchivo {
  adds: number;
  dels: number;
}

function ListaArchivos({
  archivos,
  truncado,
  archivoSeleccionado,
  alElegirArchivo,
  stats,
}: DetalleRepoSync['locales'] & {
  archivoSeleccionado: string | null;
  alElegirArchivo: (ruta: string) => void;
  stats?: Record<string, StatsArchivo>;
}) {
  return (
    <ol className="reposDetalleArchivos">
      {archivos.slice(0, MAX_ARCHIVOS_VISIBLES).map((a) => {
        const stat = stats?.[a.ruta];
        const elegido = archivoSeleccionado === a.ruta;
        return (
          <li key={a.ruta}>
            <button
              type="button"
              className={`reposDetalleArchivo${elegido ? ' reposDetalleArchivo--elegido' : ''}`}
              title={`${a.ruta} — clic para ver el diff`}
              onClick={() => alElegirArchivo(a.ruta)}
              aria-pressed={elegido}
            >
              <span
                className={`reposDetalleEstado reposDetalleEstado--${a.estado}`}
                title={a.estado}
              >
                {ETIQUETA_ESTADO[a.estado]}
              </span>
              <span className="reposDetalleRuta">{a.ruta}</span>
              {stat && (
                <span className="reposDetalleStats">
                  <span className="cambiosDiffMas">+{stat.adds}</span>
                  <span className="cambiosDiffMenos">−{stat.dels}</span>
                </span>
              )}
            </button>
          </li>
        );
      })}
      {(archivos.length > MAX_ARCHIVOS_VISIBLES || truncado) && (
        <li className="reposDetalleMas">+más (lista acotada a {MAX_ARCHIVOS_VISIBLES})</li>
      )}
    </ol>
  );
}

export function DetalleRepo({
  detalle,
  archivoSeleccionado,
  alElegirArchivo,
  stats,
}: {
  detalle: DetalleRepoSync;
  archivoSeleccionado: string | null;
  alElegirArchivo: (ruta: string) => void;
  stats?: Record<string, StatsArchivo>;
}) {
  const { salientes, entrantes } = detalle;
  const locales = detalle.locales.archivos;
  /* Solo aparece la sección que tiene algo: vacía = ni se renderiza. */
  const haySubir = !detalle.sinUpstream && salientes.commits.length > 0;
  const hayTraer = !detalle.sinUpstream && entrantes.commits.length > 0;
  const hayLocales = locales.length > 0;
  /* Total de cambios a la derecha, cantidad de archivos a la izquierda: el
   * `S:x M:x ?:x` anterior no se entendía. Suma de las stats por archivo
   * (las que no tienen diff, como dirs untracked, aportan 0). */
  let totalAdds = 0;
  let totalDels = 0;
  if (stats) {
    for (const a of locales) {
      totalAdds += stats[a.ruta]?.adds ?? 0;
      totalDels += stats[a.ruta]?.dels ?? 0;
    }
  }

  return (
    <div className="reposDetalle" aria-label={`Detalle de sincronización de ${detalle.clave}`}>
      {haySubir && (
        <Seccion
          titulo="POR SUBIR"
          resumen={resumenStat(salientes)}
          abiertaPorDefecto={true}
        >
          <ListaCommits commits={salientes.commits} />
        </Seccion>
      )}
      {hayTraer && (
        <Seccion titulo="POR TRAER" resumen={resumenStat(entrantes)} abiertaPorDefecto={true}>
          <ListaCommits commits={entrantes.commits} />
        </Seccion>
      )}
      {hayLocales && (
        <Seccion
          titulo="SIN COMMITEAR"
          resumen={`${locales.length} archivos`}
          extra={stats ? `+${totalAdds} −${totalDels}` : undefined}
          abiertaPorDefecto={true}
        >
          <ListaArchivos
            archivos={detalle.locales.archivos}
            truncado={detalle.locales.truncado}
            archivoSeleccionado={archivoSeleccionado}
            alElegirArchivo={alElegirArchivo}
            stats={stats}
          />
        </Seccion>
      )}
      {!haySubir && !hayTraer && !hayLocales && (
        <div className="docsVacio">al día ✓ · árbol limpio</div>
      )}
    </div>
  );
}
