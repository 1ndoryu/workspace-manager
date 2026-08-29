/* Consola de problemas del workspace (panel inferior).
 * [por que] El usuario pidio una consola para ver problemas con filtros:
 * todos, sin git, sin push, sin sentinel o con sentinel/varsense
 * desactualizado. La clasificacion se deriva del snapshot, sin llamada extra
 * al server. */
import { useMemo, useState } from 'react';
import type { Proyecto } from '../../shared/types.js';
import { useWorkspaceStore } from '../../hooks/useWorkspace.js';
import './paneles.css';

type Categoria = 'sinGit' | 'sinPush' | 'gate' | 'config';

interface Entrada {
  categoria: Categoria;
  motivo: string;
  /* Severidad real del problema. Solo la categoria 'config' distingue
   * error/advertencia; el resto es null (no aplica). */
  seriedad: 'error' | 'advertencia' | null;
}

/* Un proyecto con sus problemas. Cada problema (Entrada) es una linea
 * individual: el CONTEO es por entrada, no por proyecto, porque un proyecto
 * puede tener varios (p. ej. 5 opciones mal de config). Las categorias de
 * badges se derivan de las entradas (unicas). */
interface Problema {
  p: Proyecto;
  entradas: Entrada[];
}

/* Clasifica un proyecto; null si no tiene ningun problema.
 * [por que] Las carpetas (no git) solo cuentan como "sin git": no tienen
 * sentido las categorias de push/gate sobre ellas. Los problemas de la CONFIG
 * del gate (sentinel/varsense) vienen del server (snapshot): opciones
 * requeridas faltantes o valores con tipo incorrecto -> error; recomendadas
 * faltantes -> advertencia; opcionales faltantes -> se silencian (no llegan). */
function problemasDe(p: Proyecto): Problema | null {
  const entradas: Entrada[] = [];

  if (!p.esGit) {
    entradas.push({ categoria: 'sinGit', motivo: 'no es repo git', seriedad: null });
    return { p, entradas };
  }

  if (p.git) {
    if (!p.git.remoto) {
      entradas.push({ categoria: 'sinPush', motivo: 'sin remoto configurado', seriedad: null });
    } else if (p.git.ahead > 0) {
      entradas.push({ categoria: 'sinPush', motivo: `${p.git.ahead} commit(s) sin push`, seriedad: null });
    }
  }

  const g = p.gate;
  if (!g?.declarado) {
    entradas.push({ categoria: 'gate', motivo: 'sin sentinel/varsense declarado', seriedad: null });
  } else {
    if (g.sentinel === 'lock') {
      entradas.push({ categoria: 'gate', motivo: 'sentinel: solo lock, sin config', seriedad: null });
    }
    if (!g.varsense) {
      entradas.push({ categoria: 'gate', motivo: 'varsense ausente', seriedad: null });
    }
  }

  /* Problemas de la config del gate (sentinel/varsense). */
  for (const c of p.gateProblemas ?? []) {
    entradas.push({ categoria: 'config', motivo: c.mensaje, seriedad: c.severidad });
  }

  if (entradas.length === 0) return null;
  return { p, entradas };
}

/* Categorias unicas de un proyecto (para sus badges), en orden fijo. */
function categoriasDe(pr: Problema): Categoria[] {
  const orden: Categoria[] = ['sinGit', 'sinPush', 'gate', 'config'];
  return orden.filter((c) => pr.entradas.some((e) => e.categoria === c));
}

const FILTROS: { clave: 'todos' | Categoria; etiqueta: string }[] = [
  { clave: 'todos', etiqueta: 'todos' },
  { clave: 'sinGit', etiqueta: 'sin git' },
  { clave: 'sinPush', etiqueta: 'sin push' },
  { clave: 'gate', etiqueta: 'sentinel/varsense' },
  { clave: 'config', etiqueta: 'config' },
];

const ETIQUETA_CATEGORIA: Record<Categoria, string> = {
  sinGit: 'sin git',
  sinPush: 'sin push',
  gate: 'sentinel',
  config: 'config',
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
  const abrirMenuContextual = useWorkspaceStore((s) => s.abrirMenuContextual);
  const [filtro, setFiltro] = useState<'todos' | Categoria>('todos');

  const problemas = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.proyectos.map(problemasDe).filter((x): x is Problema => x !== null);
  }, [snapshot]);

  const visibles = useMemo(() => {
    if (filtro === 'todos') return problemas;
    return problemas.filter((pr) => pr.entradas.some((e) => e.categoria === filtro));
  }, [problemas, filtro]);

  /* El conteo es por PROBLEMA individual (entradas), no por proyecto.
   * [por que] Un proyecto puede agrupar varias lineas; contarlo como 1
   * hacía que el total no coincidiera con las lineas visibles al abrir.
   * 'todos' suma todas las entradas; cada filtro suma las de su categoria. */
  const contar = (clave: 'todos' | Categoria): number => {
    if (clave === 'todos') return problemas.reduce((n, pr) => n + pr.entradas.length, 0);
    return problemas.reduce((n, pr) => n + pr.entradas.filter((e) => e.categoria === clave).length, 0);
  };

  if (!snapshot) return null;

  return (
    <aside className="panelConsola" aria-label="Consola de problemas">
      <header className="panelConsolaCabecera">
        <span className="panelConsolaTitulo">problemas ({contar('todos')})</span>
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
                onContextMenu={(e) => {
                  e.preventDefault();
                  abrirMenuContextual({ x: e.clientX, y: e.clientY, id: pr.p.id, clave: pr.p.clave });
                }}
                title={pr.p.ruta}
              >
                <span className="consolaFilaNombre">{pr.p.id}</span>
                {categoriasDe(pr).map((c) => (
                  <span
                    key={c}
                    className={`consolaFilaBadge${c === 'config' ? ` consolaFilaBadge--${pr.entradas.some((e) => e.categoria === 'config' && e.seriedad === 'error') ? 'error' : 'warn'}` : ''}`}
                  >
                    {ETIQUETA_CATEGORIA[c]}
                  </span>
                ))}
              </button>
              <ul className="consolaMotivos">
                {pr.entradas.map((e, i) => (
                  <li
                    key={`${e.motivo}-${i}`}
                    className={`consolaMotivo${e.seriedad ? ` consolaMotivo--${e.seriedad === 'error' ? 'error' : 'warn'}` : ''}`}
                  >
                    {e.motivo}
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
