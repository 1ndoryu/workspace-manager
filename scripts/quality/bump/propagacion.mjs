/* Propaga el release a un consumidor: router, pin, lock, evidencia y doctor. */
import fs from 'node:fs';
import { hostname } from 'node:os';
import path from 'node:path';
import { conPasos, escribir, escribirRouters } from './ajustes.mjs';
import { familiaDe, revisarRouters } from './consumidores.mjs';
import { reescribirPin, validarReescritura } from './manifiesto.mjs';
import { pasosDe } from './release.mjs';
import { cargarTaller, decidirDonde, dirRemotoDe, dirRemotoDeHerramienta, ejecutarEnVps, mensajeSinVps } from '../../shared/vps.mjs';
import { comando, ejecutar, leerJson, leerJsonDeTexto, primeraLineaUtil } from './utilidades.mjs';

/* Issues que aparecen solo porque la herramienta no está instalada en la 89 (no por el proyecto). */
const ISSUES_ENTORNO_89 = new Set(['tool-source-missing', 'tool-cli-missing', 'tool-capability-missing']);

export function soloEntornoSinHerramienta(informe) {
  const issues = Array.isArray(informe?.issues) ? informe.issues : [];
  return issues.length > 0 && issues.every(issue => ISSUES_ENTORNO_89.has(issue?.code));
}

/* [por que] Igual que quality:setup: si el taller está configurado, el doctor del proyecto corre
 * en la 89 (AGENTS §1). Sin VPS no se ejecuta en el portátil: se informa como omitido con el motivo.
 * `--local` (emergencia) se respeta igual que en el resto de herramientas. */
function ejecutarDoctor(consumidor, doctor) {
  const taller = cargarTaller();
  let destino;
  try {
    destino = decidirDonde(process.argv, taller, hostname());
  } catch (error) {
    return { omitido: error.message, grave: true };
  }
  if (destino.donde === 'local') return ejecutar(comando(...doctor.argv), consumidor.dir, 300_000);
  /* [por que] Un doctor de herramienta vive fuera de la réplica y la 89 no lo tiene: no es un fallo
   * del proyecto, así que se informa sin marcarlo como error (salvo que haya CLI remota, `remota`). */
  if (!doctor.enProyecto && !doctor.remota) return { omitido: 'doctor de herramienta fuera del proyecto: no corre en la 89', grave: false };
  const dir = dirRemotoDe(taller, path.basename(consumidor.dir), consumidor.dir, consumidor.dir);
  /* [por que] Mutagen no sincroniza todos los proyectos: sin réplica el doctor no se puede comprobar
   * y no es un fallo del pin; se informa como no comprobado. */
  const replica = ejecutarEnVps(taller, '/var/tmp', ['test', '-d', dir], { capturar: true });
  const sinVps = mensajeSinVps(replica.status, taller.host);
  if (sinVps) return { omitido: sinVps, grave: true };
  if (replica.status !== 0) return { omitido: 'proyecto sin réplica en la 89: doctor no comprobado', grave: false };
  /* [por que] La CLI del commit fijado la prepara el setup en /var/tmp; el script npm del proyecto
   * busca `.quality-tools` (que la 89 no tiene) y acabaría en un `sentinel` global inexistente allí. */
  const argv = doctor.remota
    ? ['node', path.posix.join(dirRemotoDeHerramienta(taller, doctor.remota.nombre, doctor.remota.commit), 'out/cli/index.js'), 'doctor', '--json', '--workspace', dir]
    : doctor.argv;
  const resultado = ejecutarEnVps(taller, dir, argv, { capturar: true });
  const aviso = mensajeSinVps(resultado.status, taller.host);
  return {
    status: typeof resultado.status === 'number' ? resultado.status : 2,
    salida: aviso ?? String(resultado.stdout ?? ''),
  };
}

