/* Conformidad del taller remoto (VPS 89) y del entorno local (S3, plan sucesor 2026-10-14).
 * [por que] Funciones puras: el servidor reúne el estado (sonda `taller-estado` por SSH,
 * HTTP público, procesos y escuchas locales, registro) y aquí se decide qué es un problema.
 * Así cada comprobación se prueba con fixtures, sin tocar la 89 ni el laptop. Solo tipos
 * y lógica; sin E/S, para poder importarlo desde cliente y servidor.
 * Cada regla devuelve null si pasa o el detalle si falla. Sin lectura válida de la 89 no se
 * afirma «sano»: se emite A0. */

export type AmbitoConformidad = '89' | 'publico' | 'local';
export type SeveridadConformidad = 'error' | 'advertencia';

export interface Hallazgo {
  id: string;
  ambito: AmbitoConformidad;
  severidad: SeveridadConformidad;
  detalle: string;
  remedio: string;
}

/* Salida JSON de la sonda `scripts/remoto/taller-estado` (lectura, sin escritura). */
export interface EstadoTaller89 {
  version: number;
  tomadaEn: string;
  disco: { libreGb: number };
  sweep: { edadHoras: number | null; timerActivo: boolean };
  memoria: { disponibleMiB: number; swapUsadaMiB: number };
  /* `proceso` llega vacío cuando el socket es de otro usuario (la sonda no corre como root). */
  escuchas: { direccion: string; puerto: number; proto: 'tcp' | 'udp'; proceso?: string }[];
  tmux: string[];
  cmHeavy: { ocupado: boolean };
  buildsFueraDeCmHeavy: { pid: number; cmd: string }[];
  secretos: { ruta: string; modo: string }[];
  cloudflared: { version: string | null; tokenModo: string | null; viva: boolean };
  bdTrabajo: { existe: boolean; edadHoras: number | null };
  managerDaemonVivo: boolean;
}

/* Foto resumida de una línea de `~/taller/_datos/estado.jsonl` (S3.4). Solo los campos que el
 * panel pinta; el resto de la sonda queda fuera para que la respuesta no crezca sin medida. */
export interface MuestraHistorial {
  tomadaEn: string;
  libreGb: number;
  disponibleMiB: number;
  swapUsadaMiB: number;
  cmHeavyOcupado: boolean;
  cloudflaredViva: boolean;
  managerDaemonVivo: boolean;
}

/* Resultado de pedir cada hostname público sin credenciales (P1). `location` es la
 * cabecera Location de la respuesta, si la hay. */
export interface EstadoPublico {
  hosts: { host: string; status: number | null; location: string | null; error: string | null }[];
}

/* Procesos y escuchas del laptop (lectura de Win32_Process y Get-NetTCPConnection) y
 * estado de Mutagen. `mutagen` es null si no aparece el binario ni en el PATH ni en las
 * rutas conocidas: entonces no se afirma nada del sync (L3 lo avisa en vez de dar el
 * daemon por vivo). */
export interface EstadoLocal {
  procesos: { pid: number; nombre: string; cmd: string }[];
  escuchas: { direccion: string; puerto: number; proceso: string }[];
  mutagen: { daemonVivo: boolean; sesionesMalas: string[] } | null;
  /* Motivo si no se pudieron leer procesos y escuchas. Sin él, L1 y L2 callarían por falta
   * de datos y parecería que no hay avisos. Sin ese motivo, la ausencia de avisos sería falsa. */
  sinLectura?: string;
}

/* Lo que el registro declara y debe cumplirse. */
export interface RegistroConformidad {
  sesionesDev: string[];
  hostsPublicos: string[];
  puertosLocalesPublicos: number[];
  sitiosRust: { id: string; buildMode: string | null }[];
}

export interface EntradaConformidad {
  t89: EstadoTaller89 | null;
  motivoSinLectura?: string;
  publico: EstadoPublico | null;
  local: EstadoLocal;
  registro: RegistroConformidad;
  /* Alias SSH del taller, para que el remedio diga a qué máquina conectarse. Null si
   * no hay taller configurado: el texto entonces no nombra ninguna. */
  hostTaller?: string | null;
}

/* Umbrales. Disco: el mismo de cm-heavy (CM_HEAVY_MIN_DISK_GB). */
const MIN_DISCO_GB = 15;
const MIN_MEMORIA_MIB = 2048;
const MAX_SWAP_MIB = 1024;
const MAX_HORAS_SWEEP = 2;
const MAX_HORAS_BD = 24;

