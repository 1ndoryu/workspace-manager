/* Pruebas de las comprobaciones de salud (10AA-2 F8). Cada id tiene un caso positivo
 * (dispara) y uno negativo (no dispara), con datos construidos a mano. */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import type { Listas } from '../guardian/configuracion/politica.js';
import { COMPROBACIONES_AREA, esVersionAnterior } from './comprobacionesArea.js';
import { COMPROBACIONES_PROYECTO } from './comprobacionesProyecto.js';
import { ejecutar, limpiarCacheSalud, obtenerSalud } from './runner.js';
import type { Comprobacion, DatosArea, DatosProyecto } from './tipos.js';

const DIA_MS = 86_400_000;
const AHORA = Date.UTC(2026, 9, 11);
const LISTAS_VACIAS = {} as Listas;

function proyecto(extra: Partial<DatosProyecto> = {}): DatosProyecto {
  return {
    clave: 'proyecto',
    ahora: AHORA,
    esElegible: true,
    esRuntimeSentinel: false,
    esRust: true,
    compilacionEnArbol: [],
    targetDir: 'C:/tmp/proyecto-target/proyecto',
    targetDirCompartidoCon: [],
    incrementalDesactivadoEn: [],
    tieneProfileDev: true,
    sentinelLock: '0.7.23',
    sentinelPin: '0.7.23',
    guard: { estado: 'ok', modo: 'enforce', listas: LISTAS_VACIAS, faltanPlantilla: [] },
    ramas: [],
    instruccionesProhibidas: [],
    planesActivos: [],
    enlacesRotos: [],
    toolchainFrontend: null,
    ...extra,
  };
}

function area(extra: Partial<DatosArea> = {}): DatosArea {
  return {
    ahora: AHORA,
    carpetasGit: [],
    registradas: [],
    plataforma: 'win32',
    discoLibreGb: 100,
    rutaTemporales: 'C:/tmp',
    tmp: null,
    incrementalUsuario: null,
    sentinelPin: null,
    sentinelRuntime: null,
    agentsBytes: null,
    titulosAgents: [],
    titulosClaudeMd: [],
    subcomandosArranque: ['doctor', 'gate'],
    skillArranque: 'Arranque doctor\nArranque gate',
    copiasSkill: [],
    ...extra,
  };
}

/* Ejecuta una comprobación y devuelve sus ids de hallazgo y severidades. */
function resultado<D>(c: Comprobacion<D>, datos: D) {
  const omitida = c.omitirSi?.(datos) ?? null;
  if (omitida !== null) return { omitida, hallazgos: [] as { id: string; severidad: string }[] };
  return {
    omitida: null,
    hallazgos: c.evaluar(datos).map((h) => ({ id: h.id, severidad: h.severidad })),
  };
}

function buscar<D>(lista: Comprobacion<D>[], id: string): Comprobacion<D> {
  const c = lista.find((x) => x.id === id);
  assert.ok(c, `falta la comprobación ${id}`);
  return c;
}

describe('esVersionAnterior', () => {
  it('compara versiones numéricas por partes', () => {
    assert.equal(esVersionAnterior('0.7.13', '0.7.23'), true);
    assert.equal(esVersionAnterior('0.8.0', '0.7.23'), false);
    assert.equal(esVersionAnterior('0.7.23', '0.7.23'), false);
    assert.equal(esVersionAnterior('1.0', '1.0.0'), false);
  });

  it('cae a comparación de cadena si una parte no es numérica', () => {
    assert.equal(esVersionAnterior('abc', 'abd'), true);
  });
});

