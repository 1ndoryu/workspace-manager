/* Publica un dev server en `<proyecto>-dev.wandori.us` por el túnel `taller-89-dev`.
 * Por defecto solo lee y muestra el plan. `--aplicar` escribe en Cloudflare y en registro.json.
 *   node scripts/dev/publicar-host.mjs <host> --puerto <n> [--proyecto <id>] [--copiar-acceso <host>] [--aplicar]
 *   … --repuntar: cambia el destino de un host YA publicado (p. ej. al pasar la ficha a modo build, que
 *   sirve en otro puerto). Sin la bandera, un host existente con otro destino es un error: publicar dos
 *   veces el mismo nombre por descuido pisaría lo que ya funciona. No toca DNS ni Access: solo la regla
 *   de ingress del túnel, y el CNAME ya apunta a él.
 * [por que] Orden al aplicar: Access, ingress, DNS. Así ningún host resuelve antes de tener app de Access
 * (la app nueva sin política deniega todo). Un nivel por host: Universal SSL no cubre `x.dev.wandori.us`.
 * Token fuera del repo: CLOUDFLARE_API_TOKEN o ~/.cloudflare/dev-publico.token. */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CUENTA = 'adb83ea98dfe13362aebca91c42ed9c5';
export const TUNEL_NOMBRE = 'taller-89-dev';
export const ZONA_NOMBRE = 'wandori.us';
const API = 'https://api.cloudflare.com/client/v4';
const REGISTRO = join(dirname(fileURLToPath(import.meta.url)), 'registro.json');
const CATCH_ALL = { service: 'http_status:404' };

export function validarHost(host) {
  if (!/^[a-z0-9](?:[a-z0-9-]{0,40}[a-z0-9])?-dev\.wandori\.us$/.test(host ?? '')) {
    throw new Error(`host "${host}": formato <proyecto>-dev.wandori.us (un nivel, sufijo -dev)`);
  }
  return host;
}

export function validarPuerto(valor) {
  const n = Number(valor);
  if (!Number.isInteger(n) || n < 1024 || n > 65535) throw new Error(`puerto "${valor}": entero entre 1024 y 65535`);
  return n;
}

// Regla nueva antes del catch-all. Misma regla ya presente = nada que hacer; otro destino = conflicto
// (o repunte, si se pidió con `--repuntar`).
export function planificarIngress(ingress, host, puerto, { repuntar = false } = {}) {
  const servicio = `http://127.0.0.1:${puerto}`;
  const ajenas = ingress.filter((r) => !r.hostname && r.service !== CATCH_ALL.service);
  if (ajenas.length) throw new Error('el túnel tiene reglas sin hostname distintas del catch-all; no las reescribo');
  const reglas = ingress.filter((r) => r.hostname);
  const existente = reglas.find((r) => r.hostname === host);
  if (existente) {
    if (existente.service === servicio) return { accion: 'ya', ingress };
    if (!repuntar) throw new Error(`${host} ya apunta a ${existente.service} en el túnel; cámbialo a mano o usa otro host (o --repuntar)`);
    return {
      accion: 'repuntar',
      de: existente.service,
      ingress: reglas.map((r) => (r.hostname === host ? { ...r, service: servicio } : r)).concat(CATCH_ALL),
    };
  }
  return { accion: 'crear', ingress: [...reglas, { hostname: host, service: servicio }, CATCH_ALL] };
}

export function planificarDns(registros, host, destino) {
  if (registros.length === 0) return { accion: 'crear' };
  const [r] = registros;
  if (registros.length === 1 && r.type === 'CNAME' && r.content === destino && r.proxied) return { accion: 'ya' };
  throw new Error(`${host} ya tiene DNS distinto (${registros.map((x) => `${x.type} ${x.content}`).join(', ')}); no lo sobrescribo`);
}

export function planificarAccess(apps, host) {
  const app = apps.find((a) => a.domain === host);
  if (!app) return { accion: 'crear' };
  if (app.type === 'self_hosted') return { accion: 'ya', app };
  throw new Error(`${host} tiene una app de Access tipo ${app.type}; revísala a mano`);
}

