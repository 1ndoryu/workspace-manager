/* Fixtures y constantes compartidas por los tests de doctor (doctor.*.test.mjs).
 * No tiene tests propios: node:test lo carga y no encuentra ninguno. */
import { existsSync } from 'node:fs';
import { rutaConfigPrivada } from '../../../shared/rutas.mjs';

/* [por que] Tres tests de este fichero validan la config privada REAL (la que
 * declara proyecto-a, proyecto-b y las VPS). Esa config no se versiona, asi
 * que en un clon ajeno no existe: se saltan en vez de fallar, y donde si esta
 * siguen vigilando que el registro concuerde con el taller. */
export const HAY_CONFIG_PRIVADA = existsSync(rutaConfigPrivada('registro.json'));
export const CONFIG_PRIVADA = { skip: HAY_CONFIG_PRIVADA ? false : 'sin config privada (config/registro.json)' };
/* --- 16AA-20: fichas remotas y sus tuneles --------------------------------
 * El doctor clasificaba una ficha con `host` contra puertos locales que no
 * existen (los de la 89), asi que cinco proyectos que sirven 200 en el taller
 * salian en deriva o parados, y sus tuneles ssh sumaban ocho huerfanos
 * «(sin proyecto)». La ficha de abajo copia la de sitio-api del registro. */

export const FICHA = {
  id: 'X',
  host: 'taller-remoto',
  puertos: [3110, 5199, 3102],
  puertosRemotos: [3110, 5199, 20241],
  healths: [
    { puerto: 3110, ruta: '/api/health', esperaJson: true },
    { puerto: 20241, ruta: '/ready', esperaJson: true },
  ],
  tunelSsh: false,
  modo: 'build',
  build: {
    puertos: [3110, 20241],
    puertosLocales: [13110, 12024],
    healths: [{ puerto: 3110, ruta: '/', marcador: '<title>Proyecto Demo' }],
    boton: [['cargo', 'run'], ['cloudflared', 'run']],
    construirFront: [['npm', 'run', 'build']],
  },
};

/* Proceso con la forma que le da `procesosDe`: solo lo que miran los ayudantes. */
export const ssh = (cmd) => ({ creado: true, imagen: 'ssh.exe', cmd });
