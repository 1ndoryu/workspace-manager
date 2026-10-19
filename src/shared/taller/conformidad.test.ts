/* Tests de conformidad del taller (S3.3). Fixtures malos y buenos: cada regla debe
 * disparar con su entrada y callar con la conforme. Sin red ni SSH. */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluarConformidad,
  IDS_CONFORMIDAD,
  type EntradaConformidad,
  type EstadoTaller89,
} from './conformidad.js';
import { hostsActivos } from './conformidadPublico.js';

const T89_CONFORME: EstadoTaller89 = {
  version: 1,
  tomadaEn: '2026-10-14T10:00:00Z',
  disco: { libreGb: 80 },
  sweep: { edadHoras: 0.5, timerActivo: true },
  memoria: { disponibleMiB: 8000, swapUsadaMiB: 0 },
  escuchas: [
    { direccion: '127.0.0.1', puerto: 3110, proto: 'tcp' },
    { direccion: '0.0.0.0', puerto: 22, proto: 'tcp' },
    { direccion: '0.0.0.0', puerto: 51820, proto: 'udp' },
  ],
  tmux: ['dev-mn'],
  cmHeavy: { ocupado: false },
  buildsFueraDeCmHeavy: [],
  secretos: [{ ruta: '~/.config/cloudflared/mn-dev.env', modo: '600' }],
  cloudflared: { version: '2026.1.0', tokenModo: '600', viva: true },
  bdTrabajo: { existe: true, edadHoras: 2 },
  managerDaemonVivo: false,
};

const CONFORME: EntradaConformidad = {
  t89: T89_CONFORME,
  nombreMando: 'workspace-manager',
  publico: {
    hosts: [{
      host: 'mn-dev.wandori.us',
      status: 302,
      location: 'https://wandori.cloudflareaccess.com/cdn-cgi/access/login/mn-dev.wandori.us',
      error: null,
    }],
  },
  local: {
    procesos: [],
    escuchas: [{ direccion: '127.0.0.1', puerto: 5432, proceso: 'postgres' }],
    mutagen: { daemonVivo: true, sesionesMalas: [] },
  },
  registro: {
    sesionesDev: ['dev-mn'],
    hostsPublicos: ['mn-dev.wandori.us'],
    sesionesDevPorHost: { 'mn-dev.wandori.us': ['dev-mn'] },
    puertosLocalesPublicos: [5199],
    sitiosRust: [{ id: 'rust-x', buildMode: 'builder' }],
    ajenos: ['app-ajena'],
  },
};

/* Copia la entrada conforme y aplica un cambio parcial a la 89. */
function con(cambios: Partial<EstadoTaller89>, resto: Partial<EntradaConformidad> = {}): EntradaConformidad {
  return { ...CONFORME, ...resto, t89: { ...T89_CONFORME, ...cambios } };
}

const ids = (e: EntradaConformidad): string[] => evaluarConformidad(e).map((h) => h.id);

describe('conformidad del taller: entrada conforme', () => {
  it('no emite hallazgos', () => {
    assert.deepEqual(evaluarConformidad(CONFORME), []);
  });
});