const LOOPBACK = (d: string): boolean => d === '127.0.0.1' || d === '::1' || d.startsWith('127.');
const PATRON_OPENCODE_PROPIO = /opencode-propio/i;
const PATRON_MANAGER = /workspace-manager/i;
/* cloudflared ata sockets UDP a `*` para su transporte QUIC hacia el borde de Cloudflare: son
 * salientes, nadie se conecta a ellos y no se pueden cerrar sin tumbar el túnel. Contarlos como
 * escucha dejaba A1 en error permanente y sin arreglo posible por parte de quien opera. */
const PATRON_TUNEL_SALIENTE = /cloudflared/i;

/* Lista de reglas sobre la sonda de la 89 (solo cuando hay lectura válida). */
interface Regla89 {
  id: string;
  severidad: SeveridadConformidad;
  remedio: string;
  falla: (t: EstadoTaller89, e: EntradaConformidad) => string | null;
}

const REGLAS_89: Regla89[] = [
  {
    id: 'A1', severidad: 'error',
    remedio: 'Servicios en 127.0.0.1; expuesto solo por red privada o túnel (AGENTS §9.4).',
    falla: (t) => {
      const malas = t.escuchas.filter((x) => !LOOPBACK(x.direccion)
        && !(x.proto === 'tcp' && x.puerto === 22)
        && !(x.proto === 'udp' && x.puerto === 51820)
        && !(x.proto === 'udp' && PATRON_TUNEL_SALIENTE.test(x.proceso ?? '')));
      return malas.length ? `escucha fuera de loopback: ${malas.map((x) => `${x.direccion}:${x.puerto}/${x.proto}`).join(', ')}` : null;
    },
  },
  {
    id: 'A2', severidad: 'error',
    remedio: 'Liberar disco con cm-sweep o revisar copias de target (umbral de cm-heavy).',
    falla: (t) => (t.disco.libreGb < MIN_DISCO_GB ? `disco libre ${t.disco.libreGb} GB (mínimo ${MIN_DISCO_GB})` : null),
  },
  {
    id: 'A3', severidad: 'advertencia',
    remedio: 'Revisar procesos que consumen memoria en la 89; reducir builds concurrentes.',
    falla: (t) => {
      const av: string[] = [];
      if (t.memoria.disponibleMiB < MIN_MEMORIA_MIB) av.push(`MemAvailable ${t.memoria.disponibleMiB} MiB (mínimo ${MIN_MEMORIA_MIB})`);
      if (t.memoria.swapUsadaMiB > MAX_SWAP_MIB) av.push(`swap en uso ${t.memoria.swapUsadaMiB} MiB`);
      return av.length ? av.join('; ') : null;
    },
  },
  {
    id: 'A4', severidad: 'advertencia',
    remedio: 'Revisar el timer cm-sweep (`systemctl list-timers`) y /var/log/cm-sweep.log.',
    falla: (t) => {
      const av: string[] = [];
      if (t.sweep.edadHoras === null) av.push('sin sweep.log');
      else if (t.sweep.edadHoras > MAX_HORAS_SWEEP) av.push(`último sweep hace ${t.sweep.edadHoras} h`);
      if (!t.sweep.timerActivo) av.push('timer cm-sweep inactivo');
      return av.length ? av.join('; ') : null;
    },
  },
  {
    id: 'A5', severidad: 'error',
    remedio: 'Secretos en modo 0600 (chmod 600) y fuera de logs y commits.',
    falla: (t) => {
      const malos = t.secretos.filter((s) => s.modo !== '600');
      return malos.length ? malos.map((s) => `${s.ruta} modo ${s.modo}`).join(', ') : null;
    },
  },
  {
    id: 'A6', severidad: 'advertencia',
    remedio: 'Sesión dev-* sin entrada en el registro: detenerla con Arranque o declararla.',
    falla: (t, e) => {
      const huerfanas = t.tmux.filter((s) => s.startsWith('dev-') && !e.registro.sesionesDev.includes(s));
      return huerfanas.length ? `sesión tmux sin registro: ${huerfanas.join(', ')}` : null;
    },
  },
  {
    id: 'A7', severidad: 'advertencia',
    remedio: 'Los builds Rust pasan por cm-heavy (flock: un build a la vez).',
    falla: (t) => (t.buildsFueraDeCmHeavy.length
      ? `${t.buildsFueraDeCmHeavy.length} build(s) fuera de cm-heavy: ${t.buildsFueraDeCmHeavy.map((b) => `pid ${b.pid}`).join(', ')}`
      : null),
  },
  {
    id: 'A8', severidad: 'advertencia',
    remedio: 'Sesión Mutagen parada o con conflictos: `mutagen sync list` y resolver antes de trabajar.',
    falla: (_t, e) => (e.local.mutagen?.sesionesMalas.length ? `sesiones Mutagen con problemas: ${e.local.mutagen.sesionesMalas.join(', ')}` : null),
  },
  {
    id: 'A9', severidad: 'advertencia',
    remedio: 'Refrescar la copia de la BD de trabajo con Arranque up (--bd).',
    falla: (t) => {
      if (!t.bdTrabajo.existe) return 'BD de trabajo ausente';
      if (t.bdTrabajo.edadHoras !== null && t.bdTrabajo.edadHoras > MAX_HORAS_BD) return `BD de trabajo con ${t.bdTrabajo.edadHoras} h`;
      return null;
    },
  },
  {
    id: 'A11', severidad: 'advertencia',
    remedio: 'Retirar el daemon del manager de la 89 (plan sucesor S3.6).',
    falla: (t) => (t.managerDaemonVivo ? 'daemon del manager de la 89 sigue vivo' : null),
  },
];