// Sustituye el ítem i de una lista ya serializada sin tocar su formato (sangrías, saltos de línea):
// el registro se lee a mano, y colapsar una lista multilínea ensucia el diff de todo el fichero.
function reemplazarItem(inner, i, valor) {
  const piezas = inner.split(',');
  const crudo = piezas[i];
  piezas[i] = `${/^\s*/.exec(crudo)[0]}${valor}${/\s*$/.exec(crudo)[0]}`;
  return piezas.join(',');
}

// `hostsPublicos` y `puertosPublicos` se leen en paralelo (el host i es el del puerto i), así que un
// host ya declarado **conserva su índice** y lo que cambia es el puerto: al pasar la ficha a modo
// build el mismo nombre sirve en otro puerto local. Añadirlo al final dejaría el host sin puerto.
function fijarPuerto(bloque, host, puerto) {
  const mHosts = /"hostsPublicos": \[([^\]]*)\]/.exec(bloque);
  if (!mHosts) throw new Error('falta "hostsPublicos" en el proyecto del registro; añádelo a mano');
  const mPuertos = /"puertosPublicos": \[([^\]]*)\]/.exec(bloque);
  if (!mPuertos) throw new Error('falta "puertosPublicos" en el proyecto del registro; añádelo a mano');
  const items = (txt) => txt.split(',').map((s) => s.trim()).filter(Boolean);
  const hosts = items(mHosts[1]);
  const i = hosts.indexOf(`"${host}"`);
  const hostsTxt = i < 0 ? [...hosts, `"${host}"`].join(', ') : mHosts[1];
  let puertosTxt;
  if (i < 0) puertosTxt = [...items(mPuertos[1]), String(puerto)].join(', ');
  else if (i < items(mPuertos[1]).length) puertosTxt = reemplazarItem(mPuertos[1], i, String(puerto));
  else puertosTxt = `${mPuertos[1].replace(/\s+$/, '')}, ${puerto}`;
  return bloque
    .replace(/"hostsPublicos": \[[^\]]*\]/, `"hostsPublicos": [${hostsTxt}]`)
    .replace(/"puertosPublicos": \[[^\]]*\]/, `"puertosPublicos": [${puertosTxt}]`);
}

export function actualizarRegistro(texto, proyecto, host, puerto) {
  const inicio = texto.indexOf(`"id": "${proyecto}"`);
  if (inicio < 0) throw new Error(`proyecto "${proyecto}" no está en registro.json`);
  const siguiente = texto.indexOf('"id": "', inicio + 1);
  const fin = siguiente < 0 ? texto.length : siguiente;
  const nuevo = texto.slice(0, inicio) + fijarPuerto(texto.slice(inicio, fin), host, puerto) + texto.slice(fin);
  JSON.parse(nuevo);
  return nuevo;
}

export function leerToken(env = process.env, home = homedir()) {
  if (env.CLOUDFLARE_API_TOKEN?.trim()) return env.CLOUDFLARE_API_TOKEN.trim();
  const archivo = join(home, '.cloudflare', 'dev-publico.token');
  if (existsSync(archivo)) return readFileSync(archivo, 'utf8').trim();
  throw new Error('falta el token: define CLOUDFLARE_API_TOKEN o crea ~/.cloudflare/dev-publico.token');
}

