/* Token de portador del manager (F9.1). [por que] Sin él, cualquier proceso local o una
 * web con DNS rebinding puede disparar rutas que lanzan procesos. El archivo vive en la
 * carpeta del usuario, fuera de OneDrive y del repo, y nunca se imprime ni se registra. */
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

export function rutaTokenPorDefecto(): string {
  return path.join(homedir(), '.workspace-manager', 'token');
}

/* Orden: WM_TOKEN (variable) > archivo de WM_TOKEN_FILE o el de usuario. Si el archivo no
 * existe se crea con 32 bytes aleatorios. En Windows el modo 0600 no aplica: la protección
 * es la carpeta del usuario. */
export function obtenerToken(env: NodeJS.ProcessEnv = process.env): string {
  const porVariable = env.WM_TOKEN?.trim();
  if (porVariable) return porVariable;

  const ruta = env.WM_TOKEN_FILE || rutaTokenPorDefecto();
  if (!existsSync(ruta)) {
    mkdirSync(path.dirname(ruta), { recursive: true });
    try {
      writeFileSync(ruta, `${randomBytes(32).toString('hex')}\n`, { mode: 0o600, flag: 'wx' });
    } catch (err) {
      /* Otro proceso lo creó entre el existsSync y el write: se reutiliza el suyo. */
      if ((err as NodeJS.ErrnoException).code !== 'EEXIST') throw err;
    }
  }
  const token = readFileSync(ruta, 'utf8').trim();
  if (token.length < 32) throw new Error(`token del manager vacío o demasiado corto: ${ruta}`);
  return token;
}
