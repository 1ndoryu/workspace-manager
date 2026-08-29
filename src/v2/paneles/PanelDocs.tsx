/* Panel de documentacion: detecta las skills globales y gestiona los
 * AGENTS.md (de la raiz del area y de cada proyecto).
 * [por que] El usuario pidio un panel central para crear/manejar documentos:
 * las skills globales son esos documentos (SKILL.md en ~/.agents/skills) y
 * los agents.md de cada proyecto + el de la carpeta principal. Los datos de
 * deteccion vienen del snapshot; el contenido se lee/escribe por API.
 * [v2.2] Skills y AGENTS.md son una SOLA lista lateral con una etiqueta que
 * dice que es cada entrada; el contenido abre en el unico panel de la
 * derecha. */
import { useState } from 'react';
import axios from 'axios';
import { useWorkspaceStore } from '../../hooks/useWorkspace.js';
import type { Proyecto, SkillGlobal } from '../../shared/types.js';
import './paneles.css';

type DocSeleccionado =
  | { tipo: 'skill'; id: string; nombre: string; descripcion: string }
  | { tipo: 'agents'; id: string; nombre: string; tiene: boolean };

interface DocAgentes {
  id: string;
  nombre: string;
  tiene: boolean;
  reglas: number;
}

/* Entrada unificada de la lista: skill o AGENTS.md, con etiqueta de tipo. */
interface EntradaDocs {
  id: string;
  nombre: string;
  etiqueta: 'skill' | 'AGENTS.md';
  descripcion?: string;
  tiene?: boolean;
  reglas?: number;
}

/* Plantilla minima para crear un AGENTS.md sin contenido previo. */
const PLANTILLA = `# AGENTS.md

<!-- Reglas e instrucciones para agentes que trabajan en este proyecto. -->
`;

function agentesDoc(proyectos: Proyecto[], raizNombre: string, raizTiene: boolean, raizReglas: number): DocAgentes[] {
  const lista: DocAgentes[] = [
    { id: 'raiz', nombre: raizNombre, tiene: raizTiene, reglas: raizReglas },
  ];
  for (const p of proyectos) {
    lista.push({
      id: p.id,
      nombre: p.id,
      tiene: p.agents?.tieneAgentsMd ?? false,
      reglas: p.agents?.reglas.length ?? 0,
    });
  }
  return lista;
}

