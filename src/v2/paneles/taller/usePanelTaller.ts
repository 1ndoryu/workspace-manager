/* Lógica del PanelTaller (regla componente-sin-hook-glory: el componente solo pinta).
 * Deriva el veredicto y las filas de cada sección a partir del estado compartido. */
import {
  IDS_CONFORMIDAD,
  type EstadoPublico,
  type EstadoTaller89,
  type Hallazgo,
} from '../../../shared/taller/conformidad.js';
import {
  recargarTaller,
  useEstadoTaller,
  type RespuestaTaller,
} from './useEstadoTaller.js';

export type Fila = [etiqueta: string, valor: string];

export type Veredicto = 'cargando' | 'sin-datos' | 'conforme' | 'avisos' | 'errores';

export const ETIQUETA_VEREDICTO: Record<Veredicto, string> = {
  cargando: 'consultando…',
  'sin-datos': 'sin datos',
  conforme: 'conforme',
  avisos: 'con avisos',
  errores: 'con errores',
};

function veredictoDe(datos: RespuestaTaller | null, error: string | null, hallazgos: Hallazgo[]): Veredicto {
  if (!datos) return error ? 'sin-datos' : 'cargando';
  if (hallazgos.some((h) => h.severidad === 'error')) return 'errores';
  return hallazgos.length > 0 ? 'avisos' : 'conforme';
}

function filasVps(t: EstadoTaller89 | null, motivo: string | null): Fila[] {
  if (!t) return [['lectura', `no disponible${motivo ? `: ${motivo}` : ''}`]];
  return [
    ['disco libre', `${t.disco.libreGb} GB`],
    ['memoria', `${t.memoria.disponibleMiB} MiB disponibles · swap en uso ${t.memoria.swapUsadaMiB} MiB`],
    ['último sweep', t.sweep.edadHoras === null ? 'sin log' : `hace ${t.sweep.edadHoras} h`],
    ['timer cm-sweep', t.sweep.timerActivo ? 'activo' : 'inactivo'],
    ['cm-heavy', t.cmHeavy.ocupado ? 'ocupado' : 'libre'],
    ['escuchas', t.escuchas.map((x) => `${x.direccion}:${x.puerto}/${x.proto}`).join(' ') || 'ninguna'],
    ['sesiones tmux', t.tmux.join(', ') || 'ninguna'],
    ['cloudflared', `${t.cloudflared.viva ? 'vivo' : 'parado'} · token ${t.cloudflared.tokenModo ?? 'sin fichero'}`],
    ['BD de trabajo', t.bdTrabajo.existe ? `${t.bdTrabajo.edadHoras ?? '?'} h` : 'ausente'],
    ['daemon del manager', t.managerDaemonVivo ? 'vivo en la 89 (retirar, S3.6)' : 'no'],
  ];
}

function filasPublico(hosts: string[], publico: EstadoPublico | null): Fila[] {
  if (hosts.length === 0) return [['hostnames', 'ninguno declarado']];
  if (!publico) return [['lectura', 'no comprobada']];
  return hosts.map((h): Fila => {
    const r = publico.hosts.find((x) => x.host === h);
    if (!r) return [h, 'no comprobado'];
    const estado = r.status === null ? 'sin respuesta' : `HTTP ${r.status}`;
    const destino = r.location ? ` → ${r.location}` : '';
    const error = r.error ? ` (${r.error})` : '';
    return [h, `${estado}${destino}${error}`];
  });
}

function filasLaptop(l: RespuestaTaller['local'] | null): Fila[] {
  if (!l) return [['lectura', 'no disponible']];
  const out: Fila[] = [
    ['procesos', `${l.procesosTotal}`],
    ['escuchas', `${l.escuchas.length}`],
    ['mutagen', l.mutagen === null
      ? 'no encontrado en el PATH'
      : `daemon ${l.mutagen.daemonVivo ? 'vivo' : 'parado'}${l.mutagen.sesionesMalas.length ? ` · con problemas: ${l.mutagen.sesionesMalas.join(', ')}` : ''}`],
  ];
  if (l.sinLectura) out.push(['sin lectura', l.sinLectura]);
  return out;
}

export function usePanelTaller() {
  const { datos, cargando, error } = useEstadoTaller();
  const hallazgos: Hallazgo[] = datos?.hallazgos ?? [];
  const falla = (ambito: Hallazgo['ambito']): boolean =>
    hallazgos.some((h) => h.ambito === ambito && h.severidad === 'error');
  return {
    datos,
    cargando,
    error,
    hallazgos,
    fallos: { vps: falla('89'), publico: falla('publico'), laptop: falla('local') },
    veredicto: veredictoDe(datos, error, hallazgos),
    comprobaciones: IDS_CONFORMIDAD.length,
    filasVps: filasVps(datos?.taller89 ?? null, datos?.motivoSinLectura ?? null),
    filasPublico: filasPublico(datos?.registro.hostsPublicos ?? [], datos?.publico ?? null),
    filasLaptop: filasLaptop(datos?.local ?? null),
    recargar: recargarTaller,
  };
}
