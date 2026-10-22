#!/usr/bin/env node
/* Coherencia de la versión (2026-10-22): `package.json`, `src-tauri/tauri.conf.json` y una sección
 * en `CHANGELOG.md`. [por que existe] La versión que pinta el nav sale de `package.json`, el exe de
 * escritorio la toma de `tauri.conf.json` y el changelog la nombra: tres sitios que se olvidan por
 * separado, y un desfase hace que el nav diga «actualizada» mientras el exe es otro. Falla en vez
 * de avisar: es una comprobación de contorno, no una opinión.
 * Uso: node scripts/app/version.mjs            (comprueba)
 *      node scripts/app/version.mjs --subir    (sube el parche en los dos JSON; el changelog, a mano)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(fileURLToPath(new URL('.', import.meta.url)), '..', '..');

const leer = (rel) => JSON.parse(readFileSync(join(RAIZ, rel), 'utf8'));
const escribir = (rel, valor) => writeFileSync(join(RAIZ, rel), `${JSON.stringify(valor, null, 2)}\n`, 'utf8');

export function versionesDelProyecto() {
  return {
    package: leer('package.json').version,
    tauri: leer('src-tauri/tauri.conf.json').version,
    changelog: readFileSync(join(RAIZ, 'CHANGELOG.md'), 'utf8'),
  };
}

/* Fallos de coherencia, como textos. Vacío = todo casa.
 * [por que el changelog se exige por sección] Sin una sección propia, subir la versión deja el
 * historial sin decir qué cambió en ella y el nav abre un fichero que no habla de lo que sirve. */
export function fallosVersion({ package: vpkg, tauri: vtauri, changelog }, { exigirChangelog = true } = {}) {
  const fallos = [];
  if (!/^\d+\.\d+\.\d+$/.test(String(vpkg))) fallos.push(`package.json: versión no semver (${vpkg})`);
  if (vpkg !== vtauri) fallos.push(`versiones distintas: package.json ${vpkg}, tauri.conf.json ${vtauri}`);
  /* [por que sin RegExp] La versión lleva puntos y corchetes; comparar cabeceras línea a línea
   * con `startsWith` evita escapes que se leen distinto en cada shell. */
  const cabecera = `## [${vpkg}]`;
  const tieneSeccion = changelog.split('\n').some((l) => l.trim().startsWith(cabecera));
  if (exigirChangelog && !tieneSeccion) {
    fallos.push(`CHANGELOG.md: falta la sección «${cabecera}»`);
  }
  return fallos;
}

/* Siguiente parche. Se queda en tres números: no hay releases con contrato que justifiquen mayor
 * y menor todavía; cuando lo haya, esta es la función que cambia. */
export function siguienteParche(version) {
  const [mayor, menor, parche] = String(version).split('.').map(Number);
  if ([mayor, menor, parche].some((n) => !Number.isInteger(n))) return null;
  return `${mayor}.${menor}.${parche + 1}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const datos = versionesDelProyecto();
  if (process.argv.includes('--subir')) {
    const nueva = siguienteParche(datos.package);
    if (!nueva) {
      console.error(`version: no se pudo subir '${datos.package}' (no es semver de tres números)`);
      process.exit(1);
    }
    const pkg = leer('package.json');
    pkg.version = nueva;
    escribir('package.json', pkg);
    const tauri = leer('src-tauri/tauri.conf.json');
    tauri.version = nueva;
    escribir('src-tauri/tauri.conf.json', tauri);
    console.log(`version: ${datos.package} → ${nueva}. Añade «## [${nueva}]» a CHANGELOG.md.`);
    process.exit(0);
  }
  const fallos = fallosVersion(datos);
  if (fallos.length > 0) {
    console.error(`version: incoherente\n- ${fallos.join('\n- ')}`);
    process.exit(1);
  }
  console.log(`version: ${datos.package} coherente`);
}