export function PanelDocs() {
  const snapshot = useWorkspaceStore((s) => s.snapshot);
  const cargar = useWorkspaceStore((s) => s.cargar);

  const [seleccion, setSeleccion] = useState<DocSeleccionado | null>(null);
  const [contenido, setContenido] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  if (!snapshot) return null;

  const skills: SkillGlobal[] = snapshot.agentes.skills;
  const docs = agentesDoc(
    snapshot.proyectos,
    'raíz (area-trabajo)',
    snapshot.agentes.global.tieneAgentsMd,
    snapshot.agentes.global.reglas.length,
  );

  /* Lista unica: primero las skills (etiqueta 'skill'), luego los AGENTS.md
   * (etiqueta 'AGENTS.md'). Orden natural y cada entrada se identifica por su
   * etiqueta, no por secciones separadas. */
  const entradas: EntradaDocs[] = [
    ...skills.map((s): EntradaDocs => ({ id: s.nombre, nombre: s.nombre, etiqueta: 'skill', descripcion: s.descripcion })),
    ...docs.map((d): EntradaDocs => ({ id: d.id, nombre: d.nombre, etiqueta: 'AGENTS.md', tiene: d.tiene, reglas: d.reglas })),
  ];

  async function abrirSkill(skill: SkillGlobal) {
    setSeleccion({ tipo: 'skill', id: skill.nombre, nombre: skill.nombre, descripcion: skill.descripcion });
    setMensaje(null);
    setCargando(true);
    setContenido(null);
    try {
      const { data } = await axios.get<{ contenido: string }>(
        `/api/skills/${encodeURIComponent(skill.nombre)}`,
      );
      setContenido(data.contenido);
    } catch (err) {
      setContenido(null);
      setMensaje(`no se pudo leer la skill: ${err instanceof Error ? err.message : 'error'}`);
    } finally {
      setCargando(false);
    }
  }

  async function abrirAgents(doc: DocAgentes) {
    setSeleccion({ tipo: 'agents', id: doc.id, nombre: doc.nombre, tiene: doc.tiene });
    setMensaje(null);
    setCargando(true);
    setContenido(null);
    try {
      if (!doc.tiene) {
        /* Sin AGENTS.md: el editor parte de la plantilla para crearlo. */
        setContenido(PLANTILLA);
      } else {
        const { data } = await axios.get<{ contenido: string }>(
          `/api/agentes?id=${encodeURIComponent(doc.id)}`,
        );
        setContenido(data.contenido);
      }
    } catch (err) {
      setContenido(null);
      setMensaje(`no se pudo leer el AGENTS.md: ${err instanceof Error ? err.message : 'error'}`);
    } finally {
      setCargando(false);
    }
  }

  async function guardar() {
    if (!seleccion || seleccion.tipo !== 'agents' || contenido === null) return;
    setGuardando(true);
    setMensaje(null);
    try {
      await axios.post('/api/agentes', { id: seleccion.id, contenido });
      setMensaje('guardado ✓');
      /* Re-escanea para que la deteccion (tieneAgentsMd/reglas/git) refleje
       * el archivo recien escrito. */
      void cargar(true);
    } catch (err) {
      setMensaje(`error al guardar: ${err instanceof Error ? err.message : 'error'}`);
    } finally {
      setGuardando(false);
    }
  }

  const esSkill = seleccion?.tipo === 'skill';

  return (
    <div className="panelDocs" aria-label="Documentación">
      <div className="panelDocsLista">
        <section className="panelDocsSeccion">
          <header className="panelDocsCabecera">documentos ({entradas.length})</header>
          <div className="panelDocsEntradas">
            {entradas.length === 0 && <div className="docsVacio">no se detectaron documentos</div>}
            {entradas.map((e) => {
              const activa =
                seleccion !== null && e.id === seleccion.id && e.etiqueta === (esSkill ? 'skill' : 'AGENTS.md');
              return (
                <button
                  key={`${e.etiqueta}:${e.id}`}
                  type="button"
                  className={`docsFila${activa ? ' docsFila--activa' : ''}`}
                  onClick={() => {
                    if (e.etiqueta === 'skill') {
                      const s = skills.find((x) => x.nombre === e.id);
                      if (s) void abrirSkill(s);
                    } else {
                      const d = docs.find((x) => x.id === e.id);
                      if (d) void abrirAgents(d);
                    }
                  }}
                  title={e.descripcion ?? e.nombre}
                >
                  <span className="docsFilaEtiqueta">{e.etiqueta}</span>
                  <span className="docsFilaNombre">{e.nombre}</span>
                  {/* [por que] La descripcion larga de una skill estorba la
                   * lista y tapa el nombre; va al tooltip (title). En los
                   * AGENTS.md el meta corto (reglas/crear) si se muestra. */}
                  {e.etiqueta !== 'skill' && (
                    <span className="docsFilaMeta">
                      {e.tiene ? `${e.reglas} regla(s)` : 'crear'}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </section>
      </div>
      <div className="panelDocsContenido">
        {!seleccion && <div className="docsVacio">elige un documento para verlo/crearlo</div>}
        {seleccion && cargando && <div className="docsVacio">cargando…</div>}
        {seleccion && !cargando && contenido === null && mensaje && (
          <div className="docsVacio">{mensaje}</div>
        )}
        {seleccion && !cargando && contenido !== null && (
          <>
            <header className="panelDocsVisorCabecera">
              <span className="panelDocsVisorTitulo">{seleccion.nombre}</span>
              {seleccion.tipo === 'agents' ? (
                <button
                  type="button"
                  className="docsGuardar"
                  onClick={() => void guardar()}
                  disabled={guardando}
                >
                  {guardando ? 'guardando…' : seleccion.tiene ? 'guardar' : 'crear'}
                </button>
              ) : (
                <span className="panelDocsVisorMeta">solo lectura</span>
              )}
              {mensaje && <span className="docsMensaje">{mensaje}</span>}
            </header>
            {seleccion.tipo === 'agents' ? (
              <textarea
                className="panelDocsTexto"
                value={contenido}
                onChange={(ev) => setContenido(ev.target.value)}
                spellCheck={false}
                aria-label={`Contenido de AGENTS.md de ${seleccion.nombre}`}
              />
            ) : (
              <pre className="panelDocsPre">{contenido}</pre>
            )}
          </>
        )}
      </div>
    </div>
  );
}
