/* Panel central PC: interfaz del limpiador-pc (análisis + limpieza).
 * [por que] El usuario pidió una tab "pc" con el análisis, el resultado y el
 * borrado siguiendo la identidad v2 (monocromo estricto, sin radios, sin
 * sombras, sin bold). El server ejecuta el binario; aquí solo se pide,
 * se selecciona (filtro `solo`) y se presenta. El borrado real exige
 * simular antes y doble clic (armar + confirmar). */
import { useCallback, useEffect, useState } from 'react';
import { Button } from '../ui/Button.js';
import {
  estadoPc,
  escanearPc,
  limpiarPc,
  reconstruirPc,
  gb,
  type AccionPc,
  type EstadoPc,
  type FasePc,
  type ResultadoLimpieza,
  type ResultadoScan,
} from '../pc/apiPc.js';
import './PanelPc.css';

type Trabajo = 'idle' | 'analizando' | 'limpiando' | 'reconstruyendo';

const ORDEN_FASES: FasePc[] = ['area', 'caches', 'extern', 'vscode', 'chrome'];

export function PanelPc() {
  const [estado, setEstado] = useState<EstadoPc | null>(null);
  const [fase, setFase] = useState<FasePc>('area');
  const [scans, setScans] = useState<Partial<Record<FasePc, ResultadoScan>>>({});
  const [seleccion, setSeleccion] = useState<string[]>([]);
  const [limpieza, setLimpieza] = useState<ResultadoLimpieza | null>(null);
  const [trabajo, setTrabajo] = useState<Trabajo>('idle');
  const [armado, setArmado] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cargarEstado = useCallback(async () => {
    try {
      setEstado(await estadoPc());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'no se pudo leer el estado');
    }
  }, []);

  useEffect(() => {
    void cargarEstado();
  }, [cargarEstado]);

  const scan = scans[fase];
  const ocupado = trabajo !== 'idle';

  /* Filas seleccionables: en el área varias rutas comparten tipo y el filtro
   * del CLI (`--solo-tipo`) opera por tipo, así que se agrupan por tipo con
   * su conteo; en el resto cada objetivo es único y va por entrada. */
  const filas: { clave: string; bytes: number; n: number; rutas: string[]; detalle: string }[] =
    !scan
      ? []
      : fase === 'area'
        ? [...scan.entradas.reduce((m, e) => {
            const f = m.get(e.clave) ?? { clave: e.clave, bytes: 0, n: 0, rutas: [] as string[], detalle: e.detalle };
            f.bytes += e.bytes;
            f.n += 1;
            if (f.rutas.length < 3) f.rutas.push(e.ruta);
            return m.set(e.clave, f);
          }, new Map<string, { clave: string; bytes: number; n: number; rutas: string[]; detalle: string }>()
          ).values()]
        : scan.entradas.map((e) => ({ clave: e.clave, bytes: e.bytes, n: 1, rutas: [e.ruta], detalle: e.detalle }));
  const entradasSeleccionadas = filas.filter((f) => seleccion.includes(f.clave)).reduce((a, f) => a + f.n, 0);

  function cambiarFase(f: FasePc) {
    setFase(f);
    setSeleccion([]);
    setLimpieza(null);
    setArmado(false);
    setError(null);
  }

  async function analizar() {
    setTrabajo('analizando');
    setError(null);
    setArmado(false);
    try {
      const r = await escanearPc(fase);
      setScans((s) => ({ ...s, [fase]: r }));
      setSeleccion([...new Set(r.entradas.map((e) => e.clave))]);
      setLimpieza(null);
      await cargarEstado();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'falló el análisis');
    } finally {
      setTrabajo('idle');
    }
  }

  /* Simulación (dry-run): nunca borra, muestra lo que haría. */
  async function simular() {
    if (!scan || seleccion.length === 0) return;
    setTrabajo('limpiando');
    setError(null);
    try {
      setLimpieza(await limpiarPc(fase, false, seleccion));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'falló la simulación');
    } finally {
      setTrabajo('idle');
    }
  }

  /* Borrado real en dos pasos: el primer clic arma, el segundo ejecuta.
   * [por que] El borrado no se puede deshacer; el doble clic + haber
   * simulado antes es la confirmación visible en la UI (el server además
   * exige la palabra BORRAR). */
  async function borrar() {
    if (!scan || seleccion.length === 0) return;
    if (!armado) {
      setArmado(true);
      return;
    }
    setTrabajo('limpiando');
    setError(null);
    try {
      const r = await limpiarPc(fase, true, seleccion);
      setLimpieza(r);
      /* El reporte queda invalidado tras borrar: obliga a re-analizar. */
      setScans((s) => ({ ...s, [fase]: undefined }));
      setSeleccion([]);
      setArmado(false);
      await cargarEstado();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'falló el borrado');
    } finally {
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

  function conmutar(clave: string) {
    setArmado(false);
    setSeleccion((sel) => (sel.includes(clave) ? sel.filter((c) => c !== clave) : [...sel, clave]));
  }

  const meta = estado?.fases.find((f) => f.fase === fase);
  const etiquetaFase = meta?.etiqueta ?? fase;

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
        <Button onClick={reconstruir} disabled={ocupado} title="Reconstruye el binario desde limpiador-pc (flujo de actualización)">
          {trabajo === 'reconstruyendo' ? '…' : '⟳ reconstruir'}
        </Button>
      </header>

      <nav className="panelPcFases" aria-label="Fases del limpiador">
        {ORDEN_FASES.map((f) => {
          const m = estado?.fases.find((x) => x.fase === f);
          return (
            <Button
              key={f}
              activo={fase === f}
              onClick={() => cambiarFase(f)}
              title={m?.descripcion ?? f}
            >
              {m?.etiqueta ?? f}
            </Button>
          );
        })}
      </nav>

      <div className="panelPcContenido">
        {meta && <p className="panelPcDescripcion">{meta.descripcion}</p>}
        <div className="panelPcAcciones">
          <Button onClick={analizar} disabled={ocupado} activo title={`Mide lo limpiable (${etiquetaFase}), solo lectura`}>
            {trabajo === 'analizando' ? 'analizando…' : 'analizar'}
          </Button>
          <Button onClick={simular} disabled={ocupado || !scan || seleccion.length === 0} title="Simula el borrado sin tocar nada">
            simular
          </Button>
          <Button
            onClick={borrar}
            disabled={ocupado || !scan || seleccion.length === 0}
            activo={armado}
            title="Borra de verdad lo seleccionado (no se puede deshacer)"
          >
            {armado ? 'pulsa otra vez para BORRAR' : 'borrar'}
          </Button>
          {scan && (
            <>
              <Button
                onClick={() => {
                  setArmado(false);
                  setSeleccion(filas.map((f) => f.clave));
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
        </div>

        {meta?.meta && !scan && (
          <p className="panelPcMeta">
            último análisis: {meta.meta.n} entradas · {gb(meta.meta.totalBytes)} GB
          </p>
        )}
        {scan && (
          <p className="panelPcMeta">
            {scan.entradas.length} entradas · {gb(scan.totalBytes)} GB · {entradasSeleccionadas} seleccionadas
          </p>
        )}
        {error && <p className="panelPcError">{error}</p>}

        {scan && scan.entradas.length === 0 && <p className="panelPcVacio">nada limpiable: todo limpio</p>}

        {filas.length > 0 && (
          <ul className="panelPcLista">
            {filas.map((f) => (
              <li key={f.clave} className="panelPcFila">
                <label className="panelPcCheck">
                  <input
                    type="checkbox"
                    checked={seleccion.includes(f.clave)}
                    onChange={() => conmutar(f.clave)}
                  />
                  <span className="panelPcClave">
                    {f.clave}
                    {f.n > 1 ? ` (${f.n})` : ''}
                  </span>
                  <span className="panelPcGb">{gb(f.bytes)} GB</span>
                </label>
                <span className="panelPcRuta" title={f.detalle ? `${f.rutas.join(' · ')} — ${f.detalle}` : f.rutas.join(' · ')}>
                  {f.rutas[0]}
                  {f.n > 1 ? ` (+${f.n - 1} más)` : ''}
                  {f.detalle && fase !== 'area' ? ` — ${f.detalle}` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}

        {limpieza && <ResultadoLimpiezaVista resultado={limpieza} />}
      </div>
    </div>
  );
}

/* Resultado de simular o borrar: acciones por objetivo + total liberado. */
function ResultadoLimpiezaVista({ resultado }: { resultado: ResultadoLimpieza }) {
  return (
    <section className="panelPcResultado" aria-label={resultado.ejecutar ? 'Resultado del borrado' : 'Simulación'}>
      <header className="panelPcResultadoCabecera">
        {resultado.ejecutar ? 'borrado' : 'simulación'}: {resultado.acciones.length} acciones
        {resultado.ejecutar ? ` · liberado ${resultado.liberadosGb.toFixed(2)} GB` : ' · nada borrado'}
      </header>
      <ul className="panelPcLista">
        {resultado.acciones.map((a: AccionPc) => (
          <li key={a.clave} className="panelPcFila">
            <span className="panelPcCheck">
              <span className="panelPcEstado">{a.estado}</span>
              <span className="panelPcClave">{a.clave}</span>
              <span className="panelPcGb">{a.gb.toFixed(2)} GB</span>
            </span>
            {a.detalle && <span className="panelPcRuta">{a.detalle}</span>}
          </li>
        ))}
      </ul>
    </section>
  );
}
