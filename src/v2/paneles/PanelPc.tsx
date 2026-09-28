/* Panel central PC: interfaz del limpiador-pc (un análisis, un resultado).
 * [por que] El usuario pidió una sola cosa: un botón analiza todo, el
 * progreso muestra lo que va apareciendo en tiempo real (SSE por fase) y el
 * resultado persiste en el server (rehidrata al recargar, sin simulación).
 * La selección es por entrada suelta dentro de grupos plegables (área y
 * tmp agrupan por tipo; el resto, un grupo por origen) porque aparecen decenas
 * de cosas. El borrado dice en su etiqueta qué y cuánto borra y sigue con
 * doble clic (armar + confirmar); el server exige además la palabra BORRAR. */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button } from '../ui/Button.js';
import { Casilla } from '../ui/Casilla.js';
import {
  escanearPcTodo,
  estadoPc,
  limpiarPcStream,
  reconstruirPc,
  gb,
  type AccionPc,
  type EntradaPc,
  type EstadoPc,
  type EventoLimpieza,
  type EventoScan,
  type ResultadoLimpieza,
  type SeleccionPc,
} from '../pc/apiPc.js';
import './PanelPc.css';

type Trabajo = 'idle' | 'analizando' | 'limpiando' | 'reconstruyendo';

const TITULO_FASE: Record<EntradaPc['fase'], string> = {
  area: 'área de trabajo',
  caches: 'caches del perfil',
  extern: 'herramientas externas',
  vscode: 'VS Code',
  chrome: 'Chrome',
  tmp: 'temporales del sistema',
};

const ORDEN_FASE: EntradaPc['fase'][] = ['area', 'caches', 'extern', 'vscode', 'chrome', 'tmp'];

/* Estados que liberan espacio (el resto —fallo, rechazada— no suma al
 * total en vivo aunque aparezca en la lista). */
const ELIMINADA = new Set(['borrada', 'vaciada', 'limpiada']);

interface Fila {
  id: string;
  fase: EntradaPc['fase'];
  clave: string;
  ruta: string;
  bytes: number;
  detalle: string;
}

interface Grupo {
  id: string;
  titulo: string;
  filas: Fila[];
  bytes: number;
}

/* Quita el prefijo `\\?\` para mostrar rutas legibles. */
function rutaCorta(ruta: string): string {
  return ruta.startsWith('\\\\?\\') ? ruta.slice(4) : ruta;
}

/* Grupos ordenados: área y tmp por tipo (de mayor a menor peso), el resto
 * un grupo por origen en orden de fase. El id de fila de área y tmp es su
 * ruta suelta (el filtro `--solo-ruta`); en el resto, fase+clave. */
function aGrupos(entradas: EntradaPc[]): Grupo[] {
  const grupos: Grupo[] = [];
  const porTipo = new Map<string, { fase: EntradaPc['fase']; tipo: string; filas: Fila[] }>();
  for (const e of entradas) {
    if (e.fase !== 'area' && e.fase !== 'tmp') continue;
    const k = `${e.fase}::${e.clave}`;
    let g = porTipo.get(k);
    if (!g) {
      g = { fase: e.fase, tipo: e.clave, filas: [] };
      porTipo.set(k, g);
    }
    g.filas.push({ id: `${e.fase}::${e.ruta}`, fase: e.fase, clave: e.clave, ruta: e.ruta, bytes: e.bytes, detalle: e.detalle });
  }
  const tipos = [...porTipo.values()].sort(
    (a, b) => b.filas.reduce((x, f) => x + f.bytes, 0) - a.filas.reduce((x, f) => x + f.bytes, 0),
  );
  for (const g of tipos) {
    g.filas.sort((a, b) => b.bytes - a.bytes);
    grupos.push({ id: `${g.fase}::${g.tipo}`, titulo: g.tipo, filas: g.filas, bytes: g.filas.reduce((x, f) => x + f.bytes, 0) });
  }
  for (const fase of ORDEN_FASE) {
    if (fase === 'area' || fase === 'tmp') continue;
    const filas = entradas
      .filter((e) => e.fase === fase)
      .sort((a, b) => b.bytes - a.bytes)
      .map((e) => ({
        id: `${e.fase}::${e.clave}`,
        fase: e.fase,
        clave: e.clave,
        ruta: e.ruta,
        bytes: e.bytes,
        detalle: e.detalle,
      }));
    if (filas.length > 0) {
      grupos.push({ id: fase, titulo: TITULO_FASE[fase], filas, bytes: filas.reduce((x, f) => x + f.bytes, 0) });
    }
  }
  return grupos;
}

/* Grupos grandes plegados por defecto (el usuario los abre si quiere). */
function plegadoInicial(grupos: Grupo[]): Set<string> {
  return new Set(grupos.filter((g) => g.filas.length > 8).map((g) => g.id));
}