describe('comprobaciones por proyecto', () => {
  it('target-en-arbol: error si hay compilación dentro del árbol', () => {
    const c = buscar(COMPROBACIONES_PROYECTO, 'target-en-arbol');
    assert.deepEqual(resultado(c, proyecto({ compilacionEnArbol: ['target'] })).hallazgos, [
      { id: 'target-en-arbol', severidad: 'error' },
    ]);
    assert.deepEqual(resultado(c, proyecto()).hallazgos, []);
  });

  it('target-dir: omitida fuera de Rust; sin target-dir no avisa (la VPS lo fija); avisa con target-dir compartido', () => {
    const c = buscar(COMPROBACIONES_PROYECTO, 'target-dir');
assert.notEqual(resultado(c, proyecto({ esRust: false })).omitida, null);
    assert.equal(resultado(c, proyecto({ targetDir: null })).hallazgos.length, 0);
    assert.equal(resultado(c, proyecto({ targetDirCompartidoCon: ['otro'] })).hallazgos.length, 1);
    assert.deepEqual(resultado(c, proyecto()).hallazgos, []);
  });

  it('perfil-dev: aviso sin [profile.dev]', () => {
    const c = buscar(COMPROBACIONES_PROYECTO, 'perfil-dev');
    assert.deepEqual(resultado(c, proyecto({ tieneProfileDev: false })).hallazgos, [{ id: 'perfil-dev', severidad: 'aviso' }]);
    assert.deepEqual(resultado(c, proyecto()).hallazgos, []);
  });

  it('incremental: aviso si CARGO_INCREMENTAL=0 en el proyecto', () => {
    const c = buscar(COMPROBACIONES_PROYECTO, 'incremental');
    assert.deepEqual(resultado(c, proyecto({ incrementalDesactivadoEn: ['.cargo/config.toml'] })).hallazgos, [
      { id: 'incremental', severidad: 'aviso' },
    ]);
    assert.deepEqual(resultado(c, proyecto()).hallazgos, []);
  });

  it('guard-huecos: omitida sin Guardián; avisa por ausencia, modo, plantilla y shim', () => {
    const c = buscar(COMPROBACIONES_PROYECTO, 'guard-huecos');
    assert.notEqual(resultado(c, proyecto({ esElegible: false })).omitida, null);
    assert.equal(resultado(c, proyecto({ guard: { estado: 'ausente' } })).hallazgos.length, 1);
    assert.equal(resultado(c, proyecto({ guard: { estado: 'invalida', motivo: 'JSON' } })).hallazgos.length, 1);
    const modo = proyecto({ guard: { estado: 'ok', modo: 'observe', listas: LISTAS_VACIAS, faltanPlantilla: [] } });
    assert.equal(resultado(c, modo).hallazgos.length, 1);
    const falta = proyecto({ guard: { estado: 'ok', modo: 'enforce', listas: LISTAS_VACIAS, faltanPlantilla: ['tools:x'] } });
    assert.equal(resultado(c, falta).hallazgos.length, 1);
    const shim = proyecto({
      guard: { estado: 'ok', modo: 'enforce', listas: { tools: ['git'] } as unknown as Listas, faltanPlantilla: [] },
    });
    assert.equal(resultado(c, shim).hallazgos.length, 1);
    assert.deepEqual(resultado(c, proyecto()).hallazgos, []);
  });

  it('sentinel-desfasado: omitida sin gate sentinel o sin pin; aviso si el lock difiere', () => {
    const c = buscar(COMPROBACIONES_PROYECTO, 'sentinel-desfasado');
    assert.notEqual(resultado(c, proyecto({ esElegible: false })).omitida, null);
    assert.notEqual(resultado(c, proyecto({ sentinelPin: null })).omitida, null);
    assert.deepEqual(resultado(c, proyecto({ sentinelLock: '0.7.13' })).hallazgos, [{ id: 'sentinel-desfasado', severidad: 'aviso' }]);
    assert.deepEqual(resultado(c, proyecto()).hallazgos, []);
    // El runtime de Sentinel no tiene lock propio: no es un desfase.
    assert.notEqual(resultado(c, proyecto({ esRuntimeSentinel: true, sentinelLock: null })).omitida, null);
  });

  it('ramas-sueltas: aviso con ramas viejas no integradas; ignora main y ramas recientes', () => {
    const c = buscar(COMPROBACIONES_PROYECTO, 'ramas-sueltas');
    const vieja = AHORA - 5 * DIA_MS;
    const reciente = AHORA - DIA_MS;
    assert.deepEqual(resultado(c, proyecto({ ramas: [{ nombre: 'feat', remota: false, ultimoCommitMs: vieja }] })).hallazgos, [
      { id: 'ramas-sueltas', severidad: 'aviso' },
    ]);
    assert.deepEqual(
      resultado(c, proyecto({
        ramas: [
          { nombre: 'main', remota: false, ultimoCommitMs: vieja },
          { nombre: 'feat', remota: false, ultimoCommitMs: reciente },
        ],
      })).hallazgos,
      [],
    );
  });

  it('instrucciones-prohibidas: error si hay AGENTS.md o CLAUDE.md en el proyecto', () => {
    const c = buscar(COMPROBACIONES_PROYECTO, 'instrucciones-prohibidas');
    assert.deepEqual(resultado(c, proyecto({ instruccionesProhibidas: ['AGENTS.md'] })).hallazgos, [
      { id: 'instrucciones-prohibidas', severidad: 'error' },
    ]);
    assert.deepEqual(resultado(c, proyecto()).hallazgos, []);
  });

  it('planes-y-roadmap: info por plan inactivo y por enlace roto', () => {
    const c = buscar(COMPROBACIONES_PROYECTO, 'planes-y-roadmap');
    const viejo = AHORA - 30 * DIA_MS;
    assert.deepEqual(resultado(c, proyecto({ planesActivos: [{ archivo: 'plan-x.md', modificadoMs: viejo, abiertas: 0 }] })).hallazgos, [
      { id: 'planes-y-roadmap', severidad: 'info' },
    ]);
    /* [por que] Con casillas abiertas el plan sigue activo: no hay que cerrarlo. */
    assert.deepEqual(resultado(c, proyecto({ planesActivos: [{ archivo: 'plan-y.md', modificadoMs: viejo, abiertas: 3 }] })).hallazgos, []);
    assert.deepEqual(resultado(c, proyecto({ enlacesRotos: ['Agente/x.md'] })).hallazgos, [{ id: 'planes-y-roadmap', severidad: 'info' }]);
    assert.deepEqual(resultado(c, proyecto()).hallazgos, []);
  });

  it('toolchain: info por cada herramienta por debajo de la referencia; omitida sin frontend', () => {
    const c = buscar(COMPROBACIONES_PROYECTO, 'toolchain');
    assert.deepEqual(resultado(c, proyecto({ toolchainFrontend: { vite: '^6.4.0', typescript: '~5.9.3' } })), {
      omitida: null,
      hallazgos: [
        { id: 'toolchain', severidad: 'info' },
        { id: 'toolchain', severidad: 'info' },
      ],
    });
    assert.deepEqual(resultado(c, proyecto({ toolchainFrontend: { vite: '^8.3.0', typescript: '~6.0.2' } })).hallazgos, []);
    assert.deepEqual(resultado(c, proyecto({ toolchainFrontend: { vite: 'latest', typescript: null } })).hallazgos, []);
    assert.equal(resultado(c, proyecto()).omitida, 'sin frontend/package.json');
  });
});

