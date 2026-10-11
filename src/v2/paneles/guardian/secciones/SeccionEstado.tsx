/* Sección Estado: qué proyectos tienen Guardián, su modo, presupuestos y plantilla.
 * [por que] Vista general de solo lectura. Elegir una fila fija el proyecto que
 * usan las demás secciones y muestra aquí sus tareas y presupuestos. */
import { Seccion } from '../../../ui/caja/Caja.js';
import { Button } from '../../../ui/form/Button.js';
import type { GuardianDatos } from '../useGuardian.js';
import type {
  DiferenciasPlantilla,
  EstadoListas,
  EstadoProyecto,
  ProyectoArea,
} from '../tiposGuardian.js';

/* Límites del guard que aún no cubre: se anotan aquí; el hallazgo sigue abierto. */
const LIMITES_CONOCIDOS = [
  'En cmd, cargo.exe explícito no pasa por los shims .cmd.',
  'GLORY_REAL_NODE lo fija el entorno; el guard no lo controla.',
  'node .../vitest.mjs no pasa por el guard.',
  'cmd no tiene shims para eslint, prettier ni rustfmt.',
];

function textoListas(l: EstadoListas): string {
  if (l.estado === 'ok') return l.modo;
  return l.estado === 'ausente' ? 'sin política' : `inválida: ${l.motivo}`;
}

function textoPlantilla(d: DiferenciasPlantilla): string {
  if (d.estado === 'ok') return `faltan ${d.faltan.length} · reaparecen ${d.reaparecen.length}`;
  return d.estado === 'sin-plantilla' ? 'sin plantilla' : 'sin política';
}

export function SeccionEstado({ datos }: { datos: GuardianDatos }) {
  const { area, errorArea, claveSel, detalle, cargandoDetalle, errorDetalle, elegir } = datos;
  if (errorArea) return <div className="docsMensaje">{errorArea}</div>;
  if (!area) return <div className="docsVacio">cargando estado…</div>;

  const elegibles = area.proyectos.filter((p): p is ProyectoArea => p.elegible);
  const sinGuardian = area.proyectos.filter((p) => !p.elegible).map((p) => p.clave);

  return (
    <>
      <Seccion titulo={`proyectos con guardián: ${elegibles.length} de ${area.total}`}>
        <table className="guardianTabla">
          <thead>
            <tr>
              <th>proyecto</th>
              <th>config</th>
              <th>presupuestos</th>
              <th>listas</th>
              <th>bloqueados</th>
              <th>plantilla</th>
            </tr>
          </thead>
          <tbody>
            {elegibles.map((p) => (
              <tr key={p.clave} className={p.clave === claveSel ? 'guardianFila--activa' : undefined}>
                <td>
                  <Button type="button" className="docsFila" onClick={() => elegir(p.clave)}>
                    <span className="docsFilaNombre">{p.clave}</span>
                  </Button>
                </td>
                <td>{p.politica.config}</td>
                <td>{p.politica.modo}</td>
                <td>{textoListas(p.listas)}</td>
                <td>{p.totalBloqueados}</td>
                <td>{textoPlantilla(p.diferencias)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {sinGuardian.length > 0 && (
          <div className="guardianNota">sin puerta sentinel: {sinGuardian.join(', ')}</div>
        )}
      </Seccion>

      {claveSel && (
        <Seccion titulo={`tareas de ${claveSel}`}>
          {errorDetalle && <div className="docsMensaje">{errorDetalle}</div>}
          {!detalle && !errorDetalle && (
            <div className="docsVacio">{cargandoDetalle ? 'cargando proyecto…' : 'sin datos'}</div>
          )}
          {detalle && <TablaTareas detalle={detalle} />}
        </Seccion>
      )}

      <Seccion titulo="límites conocidos">
        {/* [por que] El texto pequeño lo pone la nota compartida del panel; la lista no
         * lleva estilo propio, así no define especificación visual local. */}
        <div className="guardianNota">
          <ul>
            {LIMITES_CONOCIDOS.map((texto) => (
              <li key={texto}>{texto}</li>
            ))}
          </ul>
        </div>
      </Seccion>
    </>
  );
}

function TablaTareas({ detalle }: { detalle: EstadoProyecto }) {
  const filas = detalle.tareas.flatMap((t) =>
    Object.entries(t.clases).map(([clase, c]) => ({
      clave: `${t.tarea}|${t.etapa}|${clase}`,
      tarea: t.tarea,
      etapa: t.etapa,
      clase,
      c,
    })),
  );
  return (
    <>
      <div className="guardianNota">
        bloqueados: {detalle.totalBloqueados} · lote-extra:{' '}
        {detalle.override.existe ? detalle.override.extra : 'no existe'}
      </div>
      {filas.length === 0 ? (
        <div className="docsVacio">sin ejecuciones registradas</div>
      ) : (
        <table className="guardianTabla">
          <thead>
            <tr>
              <th>tarea</th>
              <th>etapa</th>
              <th>clase</th>
              <th>usado / tope</th>
              <th>bloqueados</th>
              <th>modo</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={f.clave}>
                <td>{f.tarea}</td>
                <td>{f.etapa}</td>
                <td>{f.clase}</td>
                <td>
                  {f.c.usado} / {f.c.limite + f.c.extra}
                </td>
                <td>{f.c.bloqueados}</td>
                <td>{f.c.modo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}
