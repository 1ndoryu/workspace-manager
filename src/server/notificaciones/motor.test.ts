/* Pruebas del motor de notificaciones (20AA-25 N0). El motor es puro: no hay red, ni reloj, ni
 * disco, así que cada comportamiento se comprueba con una secuencia de lecturas escritas a mano.
 * Lo que se fija aquí es lo que hace que el sistema no sea un generador de ruido: la primera
 * pasada calla, la amortiguación aguanta un parpadeo y una pasada agrupa. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Entidad, Fuente } from '../../shared/notificaciones/tipos.js';
import { AUSENCIAS_PARA_BAJA, estadoMotorInicial, pasada, type EstadoMotor } from './motor.js';

/* Fuente guionizada: cada llamada a `leer()` devuelve la siguiente lectura, y la última se repite.
 * [por que] Permite escribir «pasada 1 ve A y B; pasada 2 sólo A» sin tocar nada más. */
function fuenteGuion(
  nombre: string,
  lecturas: {
    entidades: Entidad[] | null;
    problema?: string | null;
    /* Lectura parcial (20AA-31): prefijos de clave que esta pasada no alcanza a ver. */
    sinVer?: string[];
    /* Lectura fallida sin lanzar: el motor debe tratarla como rota. */
    sinLectura?: boolean;
  }[],
): Fuente & { llamadas: number } {
  const f = {
    nombre,
    tipoAlta: 'tarea-nueva' as const,
    tipoBaja: 'tarea-completada' as const,
    llamadas: 0,
    leer(): Promise<{
      entidades: Entidad[];
      problema: string | null;
      sinLectura?: boolean;
      sinVer?: string[];
    }> {
      const lectura = lecturas[Math.min(f.llamadas, lecturas.length - 1)];
      f.llamadas += 1;
      if (lectura.entidades === null) return Promise.reject(new Error(lectura.problema ?? 'sin leer'));
      return Promise.resolve({
        entidades: lectura.entidades,
        problema: lectura.problema ?? null,
        sinLectura: lectura.sinLectura,
        sinVer: lectura.sinVer,
      });
    },
  };
  return f;
}

const e = (clave: string): Entidad => ({ clave, titulo: `Título ${clave}`, detalle: 'proyecto-x' });

test('la primera pasada de una fuente es línea base y no emite nada', async () => {
  const f = fuenteGuion('tareas', [{ entidades: [e('a'), e('b'), e('c')] }]);
  const r = await pasada([f], estadoMotorInicial());
  assert.equal(r.avisos.length, 0, 'aparecer por primera vez no es «nuevo», es la foto inicial');
  assert.deepEqual(Object.keys(r.estado.memorias.tareas).sort(), ['a', 'b', 'c']);
  assert.deepEqual(r.rotas, []);
});

test('una entidad que aparece después de la base sí se anuncia, una vez', async () => {
  const f = fuenteGuion('tareas', [{ entidades: [e('a')] }, { entidades: [e('a'), e('b')] }]);
  const primera = await pasada([f], estadoMotorInicial());
  const segunda = await pasada([f], primera.estado);
  assert.equal(segunda.avisos.length, 1);
  assert.equal(segunda.avisos[0].tipo, 'tarea-nueva');
  assert.equal(segunda.avisos[0].clave, 'b');
  assert.equal(segunda.avisos[0].nivel, 'media');
  assert.equal(segunda.avisos[0].leido, false);
});

test('una sola ausencia no declara la baja; la segunda sí', async () => {
  const f = fuenteGuion('tareas', [{ entidades: [e('a')] }, { entidades: [] }, { entidades: [] }]);
  const base = await pasada([f], estadoMotorInicial());
  const dudosa = await pasada([f], base.estado);
  assert.equal(dudosa.avisos.length, 0, 'un ciclo sin datos no puede anunciar una baja');
  assert.ok(dudosa.estado.memorias.tareas.a, 'la entidad sigue en memoria mientras es dudosa');
  assert.equal(dudosa.estado.amortiguaciones.tareas.dudosas.a, 1);

  const baja = await pasada([f], dudosa.estado);
  assert.equal(baja.avisos.length, 1);
  assert.equal(baja.avisos[0].tipo, 'tarea-completada');
  assert.equal(baja.avisos[0].clave, 'a');
  assert.equal(baja.avisos[0].titulo, 'Título a', 'la baja conserva el texto que tenía');
  assert.ok(!baja.estado.memorias.tareas.a, 'tras la baja la entidad sale de memoria');
});

