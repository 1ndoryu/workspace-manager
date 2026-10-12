/* Secciones de estado: la vista del área (todos los proyectos) y el resumen de uno.
 * [por que] Los proyectos van sueltos en el menú; aquí el área solo sirve para ver
 * cuáles piden atención (primero) y abrirlos. El resumen de un proyecto vive dentro
 * de él, junto a sus demás pestañas. */
import { useState } from 'react';
import { Seccion } from '../../../ui/caja/Caja.js';
import { Button } from '../../../ui/form/Button.js';
import type { GuardianDatos } from '../useGuardian.js';
import type { EstadoProyecto, ProyectoArea } from '../tiposGuardian.js';
import { MODO_LLANO, resumenProyecto, type FilaResumen } from '../lenguaje.js';
import { Linea, Lista } from '../Lineas.js';

/* Límites del guard que aún no cubre: se anotan aquí; el hallazgo sigue abierto. */
const LIMITES_CONOCIDOS = [
  'En cmd, cargo.exe explícito no pasa por los shims .cmd.',
  'GLORY_REAL_NODE lo fija el entorno; el guard no lo controla.',
  'node .../vitest.mjs no pasa por el guard.',
  'cmd no tiene shims para eslint, prettier ni rustfmt.',
];

function datoResumen(f: FilaResumen): string {
  if (f.revisar.length > 0) return 'revisar';
  return f.bloqueos > 0 ? `${f.comandos} · ${f.bloqueos} bloqueos` : f.comandos;
}

export function SeccionArea({ datos, onAbrir }: { datos: GuardianDatos; onAbrir: (clave: string) => void }) {
  const { area, errorArea } = datos;
  const [verLimites, setVerLimites] = useState(false);
  if (errorArea) return <div className="docsMensaje">{errorArea}</div>;
  if (!area) return <div className="docsVacio">cargando estado…</div>;

  const filas = area.proyectos
    .filter((p): p is ProyectoArea => p.elegible)
    .map(resumenProyecto)
    .sort((x, y) => Number(y.revisar.length > 0) - Number(x.revisar.length > 0));

  return (
    <>
      <Lista>
        {filas.map((f) => (
          <Linea
            key={f.clave}
            titulo={f.clave}
            dato={datoResumen(f)}
            detalle={f.revisar.join(' · ')}
            onClick={() => onAbrir(f.clave)}
          />
        ))}
      </Lista>

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

export function SeccionResumen({ datos }: { datos: GuardianDatos }) {
  const { area, claveSel, detalle, cargandoDetalle, errorDetalle } = datos;
  const proyecto = area?.proyectos.find((p): p is ProyectoArea => p.elegible && p.clave === claveSel);
  const fila = proyecto ? resumenProyecto(proyecto) : undefined;

  if (errorDetalle) return <div className="docsMensaje">{errorDetalle}</div>;
  if (!detalle) return <div className="docsVacio">{cargandoDetalle ? 'cargando proyecto…' : 'sin datos'}</div>;
  return (
    <>
      <DetalleProyecto detalle={detalle} comandos={fila?.comandos ?? '—'} limites={fila?.limites ?? '—'} />
    </>
  );
}

function DetalleProyecto({ detalle, comandos, limites }: { detalle: EstadoProyecto; comandos: string; limites: string }) {
  const tareas = detalle.tareas.flatMap((t) =>
    Object.entries(t.clases).map(([clase, c]) => ({ clave: `${t.tarea}|${t.etapa}|${clase}`, t, clase, c })),
  );
  /* [por que] Los cuatro datos del proyecto van en un solo cuadro, pegados; las tareas
   * son otra cosa y van debajo en su propia lista. */
  return (
    <>
      <div className="guardianCuadro">
        <Linea titulo="comandos" dato={comandos} />
        <Linea titulo="límites" dato={limites} />
        <Linea titulo="bloqueos" dato={detalle.totalBloqueados} />
        <Linea titulo="margen extra de lote" dato={detalle.override.existe ? detalle.override.extra : 'no hay'} />
      </div>
      {tareas.length === 0 && <div className="docsVacio">este proyecto aún no ha ejecutado nada con guardián</div>}
      {tareas.length > 0 && (
        <Lista>
          {tareas.map(({ clave, t, clase, c }) => (
            <Linea
              key={clave}
              titulo={`${t.tarea} · ${clase}`}
              dato={`${c.usado} de ${c.limite + c.extra} usos`}
              detalle={`etapa ${t.etapa} · ${c.bloqueados} bloqueos · ${MODO_LLANO[c.modo]}`}
            />
          ))}
        </Lista>
      )}
    </>
  );
}
