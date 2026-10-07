/* Mando de la consola de problemas (07AA-1 F2): reproduce por CLI el
 * `problemas (N)` de la cabecera con desglose por proyecto y categoria.
 * [por que] El N solo lo calculaba el navegador desde 4 fuentes; este mando
 * consume el agregado del servidor (GET /api/consola/problemas) e itera
 * `proyectos` de la respuesta: nunca se hardcodea ni se pide una clave
 * (`--proyecto` es solo filtro de visualizacion, jamas requisito).
 * Solo lectura por defecto; `--forzar` re-escanea (tarda minutos).
 * Sin backend, rehusa a ciegas (exit 1), igual que status/up/stop. */
const API = process.env.WM_API ?? 'http://127.0.0.1:8787';

function ayuda() {
  console.log(`uso: consola [--forzar] [--categoria <cat>] [--proyecto <clave>] [--json]
  sin backend 8787: rehusa (exit 1), no inventa numeros`);
}

export async function problemas(argv) {
  const args = argv ?? process.argv.slice(2);
  if (args.includes('--ayuda') || args.includes('-h')) {
    ayuda();
    return 0;
  }
  const forzar = args.includes('--forzar');
  const iCat = args.indexOf('--categoria');
  const categoria = iCat >= 0 ? args[iCat + 1] : undefined;
  const iProy = args.indexOf('--proyecto');
  const soloProyecto = iProy >= 0 ? args[iProy + 1] : undefined;
  const comoJson = args.includes('--json');

  let resp;
  try {
    resp = await fetch(`${API}/api/consola/problemas${forzar ? '?forzar=1' : ''}`);
  } catch (e) {
    console.error(`consola: backend 8787 sin respuesta (${e?.message ?? e})`);
    return 1;
  }
  if (!resp.ok) {
    console.error(`consola: backend respondio ${resp.status}`);
    return 1;
  }
  const data = await resp.json();
  if (comoJson) {
    console.log(JSON.stringify(data, null, 2));
    return 0;
  }
  let grupos = data.proyectos ?? [];
  if (soloProyecto) grupos = grupos.filter((g) => g.clave === soloProyecto);
  if (categoria) {
    grupos = grupos
      .map((g) => ({ ...g, entradas: g.entradas.filter((e) => e.categoria === categoria) }))
      .filter((g) => g.entradas.length > 0);
  }
  const total = grupos.reduce((n, g) => n + g.entradas.length, 0);
  console.log(`problemas (${total})`);
  for (const g of grupos) {
    console.log(`${g.clave || '(puertos sin proyecto)'} [${g.id}] = ${g.entradas.length}`);
    for (const e of g.entradas) console.log(`  [${e.categoria}] ${e.motivo}`);
  }
  const v = data.vigencia ?? {};
  console.log(`vigencia: snapshot ${v.snapshotEn ?? '?'} · dev ${v.devEn ?? '?'}`);
  return 0;
}

const esCli = (process.argv[1] ?? '').replace(/\\/g, '/').endsWith('/scripts/dev/consola.mjs');
if (esCli) {
  problemas().then(
    (c) => process.exit(c),
    (e) => {
      console.error(`consola: ${e?.message ?? e}`);
      process.exit(1);
    },
  );
}
