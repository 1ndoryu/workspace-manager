/* Reglas PURAS del harness analyze-blocks (sin disco, red, reloj ni consola).
 * Agregan el reporte de varsense, cruzan cada hallazgo con el registro de excepciones
 * y calculan el drift de conteos. El CLI (analyze-blocks.mjs) las orquesta. */

function severidadKey(s) {
  const sev = String(s || '').toLowerCase();
  if (sev.startsWith('err')) return 'errores';
  if (sev.startsWith('warn')) return 'warnings';
  if (sev.startsWith('info')) return 'informativos';
  if (sev.startsWith('hint')) return 'hints';
  return 'otros';
}

/**
 * Extrae el par de tokens de un hallazgo token-duplicate:
 * mensaje "Token 'A' repite el valor de 'B'." + metadata.canonical = B.
 */
function extraerParToken(mensaje, metadata) {
  const m = /Token '([^']+)' repite el valor de '([^']+)'\./.exec(mensaje || '');
  if (!m) return null;
  return { a: m[1], b: metadata?.canonical || m[2] };
}

/**
 * Cubre un hallazgo token-duplicate contra las entradas `pares` del registro:
 * match 1:1 por regla + archivo (basename) + par de tokens (orden indistinto).
 * Devuelve la entrada del registro o null si no casa con ningún par.
 */
function cubiertoPorPar(c, proyReg) {
  const pares = proyReg?.pares || [];
  if (pares.length === 0 || c.regla !== 'token-duplicate') return null;
  const par = extraerParToken(c.mensaje, c.metadata);
  if (!par) return null;
  const basename = c.ruta.split(/[\\/]/).pop();
  for (const p of pares) {
    const archivo = String(p.archivo || '').split(/[\\/]/).pop();
    if (basename !== archivo) continue;
    const ok =
      (p.tokenA === par.a && p.tokenB === par.b) ||
      (p.tokenA === par.b && p.tokenB === par.a);
    if (ok) return p;
  }
  return null;
}

function cubiertoPorRegistro(regla, ruta, message, proyectos) {
  const familias = proyectos
    .flatMap((p) => p.familias || [])
    .filter((f) => f.regla === regla);
  if (familias.length === 0) return null;
  const basename = ruta.split(/[\\/]/).pop();
  // El CLI reporta rutas con separador del SO; normalizamos a '/' para que
  // los patrones de excepciones.json funcionen igual en Windows y POSIX.
  const rutaNorm = ruta.replace(/\\/g, '/');
  for (const f of familias) {
    // Filtro por archivos cuando la familia lo declara (patrón o sufijo).
    if (Array.isArray(f.archivos) && f.archivos.length > 0) {
      const match = f.archivos.some((a) => {
        if (a.startsWith('*.')) return basename.endsWith(a.slice(1));
        return basename === a || rutaNorm.includes(a);
      });
      if (!match) continue;
    }
    // Filtro por marca textual cuando la familia lo declara (p. ej. selector).
    if (Array.isArray(f.marcas) && f.marcas.length > 0) {
      if (!f.marcas.some((m) => message.includes(m))) continue;
    }
    return f;
  }
  return null;
}

/* Aplana el reporte de varsense en hallazgos crudos y totales por severidad, regla y archivo.
 * [por que] La ruta se reescribe respecto al repo de ejecución para que coincida con la del
 * registro, sea local o remota. */
export function agregar(res, repoEjecucion) {
  const reglas = new Map();
  const archivos = new Map();
  const totales = { errores: 0, warnings: 0, informativos: 0, hints: 0 };
  const crudos = [];

  for (const entry of res.entries || []) {
    const key = entry.ruta.startsWith(repoEjecucion) ? entry.ruta.slice(repoEjecucion.length + 1) : entry.ruta;
    const arch = archivos.get(key) || { total: 0, porRegla: new Map() };
    for (const f of entry.findings || []) {
      const sev = severidadKey(f.severity);
      totales[sev] = (totales[sev] || 0) + 1;
      arch.total += 1;
      const n = arch.porRegla.get(f.ruleId) || 0;
      arch.porRegla.set(f.ruleId, n + 1);
      const r = reglas.get(f.ruleId) || { [sev]: 0, archivos: new Set() };
      r[sev] = (r[sev] || 0) + 1;
      r.archivos.add(key);
      reglas.set(f.ruleId, r);
      crudos.push({
        regla: f.ruleId,
        severidad: f.severity,
        ruta: key,
        linea: (f.range?.start?.line ?? 0) + 1,
        mensaje: f.message,
        metadata: f.metadata || null,
      });
    }
    archivos.set(key, arch);
  }
  return { reglas, archivos, totales, crudos };
}

/* Cruza cada hallazgo con el registro: `descubiertos` son los que no tienen entrada,
 * `porEntrada` agrupa los cubiertos por la entrada que los absorbe. */
export function clasificar(crudos, proyReg) {
  const descubiertos = new Map();
  let cubiertos = 0;
  const porEntrada = new Map(); // entrada del registro → hallazgos que cubre
  for (const c of crudos) {
    // Orden: pares (preciso 1:1) antes que familias (amplias).
    let entrada = proyReg ? cubiertoPorPar(c, proyReg) : null;
    if (!entrada) {
      entrada = cubiertoPorRegistro(
        c.regla,
        c.ruta,
        c.mensaje,
        proyReg ? [proyReg] : [],
      );
    }
    if (entrada) {
      cubiertos += 1;
      const arr = porEntrada.get(entrada) || [];
      arr.push(c);
      porEntrada.set(entrada, arr);
    } else {
      const k = `${c.regla}::${c.ruta}::${c.linea}`;
      descubiertos.set(k, c);
    }
  }
  return { descubiertos, cubiertos, porEntrada };
}

/* Drift: familia con `conteo` esperado que no coincide con lo medido.
 * Nota: se recorren TODAS las entradas del registro con `conteo`, no solo las
 * que recibieron hallazgos medidos — si una familia cae a 0 hallazgos sin
 * registrar (fix de detector o borrado de CSS), debe marcar DRIFT igual que
 * un aumento. Antes de 318A-7V20 solo se miraba `porEntrada`, y una caída a 0
 * pasaba silenciosa (p. ej. coolify claseHuerfana 5→0 sin detectar). */
export function calcularDrift(proyReg, porEntrada) {
  const drift = [];
  const conConteo = proyReg ? (proyReg.familias || []).filter((f) => typeof f.conteo === 'number') : [];
  for (const entrada of conConteo) {
    const hallazgos = porEntrada.get(entrada) || [];
    if (hallazgos.length !== entrada.conteo) {
      drift.push({
        regla: entrada.regla,
        archivo: Array.isArray(entrada.archivos) ? entrada.archivos.join(',') : undefined,
        esperado: entrada.conteo,
        medido: hallazgos.length,
      });
    }
  }
  return drift;
}
