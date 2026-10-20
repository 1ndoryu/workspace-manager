/* Comparacion PURA de los dos arboles de esquema (runtime vs curacion): falta, sobra o
 * cambio por ruta. No lee ni escribe nada. */

function gruposCompatibles(a, b) {
  const scalar = new Set(['string', 'number', 'boolean']);
  if (scalar.has(a) && scalar.has(b)) return true;
  return a === b;
}

function comparar(rt, cu, ruta, out) {
  /* Si la curacion modela el nivel como mapa/mapaCatalogo, cubre cualquier
   * clave (p.ej. analyzers, rules, directCommands): no se comparan llaves
   * hijas y no hay FALTAN por claves del runtime. Sigue siendo compatible si
   * el runtime expone un objeto o un Record en ese punto. */
  if (cu.forma === 'mapa' || cu.forma === 'recursivo') return;
  /* Objetos: comparar presencia y forma de las claves hijas. */
  if (rt.forma === 'objeto' && cu.forma === 'objeto') {
    for (const k of Object.keys(rt.hijos ?? {})) {
      const rutaK = ruta ? `${ruta}.${k}` : k;
      const hijoRt = rt.hijos[k];
      const hijoCu = cu.hijos?.[k];
      /* Un mapa del runtime (Record<...>) es mas general que un objeto de la
       * curacion: no se compara recursivamente. */
      if (hijoRt.forma === 'mapa') continue;
      if (hijoCu) comparar(hijoRt, hijoCu, rutaK, out);
      else out.push({ tipo: 'falta', ruta: rutaK, rt: hijoRt.forma });
    }
    for (const k of Object.keys(cu.hijos ?? {})) {
      const rutaK = ruta ? `${ruta}.${k}` : k;
      if (!(k in (rt.hijos ?? {}))) out.push({ tipo: 'sobra', ruta: rutaK, cu: cu.hijos[k].forma });
    }
    return;
  }
  /* Comparar forma de las hojas / ramas no-objeto. */
  if (!gruposCompatibles(rt.forma, cu.forma)) {
    out.push({ tipo: 'cambio', ruta, rt: rt.forma, cu: cu.forma });
  }
}

export function compararEsquemas(rt, cu) {
  const out = [];
  comparar({ forma: 'objeto', hijos: rt }, { forma: 'objeto', hijos: cu }, '', out);
  return out;
}
