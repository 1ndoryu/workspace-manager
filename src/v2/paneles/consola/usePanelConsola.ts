/* Logica del PanelConsola en hook dedicado.
 * [por que] La regla componente-sin-hook-glory exige Componente.tsx (solo JSX)
 * + useComponente.ts (logica): el panel mezclaba selectores, memos de
 * clasificacion y conteo con el render. Sin cambio de comportamiento. */
import { useMemo, useState } from 'react';
import { useWorkspaceStore } from '../../../hooks/useWorkspace.js';
import {
  problemasDe,
  problemasSentinelDe,
  problemasVulnerabilidadDe,
  type Categoria,
  type Problema,
} from './clasificacionConsola.js';

export function usePanelConsola() {
  const snapshot = useWorkspaceStore((s) => s.snapshot);
  const analisis = useWorkspaceStore((s) => s.analisis);
  const vulnerabilidades = useWorkspaceStore((s) => s.vulnerabilidades);
  const seleccionadoId = useWorkspaceStore((s) => s.proyectoSeleccionado);
  const seleccionar = useWorkspaceStore((s) => s.seleccionar);
  const irAArchivos = useWorkspaceStore((s) => s.irAArchivos);
  const abrirMenuContextual = useWorkspaceStore((s) => s.abrirMenuContextual);
  const [filtro, setFiltro] = useState<'todos' | Categoria>('todos');

  const problemas = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.proyectos.map(problemasDe).filter((x): x is Problema => x !== null);
  }, [snapshot]);

  /* Hallazgos de sentinel por proyecto (solo de los ya analizados). Viven en
   * su propio filtro 'análisis', y su conteo SI entra en el total 'todos'
   * (decision del usuario: la cabecera debe sumar lo que detecta el análisis). */
  const problemasSentinel = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.proyectos
      .map((p) => problemasSentinelDe(p, analisis[p.clave]))
      .filter((x): x is Problema => x !== null);
  }, [snapshot, analisis]);

  /* Vulnerabilidades por proyecto (308A-4 V1). Tambien viven en su propio
   * filtro 'vulnerabilidades' y su conteo entra en el total 'todos'. */
  const problemasVuln = useMemo(() => {
    if (!snapshot) return [];
    return snapshot.proyectos
      .map((p) => problemasVulnerabilidadDe(p, vulnerabilidades[p.clave]))
      .filter((x): x is Problema => x !== null);
  }, [snapshot, vulnerabilidades]);

  /* 'todos' fusiona los problemas regulares con los hallazgos de sentinel y
   * las vulnerabilidades AGRUPADOS por proyecto (un proyecto con varias
   * categorias sale una sola vez con sus entradas combinadas y sus badges). */
  const problemasTodo = useMemo(() => {
    const porProyecto = new Map<string, Problema>();
    const poner = (pr: Problema) => {
      const ex = porProyecto.get(pr.p.ruta);
      if (ex) {
        /* [por que] Nunca mutar los objetos de 'problemas'/'problemasSentinel':
         * si `ex` fuese el objeto original y le hiciéramos push, la mutación
         * persistiría entre renders (ese useMemo no se recalcula si el
         * snapshot no cambia) y CADA escaneo volvería a añadir otra capa de
         * entradas (1408 -> 2789 -> 4170...). Se crea un objeto nuevo con
         * entradas combinadas, no se toca el original. */
        porProyecto.set(pr.p.ruta, { p: ex.p, entradas: [...ex.entradas, ...pr.entradas] });
      } else {
        porProyecto.set(pr.p.ruta, { p: pr.p, entradas: [...pr.entradas] });
      }
    };
    problemas.forEach(poner);
    problemasSentinel.forEach(poner);
    problemasVuln.forEach(poner);
    return [...porProyecto.values()];
  }, [problemas, problemasSentinel, problemasVuln]);

  const visibles = useMemo(() => {
    if (filtro === 'sentinel') return problemasSentinel;
    if (filtro === 'vulnerabilidad') return problemasVuln;
    if (filtro === 'todos') return problemasTodo;
    /* Cada filtro renderiza SOLO sus entradas: al filtrar por una categoria
     * no deben verse las lineas de otras categorias del mismo proyecto.
     * [por que] antes devolviamos el grupo completo y se colaban lineas de
     * config/sin-push/analisis al filtrar por sentinel-varsense o la inversa. */
    return problemas
      .map((pr) => ({ p: pr.p, entradas: pr.entradas.filter((e) => e.categoria === filtro) }))
      .filter((pr) => pr.entradas.length > 0);
  }, [problemas, problemasSentinel, problemasVuln, problemasTodo, filtro]);

  /* El conteo es por PROBLEMA individual (entradas), no por proyecto.
   * [por que] Un proyecto puede agrupar varias lineas; contarlo como 1
   * hacía que el total no coincidiera con las lineas visibles al abrir.
   * 'todos' suma las entradas regulares + los hallazgos de sentinel;
   * 'sentinel' suma solo sus hallazgos (su propio filtro). */
  const contar = (clave: 'todos' | Categoria): number => {
    if (clave === 'sentinel') {
      return problemasSentinel.reduce((n, pr) => n + pr.entradas.length, 0);
    }
    if (clave === 'vulnerabilidad') {
      return problemasVuln.reduce((n, pr) => n + pr.entradas.length, 0);
    }
    if (clave === 'todos') return problemasTodo.reduce((n, pr) => n + pr.entradas.length, 0);
    return problemas.reduce((n, pr) => n + pr.entradas.filter((e) => e.categoria === clave).length, 0);
  };

  return {
    snapshot,
    filtro,
    setFiltro,
    visibles,
    contar,
    seleccionadoId,
    seleccionar,
    irAArchivos,
    abrirMenuContextual,
  };
}
