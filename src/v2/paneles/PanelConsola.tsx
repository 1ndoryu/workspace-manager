/* Consola de problemas del workspace (panel inferior).
 * [por que] El usuario pidio una consola para ver problemas con filtros:
 * todos, sin git, sin push, sin sentinel o con sentinel/varsense
 * desactualizado. La clasificacion se deriva del snapshot, sin llamada extra
 * al server. */
import { useMemo, useState } from 'react';
import type { Proyecto } from '../../shared/types.js';
import { useWorkspaceStore } from '../../hooks/useWorkspace.js';
import './paneles.css';

type Categoria = 'sinGit' | 'sinPush' | 'gate';

interface Problema {
  p: Proyecto;
  categorias: Categoria[];
  motivos: string[];
}

/* Clasifica un proyecto; null si no tiene ningun problema.
 * [por que] Las carpetas (no git) solo cuentan como "sin git": no tienen
 * sentido las categorias de push/gate sobre ellas. */
function problemasDe(p: Proyecto): Problema | null {
  const categorias: Categoria[] = [];
  const motivos: string[] = [];

  if (!p.esGit) {
    categorias.push('sinGit');
    motivos.push('no es repo git');
    return { p, categorias, motivos };
  }

  if (p.git) {
    if (!p.git.remoto) {
      categorias.push('sinPush');
      motivos.push('sin remoto configurado');
    } else if (p.git.ahead > 0) {
      categorias.push('sinPush');
      motivos.push(`${p.git.ahead} commit(s) sin push`);
    }
  }

  const g = p.gate;
  if (!g?.declarado) {
    categorias.push('gate');
    motivos.push('sin sentinel/varsense declarado');
  } else {
    if (g.sentinel === 'lock') {
      categorias.push('gate');
      motivos.push('sentinel: solo lock, sin config');
    }
    if (!g.varsense) {
      categorias.push('gate');
      motivos.push('varsense ausente');
    }
  }

  if (categorias.length === 0) return null;
  return { p, categorias, motivos };
}

const FILTROS: { clave: 'todos' | Categoria; etiqueta: string }[] = [
  { clave: 'todos', etiqueta: 'todos' },
  { clave: 'sinGit', etiqueta: 'sin git' },
  { clave: 'sinPush', etiqueta: 'sin push' },
  { clave: 'gate', etiqueta: 'sentinel/varsense' },
];

const ETIQUETA_CATEGORIA: Record<Categoria, string> = {
  sinGit: 'sin git',
  sinPush: 'sin push',
  gate: 'sentinel',
};

/* Ruta relativa de un proyecto respecto a la raiz del area, para abrir su
 * carpeta en el navegador de archivos. Fuera del area devuelve ''. */
function rutaRelativa(raiz: string | undefined, rutaAbs: string): string {
  if (!raiz) return '';
  const base = raiz.replace(/\\/g, '/').replace(/\/+$/, '');
  const r = rutaAbs.replace(/\\/g, '/');
  if (r === base) return '';
  if (r.startsWith(base + '/')) return r.slice(base.length + 1);
  return '';
}

export function PanelConsola() {
  const snapshot = useWorkspaceStore((s) => s.snapshot);
  const seleccionadoId = useWorkspaceStore((s) => s.proyectoSeleccionado);
  const seleccionar = useWorkspaceStore((s) => s.seleccionar);
  const irAArchivos = useWorkspaceStore((s) => s.irAArchivos);
  const [filtro, setFiltro] = useState<'todos' | Categoria>('todos');

  const problemas = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.proyectos.map(problemasDe).filter((x): x is Problema => x !== null);
  }, [snapshot]);

  const visibles = useMemo(() => {
    if (filtro === 'todos') return problemas;
    return problemas.filter((pr) => pr.categorias.includes(filtro));
  }, [problemas, filtro]);

  const contar = (clave: 'todos' | Categoria): number => {
    if (clave === 'todos') return problemas.length;
    return problemas.filter((pr) => pr.categorias.includes(clave)).length;
  };

  if (!snapshot) return null;

  return (
    <aside className="panelConsola" aria-label="Consola de problemas">
      <header className="panelConsolaCabecera">
        <span className="panelConsolaTitulo">problemas ({problemas.length})</span>
        {FILTROS.map((f) => (
          <button
            key={f.clave}
            type="button"
            className={`panelConsolaFiltro${filtro === f.clave ? ' panelConsolaFiltro--activo' : ''}`}
            onClick={() => setFiltro(f.clave)}
            aria-pressed={filtro === f.clave}
          >
            {f.etiqueta} ({contar(f.clave)})
          </button>
        ))}
      </header>
      <div className="panelConsolaContenido">
        {visibles.length === 0 ? (
          <div className="consolaVacio">sin problemas en esta categoría</div>
        ) : (
          visibles.map((pr) => (
            /* [por que] Problemas AGRUPADOS por proyecto: cabecera con el
             * nombre (clic = seleccionar) y cada motivo en su propia linea
             * debajo, indentada con borde izquierdo. Antes todo iba en una
             * sola fila con badges y motivo a la derecha. */
            <div className="consolaGrupo" key={pr.p.id}>
              <button
                type="button"
                className={`consolaFila${pr.p.id === seleccionadoId ? ' consolaFila--seleccionada' : ''}`}
                onClick={() => {
                  seleccionar(pr.p.id);
                  /* Abrir la carpeta del proyecto en el navegador de archivos. */
                  irAArchivos(rutaRelativa(snapshot?.raiz, pr.p.ruta));
                }}
                title={pr.p.ruta}
              >
                <span className="consolaFilaNombre">{pr.p.id}</span>
                {pr.categorias.map((c) => (
                  <span key={c} className="consolaFilaBadge">
                    {ETIQUETA_CATEGORIA[c]}
                  </span>
                ))}
              </button>
              <ul className="consolaMotivos">
                {pr.motivos.map((m) => (
                  <li key={m} className="consolaMotivo">
                    {m}
                  </li>
                ))}
              </ul>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
