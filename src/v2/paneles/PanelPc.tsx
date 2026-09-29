/* Panel central PC: interfaz del limpiador-pc (un análisis, un resultado).
 * [por que] El usuario pidió una sola cosa: un botón de análisis global, el
 * progreso muestra lo que va apareciendo en tiempo real (SSE por fase) y el
 * resultado persiste en el server (rehidrata al recargar, sin simulación).
 * La selección es por entrada suelta dentro de grupos plegables (área y
 * tmp agrupan por tipo; el resto, un grupo por origen) porque aparecen decenas
 * de cosas. El borrado dice en su etiqueta qué y cuánto borra y sigue con
 * doble clic (armar + confirmar); el server exige además la palabra BORRAR.
 * [299A-11] Estado en `usePanelPc`: el componente renderiza. */
import { Button } from '../ui/form/Button.js';
import { Casilla } from '../ui/form/Casilla.js';
import { gb, type AccionPc, type ResultadoLimpieza } from '../pc/apiPc.js';
import { usePanelPc } from '../../hooks/usePanelPc.js';
import { rutaCorta, type Grupo } from '../../hooks/gruposPc.js';
import './PanelPc.css';

export function PanelPc() {
  const {
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
  } = usePanelPc();

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
              <Button onClick={elegirTodos} title="Selecciona todo">
                todos
              </Button>
              <Button onClick={elegirNinguno} title="Deselecciona todo">
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

        {grupos.map((grupo: Grupo) => {
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
                <ul className="panelPcLista v2Superficie">
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
      <ul className="panelPcLista v2Superficie">
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