describe('conformidad del taller: sonda de la 89', () => {
  it('A0: sin lectura de la 89 no se afirma estado sano', () => {
    const r = evaluarConformidad({ ...CONFORME, t89: null, motivoSinLectura: 'ssh timeout' });
    assert.equal(r.length, 1);
    assert.equal(r[0].id, 'A0');
    assert.equal(r[0].severidad, 'error');
    assert.match(r[0].detalle, /ssh timeout/);
  });

  it('A1: servicio escuchando fuera de loopback', () => {
    const r = evaluarConformidad(con({ escuchas: [{ direccion: '0.0.0.0', puerto: 3110, proto: 'tcp' }] }));
    assert.ok(r.some((h) => h.id === 'A1' && h.severidad === 'error' && /3110/.test(h.detalle)));
  });

  it('A1: SSH y WireGuard fuera de loopback no cuentan', () => {
    assert.ok(!ids(con({ escuchas: [
      { direccion: '0.0.0.0', puerto: 22, proto: 'tcp' },
      { direccion: '0.0.0.0', puerto: 51820, proto: 'udp' },
    ] })).includes('A1'));
  });

  it('A1: los sockets UDP salientes de cloudflared no cuentan', () => {
    assert.ok(!ids(con({ escuchas: [
      { direccion: '0.0.0.0', puerto: 48849, proto: 'udp', proceso: 'cloudflared' },
    ] })).includes('A1'));
  });

  it('A1: un UDP fuera de loopback de otro proceso sí cuenta (testigo del anterior)', () => {
    assert.ok(ids(con({ escuchas: [
      { direccion: '0.0.0.0', puerto: 5353, proto: 'udp', proceso: 'avahi-daemon' },
    ] })).includes('A1'));
  });

  it('A1: un UDP de cloudflared en TCP no se exime por el nombre', () => {
    assert.ok(ids(con({ escuchas: [
      { direccion: '0.0.0.0', puerto: 20241, proto: 'tcp', proceso: 'cloudflared' },
    ] })).includes('A1'));
  });

  it('A2: disco por debajo del mínimo de cm-heavy', () => {
    assert.ok(ids(con({ disco: { libreGb: 10 } })).includes('A2'));
  });

  it('A3: memoria disponible baja o swap en uso', () => {
    assert.ok(ids(con({ memoria: { disponibleMiB: 1000, swapUsadaMiB: 0 } })).includes('A3'));
    assert.ok(ids(con({ memoria: { disponibleMiB: 8000, swapUsadaMiB: 2048 } })).includes('A3'));
  });

  it('A4: sweep sin log o timer inactivo', () => {
    assert.ok(ids(con({ sweep: { edadHoras: null, timerActivo: true } })).includes('A4'));
    assert.ok(ids(con({ sweep: { edadHoras: 0.5, timerActivo: false } })).includes('A4'));
    assert.ok(ids(con({ sweep: { edadHoras: 5, timerActivo: true } })).includes('A4'));
  });

  it('A5: secreto con modo distinto de 0600', () => {
    const r = evaluarConformidad(con({ secretos: [{ ruta: '~/.config/cloudflared/mn-dev.env', modo: '644' }] }));
    assert.ok(r.some((h) => h.id === 'A5' && h.severidad === 'error'));
  });

  it('A6: sesión dev-* sin registro', () => {
    assert.ok(ids(con({ tmux: ['dev-mn', 'dev-otra'] })).includes('A6'));
    assert.ok(!ids(con({ tmux: ['dev-mn', 'otra-sesion'] })).includes('A6'));
  });

  it('A7: build Rust fuera de cm-heavy', () => {
    assert.ok(ids(con({ buildsFueraDeCmHeavy: [{ pid: 4242, cmd: 'cargo build' }] })).includes('A7'));
  });

  it('A9: BD de trabajo ausente o vieja', () => {
    assert.ok(ids(con({ bdTrabajo: { existe: false, edadHoras: null } })).includes('A9'));
    assert.ok(ids(con({ bdTrabajo: { existe: true, edadHoras: 48 } })).includes('A9'));
  });

  it('A11: daemon del manager de la 89 vivo', () => {
    assert.ok(ids(con({ managerDaemonVivo: true })).includes('A11'));
  });

  it('P3: puerto de dev público escuchando fuera de loopback', () => {
    const r = evaluarConformidad(con({ escuchas: [{ direccion: '0.0.0.0', puerto: 5199, proto: 'tcp' }] }));
    assert.ok(r.some((h) => h.id === 'P3' && h.severidad === 'error' && /5199/.test(h.detalle)));
  });
});

