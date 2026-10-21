/* Pruebas del servicio y de sus rutas (20AA-25 N2). Se monta un servidor HTTP de verdad en un
 * puerto efímero: lo que hay que probar es el contrato de la entrega (cabeceras SSE, orden de la
 * historia, reconexión, códigos de error), no una función suelta.
 * El motor y el almacén ya tienen sus pruebas: aquí las fuentes son de mentira y lo único que
 * cuenta es qué llega al cliente. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Entidad, Fuente } from '../../shared/notificaciones/tipos.js';
import { crearServicioNotificaciones, type ServicioNotificaciones } from './notificaciones.js';
import { crearManejadorNotificaciones } from './rutasNotificaciones.js';

/* Fuente controlable desde la prueba: `estado` es la lista de entidades de la próxima lectura. */
interface FuenteFalsa extends Fuente {
  estado: Entidad[];
  fallar: boolean;
}

function fuenteFalsa(nombre = 'tareas'): FuenteFalsa {
  const f: FuenteFalsa = {
    nombre,
    tipoAlta: 'tarea-nueva',
    tipoBaja: 'tarea-completada',
    estado: [],
    fallar: false,
    leer: async () => {
      if (f.fallar) throw new Error('sin lectura');
      return { entidades: f.estado, problema: null };
    },
  };
  return f;
}

const e = (clave: string): Entidad => ({ clave, titulo: `Tarea ${clave}`, detalle: 'wm' });

