/* Sección Lote: cambia el modo de varios proyectos de una vez. Primero se previsualiza
 * sin escribir y solo después se confirma.
 * [por que] La confirmación reenvía las entradas de la vista previa, sin recalcularlas. */
import { useState } from 'react';
import { Seccion } from '../../../ui/caja/Caja.js';
import { Button } from '../../../ui/form/Button.js';
import { Selector } from '../../../ui/selector/Selector.js';
import { mensajeDeError, toastError, toastInfo, toastOk } from '../../../toast.js';
import { DiffGuardian } from '../DiffGuardian.js';
import { motivoLote } from '../vistas.js';
import {
  editarLote,
  estadoProyecto,
  leerOk,
  resultadoEdicion,
  type EntradaLote,
} from '../apiGuardian.js';
import { Linea, Lista } from '../Lineas.js';
import type { GuardianDatos } from '../useGuardian.js';
import type { ModoGuard, ProyectoArea, RespuestaLote } from '../tiposGuardian.js';

export function SeccionLote({ datos }: { datos: GuardianDatos }) {
  const elegibles = datos.area?.proyectos.filter((p): p is ProyectoArea => p.elegible) ?? [];

  return (
    <Seccion titulo="lote: modo de varios proyectos">
      <LoteModo datos={datos} elegibles={elegibles} />
    </Seccion>
  );
}

function LoteModo({ datos, elegibles }: { datos: GuardianDatos; elegibles: ProyectoArea[] }) {
  const [marcados, setMarcados] = useState<Record<string, boolean>>({});
  const [modo, setModo] = useState<ModoGuard>('observe');
  const [lote, setLote] = useState<{ entradas: EntradaLote[]; respuesta: RespuestaLote } | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function previsualizar(): Promise<void> {
    const elegidos = elegibles.filter((p) => marcados[p.clave] === true);
    if (elegidos.length === 0) {
      toastInfo('elige al menos un proyecto');
      return;
    }
    setEnviando(true);
    try {
      /* [por que] El lote necesita el hash de cada proyecto y `estadoArea` no lo trae. */
      const estados = await Promise.all(
        elegidos.map((p) => estadoProyecto(p.clave).then((r) => leerOk(r))),
      );
      const entradas: EntradaLote[] = [];
      for (const e of estados) {
        if (!e.elegible) continue;
        if (!e.hashes.config) throw new Error(`${e.clave}: falta sentinel.config.json`);
        entradas.push({ clave: e.clave, hashPrevio: e.hashes.config, cambio: { modo } });
      }
      const respuesta = resultadoEdicion(await editarLote(entradas, false));
      setLote({ entradas, respuesta });
    } catch (err) {
      toastError(mensajeDeError(err));
    } finally {
      setEnviando(false);
    }
  }

  async function confirmar(): Promise<void> {
    if (!lote) return;
    setEnviando(true);
    try {
      const r = resultadoEdicion(await editarLote(lote.entradas, true));
      const motivo = motivoLote(r);
      if (motivo) toastError(motivo);
      else toastOk('lote escrito');
      setLote(null);
      await datos.refrescar();
    } catch (err) {
      toastError(mensajeDeError(err));
    } finally {
      setEnviando(false);
    }
  }

  const resultados = lote && 'resultados' in lote.respuesta ? lote.respuesta.resultados : [];
  const puedeConfirmar =
    lote !== null && lote.respuesta.estado === 'ok' && resultados.some((x) => x.cambia);

  return (
    <>
      <div className="guardianCampo">
        <span>proyectos</span>
        {elegibles.length === 0 && <div className="docsVacio">sin proyectos con guardián</div>}
        {elegibles.map((p) => (
          <label key={p.clave} className="guardianCasilla">
            <input
              type="checkbox"
              checked={marcados[p.clave] === true}
              onChange={(e) => setMarcados((m) => ({ ...m, [p.clave]: e.target.checked }))}
            />
            {p.clave}
          </label>
        ))}
      </div>
      <div className="guardianCampo">
        <label>modo para los proyectos marcados</label>
        <Selector
          titulo="modo"
          valor={modo}
          opciones={['enforce', 'observe', 'pass-through']}
          onChange={(v) => setModo(v as ModoGuard)}
        />
      </div>
      <div className="guardianAcciones">
        <Button pequeno disabled={enviando} onClick={() => void previsualizar()}>
          vista previa del lote
        </Button>
        {puedeConfirmar && (
          <Button pequeno disabled={enviando} onClick={() => void confirmar()}>
            confirmar lote
          </Button>
        )}
        {lote && (
          <Button pequeno disabled={enviando} onClick={() => setLote(null)}>
            descartar
          </Button>
        )}
      </div>
      {lote && (
        <>
          {lote.respuesta.estado !== 'ok' && (
            <div className="docsMensaje">{motivoLote(lote.respuesta)}</div>
          )}
          {resultados.length > 0 && (
            <Lista>
              {resultados.map((x) => (
                <Linea
                  key={x.clave}
                  titulo={x.clave}
                  dato={x.cambia ? `${x.estado} · cambia` : x.estado}
                  detalle={x.motivo ?? ''}
                />
              ))}
            </Lista>
          )}
          {resultados.map((x) => (
            <DiffGuardian key={x.clave} etiqueta={x.clave} diff={x.diff ?? null} />
          ))}
        </>
      )}
    </>
  );
}