describe('conformidad del taller: público (P0, P1, P2)', () => {
  it('P0: hostnames sin comprobar', () => {
    assert.ok(ids({ ...CONFORME, publico: null }).includes('P0'));
  });

  it('P1: hostname que sirve la app sin Access', () => {
    const r = evaluarConformidad({
      ...CONFORME,
      publico: { hosts: [{ host: 'mn-dev.wandori.us', status: 200, location: null, error: null }] },
    });
    assert.ok(r.some((h) => h.id === 'P1' && h.severidad === 'error'));
  });

  it('P1: hostname sin redirección a Access', () => {
    const r = evaluarConformidad({
      ...CONFORME,
      publico: { hosts: [{ host: 'mn-dev.wandori.us', status: null, location: null, error: 'timeout' }] },
    });
    assert.ok(r.some((h) => h.id === 'P1' && /timeout/.test(h.detalle)));
  });

  it('P1: hostname no incluido en la comprobación', () => {
    const r = evaluarConformidad({ ...CONFORME, publico: { hosts: [] } });
    assert.ok(r.some((h) => h.id === 'P1' && /no comprobado/.test(h.detalle)));
  });

  it('P2: conector caído o token mal protegido', () => {
    assert.ok(ids(con({ cloudflared: { version: null, tokenModo: '600', viva: false } })).includes('P2'));
    assert.ok(ids(con({ cloudflared: { version: '1', tokenModo: '644', viva: true } })).includes('P2'));
    assert.ok(ids(con({ cloudflared: { version: '1', tokenModo: null, viva: true } })).includes('P2'));
  });

  it('P1/P2: un dev público parado no se exige ni se sondea', () => {
    const parado: EntradaConformidad = {
      ...con({ tmux: [], cloudflared: { version: null, tokenModo: null, viva: false } }),
      publico: null,
    };
    assert.deepEqual(ids(parado).filter((i) => i.startsWith('P')), []);
    assert.deepEqual(hostsActivos(parado.registro, parado.t89), []);
  });

  it('P1/P2: un host sin sesiones conocidas sigue exigiéndose', () => {
    const sinSesion = { ...CONFORME.registro, sesionesDevPorHost: {} };
    assert.deepEqual(hostsActivos(sinSesion, T89_CONFORME), ['mn-dev.wandori.us']);
  });

  it('P2: sin hostnames públicos no se exige conector', () => {
    const sin: EntradaConformidad = {
      ...con({ cloudflared: { version: null, tokenModo: null, viva: false } }),
      registro: { ...CONFORME.registro, hostsPublicos: [] },
      publico: null,
    };
    assert.ok(!ids(sin).includes('P2'));
    assert.ok(!ids(sin).includes('P0'));
  });
});

