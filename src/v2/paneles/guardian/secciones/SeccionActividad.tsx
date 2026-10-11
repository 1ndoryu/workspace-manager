/* Sección Actividad: diario del guard (bloqueos, observaciones, pasos), auditoría de
 * leases y leases activas. Solo lectura.
 * [por que] El servidor limita las entradas (máx. 500) y cuenta las líneas corruptas
 * en vez de fallar; la tabla muestra cuántas se omitieron. */
import { useCallback, useEffect, useState } from 'react';
import { Seccion } from '../../../ui/caja/Caja.js';
import { Button } from '../../../ui/form/Button.js';
import { Selector } from '../../../ui/selector/Selector.js';
import { mensajeDeError } from '../../../toast.js';
import { leerOk, verActividad } from '../apiGuardian.js';
import type { GuardianDatos } from '../useGuardian.js';
import type {
  ActividadGuardian,
  DecisionRegistro,
  FiltrosActividadUi,
  ProyectoArea,
} from '../tiposGuardian.js';

const LIMITE_POR_DEFECTO = 100;

/* Los filtros del formulario son texto; se convierten al pedir la actividad. */
interface FiltrosTexto {
  proyecto: string;
  comando: string;
  decision: string;
  limite: string;
}

const FILTROS_INICIALES: FiltrosTexto = {
  proyecto: '',
  comando: '',
  decision: '',
  limite: String(LIMITE_POR_DEFECTO),
};

function aFiltros(f: FiltrosTexto): FiltrosActividadUi {
  return {
    proyecto: f.proyecto,
    comando: f.comando,
    decision: f.decision === '' ? undefined : (f.decision as DecisionRegistro),
    limite: f.limite === '' ? undefined : Number(f.limite),
  };
}

function siNo(valor: boolean | undefined): string {
  if (valor === undefined) return '—';
  return valor ? 'sí' : 'no';
}

export function SeccionActividad({ datos }: { datos: GuardianDatos }) {
  const elegibles = datos.area?.proyectos.filter((p): p is ProyectoArea => p.elegible) ?? [];
  const [filtros, setFiltros] = useState<FiltrosTexto>(FILTROS_INICIALES);
  const [actividad, setActividad] = useState<ActividadGuardian | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(false);

  const buscar = useCallback(async (f: FiltrosActividadUi): Promise<void> => {
    setCargando(true);
    try {
      setActividad(leerOk(await verActividad(f)));
      setError(null);
    } catch (err) {
      setError(mensajeDeError(err));
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void buscar(aFiltros(FILTROS_INICIALES));
  }, [buscar]);

  const campo = (clave: keyof FiltrosTexto, valor: string) =>
    setFiltros((f) => ({ ...f, [clave]: valor }));

  return (
    <>
      <Seccion titulo="filtros">
        <div className="guardianCampo">
          <label>proyecto</label>
          <Selector
            titulo="proyecto"
            valor={filtros.proyecto === '' ? 'todos' : filtros.proyecto}
            opciones={['todos', ...elegibles.map((p) => p.clave)]}
            onChange={(v) => campo('proyecto', v === 'todos' ? '' : v)}
          />
        </div>
        <div className="guardianCampo">
          <label htmlFor="actividad-comando">comando contiene</label>
          <input id="actividad-comando" value={filtros.comando} onChange={(e) => campo('comando', e.target.value)} />
        </div>
        <div className="guardianCampo">
          <label>decisión</label>
          <Selector
            titulo="decisión"
            valor={filtros.decision === '' ? 'todas' : filtros.decision}
            opciones={['todas', 'bloqueado', 'observado', 'paso']}
            onChange={(v) => campo('decision', v === 'todas' ? '' : v)}
          />
        </div>
        <div className="guardianCampo">
          <label htmlFor="actividad-limite">máximo de entradas (1 a 500)</label>
          <input id="actividad-limite" inputMode="numeric" value={filtros.limite} onChange={(e) => campo('limite', e.target.value)} />
        </div>
        <div className="guardianAcciones">
          <Button pequeno disabled={cargando} onClick={() => void buscar(aFiltros(filtros))}>
            buscar
          </Button>
        </div>
      </Seccion>

      {error && <div className="docsMensaje">{error}</div>}
      {actividad && <ResultadoActividad actividad={actividad} />}
    </>
  );
}

function ResultadoActividad({ actividad }: { actividad: ActividadGuardian }) {
  const { diario, auditoria, leases, origen } = actividad;
  return (
    <>
      <Seccion titulo={`diario: ${diario.entradas.length} de ${diario.total}`}>
        <div className="guardianNota">
          {origen.diario}
          {diario.corruptas > 0 ? ` · ${diario.corruptas} líneas corruptas omitidas` : ''}
        </div>
        {!diario.disponible && <div className="docsVacio">sin diario todavía</div>}
        {diario.entradas.length > 0 && (
          <table className="guardianTabla">
            <thead>
              <tr>
                <th>fecha</th>
                <th>proyecto</th>
                <th>comando</th>
                <th>decisión</th>
                <th>motivo</th>
              </tr>
            </thead>
            <tbody>
              {diario.entradas.map((e, i) => (
                <tr key={`${e.fecha}-${i}`}>
                  <td>{e.fecha}</td>
                  <td>{e.proyecto}</td>
                  <td>{e.comando}</td>
                  <td>{e.decision}</td>
                  <td>{e.motivo}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Seccion>

      <Seccion titulo={`auditoría de leases: ${auditoria.entradas.length} de ${auditoria.total}`}>
        <div className="guardianNota">
          {origen.auditoria}
          {auditoria.corruptas > 0 ? ` · ${auditoria.corruptas} líneas corruptas omitidas` : ''}
        </div>
        {!auditoria.disponible && <div className="docsVacio">sin auditoría todavía</div>}
        {auditoria.entradas.length > 0 && (
          <table className="guardianTabla">
            <thead>
              <tr>
                <th>momento</th>
                <th>evento</th>
                <th>comando</th>
                <th>válida</th>
                <th>motivo</th>
              </tr>
            </thead>
            <tbody>
              {auditoria.entradas.map((e, i) => (
                <tr key={`${e.at}-${i}`}>
                  <td>{e.at}</td>
                  <td>{e.event}</td>
                  <td>{e.command ?? '—'}</td>
                  <td>{siNo(e.valid)}</td>
                  <td>{e.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Seccion>

      <Seccion titulo={`leases activas: ${leases.activos.length} · expiradas: ${leases.expirados}`}>
        {leases.activos.length === 0 && <div className="docsVacio">ninguna</div>}
        {leases.activos.length > 0 && (
          <table className="guardianTabla">
            <thead>
              <tr>
                <th>id</th>
                <th>pid</th>
                <th>comando</th>
                <th>proyecto</th>
                <th>expira</th>
              </tr>
            </thead>
            <tbody>
              {leases.activos.map((l) => (
                <tr key={l.id}>
                  <td>{l.id}</td>
                  <td>{l.pid}</td>
                  <td>{l.command}</td>
                  <td>{l.projectRoot}</td>
                  <td>{l.expiresAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Seccion>
    </>
  );
}