describe('comprobaciones del área', () => {
  it('sin-mando: aviso con repos git sin registrar; nada si todos están declarados', () => {
    const c = buscar(COMPROBACIONES_AREA, 'sin-mando');
    assert.deepEqual(resultado(c, area({ carpetasGit: ['a', 'b'], registradas: ['a'] })).hallazgos, [
      { id: 'sin-mando', severidad: 'aviso' },
    ]);
    assert.deepEqual(resultado(c, area({ carpetasGit: ['a'], registradas: ['a'] })).hallazgos, []);
  });

  it('disco-c: omitida sin medición; error por debajo de 15 GB', () => {
    const c = buscar(COMPROBACIONES_AREA, 'disco-c');
    assert.notEqual(resultado(c, area({ discoLibreGb: null })).omitida, null);
    assert.deepEqual(resultado(c, area({ discoLibreGb: 10 })).hallazgos, [{ id: 'disco-c', severidad: 'error' }]);
    assert.deepEqual(resultado(c, area({ discoLibreGb: 100 })).hallazgos, []);
  });

  it('tmp-tamano: omitida sin C:\\tmp; aviso sobre 20 GB; info si la medición es parcial', () => {
    const c = buscar(COMPROBACIONES_AREA, 'tmp-tamano');
    assert.notEqual(resultado(c, area({ tmp: null })).omitida, null);
    const gb = 1024 ** 3;
    assert.deepEqual(resultado(c, area({ tmp: { bytes: 21 * gb, parcial: false } })).hallazgos, [
      { id: 'tmp-tamano', severidad: 'aviso' },
    ]);
    assert.deepEqual(resultado(c, area({ tmp: { bytes: gb, parcial: true } })).hallazgos, [{ id: 'tmp-tamano', severidad: 'info' }]);
    assert.deepEqual(resultado(c, area({ tmp: { bytes: gb, parcial: false } })).hallazgos, []);
  });

  it('incremental-usuario: aviso solo con CARGO_INCREMENTAL=0', () => {
    const c = buscar(COMPROBACIONES_AREA, 'incremental-usuario');
    assert.deepEqual(resultado(c, area({ incrementalUsuario: '0' })).hallazgos, [{ id: 'incremental-usuario', severidad: 'aviso' }]);
    assert.deepEqual(resultado(c, area({ incrementalUsuario: '1' })).hallazgos, []);
    assert.deepEqual(resultado(c, area({ incrementalUsuario: null })).hallazgos, []);
  });

  it('sentinel-runtime: omitida sin pin; aviso si falta o es anterior a la fijada', () => {
    const c = buscar(COMPROBACIONES_AREA, 'sentinel-runtime');
    assert.notEqual(resultado(c, area({ sentinelPin: null })).omitida, null);
    assert.deepEqual(resultado(c, area({ sentinelPin: '0.7.23', sentinelRuntime: null })).hallazgos, [
      { id: 'sentinel-runtime', severidad: 'aviso' },
    ]);
    assert.deepEqual(resultado(c, area({ sentinelPin: '0.7.23', sentinelRuntime: '0.7.13' })).hallazgos, [
      { id: 'sentinel-runtime', severidad: 'aviso' },
    ]);
    assert.deepEqual(resultado(c, area({ sentinelPin: '0.7.23', sentinelRuntime: '0.7.23' })).hallazgos, []);
  });

  it('instrucciones-infladas: omitida sin AGENTS.md; avisa por tamaño y por títulos duplicados', () => {
    const c = buscar(COMPROBACIONES_AREA, 'instrucciones-infladas');
    assert.notEqual(resultado(c, area({ agentsBytes: null })).omitida, null);
    assert.equal(resultado(c, area({ agentsBytes: 20 * 1024 })).hallazgos.length, 1);
    assert.equal(
      resultado(c, area({ agentsBytes: 1000, titulosAgents: ['Reglas'], titulosClaudeMd: ['Reglas'] })).hallazgos.length,
      1,
    );
    assert.deepEqual(resultado(c, area({ agentsBytes: 1000, titulosAgents: ['A'], titulosClaudeMd: ['B'] })).hallazgos, []);
  });

  it('skill-desfasada: omitida sin mando; avisa por subcomandos sin documentar y copias desfasadas', () => {
    const c = buscar(COMPROBACIONES_AREA, 'skill-desfasada');
    assert.notEqual(resultado(c, area({ subcomandosArranque: [] })).omitida, null);
    const sinGate = c.evaluar(area({ skillArranque: 'Arranque doctor' }));
    assert.equal(sinGate.length, 1);
    assert.match(sinGate[0].mensaje, /gate/);
    assert.deepEqual(resultado(c, area()).hallazgos, []);
    const desfasada = c.evaluar(area({ copiasSkill: [{ nombre: 'supervisor', coincide: false }] }));
    assert.equal(desfasada.length, 1);
    assert.match(desfasada[0].mensaje, /supervisor/);
    assert.deepEqual(resultado(c, area({ copiasSkill: [{ nombre: 'supervisor', coincide: true }] })).hallazgos, []);
    assert.deepEqual(resultado(c, area({ skillArranque: null })).hallazgos, []);
  });
});

