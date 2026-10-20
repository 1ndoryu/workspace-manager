/* Reglas del informe `doctor --all` sin lectura de disco ni consola: qué proyectos se
 * clasifican (snapshot + registro) y los criterios de `--assert`. indice.mjs hace la E/S. */

import { isAbsolute, resolve } from 'node:path';

import { RAIZ_REPO, TTL_MS } from './base.mjs';
import { validarMotivo } from './ficha/validacion.mjs';

/* Proyectos a clasificar y ruta de los ignorados. Los del snapshot van primero; las
 * entradas del registro que no estan en el (p. ej. RESTAURANTE) se añaden con su ruta. */
export function proyectosYIgnorados(snapshot, registro) {
  const proyectos = (snapshot?.proyectos ?? []).map((p) => ({ clave: p.clave, ruta: p.ruta }));
  // [por que] El tablero ignora entradas con repo (RESTAURANTE) y no llegan en el
  // snapshot: sin evaluarlas sus puertos salian huerfanos. Se evaluan con su ruta.
  const enSnapshot = new Set(proyectos.map((p) => p.clave));
  for (const e of registro.entradas.values()) {
    if (enSnapshot.has(e.id) || typeof e.ruta !== 'string') continue;
    proyectos.push({ clave: e.id, ruta: isAbsolute(e.ruta) ? e.ruta : resolve(RAIZ_REPO, e.ruta) });
  }
  // [por que] noAplica entra en el pool: opencode-propio-dev (gestion-externa) no
  // esta en ignorados, asi que sus listeners salian huerfanos sin dueño.
  const ignoradosArea = [...(snapshot?.config?.ignorados ?? []), ...Object.keys(registro.noAplica)].map((n) => ({
    clave: n,
    ruta: resolve(RAIZ_REPO, '..', n),
  }));
  return { proyectos, ignoradosArea };
}

/* Criterios de `--assert` sobre el informe. Devuelve la lista de fallos (vacia = pasa). */
export function fallosAssert(informe, proyectos, snapshotEn) {
  const fallos = [];
  if (informe.errorSensor) fallos.push(informe.errorSensor);
  if (informe.proyectos.length !== proyectos.length) {
    fallos.push(`cobertura: clasificados ${informe.proyectos.length} != snapshot ${proyectos.length}`);
  }
  // [por que] Anti-trampa: el enum de motivos rige la INTENCION humana
  // (sin-boton/no-aplica: por que nadie lo gestiona); deriva/bajo-mando/
  // parado llevan EVIDENCIA del sensor (texto libre: que se vio), no intencion.
  // Mezclarlos permitiria esconder proyectos tras 'otro' inventados o
  // motivos vacios. `otro` >20% = el registro dejo de describir el area.
  let otros = 0;
  let clasificados = 0;
  for (const p of informe.proyectos) {
    if (p.estado === 'sin-boton' || p.estado === 'no-aplica') {
      clasificados++;
      try {
        validarMotivo(p.motivo, p.clave);
      } catch (e) {
        fallos.push(e.message);
      }
      if (typeof p.motivo === 'string' && p.motivo.startsWith('otro{')) otros++;
    } else if (p.estado === 'deriva' || p.estado === 'bajo-mando' || p.estado === 'parado') {
      if (typeof p.motivo !== 'string' || p.motivo.length === 0 || p.motivo.length > 200) {
        fallos.push(`${p.clave}: evidencia vacia o excesiva (${p.estado})`);
      }
    } else {
      fallos.push(`${p.clave}: estado desconocido '${p.estado}'`);
    }
  }
  if (clasificados > 0 && otros / clasificados > 0.2) {
    fallos.push(`otro supera 20% (${otros}/${clasificados}): el registro no describe el area`);
  }
  for (const c of informe.compartidos ?? []) {
    fallos.push(`puerto ${c.puerto} compartido: ${c.ids.join(', ')}`);
  }
  if (snapshotEn) {
    const edad = Date.now() - new Date(snapshotEn).getTime();
    if (!(edad >= 0 && edad <= TTL_MS)) fallos.push(`snapshot stale (edad ${Math.round(edad / 1000)}s > TTL)`);
  } else if (proyectos.length > 0) {
    fallos.push('snapshot sin escaneadoEn');
  }
  return fallos;
}