export function propagarConsumidor(consumidor, tool, destino) {
  const dirManifiesto = path.join(consumidor.dir, 'quality-tools.json');
  const bruto = fs.readFileSync(dirManifiesto, 'utf8');
  const manifiesto = JSON.parse(bruto);
  const config = manifiesto.tools?.[tool];
  const fila = {
    proyecto: consumidor.nombre,
    familia: familiaDe(consumidor, config),
    routers: [],
    pin: 'ausente',
    lock: '—',
    setup: '—',
    doctor: '—',
    issues: null,
    estado: 'ok',
    nota: null,
  };
  if (!config) {
    fila.nota = `${tool} no declarada en el manifiesto`;
    return fila;
  }

  if (fila.familia === 'A') fila.routers = revisarRouters(consumidor, escribirRouters);

  const commitActual = config.commit ?? null;
  const versionActual = config.version ?? null;
  const yaAlineado = commitActual === destino.commit && (!destino.version || versionActual === destino.version);
  if (yaAlineado) {
    fila.pin = 'sin-cambios';
  } else if (!escribir) {
    fila.pin = 'cambiaría';
  } else {
    const resultado = reescribirPin(bruto, tool, destino);
    if (!resultado) {
      fila.pin = 'error';
      fila.estado = 'error';
      fila.nota = 'el manifiesto no tiene la forma esperada (¿tools.<tool> con commit/version?)';
      return fila;
    }
    const problema = validarReescritura(bruto, resultado.texto, tool, destino);
    if (problema) {
      fila.pin = 'error';
      fila.estado = 'error';
      fila.nota = `reescritura rechazada: ${problema}`;
      return fila;
    }
    if (resultado.cambio) {
      fs.writeFileSync(dirManifiesto, resultado.texto);
      fila.pin = 'cambiado';
    } else {
      fila.pin = 'sin-cambios';
    }
  }

  if (!conPasos || !escribir) return fila;

  const pasos = pasosDe(consumidor, config, manifiesto.tools?.sentinel);
  const lock = ejecutar(pasos.lock, consumidor.dir, 300_000);
  fila.lock = lock.status === 0 ? 'ok' : 'fallo';
  if (lock.status !== 0) {
    fila.estado = 'bloqueado';
    fila.nota = primeraLineaUtil(lock.salida) ?? 'lock falló';
    return fila;
  }

  const setup = ejecutar(pasos.setup, consumidor.dir, 3_600_000);
  fila.setup = setup.status === 0 ? 'ok' : 'fallo';
  if (setup.status !== 0) {
    fila.estado = 'error';
    fila.nota = primeraLineaUtil(setup.salida) ?? 'setup falló';
    return fila;
  }

  const evidencia = leerJson(path.join(consumidor.dir, '.sentinel', 'release-evidence', `${tool}.json`));
  fila.origen = evidencia?.origen ?? null;

  if (!pasos.doctor) {
    fila.doctor = 'n/d';
    return fila;
  }
  const doctor = ejecutarDoctor(consumidor, pasos.doctor);
  if (doctor.omitido) {
    fila.doctor = 'n/d';
    fila.nota = doctor.omitido;
    if (doctor.grave) fila.estado = 'error';
    return fila;
  }
  const informe = leerJsonDeTexto(doctor.salida);
  fila.doctor = doctor.status === 0 ? 'ok' : 'fallo';
  fila.issues = Array.isArray(informe?.issues) ? informe.issues.length : null;
  if (informe && informe.readyForGate === false) fila.doctor = 'no-listo';
  /* [por que] Si todos los issues son de herramienta ausente, la 89 no tiene `.quality-tools` (Mutagen no lo
   * replica): no es un fallo del proyecto ni del pin (lock, setup y evidencia ya lo validan) → no comprobado. */
  if (soloEntornoSinHerramienta(informe)) {
    fila.doctor = 'no-comprobado';
    fila.nota = 'herramienta fuera de la réplica de la 89 (.quality-tools no replicado)';
    return fila;
  }
  const doctorRoto = doctor.status !== 0 || fila.doctor !== 'ok';
  if (doctorRoto) {
    fila.estado = 'error';
    fila.nota = primeraLineaUtil(doctor.salida) ?? 'doctor no listo';
  }
  return fila;
}
