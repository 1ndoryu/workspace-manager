/* Escritura del pin en `quality-tools.json` sin reserializar el manifiesto. */

/* Recorre una cadena JSON saltando escapes (para no confundir una llave dentro
 * de un string con estructura). */
function finDeCadena(texto, comilla) {
  for (let i = comilla + 1; i < texto.length; i += 1) {
    if (texto[i] === '\\') {
      i += 1;
      continue;
    }
    if (texto[i] === '"') return i;
  }
  return texto.length - 1;
}

/* Localiza el objeto \`tools.<tool>\` por emparejamiento de llaves. */
function spanHerramienta(texto, tool) {
  const declaracion = new RegExp(`"${tool}"\\s*:`, 'u').exec(texto);
  if (!declaracion) return null;
  const inicio = texto.indexOf('{', declaracion.index + declaracion[0].length);
  if (inicio < 0) return null;
  let nivel = 0;
  for (let i = inicio; i < texto.length; i += 1) {
    const caracter = texto[i];
    if (caracter === '"') {
      i = finDeCadena(texto, i);
      continue;
    }
    if (caracter === '{') nivel += 1;
    else if (caracter === '}') {
      nivel -= 1;
      if (nivel === 0) return { inicio, fin: i + 1 };
    }
  }
  return null;
}

function cambiarCampo(fragmento, campo, valor) {
  const patron = new RegExp(`("${campo}"\\s*:\\s*)"[^"]*"`, 'u');
  if (!patron.test(fragmento)) return null;
  return fragmento.replace(patron, (_, prefijo) => `${prefijo}"${valor}"`);
}

/* Reescribe SOLO commit y versión de la herramienta: reserializar el manifiesto
 * reformatearía el archivo entero y ensuciaría el diff de algo que otras
 * herramientas leen. Devuelve null si el manifiesto no tiene la forma esperada. */
export function reescribirPin(texto, tool, { commit, version }) {
  const span = spanHerramienta(texto, tool);
  if (!span) return null;
  const original = texto.slice(span.inicio, span.fin);
  let fragmento = original;
  for (const [campo, valor] of [['commit', commit], ['version', version]]) {
    if (!valor) continue;
    const siguiente = cambiarCampo(fragmento, campo, valor);
    if (siguiente === null) return null;
    fragmento = siguiente;
  }
  if (fragmento === original) return { texto, cambio: false };
  return { texto: texto.slice(0, span.inicio) + fragmento + texto.slice(span.fin), cambio: true };
}

/* Red de seguridad: el texto tocado debe seguir siendo JSON válido, con el pin
 * aplicado y sin ningún otro cambio. Un escritor que no cumple esto no escribe. */
export function validarReescritura(antes, despues, tool, esperado) {
  let a;
  let b;
  try {
    a = JSON.parse(antes);
    b = JSON.parse(despues);
  } catch {
    return 'el resultado no es JSON válido';
  }
  const quitar = valor => {
    const copia = { ...(valor ?? {}) };
    delete copia.commit;
    delete copia.version;
    return copia;
  };
  if (JSON.stringify(quitar(a.tools?.[tool])) !== JSON.stringify(quitar(b.tools?.[tool]))) {
    return 'cambió algo más que commit/version de la herramienta';
  }
  if (esperado.commit && b.tools?.[tool]?.commit !== esperado.commit) return 'el commit no quedó aplicado';
  if (esperado.version && b.tools?.[tool]?.version !== esperado.version) return 'la versión no quedó aplicada';
  const resto = manifiesto => {
    const { tools = {}, ...demas } = manifiesto;
    const { [tool]: descartada, ...otras } = tools;
    return JSON.stringify({ ...demas, tools: otras });
  };
  if (resto(a) !== resto(b)) return 'cambió contenido ajeno a esa herramienta';
  return null;
}