test('una entidad que vuelve antes de la baja no emite nada', async () => {
  const f = fuenteGuion('tareas', [{ entidades: [e('a')] }, { entidades: [] }, { entidades: [e('a')] }]);
  const base = await pasada([f], estadoMotorInicial());
  const dudosa = await pasada([f], base.estado);
  const vuelta = await pasada([f], dudosa.estado);
  assert.equal(vuelta.avisos.length, 0);
  assert.deepEqual(vuelta.estado.amortiguaciones.tareas.dudosas, {}, 'la duda se borra al reaparecer');
});

test('lo de una misma pasada se agrupa por fuente y tipo en un solo aviso contable', async () => {
  const claves = ['a', 'b', 'c', 'd', 'e'];
  const f = fuenteGuion('tareas', [{ entidades: [] }, { entidades: claves.map(e) }]);
  const base = await pasada([f], estadoMotorInicial());
  const r = await pasada([f], base.estado);
  assert.equal(r.avisos.length, 1, 'cinco nuevas son un hecho, no cinco');
  assert.equal(r.avisos[0].agrupados, 5);
  assert.equal(r.avisos[0].titulo, '5 tareas nuevas');
  assert.match(r.avisos[0].detalle, /empezando por «Título /);
});

test('fuentes distintas no se agrupan entre sí aunque coincida el tipo', async () => {
  const a = fuenteGuion('tareas', [{ entidades: [] }, { entidades: [e('x')] }]);
  const b = fuenteGuion('taller', [{ entidades: [] }, { entidades: [e('y')] }]);
  const base = await pasada([a, b], estadoMotorInicial());
  const r = await pasada([a, b], base.estado);
  assert.equal(r.avisos.length, 2);
  assert.deepEqual(r.avisos.map((x) => x.fuente).sort(), ['taller', 'tareas']);
  assert.ok(r.avisos.every((x) => x.agrupados === 1));
});

test('una fuente que falla se informa como rota y su memoria no se toca', async () => {
  const f = fuenteGuion('tareas', [{ entidades: [e('a'), e('b')] }, { entidades: null, problema: 'pulse no contesta' }]);
  const base = await pasada([f], estadoMotorInicial());
  const r = await pasada([f], base.estado);
  assert.equal(r.avisos.length, 0, 'sin lectura no se puede declarar nada desaparecido');
  assert.equal(r.rotas.length, 1);
  assert.equal(r.rotas[0].fuente, 'tareas');
  assert.match(r.rotas[0].problema, /pulse/);
  assert.deepEqual(Object.keys(r.estado.memorias.tareas).sort(), ['a', 'b']);
  assert.ok(r.notas.some((n) => n.includes('pulse no contesta')));
});

test('una fuente rota no impide que las demás emitan sus avisos', async () => {
  const rota = fuenteGuion('tareas', [{ entidades: [] }, { entidades: null, problema: 'caído' }]);
  const sana = fuenteGuion('sitios', [{ entidades: [] }, { entidades: [e('s1')] }]);
  const base = await pasada([rota, sana], estadoMotorInicial());
  const r = await pasada([rota, sana], base.estado);
  assert.equal(r.rotas.length, 1);
  assert.equal(r.avisos.length, 1);
  assert.equal(r.avisos[0].fuente, 'sitios');
});

test('una fuente que devuelve problema pero datos buenos emite y además se anota', async () => {
  const f = fuenteGuion('sitios', [
    { entidades: [] },
    { entidades: [e('s1')], problema: 'el 66 respondió lento' },
  ]);
  const base = await pasada([f], estadoMotorInicial());
  const r = await pasada([f], base.estado);
  assert.equal(r.rotas.length, 0, 'leyó: no está rota');
  assert.equal(r.avisos.length, 1);
  assert.ok(r.notas.some((n) => n.includes('respondió lento')));
});

test('los ids son monótonos entre pasadas y únicos', async () => {
  const f = fuenteGuion('tareas', [
    { entidades: [] },
    { entidades: [e('a')] },
    { entidades: [] },
    { entidades: [] },
    { entidades: [e('b')] },
  ]);
  let estado = estadoMotorInicial();
  const ids: number[] = [];
  for (let i = 0; i < 5; i += 1) {
    const r = await pasada([f], estado);
    estado = r.estado;
    ids.push(...r.avisos.map((a) => a.id));
  }
  assert.deepEqual(ids, [1, 2, 3], 'dos altas y una baja, sin huecos ni repeticiones');
  assert.equal(estado.ultimoId, 3);
});