/* Reglas que no dependen de la sonda: solo registro y estado local. */
interface ReglaLocal {
  id: string;
  ambito: AmbitoConformidad;
  severidad: SeveridadConformidad;
  remedio: string;
  falla: (e: EntradaConformidad) => string | null;
}

const REGLAS_LOCAL: ReglaLocal[] = [
  {
    id: 'L0', ambito: 'local', severidad: 'advertencia',
    remedio: 'Comprobar PowerShell (Get-CimInstance, Get-NetTCPConnection); sin lectura no se afirman L1 ni L2.',
    falla: (e) => (e.local.sinLectura ? `sin lectura de procesos y escuchas del laptop: ${e.local.sinLectura}` : null),
  },
  {
    id: 'A10', ambito: '89', severidad: 'advertencia',
    remedio: 'Sitios Rust con buildMode builder (AGENTS §9.4: los builds Rust van a la 89).',
    falla: (e) => {
      const malos = e.registro.sitiosRust.filter((s) => s.buildMode !== 'builder');
      return malos.length ? malos.map((s) => `${s.id} buildMode ${s.buildMode ?? 'sin definir'}`).join(', ') : null;
    },
  },
  {
    id: 'L1', ambito: 'local', severidad: 'advertencia',
    remedio: 'Parar el proceso con PID y línea de comando (AGENTS §5). Los de opencode-propio no se tocan.',
    falla: (e) => {
      const malos: string[] = [];
      for (const p of e.local.procesos) {
        if (PATRON_OPENCODE_PROPIO.test(p.cmd)) continue;
        if (/\bcargo(\.exe)?\s+run\b|\brustc(\.exe)?\b/.test(p.cmd)) malos.push(`pid ${p.pid} build/run Rust`);
        else if (/\bvite\b/.test(p.cmd) && !PATRON_MANAGER.test(p.cmd)) malos.push(`pid ${p.pid} vite de proyecto`);
      }
      const dup = e.local.procesos.filter((p) => /opencode-delegate/i.test(p.cmd) && !PATRON_OPENCODE_PROPIO.test(p.cmd));
      if (dup.length > 1) malos.push(`${dup.length} procesos opencode-delegate (pids ${dup.map((p) => p.pid).join(', ')})`);
      return malos.length ? malos.join('; ') : null;
    },
  },
  {
    id: 'L2', ambito: 'local', severidad: 'error',
    /* `listen_addresses` es parámetro de postmaster: un reload no lo aplica, hace falta reiniciar
     * el servicio (y eso pide administrador). El remedio lo dice para no mandar a un callejón. */
    remedio: 'Postgres local solo en 127.0.0.1: `listen_addresses` en postgresql.conf y reiniciar el servicio (no basta con recargar).',
    falla: (e) => {
      const malas = e.local.escuchas.filter((x) => /postgres/i.test(x.proceso) && !LOOPBACK(x.direccion));
      return malas.length ? malas.map((x) => `Postgres en ${x.direccion}:${x.puerto}`).join(', ') : null;
    },
  },
  {
    id: 'L3', ambito: 'local', severidad: 'advertencia',
    remedio: 'Mutagen instalado (PATH o C:\\Users\\Owner\\bin\\mutagen) con el daemon arrancado (`mutagen daemon start`) y las sesiones taller-* en marcha.',
    falla: (e) => {
      if (e.local.mutagen === null) return 'mutagen no encontrado (ni en el PATH ni en C:\\Users\\Owner\\bin\\mutagen): el sync L→89 no se comprueba';
      return e.local.mutagen.daemonVivo ? null : 'daemon de Mutagen parado';
    },
  },
];

