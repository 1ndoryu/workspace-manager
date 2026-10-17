/* Punto de entrada del propagador: lee las opciones, recorre los consumidores e
 * imprime el informe. Se ejecuta al importarlo (barril scripts/quality/bump.mjs). */
import { conPasos, escribir, herramienta, salidaJson, soloShims, valorDe } from './ajustes.mjs';
import { consumidoresDeclarados, familiaDe, revisarRouters } from './consumidores.mjs';
import { imprimirTabla } from './informe.mjs';
import { propagarConsumidor } from './propagacion.mjs';
import { objetivoDelRelease } from './release.mjs';
import { leerJson } from './utilidades.mjs';
import path from 'node:path';

export function main() {
  if (soloShims) {
    const filas = [];
    for (const consumidor of consumidoresDeclarados()) {
      const config = leerJson(path.join(consumidor.dir, 'quality-tools.json'))?.tools?.[herramienta ?? 'sentinel'];
      if (familiaDe(consumidor, config) !== 'A') continue;
      filas.push({ proyecto: consumidor.nombre, routers: revisarRouters(consumidor, escribir) });
    }
    const conDrift = filas.filter(fila => fila.routers.some(router => !['ok', 'host'].includes(router.estado)));
    if (salidaJson) {
      process.stdout.write(`${JSON.stringify({ modo: 'shims', escribir, filas }, null, 2)}\n`);
    } else {
      for (const fila of filas) {
        process.stdout.write(`${fila.proyecto.padEnd(28)} ${fila.routers.map(r => `${r.router}=${r.estado}`).join('  ')}\n`);
      }
      process.stdout.write(
        `\n[quality:bump] routers: ${filas.length} consumidor(es) familia A revisado(s), ${conDrift.length} con drift${escribir ? ' (corregido)' : ' (usa --write)'}\n`,
      );
    }
    process.exitCode = escribir || conDrift.length === 0 ? 0 : 1;
    return;
  }

  if (!herramienta) {
    process.stderr.write('[quality:bump] falta --tool (o usa --shims)\n');
    process.exitCode = 2;
    return;
  }

  let consumidores;
  let destino;
  try {
    consumidores = consumidoresDeclarados();
    destino = objetivoDelRelease(herramienta, {
      commit: valorDe('--commit'),
      version: valorDe('--version'),
      source: valorDe('--source'),
    });
  } catch (error) {
    process.stderr.write(`[quality:bump] ${error.message}\n`);
    process.exitCode = 2;
    return;
  }

  if (!salidaJson) {
    process.stdout.write(
      `[quality:bump] ${herramienta} → ${destino.commit.slice(0, 12)}${destino.version ? ` (${destino.version})` : ''}` +
        ` · fuente ${destino.fuente} · ${escribir ? 'ESCRITURA' : 'dry-run'}\n`,
    );
  }

  const filas = consumidores.map(consumidor => propagarConsumidor(consumidor, herramienta, destino));
  const problemas = filas.filter(fila => fila.estado !== 'ok');

  if (salidaJson) {
    process.stdout.write(
      `${JSON.stringify({ herramienta, destino, escribiendo: escribir, filas, problemas: problemas.length }, null, 2)}\n`,
    );
  } else {
    imprimirTabla(filas);
    /* [por que] En dry-run `pin` nunca llega a 'cambiado' —esa rama exige
     * `--write`—, así que contar solo 'cambiado' hacía que el resumen dijera
     * "0 manifiesto(s) por reescribir" justo debajo de una tabla con trece
     * filas "cambiaría". El resumen tiene que contar lo que se va a escribir. */
    const cambios = filas.filter(fila => fila.pin === 'cambiado' || fila.pin === 'cambiaría').length;
    process.stdout.write(
      `\n[quality:bump] ${filas.length} consumidor(es) · ${cambios} manifiesto(s) ${escribir ? 'reescrito(s)' : 'por reescribir'}` +
        ` · ${problemas.length} con problema\n`,
    );
    for (const fila of problemas) process.stdout.write(`  - ${fila.proyecto} [${fila.estado}]: ${fila.nota ?? 'sin detalle'}\n`);
    if (problemas.some(fila => fila.estado === 'bloqueado')) {
      process.stdout.write(
        '  [nota] un consumidor de familia B queda bloqueado hasta commitear el gitlink del submódulo en el padre (requiere autorización).\n',
      );
    }
    if (!escribir) process.stdout.write('[quality:bump] dry-run: nada modificado (añade --write para aplicar)\n');
  }

  process.exitCode = problemas.length === 0 ? 0 : 1;
}
