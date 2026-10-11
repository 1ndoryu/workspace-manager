/* Estado de la sección Mantenimiento: opciones, simulación y envío de shims y perfiles.
 * [por que] Cambiar una opción borra el resultado: `aplicar` solo se habilita con una
 * simulación correcta hecha con las mismas opciones. */
import { useState } from 'react';
import { mensajeDeError, toastError, toastOk } from '../../toast.js';
import { ejecutarMantenimiento, resultadoEdicion } from './apiGuardian.js';
import type { GuardianDatos } from './useGuardian.js';
import type { ResultadoMantenimiento } from './tiposGuardian.js';

export interface MantenimientoDatos {
  conShims: boolean;
  conPerfiles: boolean;
  cambiarShims: (valor: boolean) => void;
  cambiarPerfiles: (valor: boolean) => void;
  resultado: ResultadoMantenimiento | null;
  enviando: boolean;
  aplicable: boolean;
  simular: () => Promise<void>;
  aplicar: () => Promise<void>;
}

export function useMantenimiento(datos: GuardianDatos): MantenimientoDatos {
  const [conShims, setConShims] = useState(false);
  const [conPerfiles, setConPerfiles] = useState(false);
  const [resultado, setResultado] = useState<ResultadoMantenimiento | null>(null);
  const [enviando, setEnviando] = useState(false);

  const aplicable = resultado?.modo === 'simulacion' && resultado.estado === 'ok';

  async function ejecutar(confirmar: boolean): Promise<void> {
    setEnviando(true);
    try {
      const r = resultadoEdicion(await ejecutarMantenimiento({ conShims, conPerfiles, confirmar }));
      setResultado(r);
      if (confirmar) {
        if (r.estado === 'ok') {
          toastOk('mantenimiento aplicado');
          await datos.refrescar();
        } else {
          toastError(r.motivo ?? 'mantenimiento no aplicado');
        }
      }
    } catch (err) {
      toastError(mensajeDeError(err));
    } finally {
      setEnviando(false);
    }
  }

  return {
    conShims,
    conPerfiles,
    cambiarShims: (valor) => {
      setConShims(valor);
      setResultado(null);
    },
    cambiarPerfiles: (valor) => {
      setConPerfiles(valor);
      setResultado(null);
    },
    resultado,
    enviando,
    aplicable,
    simular: () => ejecutar(false),
    aplicar: () => ejecutar(true),
  };
}
