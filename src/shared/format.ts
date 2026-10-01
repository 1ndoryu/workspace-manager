/* Formateadores compartidos (0110A-2 F2).
 * [por que] Cada panel habia inventado el suyo: `fmtBytes` en PanelVps
 * (KiB/MiB/GiB), `formatearTamano` en PanelNavegador (KB/MB), `gb` en apiPc,
 * `fechaCorta` en DetalleRepo, `toLocaleString` sueltos x3 y `slice(0, 7)`
 * x5. Un solo dueño, mismas firmas que las originales. */

export function fmtBytes(b: number): string {
  if (b < 1024) return `${Math.round(b)} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KiB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GiB`;
}

/* Gibibytes con 2 decimales para tablas y resumenes. */
export function gb(bytes: number): string {
  return (bytes / 1024 / 1024 / 1024).toFixed(2);
}

/* "2026-09-28 12:00:00 +0200" -> "28-09". */
export function fechaCorta(fecha: string): string {
  const m = fecha.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}-${m[2]}` : '';
}

export function fechaHora(fecha: string | number | Date): string {
  return new Date(fecha).toLocaleString();
}

export function horaCorta(fecha: string | number | Date): string {
  return new Date(fecha).toLocaleTimeString();
}

export function hashCorto(hash: string): string {
  return hash.slice(0, 7);
}