test('el estado del motor sobrevive a un viaje por JSON sin duplicar avisos', async () => {
  const f = fuenteGuion('tareas', [{ entidades: [e('a')] }, { entidades: [e('a'), e('b')] }, { entidades: [e('a'), e('b')] }]);
  const base = await pasada([f], estadoMotorInicial());
  const conNuevo = await pasada([f], base.estado);
  assert.equal(conNuevo.avisos.length, 1);
  /* Reinicio del servidor a mitad: el estado va al disco y vuelve. */
  const recuperado = JSON.parse(JSON.stringify(conNuevo.estado)) as EstadoMotor;
  const tras = await pasada([f], recuperado);
  assert.equal(tras.avisos.length, 0, 'releer lo mismo no puede repetir el aviso');
});

test('lo que la lectura no alcanzó a ver no se da de baja y vuelve sin ser nuevo', async () => {
  /* Caso real (20AA-31): el proyecto pierde su análisis por frescura y su problema desaparece de
   * la consola dos pasadas seguidas. Sin `sinVer` se anunciaba «resuelto» y luego «nuevo». */
  const f = fuenteGuion('problemas', [
    { entidades: [e('PROYECTO|sentinel|x'), e('OTRO|sentinel|y')] },
    { entidades: [e('OTRO|sentinel|y')], sinVer: ['PROYECTO|'] },
    { entidades: [e('OTRO|sentinel|y')], sinVer: ['PROYECTO|'] },
    { entidades: [e('PROYECTO|sentinel|x'), e('OTRO|sentinel|y')] },
  ]);
  let estado = estadoMotorInicial();
  for (let i = 0; i < 3; i += 1) {
    const r = await pasada([f], estado);
    estado = r.estado;
    assert.equal(r.avisos.length, 0, `pasada ${i + 1}: no hay transición real que anunciar`);
  }
  assert.ok(estado.memorias.problemas['PROYECTO|sentinel|x'], 'la clave sin ver sigue en memoria');
  const vuelta = await pasada([f], estado);
  assert.equal(vuelta.avisos.length, 0, 'volver a verla no la convierte en nueva');
});

test('una lectura parcial no silencia las bajas de lo que sí se miró', async () => {
  const f = fuenteGuion('problemas', [
    { entidades: [e('PROYECTO|sentinel|x'), e('OTRO|sentinel|y')] },
    { entidades: [], sinVer: ['PROYECTO|'] },
    { entidades: [], sinVer: ['PROYECTO|'] },
  ]);
  const base = await pasada([f], estadoMotorInicial());
  const dudosa = await pasada([f], base.estado);
  const baja = await pasada([f], dudosa.estado);
  assert.equal(baja.avisos.length, 1);
  assert.equal(baja.avisos[0].clave, 'OTRO|sentinel|y', 'lo mirado y ausente sí baja');
  assert.ok(baja.estado.memorias.problemas['PROYECTO|sentinel|x']);
  assert.ok(!baja.estado.memorias.problemas['OTRO|sentinel|y']);
});

test('`sinLectura` sin excepción se trata igual que una fuente rota', async () => {
  const f = fuenteGuion('sitios', [
    { entidades: [e('s1')] },
    { entidades: [], problema: 'no se pudo leer', sinLectura: true },
  ]);
  const base = await pasada([f], estadoMotorInicial());
  const r = await pasada([f], base.estado);
  assert.equal(r.avisos.length, 0, 'no leer no es «ya no hay nada»');
  assert.equal(r.rotas.length, 1);
  assert.deepEqual(Object.keys(r.estado.memorias.sitios), ['s1']);
});

test('AUSENCIAS_PARA_BAJA coincide con lo que aplica el motor', async () => {
  assert.equal(AUSENCIAS_PARA_BAJA, 2);
  const f = fuenteGuion('tareas', [{ entidades: [e('a')] }, { entidades: [] }, { entidades: [] }]);
  const base = await pasada([f], estadoMotorInicial());
  let estado = base.estado;
  const tipos: string[] = [];
  for (let i = 0; i < 2; i += 1) {
    const r = await pasada([f], estado);
    estado = r.estado;
    tipos.push(...r.avisos.map((a) => a.tipo));
  }
  assert.deepEqual(tipos, ['tarea-completada']);
});
