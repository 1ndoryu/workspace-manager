/* Cómo se lanzan los audits: el CLI de cada gestor, en local o en la 89.
 * [por qué] Sale de `vulnerabilidades.ts` para que la orquestación (cache, vuelos,
 * lockfiles) no dependa de procesos: el resto solo ve un `Corredor`, y con uno falso
 * se prueba todo sin lanzar npm ni cargo. */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GestorAudit } from '../../auditoria-remota.js';
import { fechaLocal, parsearExcepcionesAudit } from './parseo.js';

/* Resultado crudo de un comando de shell. `codigo` es null si no arranco o
 * excedio el timeout. */
export interface Ejecucion {
  stdout: string;
  codigo: number | null;
}

/* Quien ejecuta los comandos del audit: en local, o en la 89 si el proyecto se
 * analiza alli. */
export type Corredor = (comando: string) => Promise<Ejecucion>;

/* Ejecuta un comando de shell y devuelve stdout y exit code SIN rechazar por
 * exit code: npm/pnpm/cargo audit salen con exit 1 cuando hay vulnerabilidades,
 * y cargo tree sale != 0 si falta un crate. [por que] npm/pnpm son shims .cmd
 * en Windows que Node no puede lanzar con shell:false (EINVAL), asi que va por
 * cmd.exe /d /s /c. El comando lo arma SOLO este modulo (texto estatico o nombre
 * de crate validado con nombrePaqueteValido): no hay input externo en la linea,
 * asi que no hay inyeccion de shell. */
export function ejecutar(comando: string, cwd: string): Promise<Ejecucion> {
  return new Promise((resolve) => {
    const hijo = spawn(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', comando], {
      cwd,
      windowsHide: true,
      /* [por que] corepack pregunta en consola antes de descargar pnpm; sin
       * consola esa pregunta colgaria el audit. */
      env: { ...process.env, COREPACK_ENABLE_DOWNLOAD_PROMPT: '0' },
    });
    let out = '';
    const to = setTimeout(() => {
      hijo.kill();
      resolve({ stdout: out, codigo: null });
    }, 120000);
    hijo.stdout.on('data', (d: Buffer) => {
      out += d.toString('utf8');
    });
    hijo.on('error', () => {
      clearTimeout(to);
      resolve({ stdout: '', codigo: null });
    });
    hijo.on('close', (codigo) => {
      clearTimeout(to);
      resolve({ stdout: out, codigo });
    });
  });
}

/* pnpm no siempre esta en PATH (en esta maquina no lo esta; corepack si). Se
 * resuelve una vez y se recuerda el exito. Un fallo no se cachea: el siguiente
 * audit reintenta (p. ej. si corepack tardo en descargar pnpm). */
const VERSION_SEMVER = /^\d+\.\d+\.\d+/;
let cliPnpmResuelto: string | null = null;

async function resolverCliPnpm(cwd: string): Promise<string | null> {
  if (cliPnpmResuelto) return cliPnpmResuelto;
  const directo = await ejecutar('pnpm --version', cwd);
  if (directo.codigo === 0 && VERSION_SEMVER.test(directo.stdout.trim())) {
    cliPnpmResuelto = 'pnpm audit --json';
  } else {
    const via = await ejecutar('corepack pnpm --version', cwd);
    if (via.codigo === 0 && VERSION_SEMVER.test(via.stdout.trim())) {
      cliPnpmResuelto = 'corepack pnpm audit --json';
    }
  }
  return cliPnpmResuelto;
}

/* Flags `--ignore` de las excepciones vigentes de .cargo/audit.toml. [por que]
 * cargo-audit no aplica ese archivo (verificado en coolify-manager-rs: el
 * advisory RUSTSEC-2023-0071 sale en el JSON). Sin archivo o ilegible: ninguna
 * excepcion, todo cuenta. */
function flagsIgnorarCargo(cwd: string): string {
  let texto: string;
  try {
    texto = readFileSync(join(cwd, '.cargo', 'audit.toml'), 'utf8');
  } catch {
    return '';
  }
  const { vigentes } = parsearExcepcionesAudit(texto, fechaLocal(new Date()));
  return vigentes.map((id) => ` --ignore ${id}`).join('');
}

/* Comando de audit de cada gestor. Para pnpm puede no haber CLI: devuelve null.
 * [por que] Una tabla por gestor: añadir uno es una entrada, no otra rama. En la 89
 * no se sondea nada: el PATH lo fija `ejecutarAuditRemoto` con el node de `taller.json`
 * y pnpm se resuelve por corepack, que si esta. Sondearlo costaria un ssh extra por
 * audit para una respuesta que ya se conoce. */
type ComandoAudit = (cwd: string, remoto: boolean) => Promise<string | null>;

const COMANDOS_AUDIT: Record<GestorAudit, ComandoAudit> = {
  npm: async () => 'npm audit --json',
  pnpm: async (cwd, remoto) => (remoto ? 'corepack pnpm audit --json' : resolverCliPnpm(cwd)),
  cargo: async (cwd) => `cargo audit --json${flagsIgnorarCargo(cwd)}`,
};

export function cliDeAudit(g: GestorAudit, cwd: string, remoto: boolean): Promise<string | null> {
  return COMANDOS_AUDIT[g](cwd, remoto);
}
