/* Sección Plantilla: .quality-tools/guard-plantillas.json, global del área.
 * [por que] Solo se edita si el archivo existe y es válido: sin hash no hay
 * hashPrevio que mandar, y crear el archivo queda fuera de esta pestaña. El
 * formulario se monta con key = hash, igual que la política. */
import { useCallback, useEffect, useState } from 'react';
import { Seccion } from '../../../ui/caja/Caja.js';
import { Button } from '../../../ui/form/Button.js';
import { Campo } from '../../../ui/form/Campo.js';
import { mensajeDeError, toastError, toastOk } from '../../../toast.js';
import { PreviaGuardian } from '../DiffGuardian.js';
import { vistaDeEdicion, type VistaPrevia } from '../vistas.js';
import {
  editarPlantilla,
  leerOk,
  resultadoEdicion,
  verPlantilla,
  type CuerpoPlantilla,
} from '../apiGuardian.js';
import type { GuardianDatos } from '../useGuardian.js';
import type { LecturaPlantilla, PlantillaDatos } from '../tiposGuardian.js';

type LecturaOk = Extract<LecturaPlantilla, { estado: 'ok' }>;

export function SeccionPlantilla({ datos }: { datos: GuardianDatos }) {
  const [lectura, setLectura] = useState<LecturaPlantilla | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cargar = useCallback(async (): Promise<void> => {
    try {
      setLectura(leerOk(await verPlantilla()));
      setError(null);
    } catch (err) {
      setError(mensajeDeError(err));
    }
  }, []);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  return (
    <Seccion titulo="plantilla de stacks (guard-plantillas.json)">
      {error && <div className="docsMensaje">{error}</div>}
      {!error && !lectura && <div className="docsVacio">cargando plantilla…</div>}
      {lectura && lectura.estado !== 'ok' && (
        <div className="docsMensaje">
          {lectura.estado === 'ausente'
            ? 'falta .quality-tools/guard-plantillas.json en workspace-manager: crearla queda fuera de esta pestaña'
            : lectura.motivo}
        </div>
      )}
      {lectura?.estado === 'ok' && (
        <FormularioPlantilla key={lectura.hash} datos={datos} lectura={lectura} alEscribir={cargar} />
      )}
    </Seccion>
  );
}

interface FormularioPlantillaProps {
  datos: GuardianDatos;
  lectura: LecturaOk;
  alEscribir: () => Promise<void>;
}

function FormularioPlantilla({ datos, lectura, alEscribir }: FormularioPlantillaProps) {
  const [texto, setTexto] = useState(lectura.contenido);
  const [previa, setPrevia] = useState<{ vista: VistaPrevia; cuerpo: CuerpoPlantilla } | null>(null);
  const [enviando, setEnviando] = useState(false);

  /* [por que] Aquí solo se valida que sea JSON; la forma la valida el servidor. */
  function parsear(): PlantillaDatos | null {
    try {
      return JSON.parse(texto) as PlantillaDatos;
    } catch (err) {
      toastError(`JSON no válido: ${mensajeDeError(err)}`);
      return null;
    }
  }

  async function previsualizar(): Promise<void> {
    const plantilla = parsear();
    if (!plantilla) return;
    const cuerpo: CuerpoPlantilla = { hashPrevio: lectura.hash, plantilla };
    setEnviando(true);
    try {
      const r = resultadoEdicion(await editarPlantilla(cuerpo));
      setPrevia({ vista: vistaDeEdicion(r, 'plantilla'), cuerpo });
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
      const r = resultadoEdicion(await editarPlantilla({ ...previa.cuerpo, confirmar: true }));
      if (r.estado === 'ok') toastOk(r.escrito ? 'plantilla escrita' : 'sin cambios');
      else toastError(r.motivo);
      setPrevia(null);
      await alEscribir();
      await datos.refrescar();
    } catch (err) {
      toastError(mensajeDeError(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <>
      <Campo codigo htmlFor="plantilla-texto" etiqueta="contenido JSON">
        <textarea
          id="plantilla-texto"
          rows={16}
          spellCheck={false}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
        />
      </Campo>
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