describe('ejecutar', () => {
  it('reparte las comprobaciones entre ejecutadas y omitidas', () => {
    const lista: Comprobacion<number>[] = [
      { id: 'a', evaluar: () => [{ id: 'a', severidad: 'aviso', mensaje: 'm', accion: 'x' }] },
      { id: 'b', omitirSi: () => 'motivo', evaluar: () => [] },
    ];
    const r = ejecutar('proyecto', 'p', lista, 0, 'ahora');
    assert.deepEqual(r.ejecutadas, ['a']);
    assert.deepEqual(r.omitidas, [{ id: 'b', motivo: 'motivo' }]);
    assert.equal(r.hallazgos.length, 1);
    assert.equal(r.ambito, 'proyecto');
  });
});

describe('obtenerSalud', () => {
  beforeEach(() => limpiarCacheSalud());

  it('reutiliza el valor dentro del TTL y recalcula con forzar', async () => {
    let llamadas = 0;
    const calcular = async () => ++llamadas;
    assert.equal(await obtenerSalud('k', calcular), 1);
    assert.equal(await obtenerSalud('k', calcular), 1);
    assert.equal(await obtenerSalud('k', calcular, true), 2);
    assert.equal(llamadas, 2);
  });

  it('une las peticiones concurrentes a un único cálculo en curso', async () => {
    let llamadas = 0;
    const calcular = () => new Promise<number>((r) => setTimeout(() => r(++llamadas), 10));
    const [a, b] = await Promise.all([obtenerSalud('c', calcular), obtenerSalud('c', calcular)]);
    assert.equal(a, 1);
    assert.equal(b, 1);
    assert.equal(llamadas, 1);
  });
});