export function PanelPc() {
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

  const etiquetaBorrar =
    filasElegidas.length === 0
      ? 'borrar'
      : armado
        ? `confirma: borrar ${filasElegidas.length} · ${gb(bytesElegidos)} GB`
        : `borrar ${filasElegidas.length} · ${gb(bytesElegidos)} GB`;

  return (
    <div className="panelPc" aria-label="Limpieza del PC">
      <header className="panelPcCabecera">
        <span>pc — limpieza</span>
        <span className="panelPcMeta">
          {estado
            ? estado.existe
              ? `limpiador v${estado.versionBinario ?? '?'}${estado.actualizado ? '' : ' (desactualizado)'}`
              : 'binario ausente (se construye al analizar)'
            : '…'}
          {estado?.reconstruyendo ? ' · construyendo…' : ''}
        </span>
        <div className="panelPcAcciones">
          <Button onClick={analizar} disabled={ocupado} title="Mide todo lo limpiable, solo lectura">
            {trabajo === 'analizando' ? 'analizando…' : 'analizar'}
          </Button>
          <Button
            onClick={borrar}
            disabled={ocupado || filasElegidas.length === 0}
            activo={armado}
            title={
              filasElegidas.length === 0
                ? 'Elige qué borrar en la lista (borra de verdad, no se puede deshacer)'
                : `Borra de verdad lo elegido (${filasElegidas.length} entradas, ${gb(bytesElegidos)} GB, no se puede deshacer)`
            }
          >
            {trabajo === 'limpiando' ? 'borrando…' : etiquetaBorrar}
          </Button>
          {entradas.length > 0 && (
            <>
              <Button
                onClick={() => {
                  setArmado(false);
                  setSeleccion(grupos.flatMap((g) => g.filas.map((f) => f.id)));
                }}
                title="Selecciona todo"
              >
                todos
              </Button>
              <Button
                onClick={() => {
                  setArmado(false);
                  setSeleccion([]);
                }}
                title="Deselecciona todo"
              >
                ninguno
              </Button>
            </>
          )}
          <Button onClick={reconstruir} disabled={ocupado} title="Reconstruye el binario desde limpiador-pc (flujo de actualización)">
            {trabajo === 'reconstruyendo' ? '…' : '⟳ reconstruir'}
          </Button>
        </div>
      </header>

      <div className="panelPcContenido">
        {progreso && <p className="panelPcMeta">{progreso} · {gb(totalBytes)} GB encontrados</p>}
        {!progreso && entradas.length > 0 && (
          <p className="panelPcMeta">
            {entradas.length} entradas · {gb(totalBytes)} GB · {filasElegidas.length} elegidas ({gb(bytesElegidos)} GB se borrarán)
            {medidoEn ? ` · medido ${new Date(medidoEn).toLocaleString()}` : ''}
          </p>
        )}
        {error && <p className="panelPcError">{error}</p>}

        {!progreso && entradas.length === 0 && medidoEn && <p className="panelPcVacio">nada limpiable: todo limpio</p>}

        {grupos.map((grupo) => {
          const plegado = plegados.has(grupo.id);
          const elegidasGrupo = grupo.filas.filter((f) => elegidas.has(f.id)).length;
          const todas = elegidasGrupo === grupo.filas.length;
          return (
            <section key={grupo.id} className="panelPcGrupo" aria-label={grupo.titulo}>
              <header className="panelPcGrupoCabecera">
                <Button cuadrado pequeno onClick={() => plegar(grupo.id)} title={plegado ? `Despliega ${grupo.titulo}` : `Pliega ${grupo.titulo}`}>
                  {plegado ? '+' : '−'}
                </Button>
                <label className="panelPcCheck">
                  <Casilla
                    checked={todas}
                    indeterminado={elegidasGrupo > 0 && !todas}
                    onChange={() => conmutarGrupo(grupo)}
                  />
                  <span className="panelPcClave">
                    {grupo.titulo} ({elegidasGrupo}/{grupo.filas.length})
                  </span>
                  <span className="panelPcGb">{gb(grupo.bytes)} GB</span>
                </label>
              </header>
              {!plegado && (
                <ul className="panelPcLista">
                  {grupo.filas.map((f) => (
                    <li key={f.id} className="panelPcFila">
                      <label className="panelPcCheck">
                        <Casilla checked={elegidas.has(f.id)} onChange={() => conmutar(f.id)} />
                        <span className="panelPcRuta" title={f.ruta}>
                          {rutaCorta(f.ruta)}
                        </span>
                        <span className="panelPcGb">{gb(f.bytes)} GB</span>
                      </label>
                      {f.detalle && f.fase !== 'area' && <span className="panelPcRuta">{f.detalle}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          );
        })}

        {limpieza && <ResultadoLimpiezaVista resultado={limpieza} />}
      </div>
    </div>
  );
}

/* Resultado del borrado: acciones por objetivo + total liberado. */
function ResultadoLimpiezaVista({ resultado }: { resultado: ResultadoLimpieza }) {
  return (
    <section className="panelPcResultado" aria-label="Resultado del borrado">
      <header className="panelPcResultadoCabecera">
        borrado: {resultado.acciones.length} acciones · liberado {resultado.liberadosGb.toFixed(2)} GB
      </header>
      <ul className="panelPcLista">
        {resultado.acciones.map((a: AccionPc, i: number) => (
          <li key={`${a.fase}::${a.clave}::${i}`} className="panelPcFila">
            <span className="panelPcCheck">
              <span className="panelPcEstado">{a.estado}</span>
              <span className="panelPcClave">{rutaCorta(a.clave)}</span>
              <span className="panelPcGb">{a.gb.toFixed(2)} GB</span>
            </span>
            {a.detalle && <span className="panelPcRuta">{a.detalle}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