/* Servicio + servidor en un puerto efímero. Devuelve también la limpieza. */
async function montar(fuentes: Fuente[] = []): Promise<{
  servicio: ServicioNotificaciones;
  base: string;
  cerrar: () => Promise<void>;
}> {
  const dir = mkdtempSync(join(tmpdir(), 'notif-'));
  const servicio = crearServicioNotificaciones({
    rutaFichero: join(dir, 'notificaciones.json'),
    fuentes,
    /* Calma mínima: las pruebas no esperan ventanas. */
    calmaMs: 1,
    latidoMs: 60_000,
  });
  const manejar = crearManejadorNotificaciones(servicio);
  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://x');
    void manejar(req, res, url, url.pathname).then((atendida) => {
      if (!atendida) {
        res.writeHead(404).end('no');
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const dir0 = server.address();
  const puerto = typeof dir0 === 'object' && dir0 !== null ? dir0.port : 0;
  return {
    servicio,
    base: `http://127.0.0.1:${puerto}`,
    cerrar: async () => {
      await servicio.detener();
      /* Un canal SSE abierto impide que `close` llame de vuelta: se cortan las conexiones vivas
       * antes de esperar al cierre. */
      server.closeAllConnections?.();
      await new Promise<void>((r) => server.close(() => r()));
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

test('la primera pasada es línea base: no hay avisos aunque haya tareas', async () => {
  const f = fuenteFalsa();
  f.estado = [e('a'), e('b')];
  const { servicio, cerrar } = await montar([f]);
  try {
    const avisos = await servicio.correr();
    assert.deepEqual(avisos, []);
    assert.equal(servicio.estado().avisos.length, 0);
  } finally {
    await cerrar();
  }
});

test('GET /api/notificaciones devuelve el estado y los tipos de 405', async () => {
  const { base, cerrar } = await montar([]);
  try {
    const r = await fetch(`${base}/api/notificaciones`);
    assert.equal(r.status, 200);
    const cuerpo = (await r.json()) as { avisos: unknown[]; preferencias: { silenciados: string[] } };
    assert.deepEqual(cuerpo.avisos, []);
    assert.deepEqual(cuerpo.preferencias.silenciados, []);

    const malo = await fetch(`${base}/api/notificaciones`, { method: 'DELETE' });
    assert.equal(malo.status, 405);
  } finally {
    await cerrar();
  }
});

test('una tarea nueva tras la base llega por GET y por el canal SSE', async () => {
  const f = fuenteFalsa();
  f.estado = [e('a')];
  const { servicio, base, cerrar } = await montar([f]);
  try {
    await servicio.correr();
    f.estado = [e('a'), e('b')];

    /* Se abre el canal ANTES de la pasada: el aviso tiene que llegar en vivo. */
    const ctrl = new AbortController();
    const respuesta = await fetch(`${base}/api/notificaciones/eventos`, { signal: ctrl.signal });
    assert.equal(respuesta.status, 200);
    assert.match(respuesta.headers.get('content-type') ?? '', /text\/event-stream/);
    const lector = respuesta.body!.getReader();
    const dec = new TextDecoder();

    await servicio.correr();
    const { value } = await Promise.race([
      lector.read(),
      new Promise<never>((_, rechaza) => setTimeout(() => rechaza(new Error('el aviso no llegó por el canal')), 2000)),
    ]);
    const texto = dec.decode(value);
    assert.match(texto, /event: aviso/);
    assert.match(texto, /Tarea b/);
    ctrl.abort();

    const estado = (await (await fetch(`${base}/api/notificaciones`)).json()) as { avisos: { titulo: string; leido: boolean }[] };
    assert.equal(estado.avisos.length, 1);
    assert.equal(estado.avisos[0].leido, false);
  } finally {
    await cerrar();
  }
});

test('el canal manda la historia al conectar y respeta Last-Event-ID al reconectar', async () => {
  const f = fuenteFalsa();
  f.estado = [];
  const { servicio, base, cerrar } = await montar([f]);
  try {
    await servicio.correr();
    f.estado = [e('a')];
    await servicio.correr();
    f.estado = [e('a'), e('b')];
    await servicio.correr();
    const ids = servicio.estado().avisos;
    assert.equal(ids.length, 2);
    const [nuevo, viejo] = ids;

    /* Sin cabecera: las dos, de la más vieja a la más nueva (es el orden en que se pintan). */
    const todas = await leerCanal(`${base}/api/notificaciones/eventos`);
    assert.deepEqual(
      todas.filter((l) => l.startsWith('id:')),
      [`id: ${viejo.id}`, `id: ${nuevo.id}`],
    );

    /* Con Last-Event-ID del primero: sólo el segundo. */
    const resto = await leerCanal(`${base}/api/notificaciones/eventos`, { 'last-event-id': String(viejo.id) });
    assert.deepEqual(
      resto.filter((l) => l.startsWith('id:')),
      [`id: ${nuevo.id}`],
    );
  } finally {
    await cerrar();
  }
});

test('sin-historia no suelta la historia: sólo dice en qué id va', async () => {
  const f = fuenteFalsa();
  f.estado = [];
  const { servicio, base, cerrar } = await montar([f]);
  try {
    await servicio.correr();
    f.estado = [e('a'), e('b')];
    await servicio.correr();
    const ultimo = servicio.estado().avisos[0].id;

    const lineas = await leerCanal(`${base}/api/notificaciones/eventos?sin-historia=1`);
    assert.equal(lineas.filter((l) => l.startsWith('event: aviso')).length, 0, 'el toast no repite la historia');
    assert.ok(lineas.includes('event: sinc'));
    assert.ok(lineas.some((l) => l.includes(`"id":${ultimo}`)));
  } finally {
    await cerrar();
  }
});

test('POST leidas marca todas o sólo las indicadas, y valida', async () => {
  const f = fuenteFalsa();
  f.estado = [];
  const { servicio, base, cerrar } = await montar([f]);
  try {
    await servicio.correr();
    /* Una por pasada: dos en la misma pasada se agruparían en un solo aviso contable, que es lo
     * correcto pero no sirve para probar «marca sólo éste». */
    f.estado = [e('a')];
    await servicio.correr();
    f.estado = [e('a'), e('b')];
    await servicio.correr();
    const [masNuevo, masViejo] = servicio.estado().avisos;
    assert.ok(masNuevo && masViejo, 'la pasada emitió los dos avisos');

    const una = await fetch(`${base}/api/notificaciones/leidas`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ids: [masViejo.id] }),
    });
    assert.equal(una.status, 200);
    const tras = servicio.estado().avisos;
    assert.equal(tras.find((a) => a.id === masViejo.id)?.leido, true);
    assert.equal(tras.find((a) => a.id === masNuevo.id)?.leido, false);

    const todas = await fetch(`${base}/api/notificaciones/leidas`, { method: 'POST', body: '{}' });
    assert.equal(todas.status, 200);
    assert.ok(servicio.estado().avisos.every((a) => a.leido));

    const invalido = await fetch(`${base}/api/notificaciones/leidas`, {
      method: 'POST',
      body: JSON.stringify({ ids: 'todo' }),
    });
    assert.equal(invalido.status, 400);
  } finally {
    await cerrar();
  }
});

test('GET /api/notificaciones/preferencias sólo trae los tipos silenciados', async () => {
  const f = fuenteFalsa();
  const { servicio, base, cerrar } = await montar([f]);
  try {
    servicio.silenciar(['sitio-caido', 'problema-detectado']);
    const r = await fetch(`${base}/api/notificaciones/preferencias`);
    assert.equal(r.status, 200);
    /* [por que importa] El toast del sistema pregunta esto antes de pintar cada aviso; si
     * viniera el estado entero serían 500 avisos para leer una lista corta. */
    assert.deepEqual(await r.json(), { silenciados: ['sitio-caido', 'problema-detectado'] });

    const malo = await fetch(`${base}/api/notificaciones/preferencias`, { method: 'POST' });
    assert.equal(malo.status, 405);
  } finally {
    await cerrar();
  }
});

test('POST silenciar guarda los tipos y rechaza los inventados', async () => {
  const f = fuenteFalsa();
  const { servicio, base, cerrar } = await montar([f]);
  try {
    const ok = await fetch(`${base}/api/notificaciones/silenciar`, {
      method: 'POST',
      body: JSON.stringify({ tipos: ['sitio-caido'] }),
    });
    assert.equal(ok.status, 200);
    assert.deepEqual(servicio.estado().preferencias.silenciados, ['sitio-caido']);

    const malo = await fetch(`${base}/api/notificaciones/silenciar`, {
      method: 'POST',
      body: JSON.stringify({ tipos: ['inventado'] }),
    });
    assert.equal(malo.status, 400);
  } finally {
    await cerrar();
  }
});

test('una ruta hermana desconocida no se queda en el 404 de la app', async () => {
  const { base, cerrar } = await montar([]);
  try {
    const r = await fetch(`${base}/api/notificaciones/inventada`);
    assert.equal(r.status, 405, 'es hermana de las conocidas: se dice que no se atiende así');
  } finally {
    await cerrar();
  }
});

test('sin suscriptores no hay latido; con uno, sí, y la baja lo apaga', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'notif-'));
  const servicio = crearServicioNotificaciones({ rutaFichero: join(dir, 'n.json'), fuentes: [fuenteFalsa()], latidoMs: 5 });
  try {
    const baja = servicio.suscribir(() => undefined);
    /* El latido abre pasadas; con la fuente vacía no emite, pero el servicio no se cae. */
    await new Promise((r) => setTimeout(r, 30));
    baja();
    await new Promise((r) => setTimeout(r, 20));
    await servicio.detener();
    assert.ok(true, 'sin excepciones');
  } finally {
    await servicio.detener();
    rmSync(dir, { recursive: true, force: true });
  }
});

/* Abre el canal, junta lo que llegue durante `ms` y lo cierra. [por que se corta por tiempo y no
 * al ver un bloque] La historia sale en varias escrituras y el canal no termina nunca solo: cortar
 * al primer `\n\n` dejaba fuera los bloques siguientes. El plazo es corto y fijo, así que la
 * prueba dura lo mismo pase lo que pase. */
async function leerCanal(url: string, cabeceras: Record<string, string> = {}, ms = 250): Promise<string[]> {
  const ctrl = new AbortController();
  const r = await fetch(url, { headers: cabeceras, signal: ctrl.signal });
  const lector = r.body!.getReader();
  const dec = new TextDecoder();
  let texto = '';
  const fin = Date.now() + ms;
  while (Date.now() < fin) {
    const leido = await Promise.race([
      lector.read(),
      /* Plazo: el canal no cierra solo, así que hay que dejar de esperar. */
      new Promise<null>((r2) => setTimeout(() => r2(null), Math.max(0, fin - Date.now()))),
    ]);
    if (leido === null || leido.done) break;
    texto += dec.decode(leido.value);
  }
  ctrl.abort();
  return texto.split('\n').filter((l) => l.trim() !== '' && l !== ': latido');
}
