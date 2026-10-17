/* Utilidades del propagador: citar en shell, ejecutar y leer JSON tolerante. */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

export function citar(valor) {
  return /[\s"]/u.test(valor) ? `"${valor.replace(/"/gu, '\\"')}"` : valor;
}

export function comando(exe, args) {
  return [exe, ...args].map(citar).join(' ');
}

export function ejecutar(linea, cwd, timeout = 0) {
  const resultado = spawnSync(linea, {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    shell: true,
    maxBuffer: 32 * 1024 * 1024,
    ...(timeout > 0 ? { timeout } : {}),
  });
  return {
    status: typeof resultado.status === 'number' ? resultado.status : 2,
    salida: `${resultado.stdout ?? ''}${resultado.stderr ?? ''}`,
    error: resultado.error?.message ?? null,
  };
}

export function leerJson(archivo) {
  try {
    return JSON.parse(fs.readFileSync(archivo, 'utf8'));
  } catch {
    return null;
  }
}

/* Recorta el primer objeto JSON de una salida que puede traer líneas de log. */
export function leerJsonDeTexto(texto) {
  const inicio = texto.indexOf('{');
  const fin = texto.lastIndexOf('}');
  if (inicio < 0 || fin <= inicio) return null;
  try {
    return JSON.parse(texto.slice(inicio, fin + 1));
  } catch {
    return null;
  }
}

/* Mensaje de error útil: la primera línea con contenido y sin ruido de npm. */
export function primeraLineaUtil(salida) {
  const linea = String(salida ?? '')
    .split(/\r?\n/u)
    .map(texto => texto.trim())
    .find(texto => texto.length > 0 && !/^>|^npm (error )?code|^npm ERR! *$/u.test(texto));
  return linea ? linea.slice(0, 200) : null;
}
