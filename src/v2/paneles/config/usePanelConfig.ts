/* Logica del PanelConfig en hook dedicado.
 * [por que] La regla componente-sin-hook-glory exige Componente.tsx (solo JSX)
 * + useComponente.ts (logica): el panel mezclaba estados y handlers de
 * scan con el render. La config por proyecto/gate vive ahora en el tab
 * 'sentinel' (usePanelSentinel); aqui quedan excepciones, escaneo y gate
 * centralizado. Sin cambio de comportamiento. */
import { useEffect, useState } from 'react';
import { useWorkspaceStore } from '../../../hooks/useWorkspace.js';
import { useEscanear } from '../../../hooks/useEscanear.js';
import { mensajeDeError, toastError, toastOk } from '../../toast.js';

/* Vista del visor derecho: excepciones, escaneo de sentinel o gate
 * centralizado. [por que] El usario pidio que el escaneo tenga su propia
 * opcion de menu y no viva embebido dentro de las excepciones. */
export type Vista = 'excepciones' | 'scan' | 'gate';

export function usePanelConfig() {
  const snapshot = useWorkspaceStore((s) => s.snapshot);
  const cambiarIgnorado = useWorkspaceStore((s) => s.cambiarIgnorado);
  /* Analisis + vulnerabilidades en un solo 'escanear' (hook compartido
   * con el acceso rapido de la consola). */
  const { ocupado: scanOcupado, aviso: scanAviso, escanearTodoUnificado } = useEscanear();
  const configurarScan = useWorkspaceStore((s) => s.configurarScan);
  const analisis = useWorkspaceStore((s) => s.analisis);
  const vulnerabilidades = useWorkspaceStore((s) => s.vulnerabilidades);
  /* Estado del checkout compartido del gate (plan 308A-1 F7). */
  const sincronizacion = useWorkspaceStore((s) => s.sincronizacion);
  const errorSincronizacion = useWorkspaceStore((s) => s.errorSincronizacion);
  const cargarSincronizacion = useWorkspaceStore((s) => s.cargarSincronizacion);

  /* Vista actual del visor derecho. */
  const [vista, setVista] = useState<Vista>('excepciones');

  /* Al abrir la vista 'gate' (plan 308A-1 F7) se refresca el estado del
   * checkout compartido (GET barato de quality-sync). [por que] No se corre en
   * el arranque para no lanzar git en cada carga; solo cuando el usuario pide
   * ver esta vista o pulsa 'verificar'. */
  useEffect(() => {
    if (vista === 'gate') void cargarSincronizacion();
  }, [vista, cargarSincronizacion]);

  /* Config de escaneo (switch + intervalo) editable en este panel. */
  const [auto, setAuto] = useState<boolean>(snapshot?.config?.scan?.automatico ?? false);
  const [intervalo, setIntervalo] = useState<number>(snapshot?.config?.scan?.intervaloMin ?? 30);

  /* Mantiene los controles de escaneo al dia con la config persistida (p. ej.
   * tras configurarScan o al llegar un snapshot recargado). [por que] El input
   * de intervalo es controlado; sin esto, quedaria stale con el valor del store. */
  useEffect(() => {
    const sc = snapshot?.config?.scan;
    if (!sc) return;
    setAuto(sc.automatico);
    setIntervalo(sc.intervaloMin);
  }, [snapshot?.config?.scan, snapshot?.config?.scan?.automatico, snapshot?.config?.scan?.intervaloMin]);

  if (!snapshot) return null;

  const ignorados = snapshot.config.ignorados;
  const proyectos = snapshot.proyectos;

  async function alternarIgnorado(clave: string, ignorar: boolean) {
    try {
      await cambiarIgnorado(clave, ignorar);
      toastOk(ignorar ? 'ignorado ✓' : 'ya no se ignora ✓');
    } catch (err) {
      toastError(mensajeDeError(err));
    }
  }

  /* [por que] Persiste la config scan cuando se cambia automatico o intervalo
   * (el server valida intervalo minimo por frescura). Se llama desde los
   * controles, no en cada teclado de intervalo. */
  function guardarScan(autoNuevo: boolean, intervaloNuevo: number) {
    void configurarScan({ automatico: autoNuevo, intervaloMin: intervaloNuevo })
      .catch((err: unknown) => toastError(`no se pudo guardar el escaneo: ${mensajeDeError(err)}`));
  }

  /* Total de hallazgos por severidad de los proyectos analizados (para la
   * cabecera del escaneo en el panel). */
  function totalesEscaneo(): { error: number; warning: number } {
    let error = 0;
    let warning = 0;
    for (const a of Object.values(analisis)) {
      error += a.resumen.error;
      warning += a.resumen.warning + a.resumen.information + a.resumen.hint;
    }
    return { error, warning };
  }
  /* Totales de vulnerabilidades por severidad sobre los proyectos auditados. */
  function totalesVuln(): { critical: number; high: number; moderate: number; low: number } {
    const t = { critical: 0, high: 0, moderate: 0, low: 0 };
    for (const v of Object.values(vulnerabilidades)) {
      t.critical += v.resumen.critical;
      t.high += v.resumen.high;
      t.moderate += v.resumen.moderate;
      t.low += v.resumen.low;
    }
    return t;
  }
  const tVuln = totalesVuln();
  const tieneVuln = tVuln.critical + tVuln.high + tVuln.moderate + tVuln.low > 0;
  const totales = totalesEscaneo();
  const ultimaActualizacion = Object.values(analisis).reduce<number>((mx, a) => {
    const t = new Date(a.analizadoEn).getTime();
    return Number.isNaN(t) ? mx : Math.max(mx, t);
  }, 0);

  return {
    snapshot,
    vista, setVista,
    auto, setAuto, intervalo, setIntervalo, scanOcupado, scanAviso, escanearTodoUnificado,
    ignorados, proyectos,
    analisis, vulnerabilidades, sincronizacion, errorSincronizacion, cargarSincronizacion,
    totales, tVuln, tieneVuln, ultimaActualizacion,
    alternarIgnorado, guardarScan,
  };
}

/* Paquete de datos que el panel entrega a cada vista. [por que] Las vistas
 * reciben un solo prop (`datos`) en vez de 15 props sueltas: evita interfaces
 * de props gigantes (large-interface-isp) y el trasiego no cambia. */
export type DatosPanelConfig = NonNullable<ReturnType<typeof usePanelConfig>>;
