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
import { Linea, Lista } from '../Lineas.js';
import type { GuardianDatos } from '../useGuardian.js';
import type { ActividadGuardian, DecisionRegistro, FiltrosActividadUi } from '../tiposGuardian.js';

const LIMITE_POR_DEFECTO = 100;

/* Los filtros del formulario son texto; se convierten al pedir la actividad. */
interface FiltrosTexto {
  comando: string;
  decision: string;
  limite: string;
}

const FILTROS_INICIALES: FiltrosTexto = {
  comando: '',
  decision: '',
  limite: String(LIMITE_POR_DEFECTO),
};

function aFiltros(f: FiltrosTexto, proyecto: string | null): FiltrosActividadUi {
  return {
    proyecto: proyecto ?? '',
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
  const proyecto = datos.claveSel;
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

  /* [por que] El historial es del proyecto elegido: al cambiar de proyecto se vuelve a pedir. */
  useEffect(() => {
    setFiltros(FILTROS_INICIALES);
    void buscar(aFiltros(FILTROS_INICIALES, proyecto));
  }, [buscar, proyecto]);

  const campo = (clave: keyof FiltrosTexto, valor: string) =>
    setFiltros((f) => ({ ...f, [clave]: valor }));

  return (
    <>
      <Seccion titulo="filtros">
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
          <Button pequeno disabled={cargando} onClick={() => void buscar(aFiltros(filtros, proyecto))}>
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
  const { diario, auditoria, leases } = actividad;
  return (
    <>
      <Seccion titulo={`diario: ${diario.entradas.length} de ${diario.total}`}>
        {diario.corruptas > 0 && <div className="docsMensaje">{diario.corruptas} líneas corruptas omitidas</div>}
        {!diario.disponible && <div className="docsVacio">sin diario todavía</div>}
        {diario.entradas.length > 0 && (
          <Lista>
            {diario.entradas.map((e, i) => (
              <Linea
                key={`${e.fecha}-${i}`}
                titulo={`${e.proyecto} · ${e.comando}`}
                dato={e.decision}
                detalle={e.motivo ? `${e.fecha} · ${e.motivo}` : e.fecha}
              />
            ))}
          </Lista>
        )}
      </Seccion>

      <Seccion titulo={`auditoría de leases: ${auditoria.entradas.length} de ${auditoria.total}`}>
        {auditoria.corruptas > 0 && <div className="docsMensaje">{auditoria.corruptas} líneas corruptas omitidas</div>}
        {!auditoria.disponible && <div className="docsVacio">sin auditoría todavía</div>}
        {auditoria.entradas.length > 0 && (
          <Lista>
            {auditoria.entradas.map((e, i) => (
              <Linea
                key={`${e.at}-${i}`}
                titulo={e.command ? `${e.event} · ${e.command}` : e.event}
                dato={`válida: ${siNo(e.valid)}`}
                detalle={e.reason ? `${e.at} · ${e.reason}` : e.at}
              />
            ))}
          </Lista>
        )}
      </Seccion>

      <Seccion titulo={`leases activas: ${leases.activos.length} · expiradas: ${leases.expirados}`}>
        {leases.activos.length === 0 && <div className="docsVacio">ninguna</div>}
        {leases.activos.length > 0 && (
          <Lista>
            {leases.activos.map((l) => (
              <Linea
                key={l.id}
                titulo={l.command}
                dato={`pid ${l.pid}`}
                detalle={`${l.projectRoot} · expira ${l.expiresAt}`}
              />
            ))}
          </Lista>
        )}
      </Seccion>
    </>
  );
}
