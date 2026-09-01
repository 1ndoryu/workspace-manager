/* Hook del PanelDocs: estado + CRUD de skills/AGENTS.md.
 * [por que] Extraido de PanelDocs para resolver componente-sin-hook-glory:
 * el componente renderiza, el hook posee estado/handlers asincronos. */
import { useState } from 'react';
import axios from 'axios';
import { useWorkspaceStore } from './useWorkspace.js';
import type { Proyecto, SkillGlobal } from '../shared/types.js';
import { mensajeDeError, toastError, toastOk } from '../v2/toast.js';

export type DocSeleccionado =
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

/* Grupo de la lista lateral: documentos que comparten ubicacion. */
interface GrupoDocs {
  titulo: string;
  ubicacion: string;
  entradas: EntradaDocs[];
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

export function usePanelDocs() {
  const snapshot = useWorkspaceStore((s) => s.snapshot);
  const cargar = useWorkspaceStore((s) => s.cargar);

  const [seleccion, setSeleccion] = useState<DocSeleccionado | null>(null);
  const [contenido, setContenido] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);
  const [guardando, setGuardando] = useState(false);

  const skills: SkillGlobal[] = snapshot?.agentes.skills ?? [];
  const docs = agentesDoc(
    snapshot?.proyectos ?? [],
    'raíz (area-trabajo)',
    snapshot?.agentes.global.tieneAgentsMd ?? false,
    snapshot?.agentes.global.reglas.length ?? 0,
  );

  /* Lista agrupada por ubicacion: skills globales (~/.agents/skills),
   * AGENTS.md de la raiz del area y AGENTS.md de cada proyecto. Cada grupo
   * muestra su ubicacion como cabecera; dentro, cada entrada se identifica
   * por su etiqueta (skill / AGENTS.md). */
  const grupos: GrupoDocs[] = [
    {
      titulo: `skills globales (${skills.length})`,
      ubicacion: '~/.agents/skills',
      entradas: skills.map((s): EntradaDocs => ({ id: s.nombre, nombre: s.nombre, etiqueta: 'skill', descripcion: s.descripcion })),
    },
    {
      titulo: 'raíz (area-trabajo)',
      ubicacion: snapshot?.agentes.global.ruta ?? 'AGENTS.md',
      entradas: docs
        .filter((d) => d.id === 'raiz')
        .map((d): EntradaDocs => ({ id: d.id, nombre: d.nombre, etiqueta: 'AGENTS.md', tiene: d.tiene, reglas: d.reglas })),
    },
    {
      titulo: `proyectos (${docs.filter((d) => d.id !== 'raiz').length})`,
      ubicacion: 'area-trabajo/<proyecto>/AGENTS.md',
      entradas: docs
        .filter((d) => d.id !== 'raiz')
        .map((d): EntradaDocs => ({ id: d.id, nombre: d.nombre, etiqueta: 'AGENTS.md', tiene: d.tiene, reglas: d.reglas })),
    },
  ];

  async function abrirSkill(skill: SkillGlobal) {
    setSeleccion({ tipo: 'skill', id: skill.nombre, nombre: skill.nombre, descripcion: skill.descripcion });
    setCargando(true);
    setContenido(null);
    try {
      const { data } = await axios.get<{ contenido: string }>(
        `/api/skills/${encodeURIComponent(skill.nombre)}`,
      );
      setContenido(data.contenido);
    } catch (err) {
      setContenido(null);
      toastError(`no se pudo leer la skill: ${mensajeDeError(err)}`);
    } finally {
      setCargando(false);
    }
  }

  async function abrirAgents(doc: DocAgentes) {
    setSeleccion({ tipo: 'agents', id: doc.id, nombre: doc.nombre, tiene: doc.tiene });
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
      toastError(`no se pudo leer el AGENTS.md: ${mensajeDeError(err)}`);
    } finally {
      setCargando(false);
    }
  }

  /* Guarda el documento abierto: AGENTS.md por /api/agentes, SKILL.md por
   * /api/skills/<nombre>. [por que] El usuario pidio poder escribir y
   * modificar TODOS los documentos de documentacion (skills y agents.md),
   * no solo leerlos. */
  async function guardar() {
    if (!seleccion || contenido === null) return;
    setGuardando(true);
    try {
      if (seleccion.tipo === 'skill') {
        await axios.post(`/api/skills/${encodeURIComponent(seleccion.id)}`, { contenido });
      } else {
        await axios.post('/api/agentes', { id: seleccion.id, contenido });
      }
      toastOk('guardado ✓');
      /* Re-escanea para que la deteccion (skills, tieneAgentsMd/reglas)
       * refleje el archivo recien escrito. */
      void cargar(true);
    } catch (err) {
      toastError(`no se pudo guardar: ${mensajeDeError(err)}`);
    } finally {
      setGuardando(false);
    }
  }

  return {
    snapshot,
    seleccion,
    contenido,
    cargando,
    guardando,
    skills,
    docs,
    grupos,
    setContenido,
    abrirSkill,
    abrirAgents,
    guardar,
    setSeleccion,
  };
}
