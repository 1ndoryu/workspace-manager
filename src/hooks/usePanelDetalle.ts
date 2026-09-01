/* Hook del PanelDetalle: estado de los botones escanear/auditar por proyecto.
 * [por que] Extraido de PanelDetalle para resolver componente-sin-hook-glory:
 * el componente deriva y renderiza; el hook posee estado + handlers async. */
import { useState } from 'react';
import { useWorkspaceStore } from './useWorkspace.js';

export function usePanelDetalle() {
  const escanearUno = useWorkspaceStore((s) => s.escanearUno);
  const auditarUno = useWorkspaceStore((s) => s.auditarUno);
  const [escanneando, setEscaneando] = useState(false);
  const [auditando, setAuditando] = useState(false);

  async function escanearAhora(clave: string) {
    setEscaneando(true);
    try {
      await escanearUno(clave);
    } finally {
      setEscaneando(false);
    }
  }

  async function auditarAhora(clave: string) {
    setAuditando(true);
    try {
      await auditarUno(clave);
    } finally {
      setAuditando(false);
    }
  }

  return { escanneando, auditando, escanearAhora, auditarAhora };
}
