// Ejecución de procesos hijos del taller remoto (cargo, ssh, mutagen…) y su citado para shell.
// [por que] Sacado de rcargo.mjs para que ese módulo quede bajo el límite de 300 líneas efectivas.
import { spawnSync } from 'node:child_process';

export function shQuote(valor) {
  return `'${String(valor).replace(/'/g, `'\\''`)}'`;
}

function mostrar(cmd, args) {
  return [cmd, ...args].map((a) => (/\s|'/.test(a) ? shQuote(a) : a)).join(' ');
}

export function correr(cmd, args, { dryRun, cwd, heredar = false, silencioso = false, timeoutMs = 0 }) {
  if (dryRun) {
    console.log(mostrar(cmd, args));
    return { status: 0 };
  }
  const r = spawnSync(cmd, args, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    stdio: heredar ? 'inherit' : ['ignore', 'pipe', 'pipe'],
    // [por que] Sin límite, un Mutagen colgado (laptop sin red hacia la 89) dejaba el gate parado para siempre.
    timeout: timeoutMs || undefined,
  });
  if (r.error?.code === 'ETIMEDOUT') {
    console.error(`rcargo: "${cmd}" no terminó en ${timeoutMs / 1000} s (¿Mutagen sin conexión con la VPS?)`);
    return { status: 1 };
  }
  if (r.error) {
    console.error(`rcargo: no se pudo ejecutar "${cmd}": ${r.error.message}`);
    return { status: 2 };
  }
  if (r.status !== 0 && !heredar && !silencioso) {
    process.stderr.write(r.stderr ?? '');
    process.stdout.write(r.stdout ?? '');
  }
  return { status: r.status ?? 1, stdout: r.stdout ?? '' };
}

// La base se deriva de la raíz del repo, igual que el directorio remoto (dirRemoto).
// [19AA-3] Un crate en subcarpeta (glory-pulse: `pulse/Cargo.toml`) no tiene Cargo.toml en la raíz:
// devolver null deja que `basedatos` de la ficha mande, y sin ninguna de las dos el proyecto se
// trata como «sin BD» en vez de morir con ENOENT (así el gate de glory-pulse no podía correr).
