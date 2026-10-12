/* Sección Presupuestos: topes del guard (budgets de sentinel.config.json) y el extra
 * total de lote-extra.md para el proyecto elegido.
 * [por que] Igual que la política: vista previa antes de escribir y formulario
 * montado con key de los hashes. Un límite vacío quita la clave (`null` en el
 * contrato) y vuelve al defecto del guard. */
import { useState } from 'react';
import { Seccion } from '../../../ui/caja/Caja.js';
import { Button } from '../../../ui/form/Button.js';
import { Selector } from '../../../ui/selector/Selector.js';
import { mensajeDeError, toastError, toastInfo, toastOk } from '../../../toast.js';
import { PreviaGuardian } from '../DiffGuardian.js';
import { textoErrorTopes, vistaDeTopes, type VistaPrevia } from '../vistas.js';
import { editarTopes, resultadoEdicion, type CuerpoTopes } from '../apiGuardian.js';
import type { GuardianDatos } from '../useGuardian.js';
import {
  CLASES_TOPE,
  type CambioTopes,
  type ClaseTope,
  type EstadoProyecto,
  type ModoTope,
} from '../tiposGuardian.js';

/* Máximo de un tope y del extra (TOPE_MAX y EXTRA_MAX en el servidor). */
const MAXIMO = 100;

function textosLimites(limites: Record<string, number>): Record<ClaseTope, string> {
  const textos = {} as Record<ClaseTope, string>;
  for (const clase of CLASES_TOPE) {
    textos[clase] = clase in limites ? String(limites[clase]) : '';
  }
  return textos;
}

function entero(texto: string, etiqueta: string): number {
  const n = texto === '' ? Number.NaN : Number(texto);
  if (!Number.isInteger(n) || n < 0 || n > MAXIMO) {
    throw new Error(`${etiqueta}: entero entre 0 y ${MAXIMO}`);
  }
  return n;
}

export function SeccionTopes({ datos }: { datos: GuardianDatos }) {
  const { detalle, claveSel, errorDetalle } = datos;
  const titulo = claveSel ? `presupuestos de ${claveSel}` : 'presupuestos';

  if (!detalle) {
    return (
      <Seccion titulo={titulo}>
        {errorDetalle ? (
          <div className="docsMensaje">{errorDetalle}</div>
        ) : (
          <div className="docsVacio">{claveSel ? 'cargando proyecto…' : 'elige un proyecto en el menú'}</div>
        )}
      </Seccion>
    );
  }

  if (!detalle.hashes.config) {
    return (
      <Seccion titulo={titulo}>
        <div className="docsMensaje">falta sentinel.config.json: sin presupuestos que editar</div>
      </Seccion>
    );
  }

  return (
    <Seccion titulo={titulo}>
      <FormularioTopes
        key={`${detalle.hashes.config}|${detalle.hashes.extra ?? ''}`}
        datos={datos}
        detalle={detalle}
        hashConfig={detalle.hashes.config}
        hashExtra={detalle.hashes.extra}
      />
    </Seccion>
  );
}

interface FormularioTopesProps {
  datos: GuardianDatos;
  detalle: EstadoProyecto;
  hashConfig: string;
  hashExtra: string | null;
}

function FormularioTopes({ datos, detalle, hashConfig, hashExtra }: FormularioTopesProps) {
  const base = textosLimites(detalle.politica.limites);
  const [modo, setModo] = useState<ModoTope>(detalle.politica.modo);
  const [limites, setLimites] = useState<Record<ClaseTope, string>>(base);
  const [extra, setExtra] = useState(String(detalle.override.extra));
  const [motivo, setMotivo] = useState('');
  const [previa, setPrevia] = useState<{ vista: VistaPrevia; cuerpo: CuerpoTopes } | null>(null);
  const [enviando, setEnviando] = useState(false);

  function construirCambio(): CambioTopes {
    const cambio: CambioTopes = {};
    if (modo !== detalle.politica.modo) cambio.modo = modo;

    const cambiosLimites: Partial<Record<ClaseTope, number | null>> = {};
    for (const clase of CLASES_TOPE) {
      const texto = limites[clase].trim();
      if (texto === base[clase]) continue;
      cambiosLimites[clase] = texto === '' ? null : entero(texto, clase);
    }
    if (Object.keys(cambiosLimites).length > 0) cambio.limites = cambiosLimites;

    const extraNuevo = entero(extra.trim(), 'extra total');
    if (extraNuevo !== detalle.override.extra) cambio.extraTotal = extraNuevo;

    if (motivo.trim()) cambio.motivo = motivo.trim();
    return cambio;
  }

  async function previsualizar(): Promise<void> {
    let cambio: CambioTopes;
    try {
      cambio = construirCambio();
    } catch (err) {
      toastError(mensajeDeError(err));
      return;
    }
    if (Object.keys(cambio).length === 0) {
      toastInfo('sin cambios que previsualizar');
      return;
    }
    const cuerpo: CuerpoTopes = {
      clave: detalle.clave,
      hashes: { config: hashConfig, extra: hashExtra },
      cambio,
    };
    setEnviando(true);
    try {
      const r = resultadoEdicion(await editarTopes(cuerpo));
      setPrevia({ vista: vistaDeTopes(r), cuerpo });
    } catch (err) {
      toastError(mensajeDeError(err));
    } finally {
      setEnviando(false);
    }
  }

  async function confirmar(): Promise<void> {
    if (!previa) return;
    setEnviando(true);
    try {
      const r = resultadoEdicion(await editarTopes({ ...previa.cuerpo, confirmar: true }));
      if (r.estado === 'ok') toastOk(r.escrito ? 'presupuestos escritos' : 'sin cambios');
      else toastError(textoErrorTopes(r));
      setPrevia(null);
      await datos.refrescar();
    } catch (err) {
      toastError(mensajeDeError(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <div className="guardianCampo">
        <label>modo de presupuestos</label>
        <Selector
          titulo="modo de presupuestos"
          valor={modo}
          opciones={['observe', 'enforce']}
          onChange={(v) => setModo(v as ModoTope)}
        />
      </div>

      {CLASES_TOPE.map((clase) => (
        <div key={clase} className="guardianCampo">
          <label htmlFor={`tope-${clase}`}>
            {clase} · ahora: {base[clase] === '' ? 'defecto' : base[clase]}
          </label>
          <input
            id={`tope-${clase}`}
            inputMode="numeric"
            placeholder="defecto (vacío quita el límite)"
            value={limites[clase]}
            onChange={(e) => setLimites((l) => ({ ...l, [clase]: e.target.value }))}
          />
        </div>
      ))}

      <div className="guardianCampo">
        <label htmlFor="topes-extra">
          extra total de lote-extra.md (hoy {detalle.override.existe ? 'existe' : 'no existe'})
        </label>
        <input id="topes-extra" inputMode="numeric" value={extra} onChange={(e) => setExtra(e.target.value)} />
      </div>
      <div className="guardianCampo">
        <label htmlFor="topes-motivo">motivo, opcional (máx. 120)</label>
        <input id="topes-motivo" maxLength={120} value={motivo} onChange={(e) => setMotivo(e.target.value)} />
      </div>
      <div className="guardianAcciones">
        <Button pequeno disabled={enviando} onClick={() => void previsualizar()}>
          vista previa
        </Button>
      </div>
      {previa && (
        <PreviaGuardian
          vista={previa.vista}
          enviando={enviando}
          onConfirmar={() => void confirmar()}
          onDescartar={() => setPrevia(null)}
        />
      )}
    </>
  );
}
