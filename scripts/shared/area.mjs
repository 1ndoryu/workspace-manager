/* Papeles del área: qué proyecto NUESTRO hace cada cosa que el manager no puede
 * adivinar por sí solo.
 * [por qué] Gemelo de `src/shared/area.ts` (los `.mjs` sueltos no pueden
 * importar TypeScript; es la misma duplicación documentada que en `rutas`).
 * Sin `config/area.json` no se rompe nada: cada papel ausente es `null` y quien
 * lo usa desactiva su función diciéndolo. */
import { readFileSync } from 'node:fs';
import { rutaConfigPrivada } from './rutas.mjs';

const VACIOS = { sentinel: null, despliegue: null, despliegueBin: null, limpiador: null, bumpExcluidos: [] };

function texto(v) {
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}

/** Papeles declarados. Nunca lanza: un fichero ausente o ilegible da `VACIOS`. */
export function papelesDeArea() {
  let crudo;
  try {
    crudo = JSON.parse(readFileSync(rutaConfigPrivada('area.json'), 'utf8'));
  } catch {
    return VACIOS;
  }
  if (!crudo || typeof crudo !== 'object') return VACIOS;
  const bump = crudo.bump ?? {};
  return {
    sentinel: texto(crudo.sentinel),
    despliegue: texto(crudo.despliegue),
    despliegueBin: texto(crudo.despliegueBin),
    limpiador: texto(crudo.limpiador),
    bumpExcluidos: Array.isArray(bump.excluidos)
      ? bump.excluidos.filter((x) => texto(x) !== null)
      : [],
  };
}

/** El proyecto que hace `nombre`, o `null` si no está declarado. */
export function papelDeArea(nombre) {
  return papelesDeArea()[nombre];
}

/** Remite a la config cuando falta un papel. Un solo texto para todos los
 * sitios: el remedio es siempre el mismo fichero. */
export function avisoSinPapel(nombre) {
  return `no hay '${nombre}' declarado en config/area.json (copia config/ejemplos/area.example.json y ajústalo)`;
}
