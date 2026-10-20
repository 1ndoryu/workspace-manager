/* Salida por consola del harness analyze-blocks: JSON (--json) o texto legible.
 * Solo presenta; ningún cálculo vive aquí (lo hace analyze-blocks-reglas.mjs). */

/* Sale en JSON estable para consumidores: totales, desgloses, cobertura, drift y veredicto. */
export function imprimirJson(r) {
  const { arg, total, totales, reglas, archivos, cubiertos, descubiertos, drift, proyReg, enMantenimiento } = r;
  console.log(
    JSON.stringify(
      {
        proyecto: arg,
        total,
        totales,
        porRegla: Object.fromEntries(
          [...reglas.entries()].map(([k, v]) => [
            k,
            { total: (v.errores || 0) + (v.warnings || 0) + (v.informativos || 0) + (v.hints || 0), ...v, archivos: v.archivos.size },
          ]),
        ),
        porArchivo: Object.fromEntries(
          [...archivos.entries()].map(([k, v]) => [
            k,
            { total: v.total, porRegla: Object.fromEntries(v.porRegla) },
          ]),
        ),
        cobertura: {
          cubiertos,
          descubiertos: descubiertos.size,
          pares: (proyReg?.pares || []).length,
        },
        drift,
        enMantenimiento,
      },
      null,
      2,
    ),
  );
}

/* Salida legible: cabecera, totales, desglose por regla, detalle o top de archivos y veredicto. */
export function imprimirTexto(r) {
  const { arg, res, total, totales, reglas, archivos, crudos, cubiertos, descubiertos, drift, proyReg, detalle } = r;
  console.log(`=== ${arg} — varsense (runtime fijado) ===`);
  console.log(
    `Total: ${total} — ${totales.errores} errores / ${totales.warnings} warnings / ` +
      `${totales.informativos} informativos / ${totales.hints} hints`,
  );
  if (res.cache?.utilizada) {
    console.log(`(resultado de cache: ${res.cache.utilizada})`);
  }
  console.log('\nPor regla:');
  for (const [k, v] of [...reglas.entries()].sort((a, b) =>
    b[1].errores + b[1].warnings - (a[1].errores + a[1].warnings),
  )) {
    const t = (v.errores || 0) + (v.warnings || 0) + (v.informativos || 0) + (v.hints || 0);
    console.log(
      `  ${k}: ${t} ` +
        `(e${v.errores || 0}/w${v.warnings || 0}/i${v.informativos || 0}/h${v.hints || 0}) en ${v.archivos.size} archivo(s)`,
    );
  }

  if (detalle) {
    const filtrados = crudos.filter((c) => c.regla === detalle);
    console.log(`\nDetalle ${detalle} (${filtrados.length}):`);
    for (const c of filtrados) {
      console.log(`  ${c.ruta}:${c.linea} — ${c.mensaje}`);
    }
  } else {
    console.log('\nPor archivo (top 15):');
    for (const [k, v] of [...archivos.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 15)) {
      const ps = [...v.porRegla.entries()]
        .map(([r, n]) => `${r}x${n}`)
        .join(', ');
      console.log(`  ${k}: ${v.total} (${ps})`);
    }
  }

  console.log('\n=== Veredicto de convergencia ===');
  if (!proyReg) {
    console.log(
      `Sin entrada en excepciones.json para ${arg} — sembrar el registro o clasificar manualmente.`,
    );
  } else if (descubiertos.size === 0 && drift.length === 0) {
    console.log(`MANTENIMIENTO — ${total} hallazgos, todos cubiertos por el registro.`);
  } else if (descubiertos.size === 0) {
    console.log(
      `DRIFT — ${total} hallazgos cubiertos pero con conteos desincronizados:`,
    );
    for (const d of drift) {
      console.log(
        `  ${d.regla}${d.archivo ? ' (' + d.archivo + ')' : ''}: esperado ${d.esperado}, medido ${d.medido}`,
      );
    }
  } else {
    console.log(
      `ACCIONABLE — ${descubiertos.size}/${total} hallazgos fuera del registro:`,
    );
    for (const c of descubiertos.values()) {
      console.log(`  ${c.regla} ${c.ruta}:${c.linea} — ${c.mensaje}`);
    }
  }
  if (drift.length > 0 && descubiertos.size > 0) {
    console.log('\nDRIFT de conteos (registro desincronizado):');
    for (const d of drift) {
      console.log(
        `  ${d.regla}${d.archivo ? ' (' + d.archivo + ')' : ''}: esperado ${d.esperado}, medido ${d.medido}`,
      );
    }
  }
  if (proyReg) {
    console.log(
      `Cobertura del registro: ${cubiertos}/${total} ` +
        `(familias: ${(proyReg.familias || []).length}, ` +
        `pares: ${(proyReg.pares || []).length})`,
    );
  }
}