/* Reglas públicas que dependen de la sonda P1 (HTTP sin credenciales). */
function fallaPublico(e: EntradaConformidad): Hallazgo[] {
  const out: Hallazgo[] = [];
  if (e.registro.hostsPublicos.length === 0) return out;
  if (!e.publico) {
    out.push({ id: 'P0', ambito: 'publico', severidad: 'advertencia', detalle: 'hostnames públicos no comprobados', remedio: 'Reintentar la comprobación (forzar).' });
    return out;
  }
  const malos: string[] = [];
  for (const host of e.registro.hostsPublicos) {
    const r = e.publico.hosts.find((h) => h.host === host);
    if (!r) { malos.push(`${host} no comprobado`); continue; }
    if (r.status === 200) malos.push(`${host} sirve la app sin Access (200)`);
    else if (!r.location || !/cloudflareaccess\.com/.test(r.location)) {
      malos.push(`${host} no redirige a Access (status ${r.status ?? 'sin respuesta'}${r.error ? `, ${r.error}` : ''})`);
    }
  }
  if (malos.length) out.push({
    id: 'P1', ambito: 'publico', severidad: 'error', detalle: malos.join('; '),
    remedio: 'Crear la app de Access para el hostname antes de publicarlo (plan sucesor S6.1); no hay servicio sin Access.',
  });
  return out;
}

/* P2: el conector de Cloudflare vive en la 89 y su token va con modo 0600. Solo se exige
 * si hay hostnames públicos declarados; sin ellos no hay túnel que vigilar. */
function fallaConector(e: EntradaConformidad, t: EstadoTaller89): Hallazgo | null {
  if (e.registro.hostsPublicos.length === 0) return null;
  const av: string[] = [];
  if (!t.cloudflared.viva) av.push('cloudflared no está vivo');
  if (t.cloudflared.tokenModo === null) av.push('sin fichero de token');
  else if (t.cloudflared.tokenModo !== '600') av.push(`token con modo ${t.cloudflared.tokenModo}`);
  if (!av.length) return null;
  return {
    id: 'P2', ambito: 'publico', severidad: 'error', detalle: av.join('; '),
    remedio: 'Token de cloudflared en ~/.config/cloudflared/*.env con modo 0600; conector vivo con Arranque up.',
  };
}

/* Evalúa todas las reglas y devuelve los hallazgos. Lista vacía = conforme. */
export function evaluarConformidad(e: EntradaConformidad): Hallazgo[] {
  const out: Hallazgo[] = [];

  if (!e.t89) {
    out.push({
      id: 'A0', ambito: '89', severidad: 'error',
      detalle: `sin lectura válida de la 89${e.motivoSinLectura ? `: ${e.motivoSinLectura}` : ''}`,
      remedio: e.hostTaller
        ? `Comprobar \`ssh ${e.hostTaller}\` (BatchMode) y la red. No se afirma estado sano sin lectura.`
        : 'No hay taller configurado: declarar `host` en la config privada. No se afirma estado sano sin lectura.',
    });
  } else {
    for (const r of REGLAS_89) {
      const detalle = r.falla(e.t89, e);
      if (detalle) out.push({ id: r.id, ambito: '89', severidad: r.severidad, detalle, remedio: r.remedio });
    }
    /* [por que] P3: los puertos de dev declarados escuchan solo en loopback. Se apoya en A1
     * pero lo nombra por puerto de servicio, para que el fallo diga qué servicio se expone. */
    const expuestos = e.registro.puertosLocalesPublicos.flatMap((p) => e.t89!.escuchas
      .filter((x) => x.puerto === p && x.proto === 'tcp' && !LOOPBACK(x.direccion))
      .map((x) => `${x.direccion}:${x.puerto}`));
    if (expuestos.length) out.push({
      id: 'P3', ambito: 'publico', severidad: 'error',
      detalle: `servicio de dev escucha fuera de loopback: ${expuestos.join(', ')}`,
      remedio: 'Vite y backend solo en 127.0.0.1; el acceso público va por el túnel (S6).',
    });
    const conector = fallaConector(e, e.t89);
    if (conector) out.push(conector);
  }

  out.push(...fallaPublico(e));

  for (const r of REGLAS_LOCAL) {
    const detalle = r.falla(e);
    if (detalle) out.push({ id: r.id, ambito: r.ambito, severidad: r.severidad, detalle, remedio: r.remedio });
  }

  return out;
}

/* Identificadores de todas las comprobaciones, en orden. Lo usa el panel para mostrar
 * cuántas se evalúan y los tests para verificar que ninguna queda sin cubrir. */
export const IDS_CONFORMIDAD: string[] = [
  'A0', ...REGLAS_89.map((r) => r.id), 'P0', 'P1', 'P2', 'P3', ...REGLAS_LOCAL.map((r) => r.id),
].sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
