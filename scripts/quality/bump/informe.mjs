/* Tabla de resultados del propagador (modo texto). */
export function imprimirTabla(filas) {
  const cabecera = ['Proyecto', 'Fam', 'Pin', 'Routers', 'Evid', 'Lock', 'Setup', 'Doctor', 'Iss'];
  const filasTexto = filas.map(fila => [
    fila.proyecto,
    fila.familia,
    fila.pin,
    fila.routers.length
      ? fila.routers.map(router => `${router.estado.slice(0, 4)}`).join('/')
      : '—',
    fila.origen ? fila.origen.slice(0, 4) : '—',
    fila.lock,
    fila.setup,
    fila.doctor,
    fila.issues === null ? '—' : String(fila.issues),
  ]);
  const anchos = cabecera.map((titulo, columna) =>
    Math.max(titulo.length, ...filasTexto.map(fila => fila[columna]?.length ?? 0)),
  );
  const linea = valores => valores.map((valor, columna) => String(valor).padEnd(anchos[columna])).join('  ');
  process.stdout.write(`${linea(cabecera)}\n${linea(anchos.map(ancho => '-'.repeat(ancho)))}\n`);
  for (const fila of filasTexto) process.stdout.write(`${linea(fila)}\n`);
}
