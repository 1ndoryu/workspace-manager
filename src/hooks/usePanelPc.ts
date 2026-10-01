/* Hook del PanelPc: estado + analisis/limpieza/reconstruccion del limpiador-pc.
 * [por que] Extraido de PanelPc para resolver componente-sin-hook-glory (y
 * limite-lineas de paso): el componente renderiza, el hook posee
 * estado/handlers/SSE. */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  escanearPcTodo,
  estadoPc,
  limpiarPcStream,
  reconstruirPc,
  type AccionPc,
  type EntradaPc,
  type EstadoPc,
  type EventoLimpieza,
  type EventoScan,
  type ResultadoLimpieza,
  type SeleccionPc,
} from '../v2/pc/apiPc.js';
import { gb } from '../shared/format.js';
import {
  aGrupos,
  plegadoInicial,
  rutaCorta,
  type Grupo,
} from './gruposPc.js';

export type Trabajo = 'idle' | 'analizando' | 'limpiando' | 'reconstruyendo';

/* Estados que liberan espacio (el resto —fallo, rechazada— no suma al
 * total en vivo aunque aparezca en la lista). */
const ELIMINADA = new Set(['borrada', 'vaciada', 'limpiada']);

export function usePanelPc() {
  const [estado, setEstado] = useState<EstadoPc | null>(null);
  const [entradas, setEntradas] = useState<EntradaPc[]>([]);
  const [totalBytes, setTotalBytes] = useState(0);
  const [medidoEn, setMedidoEn] = useState<string | null>(null);
  const [progreso, setProgreso] = useState<string | null>(null);
  const [seleccion, setSeleccion] = useState<string[]>([]);
  const [plegados, setPlegados] = useState<Set<string>>(new Set());
  const [limpieza, setLimpieza] = useState<ResultadoLimpieza | null>(null);
  const [trabajo, setTrabajo] = useState<Trabajo>('idle');
  const [armado, setArmado] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const cerrarRef = useRef<(() => void) | null>(null);

  const cargarEstado = useCallback(async () => {
    try {
      const est = await estadoPc();
      setEstado(est);
      /* Rehidrata el último análisis persistido (no se pierde al recargar). */
      if (est.limpieza?.enCurso) {
        /* Recarga con borrado en marcha: se adjunta al trabajo del server
         * (reenvía lo borrado + sigue en vivo) en vez de quedarse ciego. */
        setProgreso(`retomando el borrado… (${est.limpieza.hechas}/${est.limpieza.total})`);
        conectarLimpieza(null);
      } else if (est.scan?.enCurso) {
        /* Recarga con análisis en marcha: reengancha al trabajo del server
         * (reenvía lo completado + sigue en vivo) en vez de quedarse ciego. */
        setEntradas([]);
        setTotalBytes(0);
        setMedidoEn(null);
        setSeleccion([]);
        setPlegados(new Set());
        setLimpieza(null);
        setArmado(false);
        setProgreso(`retomando ${est.scan.etiqueta}… (${est.scan.indice}/${est.scan.total})`);
        conectar();
      } else if (est.reporte) {
        setEntradas(est.reporte.entradas);
        setTotalBytes(est.reporte.totalBytes);
        setMedidoEn(est.reporte.medidoEn);
        const grupos = aGrupos(est.reporte.entradas);
        setPlegados(plegadoInicial(grupos));
        setSeleccion(grupos.flatMap((g) => g.filas.map((f) => f.id)));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'no se pudo leer el estado');
    }
  }, []);

  useEffect(() => {
    void cargarEstado();
    return () => cerrarRef.current?.();
  }, [cargarEstado]);

  const grupos = aGrupos(entradas);
  const ocupado = trabajo !== 'idle';
  const elegidas = new Set(seleccion);
  const filasElegidas = grupos.flatMap((g) => g.filas).filter((f) => elegidas.has(f.id));
  const bytesElegidos = filasElegidas.reduce((a, f) => a + f.bytes, 0);

  /* Conecta el SSE al trabajo del server (nuevo o adjuntado a uno en
   * curso tras recargar). Devuelve el cierre. */
  function conectar() {
    cerrarRef.current?.();
    setTrabajo('analizando');
    cerrarRef.current = escanearPcTodo(alEvento, (mensaje) => {
      setError(mensaje);
      setProgreso(null);
      setTrabajo('idle');
    });
  }

  function alEvento(ev: EventoScan) {
    if (ev.tipo === 'inicio') {
      setProgreso(`analizando ${ev.etiqueta}… (${ev.indice}/${ev.total})`);
    } else if (ev.tipo === 'preparando') {
      setProgreso(ev.detalle);
    } else if (ev.tipo === 'avance') {
      /* En vivo qué carpeta se está midiendo (el área tarda en silencio). */
      const donde = ev.dir !== '' ? ` ${rutaCorta(ev.dir)}` : '';
      setProgreso(`analizando ${ev.etiqueta}…${donde} · ${ev.halladas} halladas`);
    } else if (ev.tipo === 'fase') {
      setEntradas((prev) => {
        const union = [...prev.filter((e) => e.fase !== ev.fase), ...ev.entradas];
        setPlegados(plegadoInicial(aGrupos(union)));
        return union;
      });
      setTotalBytes((prev) => prev + ev.totalBytes);
      setSeleccion((prev) => {
        const ids = aGrupos(ev.entradas).flatMap((g) => g.filas.map((f) => f.id));
        return [...prev, ...ids.filter((id) => !prev.includes(id))];
      });
    } else if (ev.tipo === 'fin') {
      setTotalBytes(ev.totalBytes);
      setMedidoEn(ev.medidoEn);
      setProgreso(null);
      setTrabajo('idle');
      void cargarEstado();
    } else {
      setError(`falló ${ev.etiqueta || 'el análisis'}: ${ev.detalle}`);
      setProgreso(null);
      setTrabajo('idle');
    }
  }

  function analizar() {
    setEntradas([]);
    setTotalBytes(0);
    setMedidoEn(null);
    setSeleccion([]);
    setPlegados(new Set());
    setLimpieza(null);
    setArmado(false);
    setError(null);
    setProgreso('arrancando…');
    conectar();
  }

  /* Borrado real en dos pasos con progreso en vivo: el primer clic arma,
   * el segundo ejecuta y cada objetivo aparece en la lista al completarse.
   * [por que] El borrado no se puede deshacer; la etiqueta dice qué y
   * cuánto se borra y el doble clic lo confirma (el server además exige
   * la palabra BORRAR). El SSE muestra en vivo qué se está borrando
   * porque borrar GB tarda minutos en silencio. */
  function borrar() {
    if (filasElegidas.length === 0) return;
    if (!armado) {
      setArmado(true);
      return;
    }
    const sel: SeleccionPc[] = filasElegidas.map((f) =>
      f.fase === 'area' || f.fase === 'tmp' ? { fase: f.fase, clave: f.clave, ruta: f.ruta } : { fase: f.fase, clave: f.clave },
    );
    setLimpieza(null);
    setArmado(false);
    setError(null);
    setProgreso('arrancando el borrado…');
    conectarLimpieza(sel);
  }

  /* Conecta el SSE al borrado del server (nuevo o adjuntado a uno en
   * curso tras recargar). Devuelve el cierre. */
  function conectarLimpieza(sel: SeleccionPc[] | null) {
    cerrarRef.current?.();
    setTrabajo('limpiando');
    cerrarRef.current = limpiarPcStream(sel, alEventoLimpieza, (mensaje) => {
      setError(mensaje);
      setProgreso(null);
      setTrabajo('idle');
    });
  }

  function alEventoLimpieza(ev: EventoLimpieza) {
    if (ev.tipo === 'inicio') {
      setProgreso(`borrando 0/${ev.total}…`);
    } else if (ev.tipo === 'fase') {
      setProgreso(`borrando ${ev.etiqueta}… (${ev.actual}/${ev.total})`);
    } else if (ev.tipo === 'fila') {
      /* En vivo qué se acaba de borrar (o por qué falló esa fila). */
      const donde = ev.ruta !== '' ? rutaCorta(ev.ruta) : ev.clave;
      setProgreso(`borrado ${donde} · ${ev.estado}`);
      const accion: AccionPc = { fase: ev.fase, clave: ev.clave, gb: ev.gb, estado: ev.estado, detalle: ev.detalle };
      setLimpieza((prev) => ({
        acciones: [...(prev?.acciones ?? []), accion],
        liberadosGb: (prev?.liberadosGb ?? 0) + (ELIMINADA.has(ev.estado) ? ev.gb : 0),
      }));
    } else if (ev.tipo === 'fin') {
      setProgreso(null);
      setTrabajo('idle');
      setSeleccion([]);
      void cargarEstado();
    } else {
      setError(`falló ${ev.etiqueta || 'el borrado'}: ${ev.detalle}`);
      setProgreso(null);
      setTrabajo('idle');
    }
  }

  async function reconstruir() {
    setTrabajo('reconstruyendo');
    setError(null);
    try {
      setEstado(await reconstruirPc());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'falló la reconstrucción');
    } finally {
      setTrabajo('idle');
    }
  }

  function conmutar(id: string) {
    setArmado(false);
    setSeleccion((sel) => (sel.includes(id) ? sel.filter((c) => c !== id) : [...sel, id]));
  }

  function conmutarGrupo(grupo: Grupo) {
    setArmado(false);
    const ids = grupo.filas.map((f) => f.id);
    setSeleccion((sel) =>
      ids.every((id) => sel.includes(id)) ? sel.filter((c) => !ids.includes(c)) : [...sel, ...ids.filter((id) => !sel.includes(id))],
    );
  }

  function plegar(id: string) {
    setPlegados((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function elegirTodos() {
    setArmado(false);
    setSeleccion(grupos.flatMap((g) => g.filas.map((f) => f.id)));
  }

  function elegirNinguno() {
    setArmado(false);
    setSeleccion([]);
  }

  const etiquetaBorrar =
    filasElegidas.length === 0
      ? 'borrar'
      : armado
        ? `confirma: borrar ${filasElegidas.length} · ${gb(bytesElegidos)} GB`
        : `borrar ${filasElegidas.length} · ${gb(bytesElegidos)} GB`;

  return {
    estado,
    entradas,
    totalBytes,
    medidoEn,
    progreso,
    grupos,
    plegados,
    limpieza,
    trabajo,
    armado,
    error,
    ocupado,
    elegidas,
    filasElegidas,
    bytesElegidos,
    etiquetaBorrar,
    analizar,
    borrar,
    reconstruir,
    conmutar,
    conmutarGrupo,
    plegar,
    elegirTodos,
    elegirNinguno,
  };
}
