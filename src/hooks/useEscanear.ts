/* Escaneo unificado (analisis + auditoria de vulnerabilidades) en un solo
 * boton 'escanear'.
 * [por que] El usuario pidio unificar 'escanear ahora' y 'auditar' en un
 * unico boton: vive en la configuracion y como acceso rapido junto al
 * filtro de la consola. Secuencial (analisis y luego auditoria) para no
 * solapar dos recorridos del workspace; el server ya evita solapes por
 * operacion con single-flight. */
import { useState } from 'react';
import { useWorkspaceStore } from './useWorkspace.js';
import { mensajeDeError, toastError, toastOk } from '../v2/toast.js';

export function useEscanear() {
  const escanearTodo = useWorkspaceStore((s) => s.escanearTodo);
  const auditarTodo = useWorkspaceStore((s) => s.auditarTodo);
  const escanearUno = useWorkspaceStore((s) => s.escanearUno);
  const auditarUno = useWorkspaceStore((s) => s.auditarUno);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  /* Todo el workspace (configuracion + acceso rapido de la consola):
   * forzar=true para un escaneo GENUINO aunque la frescura no cambio. */
  async function escanearTodoUnificado() {
    if (ocupado) return;
    setOcupado(true);
    setAviso(null);
    try {
      await escanearTodo(true);
      await auditarTodo(true);
      setAviso('escaneo completo ✓');
      toastOk('escaneo completo ✓');
    } catch (err) {
      toastError(`no se pudo escanear: ${mensajeDeError(err)}`);
    } finally {
      setOcupado(false);
    }
  }

  /* Un proyecto (detalle): sin forzar, reusa frescura como hacian los
   * botones separados. conAnalisis=false en proyectos sin puerta sentinel
   * (antes el boton de analisis ni se renderizaba ahi). */
  async function escanearProyecto(clave: string, conAnalisis: boolean) {
    if (ocupado) return;
    setOcupado(true);
    try {
      if (conAnalisis) await escanearUno(clave);
      await auditarUno(clave);
    } finally {
      setOcupado(false);
    }
  }

  return { ocupado, aviso, escanearTodoUnificado, escanearProyecto };
}