async function cf(token, metodo, ruta, cuerpo) {
  const res = await fetch(`${API}${ruta}`, {
    method: metodo,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    const msg = (json.errors ?? []).map((e) => e.message).join('; ') || `HTTP ${res.status}`;
    throw new Error(`Cloudflare ${metodo} ${ruta}: ${msg}`);
  }
  return json.result;
}

const ETIQUETA = { ya: 'ya existe', crear: 'crear', repuntar: 'repuntar' };

export async function main(argv = process.argv.slice(2), { log = console.log } = {}) {
  const host = validarHost(argv[0]);
  const valorDe = (flag, por) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : por);
  const puerto = validarPuerto(valorDe('--puerto'));
  const proyecto = valorDe('--proyecto', null);
  const referencia = valorDe('--copiar-acceso', 'mn-dev.wandori.us');
  const aplicar = argv.includes('--aplicar');
  const repuntar = argv.includes('--repuntar');
  const token = leerToken();

  const [tunel] = await cf(token, 'GET', `/accounts/${CUENTA}/cfd_tunnel?name=${TUNEL_NOMBRE}&is_deleted=false`);
  if (!tunel) throw new Error(`no existe el túnel ${TUNEL_NOMBRE}`);
  const [zona] = await cf(token, 'GET', `/zones?name=${ZONA_NOMBRE}`);
  const apps = await cf(token, 'GET', `/accounts/${CUENTA}/access/apps?per_page=100`);
  const config = (await cf(token, 'GET', `/accounts/${CUENTA}/cfd_tunnel/${tunel.id}/configurations`)).config;
  const registros = await cf(token, 'GET', `/zones/${zona.id}/dns_records?name=${host}`);

  const ing = planificarIngress(config.ingress ?? [], host, puerto, { repuntar });
  const acc = planificarAccess(apps, host);
  const destino = `${tunel.id}.cfargotunnel.com`;
  const dns = planificarDns(registros, host, destino);

  let registroTexto = null;
  let reg = { accion: 'omitido' };
  if (proyecto) {
    const actual = readFileSync(REGISTRO, 'utf8');
    registroTexto = actualizarRegistro(actual, proyecto, host, puerto);
    reg = { accion: registroTexto === actual ? 'ya' : actual.includes(`"${host}"`) ? 'repuntar' : 'crear' };
  }

  log(`Host ${host} → http://127.0.0.1:${puerto} (túnel ${TUNEL_NOMBRE})`);
  log(`  1. Access app      : ${ETIQUETA[acc.accion]} (política copiada de ${referencia})`);
  log(`  2. Ingress         : ${ETIQUETA[ing.accion]}${ing.accion === 'repuntar' ? ` (${ing.de} → http://127.0.0.1:${puerto})` : ''}`);
  log(`  3. DNS CNAME       : ${ETIQUETA[dns.accion]} → ${destino} (proxied)`);
  log(`  4. registro.json   : ${reg.accion === 'omitido' ? 'omitido (sin --proyecto)' : ETIQUETA[reg.accion]}`);

  const pendiente = [acc, ing, dns, reg].some((p) => p.accion === 'crear' || p.accion === 'repuntar');
  if (!aplicar) {
    log(pendiente
      ? `Simulación: no se ha cambiado nada. Para aplicar: añade --aplicar (cambia DNS; avisar a la usuaria antes).`
      : 'Nada que cambiar: el host ya está publicado.');
    return;
  }
  if (!pendiente) return log('Nada que cambiar.');

  if (acc.accion === 'crear') {
    const referenciaApp = apps.find((a) => a.domain === referencia);
    if (!referenciaApp) throw new Error(`no encuentro la app de referencia ${referencia}`);
    const politicas = await cf(token, 'GET', `/accounts/${CUENTA}/access/apps/${referenciaApp.id}/policies`);
    const permitida = politicas.find((p) => p.decision === 'allow');
    if (!permitida) throw new Error(`${referencia} no tiene política allow que copiar`);
    const app = await cf(token, 'POST', `/accounts/${CUENTA}/access/apps`, {
      name: host, domain: host, type: 'self_hosted', session_duration: '24h',
    });
    // Sin política la app deniega todo: si falla este paso, el host queda cerrado.
    await cf(token, 'POST', `/accounts/${CUENTA}/access/apps/${app.id}/policies`, {
      name: 'Acceso del propietario', decision: 'allow', precedence: 1, include: permitida.include,
    });
    log(`✓ Access app ${host} creada con política allow`);
  }
  if (ing.accion === 'crear' || ing.accion === 'repuntar') {
    await cf(token, 'PUT', `/accounts/${CUENTA}/cfd_tunnel/${tunel.id}/configurations`, {
      config: { ...config, ingress: ing.ingress },
    });
    log(ing.accion === 'crear' ? `✓ Ingress: regla ${host} añadida` : `✓ Ingress: ${host} ${ing.de} → http://127.0.0.1:${puerto}`);
  }
  if (dns.accion === 'crear') {
    await cf(token, 'POST', `/zones/${zona.id}/dns_records`, { type: 'CNAME', name: host, content: destino, proxied: true, ttl: 1 });
    log(`✓ DNS: CNAME ${host} creado`);
  }
  if (registroTexto && reg.accion !== 'ya') {
    const tmp = `${REGISTRO}.tmp`;
    writeFileSync(tmp, registroTexto);
    renameSync(tmp, REGISTRO);
    log(`✓ registro.json: ${host} → puerto ${puerto} en ${proyecto}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((e) => {
    console.error(`publicar-host: ${e.message}`);
    process.exitCode = 1;
  });
}
