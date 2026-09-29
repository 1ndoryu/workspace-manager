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
  abiertaPorDefecto,
  vacia,
  children,
}: {
  titulo: string;
  resumen: string;
  abiertaPorDefecto: boolean;
  /* Sin contenido que mostrar (vacío o sin upstream): la cabecera es un
   * div estático, no abre nada al pulsar (el resumen ya lo dice todo). */
  vacia: boolean;
  children: ReactNode;
}) {
  const [abierta, setAbierta] = useState(abiertaPorDefecto);
  if (vacia) {
    return (
      <div className="reposDetalleSeccion">
        <div className="reposDetalleSeccionCabecera reposDetalleSeccionCabecera--vacia" aria-disabled="true">
          <span className="reposDetalleFlecha" aria-hidden="true">
            ·
          </span>
          <span className="reposDetalleSeccionTitulo">{titulo}</span>
          <span className="reposDetalleSeccionResumen">{resumen}</span>
        </div>
      </div>
    );
  }
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

function fechaCorta(fecha: string): string {
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

function ListaArchivos({ archivos, truncado }: DetalleRepoSync['locales']) {
  return (
    <ol className="reposDetalleArchivos">
      {archivos.slice(0, MAX_ARCHIVOS_VISIBLES).map((a) => (
        <li key={a.ruta} className="reposDetalleArchivo">
          <span
            className={`reposDetalleEstado reposDetalleEstado--${a.estado}`}
            title={a.estado}
          >
            {ETIQUETA_ESTADO[a.estado]}
          </span>
          <span className="reposDetalleRuta">{a.ruta}</span>
        </li>
      ))}
      {(archivos.length > MAX_ARCHIVOS_VISIBLES || truncado) && (
        <li className="reposDetalleMas">+más (lista acotada a {MAX_ARCHIVOS_VISIBLES})</li>
      )}
    </ol>
  );
}

export function DetalleRepo({ detalle }: { detalle: DetalleRepoSync }) {
  const { salientes, entrantes } = detalle;
  const locales = detalle.locales.archivos;
  const cuentaLocal: Record<ArchivoLocal['estado'], number> = {
    staged: 0,
    unstaged: 0,
    untracked: 0,
    mixto: 0,
  };
  for (const a of locales) cuentaLocal[a.estado]++;
  const resumenLocales =
    locales.length === 0
      ? 'limpio ✓'
      : `${locales.length} archivos · S:${cuentaLocal.staged}+${cuentaLocal.mixto} M:${cuentaLocal.unstaged} ?:${cuentaLocal.untracked}`;

  return (
    <div className="reposDetalle" aria-label={`Detalle de sincronización de ${detalle.clave}`}>
      <Seccion
        titulo="POR SUBIR"
        resumen={detalle.sinUpstream ? 'sin upstream' : resumenStat(salientes)}
        abiertaPorDefecto={salientes.commits.length > 0}
        vacia={detalle.sinUpstream || salientes.commits.length === 0}
      >
        {detalle.sinUpstream ? (
          <div className="docsVacio">sin upstream: nada que subir contra remoto</div>
        ) : salientes.commits.length === 0 ? (
          <div className="docsVacio">nada por subir ✓</div>
        ) : (
          <ListaCommits commits={salientes.commits} />
        )}
      </Seccion>
      <Seccion
        titulo="POR TRAER"
        resumen={detalle.sinUpstream ? 'sin upstream' : resumenStat(entrantes)}
        abiertaPorDefecto={entrantes.commits.length > 0}
        vacia={detalle.sinUpstream || entrantes.commits.length === 0}
      >
        {detalle.sinUpstream ? (
          <div className="docsVacio">sin upstream: nada que traer del remoto</div>
        ) : entrantes.commits.length === 0 ? (
          <div className="docsVacio">al día ✓</div>
        ) : (
          <ListaCommits commits={entrantes.commits} />
        )}
      </Seccion>
      <Seccion
        titulo="SIN COMMITEAR"
        resumen={resumenLocales}
        abiertaPorDefecto={locales.length > 0}
        vacia={locales.length === 0}
      >
        {locales.length === 0 ? (
          <div className="docsVacio">árbol limpio ✓</div>
        ) : (
          <ListaArchivos archivos={detalle.locales.archivos} truncado={detalle.locales.truncado} />
        )}
      </Seccion>
      <div className="reposDetallePie">calculado en local, sin fetch — lo que traiga el remoto puede variar</div>
    </div>
  );
}
