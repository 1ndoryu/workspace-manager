#!/usr/bin/env node
/* quality:sync — valida el commit comun del checkout compartido del gate
 * (308A-1 §F5 / §3.3). Es un script de VALIDACION/CONSISTENCIA en-repo del
 * workspace-manager: NO escribe nada por defecto.
 *
 * [por que] El plan centraliza el runtime en `<area>/.quality-tools/{sentinel,
 * varsense}` y exige que TODOS los consumidores apunten al MISMO commit ("mismo
 * commit para todos = quality:sync falla si uno difiere"). Este script es la
 * guarda: recorre los consumidores del gate, compara el `sentinel.commit` /
 * `varsense.commit` de cada `quality-tools.json` contra el HEAD real del
 * checkout que ese mismo manifiesto declara —el compartido para casi todos, el
 * del arnés (`../.quality-tools-harness/*`) o el submódulo propio (familia B)
 * para el resto— y falla (fail-closed, exit != 0) si hay desync, un checkout
 * compartido sucio o no provisto, o un consumidor con gate que no tiene
 * `quality-tools.json`. No declarar una herramienta no es un problema.
 *
 * La resolucion es server-side / en-repo: lee el HEAD del checkout compartido y
 * el JSON real de cada consumidor (carpetas exactas del area), igual que el
 * server deriva las env. No muta nada: reporta y sale con codigo de error para
 * poder colgarlo de CI/guard.
 *
 * Los consumidores NO van en el codigo: son configuracion del area y viven en
 * `config/quality-consumidores.json` (privada, con ejemplo versionado). Sin ese
 * archivo el script informa y sale en verde, que es lo que le toca a un clone
 * recien hecho.
 *
 * Uso:  pnpm sync:quality            (recorre los consumidores declarados)
 *       pnpm sync:quality --json      (salida JSON en stdout)
 *
 * Exit codes:
 *   0  todos los consumidores con gate apuntan al commit comun y al checkout
 *      compartido con rutas limpias
 *   1  desync (commit distinto, ruta no compartida, checkout sucio, o falta
 *      quality-tools.json en un consumidor con gate, o checkout compartido
 *      no provisto)
 *   2  error de entorno/data (no se pudo leer algo, area no hallada) */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { RAIZ_AREA, rutaConfigPrivada } from './shared/rutas.mjs';
// Reparto: lo puro en quality-sync-puro.mjs y la lectura de git/config en quality-sync-git.mjs.
import { CHECKOUT, HERRAMIENTAS, QITOOLS, corto } from './quality-sync-puro.mjs';
import { compararTool, gitHead, gitSucio, leerConsumidores, leerManifest } from './quality-sync-git.mjs';

