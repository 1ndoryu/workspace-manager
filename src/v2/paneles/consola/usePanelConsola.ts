/* Logica del PanelConsola en hook dedicado.
 * [por que] La regla componente-sin-hook-glory exige Componente.tsx (solo JSX)
 * + useComponente.ts (logica): el panel mezclaba selectores, memos de
 * clasificacion y conteo con el render. Sin cambio de comportamiento. */
import { useMemo, useState } from 'react';
import { useWorkspaceStore } from '../../../hooks/useWorkspace.js';
import {
  problemaHuerfanosSinProyecto,
  problemaSaludArea,
  problemasDe,
  problemasDevDe,
  problemasSaludDe,
  contarProblemas,
  marcarHuellas,
  problemasSentinelDe,
  problemasTallerDe,
  problemasVulnerabilidadDe,
  type Categoria,
  type Problema,
} from '../../../shared/consola/clasificacionConsola.js';
import { CLAVE_AREA } from '../../../shared/salud/salud.js';
import { hallazgosTallerDe, useEstadoTaller } from '../taller/useEstadoTaller.js';

export function usePanelConsola() {
  const snapshot = useWorkspaceStore((s) => s.snapshot);
  const analisis = useWorkspaceStore((s) => s.analisis);
  const vulnerabilidades = useWorkspaceStore((s) => s.vulnerabilidades);
  const salud = useWorkspaceStore((s) => s.salud);
  const dev = useWorkspaceStore((s) => s.dev);
  const devError = useWorkspaceStore((s) => s.devError);
  /* Mando dev (F3): ejecutar acciones y pintar el ultimo resultado. */
  const devOcupado = useWorkspaceStore((s) => s.devOcupado);
  const devResultado = useWorkspaceStore((s) => s.devResultado);
  const accionDev = useWorkspaceStore((s) => s.accionDev);
  const alternarPermanente = useWorkspaceStore((s) => s.alternarPermanente);
  const seleccionadoId = useWorkspaceStore((s) => s.proyectoSeleccionado);
  const seleccionar = useWorkspaceStore((s) => s.seleccionar);
  const irAArchivos = useWorkspaceStore((s) => s.irAArchivos);
  const abrirMenuContextual = useWorkspaceStore((s) => s.abrirMenuContextual);
  const [filtro, setFiltro] = useState<'todos' | Categoria>('todos');

  /* Los pendientes del roadmap (D8) ya no son un contador aparte: `problemasDe` los emite como
   * categoria 'pendiente', así que entran en `problemas (N)`, se listan una por tarea y se
   * filtran como cualquier otra. [por que] La usuaria pidió que fueran la misma cosa
   * (2026-10-20); el contador separado no se podía filtrar ni leer. */
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

  /* Vigilancia dev por proyecto (F0b): sin-boton/deriva + huerfanos con clave,
   * mas el grupo sintetico de huerfanos sin proyecto. Viven en los filtros
   * 'dev'/'huérfanos' y su conteo entra en el total 'todos'. */
  const problemasDev = useMemo(() => {
    if (!snapshot) return [];
    const lista = snapshot.proyectos
      .map((p) => problemasDevDe(p, dev, devError))
      .filter((x): x is Problema => x !== null);
    const solos = problemaHuerfanosSinProyecto(dev);
    if (solos) lista.push(solos);
    return lista;
  }, [snapshot, dev, devError]);

  /* Salud (10AA-2 F8): hallazgos por proyecto + grupo sintetico del área
   * (CLAVE_AREA). Viven en el filtro 'salud' y su conteo entra en 'todos'. */
  const problemasSalud = useMemo(() => {
    if (!snapshot) return [];
    const lista = snapshot.proyectos
      .map((p) => problemasSaludDe(p, salud[p.clave]))
      .filter((x): x is Problema => x !== null);
    const area = problemaSaludArea(salud[CLAVE_AREA]);
    if (area) lista.push(area);
    return lista;
  }, [snapshot, salud]);

  /* Taller remoto (14AA-5 S3): conformidad de la 89, HTTP publico y laptop, en el
   * grupo sintetico del area (CLAVE_AREA). Viven en el filtro 'taller' y su conteo
   * entra en 'todos'. useEstadoTaller es singleton: PanelTaller comparte la peticion. */
  const { datos: datosTaller, error: errorTaller } = useEstadoTaller();
  const problemasTaller = useMemo(() => {
    const area = problemasTallerDe(hallazgosTallerDe(datosTaller, errorTaller));
    return area ? [area] : [];
  }, [datosTaller, errorTaller]);

  /* Base filtrable: regulares + dev + salud + taller (los filtros por categoria solo
   * miran entradas de su categoria, asi que un proyecto con varias categorias no
   * se duplica al filtrar). */
  const problemasBase = useMemo(
    () => [...problemas, ...problemasDev, ...problemasSalud, ...problemasTaller],
    [problemas, problemasDev, problemasSalud, problemasTaller],
  );

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
    problemasDev.forEach(poner);
    problemasSalud.forEach(poner);
    problemasTaller.forEach(poner);
    return [...porProyecto.values()];
  }, [problemas, problemasSentinel, problemasVuln, problemasDev, problemasSalud, problemasTaller]);

  const visibles = useMemo(() => {
    const filtrar = (): Problema[] => {
      if (filtro === 'sentinel') return problemasSentinel;
      if (filtro === 'vulnerabilidad') return problemasVuln;
      if (filtro === 'todos') return problemasTodo;
      /* Cada filtro renderiza SOLO sus entradas: al filtrar por una categoria
       * no deben verse las lineas de otras categorias del mismo proyecto.
       * [por que] antes devolviamos el grupo completo y se colaban lineas de
       * config/sin-push/analisis al filtrar por sentinel-varsense o la inversa. */
      return problemasBase
        .map((pr) => ({ p: pr.p, entradas: pr.entradas.filter((e) => e.categoria === filtro) }))
        .filter((pr) => pr.entradas.length > 0);
    };
    /* [por que aquí] La huella es la identidad de cada linea en la lista, y sólo
     * con el grupo entero se resuelven los empates: ponerla en cada rama la
     * habría escrito cuatro veces con cuatro criterios (20AA-30 N4-1). */
    return marcarHuellas(filtrar());
  }, [problemasBase, problemasSentinel, problemasVuln, problemasTodo, filtro]);

  /* El conteo es por PROBLEMA individual (entradas), no por proyecto.
   * [por que] Un proyecto puede agrupar varias lineas; contarlo como 1
   * hacía que el total no coincidiera con las lineas visibles al abrir.
   * 'todos' suma las entradas regulares + los hallazgos de sentinel;
   * 'sentinel' suma solo sus hallazgos (su propio filtro). */
  const contar = (clave: 'todos' | Categoria): number => {
    if (clave === 'sentinel') {
      return problemasSentinel.reduce((n, pr) => n + contarProblemas(pr.entradas), 0);
    }
    if (clave === 'vulnerabilidad') {
      return problemasVuln.reduce((n, pr) => n + contarProblemas(pr.entradas), 0);
    }
    if (clave === 'todos') return problemasTodo.reduce((n, pr) => n + contarProblemas(pr.entradas), 0);
    return problemasBase.reduce((n, pr) => n + contarProblemas(pr.entradas.filter((e) => e.categoria === clave)), 0);
  };

  return {
    snapshot,
    filtro,
    setFiltro,
    visibles,
    contar,
    devOcupado,
    devResultado,
    accionDev,
    alternarPermanente,
    seleccionadoId,
    /* [por que] El grupo sintetico '(puertos sin proyecto)' no es un proyecto
     * real: plegar/desplegar sigue funcionando (estado local del panel) pero
     * seleccionar o abrir menu sobre el no debe tocar seleccion ni config. */
    seleccionar: (id: string) => {
      if (id === '(puertos sin proyecto)' || id === CLAVE_AREA) return;
      seleccionar(id);
    },
    irAArchivos,
    abrirMenuContextual: (m: { x: number; y: number; id: string; clave: string }) => {
      if (!m.clave || m.clave === CLAVE_AREA) return;
      abrirMenuContextual(m);
    },
  };
}
