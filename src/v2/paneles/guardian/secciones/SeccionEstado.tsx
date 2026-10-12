/* Sección Estado: qué proyectos tienen Guardián y cuáles piden atención.
 * [por que] Vista general de solo lectura. Elegir una línea fija el proyecto que
 * usan las demás secciones y muestra aquí su detalle. Los que piden revisión van
 * primero: es lo único que obliga a actuar. */
import { useState } from 'react';
import { Seccion } from '../../../ui/caja/Caja.js';
import { Button } from '../../../ui/form/Button.js';
import type { GuardianDatos } from '../useGuardian.js';
import type { EstadoProyecto, ProyectoArea } from '../tiposGuardian.js';
import { EXPLICACION_MODOS, MODO_LLANO, fraseArea, resumenProyecto, type FilaResumen } from '../lenguaje.js';
import { Linea, Lista } from '../Lineas.js';

/* Límites del guard que aún no cubre: se anotan aquí; el hallazgo sigue abierto. */
const LIMITES_CONOCIDOS = [
  'En cmd, cargo.exe explícito no pasa por los shims .cmd.',
  'GLORY_REAL_NODE lo fija el entorno; el guard no lo controla.',
  'node .../vitest.mjs no pasa por el guard.',
  'cmd no tiene shims para eslint, prettier ni rustfmt.',
];

interface SeccionEstadoProps {
  datos: GuardianDatos;
  /* Salta a otra sección del panel con el proyecto ya elegido. */
  onIr?: (vista: 'politica' | 'topes' | 'probar') => void;
}

function datoResumen(f: FilaResumen): string {
  if (f.revisar.length > 0) return 'revisar';
  return f.bloqueos > 0 ? `${f.comandos} · ${f.bloqueos} bloqueos` : f.comandos;
}

export function SeccionEstado({ datos, onIr }: SeccionEstadoProps) {
  const { area, errorArea, claveSel, detalle, cargandoDetalle, errorDetalle, elegir } = datos;
  const [verLimites, setVerLimites] = useState(false);
  if (errorArea) return <div className="docsMensaje">{errorArea}</div>;
  if (!area) return <div className="docsVacio">cargando estado…</div>;

  const filas = area.proyectos
    .filter((p): p is ProyectoArea => p.elegible)
    .map(resumenProyecto)
    .sort((x, y) => Number(y.revisar.length > 0) - Number(x.revisar.length > 0));
  const sel = filas.find((f) => f.clave === claveSel);
  const sinGuardian = area.proyectos.filter((p) => !p.elegible).map((p) => p.clave);

  return (
    <>
      <div className="guardianNota">{fraseArea(area.proyectos)}</div>
      <Seccion titulo="proyectos">
        <Lista>
          {filas.map((f) => (
            <Linea
              key={f.clave}
              titulo={f.clave}
              dato={datoResumen(f)}
              detalle={f.revisar.join(' · ')}
              activa={f.clave === claveSel}
              onClick={() => elegir(f.clave)}
            />
          ))}
        </Lista>
        <div className="guardianNota guardianNota--tenue">{EXPLICACION_MODOS}</div>
        {sinGuardian.length > 0 && (
          <div className="guardianNota guardianNota--tenue">sin guardián (su puerta no es sentinel): {sinGuardian.join(', ')}</div>
        )}
      </Seccion>

      {claveSel && (
        <Seccion titulo={`detalle de ${claveSel}`}>
          {onIr && (
            <div className="guardianAcciones">
              <Button pequeno onClick={() => onIr('politica')}>
                cambiar reglas
              </Button>
              <Button pequeno onClick={() => onIr('topes')}>
                cambiar límites
              </Button>
              <Button pequeno onClick={() => onIr('probar')}>
                probar un comando
              </Button>
            </div>
          )}
          {errorDetalle && <div className="docsMensaje">{errorDetalle}</div>}
          {!detalle && !errorDetalle && (
            <div className="docsVacio">{cargandoDetalle ? 'cargando proyecto…' : 'sin datos'}</div>
          )}
          {detalle && <DetalleProyecto detalle={detalle} comandos={sel?.comandos ?? '—'} limites={sel?.limites ?? '—'} />}
        </Seccion>
      )}

      <Seccion titulo="límites conocidos del guard">
        <div className="guardianAcciones">
          <Button pequeno onClick={() => setVerLimites((v) => !v)}>
            {verLimites ? 'ocultar' : `ver los ${LIMITES_CONOCIDOS.length}`}
          </Button>
        </div>
        {verLimites && (
          <Lista>
            {LIMITES_CONOCIDOS.map((texto) => (
              <Linea key={texto} titulo={texto} />
            ))}
          </Lista>
        )}
      </Seccion>
    </>
  );
}

function DetalleProyecto({ detalle, comandos, limites }: { detalle: EstadoProyecto; comandos: string; limites: string }) {
  const tareas = detalle.tareas.flatMap((t) =>
    Object.entries(t.clases).map(([clase, c]) => ({ clave: `${t.tarea}|${t.etapa}|${clase}`, t, clase, c })),
  );
  return (
    <Lista>
      <Linea titulo="comandos" dato={comandos} />
      <Linea titulo="límites" dato={limites} />
      <Linea titulo="bloqueos" dato={detalle.totalBloqueados} />
      <Linea titulo="margen extra de lote" dato={detalle.override.existe ? detalle.override.extra : 'no hay'} />
      {tareas.length === 0 && <div className="docsVacio">este proyecto aún no ha ejecutado nada con guardián</div>}
      {tareas.map(({ clave, t, clase, c }) => (
        <Linea
          key={clave}
          titulo={`${t.tarea} · ${clase}`}
          dato={`${c.usado} de ${c.limite + c.extra} usos`}
          detalle={`etapa ${t.etapa} · ${c.bloqueados} bloqueos · ${MODO_LLANO[c.modo]}`}
        />
      ))}
    </Lista>
  );
}