function main() {
  const useJson = process.argv.includes('--json');
  const consumidores = leerConsumidores();
  const reporte = {
    area: RAIZ_AREA,
    checkout: CHECKOUT,
    consumidores: [],
    ...(consumidores ? {} : { sinConsumidores: true }),
  };
  let problemas = 0;
  const sinDirectorio = [];

  /* Sin config de consumidores no hay nada que validar: se informa y se sale en
   * verde. Un clone del repo no trae la lista (es configuracion del area), asi
   * que fallar aqui seria fallar por no tener nuestros datos. */
  if (!consumidores) {
    if (useJson) console.log(JSON.stringify(reporte, null, 2));
    else {
      console.log(`sin consumidores declarados: no hay ${rutaConfigPrivada('quality-consumidores.json')}`);
      console.log('Copialo de config/ejemplos/quality-consumidores.example.json y pon tus proyectos.');
    }
    return 0;
  }

  /* HEAD y limpieza de cada herramienta del checkout compartido. */
  const cabeceras = {};
  const sucios = {};
  for (const [tool, sub] of Object.entries(HERRAMIENTAS)) {
    const dir = join(CHECKOUT, sub);
    if (!existsSync(dir)) {
      cabeceras[tool] = null;
      sucios[tool] = ['no provisto'];
      continue;
    }
    cabeceras[tool] = gitHead(dir);
    const dirty = gitSucio(dir);
    if (dirty === null) sucios[tool] = ['no es git'];
    else if (dirty.length) sucios[tool] = dirty;
  }
  /* Un checkout compartido limpio no es un problema: se cuenta solo lo que de
   * verdad lo es (no provisto o sucio). Antes la condición daba por sucio todo
   * checkout limpio —`sucios[tool]` es `[]`, que es *truthy*, y `[][0]` no es
   * `'no es git'`— y el área sana salía con 2 problemas fantasma. */
  for (const [tool, sub] of Object.entries(HERRAMIENTAS)) {
    const noProvisto = sucios[tool]?.[0] === 'no provisto';
    const sucio = Array.isArray(sucios[tool]) && sucios[tool].length > 0;
    if (!noProvisto && !sucio) continue;
    reporte[`checkout_${tool}`] = {
      head: cabeceras[tool] ? corto(cabeceras[tool]) : null,
      sucio: noProvisto ? 0 : sucios[tool].length,
    };
    problemas++;
  }

  /* Recorre consumidores. */
  for (const c of consumidores) {
    const dir = join(RAIZ_AREA, c.ruta);
    const entry = { nombre: c.nombre, fase: c.fase, ruta: c.ruta, problemas: [] };

    /* Proyecto registrado cuyo directorio no está en el área: no hay pin que
     * validar. Se reporta como tal —no como desync, que sería un diagnóstico
     * falso— y no cuenta como problema del gate. */
    if (!existsSync(dir)) {
      entry.estado = 'sin-directorio';
      entry.detalle = `no existe ${dir} en el área (registro obsoleto o repo fuera)`;
      sinDirectorio.push(c.nombre);
      reporte.consumidores.push(entry);
      continue;
    }

    const manifest = leerManifest(dir);
    if (!manifest) {
      entry.estado = c.fase === 'F4' ? 'pendiente-F4' : 'sin-manifest';
      entry.detalle =
        c.fase === 'F4'
          ? 'no tiene gate aun (F4 crea quality-tools.json)'
          : 'consumidor con gate sin quality-tools.json (desync)';
      if (c.fase !== 'F4') problemas++;
      reporte.consumidores.push(entry);
      continue;
    }
    if (manifest.__error__) {
      entry.estado = 'error';
      entry.detalle = `${QITOOLS} corrupto/no leido`;
      problemas++;
      reporte.consumidores.push(entry);
      continue;
    }

    for (const [tool] of Object.entries(HERRAMIENTAS)) {
      const r = compararTool(manifest, dir, tool, cabeceras[tool]);
      entry[tool] = { estado: r.estado, checkout: r.checkout, detalle: r.detalle };
      if (r.estado === 'desync') {
        problemas++;
        entry.problemas.push(`${tool}: ${r.detalle}`);
      }
    }
    entry.estado = entry.problemas.length ? 'desync' : 'ok';
    reporte.consumidores.push(entry);
  }

  reporte.problemas = problemas;
  reporte.sinDirectorio = sinDirectorio;

  if (useJson) {
    console.log(JSON.stringify(reporte, null, 2));
  } else {
    console.log(`area: ${RAIZ_AREA}`);
    console.log(`checkout compartido: ${CHECKOUT}`);
    for (const tool of Object.keys(HERRAMIENTAS)) {
      const h = cabeceras[tool];
      const dirty = sucios[tool];
      console.log(
        `  ${tool}: head=${h ? corto(h) : 'NO-PROVISTO'}${dirty?.length ? `  (sucio ${dirty.length})` : ''}`,
      );
    }
    console.log('');
    for (const e of reporte.consumidores) {
      const badges =
        (e.sentinel ? `sentinel=${e.sentinel.estado} ` : '') +
        (e.varsense ? `varsense=${e.varsense.estado} ` : '') +
        (e.estado === 'ok'
          ? '✓'
          : e.estado === 'pendiente-F4'
            ? '· (F4 pendiente)'
            : e.estado === 'sin-directorio'
              ? '· (sin directorio en el área)'
              : `✗ ${e.problemas.length ? e.problemas.join('; ') : e.detalle || e.estado}`);
      console.log(`  ${e.nombre.padEnd(16)} ${badges}`);
    }
    console.log('');
    if (sinDirectorio.length) {
      console.log(
        `· ${sinDirectorio.length} registrado(s) sin directorio en el área, no validables: ${sinDirectorio.join(', ')}`,
      );
    }
    if (problemas === 0) {
      console.log(`OK: ${reporte.consumidores.length} consumidores registrados, sin desync de gate.`);
      return 0;
    }
    console.error(`DESYNC: ${problemas} problema(s) de consistencia del gate.`);
    for (const e of reporte.consumidores) {
      if (e.estado === 'desync' || e.estado === 'error' || e.estado === 'sin-manifest') {
        console.error(`  - ${e.nombre}: ${e.problemas.length ? e.problemas.join('; ') : e.detalle}`);
      }
    }
    return 1;
  }
  return problemas === 0 ? 0 : 1;
}

process.exit(main());