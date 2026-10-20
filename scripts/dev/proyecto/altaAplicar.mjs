/* Aplicacion del alta (E/S): crea lo que falta y lo versiona en una rama propia, un commit
 * por bloque. Solo se llama con --aplicar; las comprobaciones son de altaComprobaciones.mjs. */

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { baseDe } from './cierre.mjs';
import { git, gitOk } from './altaComprobaciones.mjs';
import { MENSAJES, RAMA_ALTA } from './altaReglas.mjs';

function aplicarAccion(ruta, a) {
  const destino = join(ruta, a.ruta);
  if (a.tipo === 'crear') {
    if (existsSync(destino)) throw new Error(`${a.ruta} ya existe; no se sobrescribe`);
    mkdirSync(dirname(destino), { recursive: true });
    writeFileSync(destino, a.contenido);
    return;
  }
  const actual = existsSync(destino) ? readFileSync(destino, 'utf8') : '';
  const separador = actual.length && !actual.endsWith('\n') ? '\n' : '';
  appendFileSync(destino, `${separador}# alta 10AA-2 F10\n${a.lineas.join('\n')}\n`);
}

/* Aplica los bloques pendientes en la rama `alta/10aa-2`, un commit por bloque.
 * [por que] Se niega si la base no está en curso, si hay cambios en el índice o en
 * archivos que tocaría, o si la rama ya existe: nunca mezcla ni pisa trabajo ajeno. */
export function aplicarAlta(ruta, items) {
  const porBloque = new Map();
  for (const it of items) {
    if (it.ok || !it.bloque) continue;
    porBloque.set(it.bloque, [...(porBloque.get(it.bloque) ?? []), ...it.acciones]);
  }
  if (porBloque.size === 0) return ['nada que aplicar'];
  if (!gitOk(ruta, ['rev-parse', '--is-inside-work-tree'])) throw new Error('aplicar necesita un repo Git');
  const base = baseDe(ruta);
  if (!base) throw new Error('aplicar necesita una rama base (main)');
  const actual = git(ruta, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (actual !== base) throw new Error(`aplicar corre desde ${base}; estás en ${actual}`);
  if (git(ruta, ['diff', '--cached', '--name-only']).length) throw new Error('hay cambios en el índice; no se mezclan con el alta');
  if (gitOk(ruta, ['rev-parse', '--verify', '-q', RAMA_ALTA])) throw new Error(`la rama ${RAMA_ALTA} ya existe; intégrala o bórrala antes`);
  const rutas = [...porBloque.values()].flat().map((a) => a.ruta);
  const sucio = git(ruta, ['status', '--porcelain', '--', ...rutas]);
  if (sucio) throw new Error(`hay cambios sin commit en archivos del alta:\n${sucio}`);

  git(ruta, ['checkout', '-b', RAMA_ALTA]);
  const log = [];
  for (const [bloque, acciones] of porBloque) {
    for (const a of acciones) aplicarAccion(ruta, a);
    /* [por que] Lo que el .gitignore declara local (p. ej. Agente/ en glory-sentinel, decisión
     * de la usuaria) se crea en disco pero no se versiona: `git add` fallaría con «ignored». */
    const archivos = acciones.map((a) => a.ruta).filter((r) => !gitOk(ruta, ['check-ignore', '-q', '--', r]));
    if (archivos.length === 0) {
      log.push(`bloque ${bloque}: solo local (ignorado por .gitignore), sin commit`);
      continue;
    }
    git(ruta, ['add', '--', ...archivos]);
    git(ruta, ['commit', '-m', MENSAJES[bloque]]);
    log.push(`commit ${bloque}: ${archivos.join(', ')}`);
  }
  /* [por que] Una rama sin commits no aporta nada que integrar: se vuelve a la base y se borra. */
  if (!log.some((l) => l.startsWith('commit '))) {
    git(ruta, ['checkout', base]);
    git(ruta, ['branch', '-D', RAMA_ALTA]);
    return [...log, 'sin cambios que versionar: rama descartada'];
  }
  log.push(`rama ${RAMA_ALTA} lista para integrar en ${base} (AGENTS §5)`);
  return log;
}
