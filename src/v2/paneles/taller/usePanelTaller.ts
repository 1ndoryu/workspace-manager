/* Lógica del PanelTaller (regla componente-sin-hook-glory: el componente solo pinta).
 * Deriva el veredicto y las filas de cada sección a partir del estado compartido. */
import {
  IDS_CONFORMIDAD,
  type EstadoPublico,
  type EstadoTaller89,
  type Hallazgo,
  type MuestraHistorial,
} from '../../../shared/taller/conformidad.js';
import {
  recargarTaller,
  useEstadoTaller,
  type RespuestaTaller,
} from './useEstadoTaller.js';

export type Fila = [etiqueta: string, valor: string];

/* Nivel de la última corrida de cm-sweep (D4 del plan de limpieza del disco de la 89). */
const NIVELES_SWEEP: Record<number, string> = { 0: 'mantenimiento', 1: 'aviso', 2: 'suelo' };

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

/* Qué hizo la última corrida del limpiador: nivel y GB liberados. Si la sonda no los trajo (sonda
 * antigua o estado ilegible) se dice «sin dato», no un cero que parecería «no liberó nada». */
function filaLimpieza(s: EstadoTaller89['sweep']): string {
  if (s.nivel === null || s.nivel === undefined) return 'sin dato';
  const gb = s.liberadoGb === null || s.liberadoGb === undefined ? '?' : s.liberadoGb;
  return `${NIVELES_SWEEP[s.nivel] ?? s.nivel} · ${gb} GB liberados`;
}

function filasVps(t: EstadoTaller89 | null, motivo: string | null): Fila[] {
  if (!t) return [['lectura', `no disponible${motivo ? `: ${motivo}` : ''}`]];
  return [
    ['disco libre', `${t.disco.libreGb} GB`],
    ['memoria', `${t.memoria.disponibleMiB} MiB disponibles · swap en uso ${t.memoria.swapUsadaMiB} MiB`],
    ['último sweep', t.sweep.edadHoras === null ? 'sin log' : `hace ${t.sweep.edadHoras} h`],
    ['timer cm-sweep', t.sweep.timerActivo ? 'activo' : 'inactivo'],
    ['última limpieza', filaLimpieza(t.sweep)],
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
    /* Sin sonda es que su dev está parado: hostsActivos no lo sondea (conformidadPublico.ts). */
    if (!r) return [h, 'no sondeado (dev parado)'];
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

/* [por que] Las muestras más recientes primero y solo una hora (12 de 5 min): el panel es una
 * vista de estado, no un gráfico; el resto queda en estado.jsonl de la 89. */
export const HISTORIAL_VISIBLE = 12;

function filasHistorial(muestras: MuestraHistorial[], motivo: string | null): Fila[] {
  if (muestras.length === 0) return [['historial', motivo ?? 'sin datos']];
  return muestras.slice(-HISTORIAL_VISIBLE).reverse().map((m): Fila => [
    new Date(m.tomadaEn).toLocaleTimeString(),
    `disco ${m.libreGb} GB · RAM ${m.disponibleMiB} MiB · swap ${m.swapUsadaMiB} MiB · cm-heavy ${m.cmHeavyOcupado ? 'ocupado' : 'libre'} · cloudflared ${m.cloudflaredViva ? 'vivo' : 'parado'}${m.managerDaemonVivo ? ' · daemon vivo' : ''}`,
  ]);
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
    filasHistorial: filasHistorial(datos?.historial ?? [], datos?.motivoHistorial ?? null),
    recargar: recargarTaller,
  };
}
