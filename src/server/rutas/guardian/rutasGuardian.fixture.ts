/* Fixture compartido de los tests del Guardián (10AA-2 F11.4, /api/guardian/*): lo usan
 * rutasGuardian.lecturas.test.ts (GET) y rutasGuardian.escritura.test.ts (POST). No es un
 * test: no declara describe ni test.
 * [por que] Servidor HTTP real en un puerto libre para ejercer las guardas de origen
 * y el cuerpo tal como llegan. Proyectos y comandos son falsos e inyectados: ningún
 * test toca el área real ni ejecuta Sentinel. Fixtures en C:/tmp (protocolo de temporales).
 * Cada fichero de test corre en su propio proceso y arranca su propio servidor y área. */
import { createServer, request, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { manejarRutasGuardian } from './rutasGuardian.js';
import type { DependenciasGuardian } from './rutasGuardianTipos.js';
import { leerActividad } from '../../guardian/operacion/actividad.js';
import { RUTA_PLANTILLA } from '../../guardian/configuracion/plantilla.js';
import type { Proyecto } from '../../../shared/types.js';

const BASE_TMP = 'C:/tmp/guardian-test';
const temporales: string[] = [];

/* [por que] Área falsa con una copia de la plantilla real: las escrituras de plantilla
 * nunca tocan el área real. Cinco niveles desde guardian/ llegan a la raíz del área. */
const RAIZ_AREA_FALSA = (() => {
  mkdirSync(BASE_TMP, { recursive: true });
  const d = mkdtempSync(join(BASE_TMP, 'area-'));
  temporales.push(d);
  mkdirSync(join(d, '.quality-tools'));
  const real = readFileSync(join(import.meta.dirname, '..', '..', '..', '..', '..', RUTA_PLANTILLA), 'utf8');
  writeFileSync(join(d, RUTA_PLANTILLA), real, 'utf8');
  return d;
})();

/* Formato de workspace-manager: CRLF y sangría 2 y 4. */
export const CONFIG_BASE = [
  '{',
  '  "schemaVersion": 2,',
  '  "mode": "enforce",',
  '  "budgets": {',
  '    "mode": "enforce"',
  '  },',
  '  "guard": {',
  '    "directCommands": {',
  '      "npmScripts": ["lint", "test"],',
  '      "npxTools": ["tsc"],',
  '      "cargoSubcommands": ["check"],',
  '      "tools": ["cargo"]',
  '    }',
  '  }',
  '}',
  '',
].join('\r\n');

/* Las listas que CONFIG_BASE declara; el router debe devolverlas tal cual. */
export const LISTAS_BASE = {
  npmScripts: ['lint', 'test'],
  npxTools: ['tsc'],
  cargoSubcommands: ['check'],
  tools: ['cargo'],
};

export const proyectos: Proyecto[] = [];
export const llamadas = { probar: [] as Array<{ raiz: string; ejecutable: string; args: string[] }>, mantenimiento: [] as unknown[] };

/* Crea un proyecto temporal y lo registra en el área falsa. */
export function registrar(clave: string, puerta: string, config: string | null): string {
  mkdirSync(BASE_TMP, { recursive: true });
  const ruta = mkdtempSync(join(BASE_TMP, `rutas-${clave}-`));
  temporales.push(ruta);
  if (config !== null) writeFileSync(join(ruta, 'sentinel.config.json'), config, 'utf8');
  proyectos.push({ clave, ruta, gate: { puerta } } as unknown as Proyecto);
  return ruta;
}

const deps: DependenciasGuardian = {
  raizArea: RAIZ_AREA_FALSA,
  proyectos: () => proyectos,
  proyectoPorClave: (clave) => proyectos.find((p) => p.clave === clave) ?? null,
  leerActividad,
  probarComando: async (entrada) => {
    llamadas.probar.push(entrada);
    return { estado: 'ok', codigo: 78, decision: { blocked: true, reason: 'falso' } };
  },
  ejecutarMantenimiento: async (entrada) => {
    llamadas.mantenimiento.push(entrada);
    return { estado: 'ok', modo: 'simulacion', codigo: 0, salida: '' };
  },
};

let servidor: Server;
let puerto: number;

/* Servidor en un puerto libre de 127.0.0.1. Lo llama before() de cada fichero de test. */
export async function arrancar(): Promise<void> {
  servidor = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    void manejarRutasGuardian(req, res, url, url.pathname, deps).then((atendida) => {
      if (!atendida) {
        res.statusCode = 404;
        res.end();
      }
    });
  });
  await new Promise<void>((resolve) => servidor.listen(0, '127.0.0.1', resolve));
  puerto = (servidor.address() as AddressInfo).port;
}

/* Lo llama after() de cada fichero: cierra el servidor y borra los temporales. */
export async function cerrar(): Promise<void> {
  await new Promise<void>((resolve) => servidor.close(() => resolve()));
  for (const d of temporales) rmSync(d, { recursive: true, force: true });
}

interface Opciones {
  cuerpo?: unknown;
  crudo?: string;
  cabeceras?: Record<string, string>;
}

/* cuerpo es null cuando la respuesta no trae cuerpo (404 o 405). Los tests que leen el
 * cuerpo piden respuestas con cuerpo, por eso el tipo no lo contempla. */
export interface Respuesta {
  status: number;
  cuerpo: Record<string, unknown>;
}

/* Por defecto, una petición de escritura llega como lo haría la página local. */
export function pedir(metodo: string, ruta: string, opciones: Opciones = {}): Promise<Respuesta> {
  const texto = opciones.crudo ?? (opciones.cuerpo === undefined ? undefined : JSON.stringify(opciones.cuerpo));
  const cabeceras: Record<string, string> = {
    Host: 'localhost:8787',
    ...(metodo === 'POST' ? { Origin: 'http://localhost:5175', 'Content-Type': 'application/json' } : {}),
    ...opciones.cabeceras,
  };
  if (texto !== undefined) cabeceras['Content-Length'] = String(Buffer.byteLength(texto));
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port: puerto, method: metodo, path: ruta, headers: cabeceras }, (res) => {
      let datos = '';
      res.setEncoding('utf8');
      res.on('data', (trozo: string) => {
        datos += trozo;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, cuerpo: datos === '' ? null : JSON.parse(datos) }));
    });
    req.on('error', reject);
    if (texto !== undefined) req.write(texto);
    req.end();
  });
}

export const leer = (ruta: string, fichero: string): string => readFileSync(join(ruta, fichero), 'utf8');