describe('conformidad del taller: local (L1, L2, L3, A10)', () => {
  it('A10: sitio Rust sin buildMode builder', () => {
    const r = evaluarConformidad({
      ...CONFORME,
      registro: { ...CONFORME.registro, sitiosRust: [{ id: 'rust-x', buildMode: 'local' }] },
    });
    assert.ok(r.some((h) => h.id === 'A10'));
  });

  it('L1: cargo run o rustc en el laptop', () => {
    const r = evaluarConformidad({
      ...CONFORME,
      local: { ...CONFORME.local, procesos: [{ pid: 7, nombre: 'cargo.exe', cmd: 'cargo run --bin mn' }] },
    });
    assert.ok(r.some((h) => h.id === 'L1' && /pid 7/.test(h.detalle)));
  });

  it('L1: vite de proyecto, pero no el del manager ni el de una app ajena', () => {
    const malo = evaluarConformidad({
      ...CONFORME,
      local: { ...CONFORME.local, procesos: [{ pid: 8, nombre: 'node.exe', cmd: 'node node_modules/vite/bin/vite.js' }] },
    });
    assert.ok(malo.some((h) => h.id === 'L1'));
    const propio = evaluarConformidad({
      ...CONFORME,
      local: { ...CONFORME.local, procesos: [
        { pid: 9, nombre: 'node.exe', cmd: 'node C:\\app-ajena\\node_modules\\vite\\bin\\vite.js' },
        { pid: 10, nombre: 'node.exe', cmd: 'node workspace-manager\\node_modules\\vite\\bin\\vite.js' },
      ] },
    });
    assert.ok(!propio.some((h) => h.id === 'L1'));
  });

  it('L1: reconoce el vite del tablero aunque su carpeta se llame de otra forma', () => {
    /* El nombre no está incrustado: lo dice la entrada. Un clon con otro nombre
     * de carpeta (o la réplica de la 89) se tomaba por un vite ajeno. */
    const clon = evaluarConformidad({
      ...CONFORME,
      nombreMando: 'mi-tablero',
      local: { ...CONFORME.local, procesos: [
        { pid: 11, nombre: 'node.exe', cmd: 'node C:\\area\\mi-tablero\\node_modules\\vite\\bin\\vite.js' },
      ] },
    });
    assert.ok(!clon.some((h) => h.id === 'L1'));
  });

  it('L1: una herramienta que MENCIONA vite no es un vite de proyecto', () => {
    /* Regresión del falso positivo: L1 miraba el texto de la línea de comandos
     * de cualquier proceso, así que `grep -rn vite` o un `bash -c "...vite..."`
     * salían como «vite de proyecto». Solo un runtime ejecuta un proyecto. */
    const r = evaluarConformidad({
      ...CONFORME,
      local: { ...CONFORME.local, procesos: [
        { pid: 11, nombre: 'grep.exe', cmd: 'grep.exe -rn "vite" src/' },
        { pid: 12, nombre: 'bash.exe', cmd: 'bash.exe -c "echo vite | cargo run"' },
        { pid: 13, nombre: 'powershell.exe', cmd: 'powershell.exe -Command "Get-Process vite"' },
      ] },
    });
    assert.ok(!r.some((h) => h.id === 'L1'), 'un shell que menciona la palabra no ejecuta el proyecto');
  });

  it('L2: Postgres escuchando fuera de loopback', () => {
    const r = evaluarConformidad({
      ...CONFORME,
      local: { ...CONFORME.local, escuchas: [{ direccion: '0.0.0.0', puerto: 5432, proceso: 'postgres' }] },
    });
    assert.ok(r.some((h) => h.id === 'L2' && h.severidad === 'error'));
  });

  it('L3: daemon de Mutagen parado y sesiones con problemas (A8)', () => {
    assert.ok(evaluarConformidad({
      ...CONFORME,
      local: { ...CONFORME.local, mutagen: { daemonVivo: false, sesionesMalas: [] } },
    }).some((h) => h.id === 'L3'));
    assert.ok(ids({
      ...CONFORME,
      local: { ...CONFORME.local, mutagen: { daemonVivo: true, sesionesMalas: ['mn-sync'] } },
    }).includes('A8'));
  });

  it('L0: sin lectura del laptop se dice, no se calla', () => {
    const r = evaluarConformidad({ ...CONFORME, local: { ...CONFORME.local, sinLectura: 'powershell timeout' } });
    const l0 = r.find((h) => h.id === 'L0');
    assert.ok(l0);
    assert.match(l0.detalle, /powershell timeout/);
  });

  it('L3: sin mutagen en el PATH avisa, no da el daemon por vivo ni por parado', () => {
    const r = evaluarConformidad({ ...CONFORME, local: { ...CONFORME.local, mutagen: null } });
    const l3 = r.find((h) => h.id === 'L3');
    assert.ok(l3);
    assert.match(l3.detalle, /no encontrado/);
    assert.ok(!r.some((h) => h.id === 'A8'));
  });
});

describe('conformidad del taller: catálogo de identificadores', () => {
  it('lista todas las comprobaciones sin duplicados', () => {
    assert.equal(new Set(IDS_CONFORMIDAD).size, IDS_CONFORMIDAD.length);
    for (const id of ['A0', 'A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A7', 'A8', 'A9', 'A10', 'A11',
      'P0', 'P1', 'P2', 'P3', 'L0', 'L1', 'L2', 'L3']) {
      assert.ok(IDS_CONFORMIDAD.includes(id), `falta ${id}`);
    }
  });
});
