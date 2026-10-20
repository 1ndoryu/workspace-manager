/* Veredicto y salida del doctor: funciones PURAS (sin disco ni red). Calculan el
 * codigo de salida, la tabla de texto y los puertos compartidos sobre datos ya leidos. */

export function codigoSalida(informe) {
  if (informe.errorSensor) return 1;
  if ((informe.compartidos ?? []).length > 0) return 2;
  if ((informe.rust ?? []).length > 0) return 2;
  /* [20AA-7] Igual que rust: exit 2 es degradado visible, no fallo (el
   * servidor parsea el JSON venga el codigo que venga). Un .exe que no embebe
   * el front nuevo es una inconsistencia real del area, no una deriva de
   * fichero de config como derivaEnv. */
  if ((informe.artefactos ?? []).length > 0) return 2;
  if (informe.huerfanos.length > 0) return 2;
  if (informe.proyectos.some((p) => p.estado === 'deriva' || p.estado === 'sin-boton')) return 2;
  return 0;
}


export function tabla(informe) {
  const lineas = ['estado      clave                      motivo'];
  for (const p of informe.proyectos) {
    lineas.push(`${p.estado.padEnd(11)} ${(p.clave ?? '').slice(0, 26).padEnd(26)} ${p.motivo}`);
  }
  for (const h of informe.huerfanos) {
    lineas.push(`deriva      ${h.clave ? `@${h.clave} ` : '(sin proyecto) '}(puerto ${h.puerto} pid ${h.pid}${h.verificado ? '' : ' NO-VERIFICADO'})`);
  }
  for (const c of informe.compartidos ?? []) {
    lineas.push(`aviso       puerto ${c.puerto} compartido: ${c.ids.join(', ')}`);
  }
  for (const r of informe.rust ?? []) {
    lineas.push(`aviso       rust ${r.chequeo} [${r.proyectos.join(', ')}]: ${r.detalle}`);
  }
  for (const a of informe.artefactos ?? []) {
    lineas.push(`aviso       artefacto ${a.proyecto} <- ${a.consumido} [${a.veredicto}]: ${a.detalle}`);
  }
  for (const d of informe.derivaEnv ?? []) {
    lineas.push(`aviso       env ${d.id} ${d.archivo}: ${d.motivo}`);
  }
  if (informe.errorSensor) lineas.push(`ERROR sensor: ${informe.errorSensor}`);
  lineas.push(`tomadoEn=${informe.tomadoEn} snapshotEn=${informe.snapshotEn}`);
  return lineas.join('\n');
}

/* Puertos reclamados por >1 entrada: el mando los DETECTA y degrada (exit 2)
 * en vez de dejar que dos `up` peleen por el mismo puerto. Solo registro
 * interno; un oyente externo (p. ej. 5173 ocupado por opencode-propio) sale
 * como ocupado-desconocido en cada entrada, no aqui. */
export function detectarCompartidos(registro) {
  const porPuerto = new Map();
  for (const e of registro.entradas?.values() ?? []) {
    for (const p of e.puertos ?? []) {
      if (!porPuerto.has(p)) porPuerto.set(p, []);
      porPuerto.get(p).push(e.id);
    }
  }
  return [...porPuerto.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([puerto, ids]) => ({ puerto, ids: [...ids].sort() }))
    .sort((a, b) => a.puerto - b.puerto);
}
