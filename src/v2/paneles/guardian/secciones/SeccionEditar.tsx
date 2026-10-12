/* Sección Política: modo y listas del proyecto elegido.
 * [por que] El formulario se monta con key = hash de config: tras cada escritura el
 * hash cambia y el formulario se rehace desde el estado real, sin sincronizar a mano.
 * Las listas enviadas reemplazan la lista entera (contrato del servidor), por eso
 * solo se envían las que cambian. */
import { useState } from 'react';
import { Seccion } from '../../../ui/caja/Caja.js';
import { Button } from '../../../ui/form/Button.js';
import { Selector } from '../../../ui/selector/Selector.js';
import { mensajeDeError, toastError, toastInfo, toastOk } from '../../../toast.js';
import { PreviaGuardian } from '../DiffGuardian.js';
import { vistaDeEdicion, type VistaPrevia } from '../vistas.js';
import { editarPolitica, resultadoEdicion, type CuerpoPolitica } from '../apiGuardian.js';
import type { GuardianDatos } from '../useGuardian.js';
import { SeccionLote } from './SeccionLote.js';
import {
  LISTAS,
  type CambioPolitica,
  type EstadoListas,
  type EstadoProyecto,
  type ListaGuard,
  type Listas,
  type ModoGuard,
} from '../tiposGuardian.js';

type ListasOk = Extract<EstadoListas, { estado: 'ok' }>;

const ETIQUETA_LISTA: Record<ListaGuard, string> = {
  npmScripts: 'scripts npm',
  npxTools: 'npx',
  cargoSubcommands: 'subcomandos cargo',
  tools: 'herramientas',
};

function lineas(texto: string): string[] {
  return texto
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

function textosDe(listas: Listas): Record<ListaGuard, string> {
  return {
    npmScripts: listas.npmScripts.join('\n'),
    npxTools: listas.npxTools.join('\n'),
    cargoSubcommands: listas.cargoSubcommands.join('\n'),
    tools: listas.tools.join('\n'),
  };
}

export function SeccionEditar({ datos }: { datos: GuardianDatos }) {
  const { claveSel, detalle, errorDetalle } = datos;

  return (
    <>
      <Seccion titulo={claveSel ? `política de ${claveSel}` : 'política'}>
        {!claveSel && <div className="docsVacio">elige un proyecto en el menú</div>}
        {claveSel && errorDetalle && <div className="docsMensaje">{errorDetalle}</div>}
        {claveSel && !detalle && !errorDetalle && (
          <div className="docsVacio">cargando proyecto…</div>
        )}
        {detalle && <PoliticaProyecto datos={datos} detalle={detalle} />}
      </Seccion>

      <SeccionLote datos={datos} />
    </>
  );
}

function PoliticaProyecto({ datos, detalle }: { datos: GuardianDatos; detalle: EstadoProyecto }) {
  const { clave, hashes, listas } = detalle;
  if (!hashes.config) {
    return <div className="docsMensaje">falta sentinel.config.json: sin política que editar</div>;
  }
  if (listas.estado !== 'ok') {
    return (
      <div className="docsMensaje">
        {listas.estado === 'ausente' ? 'sin política de listas' : listas.motivo}
      </div>
    );
  }
  return (
    <FormularioPolitica
      key={hashes.config}
      datos={datos}
      clave={clave}
      hashConfig={hashes.config}
      inicial={listas}
    />
  );
}

interface FormularioPoliticaProps {
  datos: GuardianDatos;
  clave: string;
  hashConfig: string;
  inicial: ListasOk;
}

function FormularioPolitica({ datos, clave, hashConfig, inicial }: FormularioPoliticaProps) {
  const [modo, setModo] = useState<ModoGuard>(inicial.modo);
  const [textos, setTextos] = useState<Record<ListaGuard, string>>(() => textosDe(inicial.listas));
  const [previa, setPrevia] = useState<{ vista: VistaPrevia; cuerpo: CuerpoPolitica } | null>(null);
  const [enviando, setEnviando] = useState(false);

  function construirCambio(): CambioPolitica {
    const cambio: CambioPolitica = {};
    if (modo !== inicial.modo) cambio.modo = modo;
    const listas: Partial<Listas> = {};
    for (const lista of LISTAS) {
      const nuevas = lineas(textos[lista]);
      if (nuevas.join('\n') !== inicial.listas[lista].join('\n')) listas[lista] = nuevas;
    }
    if (Object.keys(listas).length > 0) cambio.listas = listas;
    return cambio;
  }

  async function previsualizar(cambio: CambioPolitica): Promise<void> {
    if (Object.keys(cambio).length === 0) {
      toastInfo('sin cambios que previsualizar');
      return;
    }
    const cuerpo: CuerpoPolitica = { clave, hashPrevio: hashConfig, cambio };
    setEnviando(true);
    try {
      const r = resultadoEdicion(await editarPolitica(cuerpo));
      setPrevia({ vista: vistaDeEdicion(r, 'política'), cuerpo });
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
      const r = resultadoEdicion(await editarPolitica({ ...previa.cuerpo, confirmar: true }));
      if (r.estado === 'ok') toastOk(r.escrito ? 'política escrita' : 'sin cambios');
      else toastError(r.motivo);
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
        <label>modo</label>
        <Selector
          titulo="modo"
          valor={modo}
          opciones={['enforce', 'observe', 'pass-through']}
          onChange={(v) => setModo(v as ModoGuard)}
        />
        <span>enforce = bloquea · observe = solo avisa · pass-through = no actúa</span>
      </div>
      {LISTAS.map((lista) => (
        <div key={lista} className="guardianCampo">
          <label htmlFor={`politica-${lista}`}>
            {ETIQUETA_LISTA[lista]} (una por línea)
          </label>
          <textarea
            id={`politica-${lista}`}
            rows={4}
            value={textos[lista]}
            onChange={(e) => setTextos((t) => ({ ...t, [lista]: e.target.value }))}
          />
        </div>
      ))}
      <div className="guardianAcciones">
        <Button pequeno disabled={enviando} onClick={() => void previsualizar(construirCambio())}>
          vista previa
        </Button>
        <Button pequeno disabled={enviando} onClick={() => void previsualizar({ aplicarPlantilla: true })}>
          aplicar plantilla del stack
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
