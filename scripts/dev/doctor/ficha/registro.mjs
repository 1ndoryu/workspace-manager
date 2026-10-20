/* Lectura y validacion del registro del area (schema v1). Falla cerrado: cualquier
 * desvio es error, nunca «vale igual». */

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute } from 'node:path';

import { RUTA_REGISTRO } from '../base.mjs';
import { validarEntrada, validarMotivo } from './validacion.mjs';

/* Lee y valida el registro (schema v1). Falla cerrado: cualquier desvio
 * es error, nunca "vale igual". */
export function leerRegistro(ruta = RUTA_REGISTRO) {
  if (!existsSync(ruta)) throw new Error(`registro ausente: ${ruta}`);
  let crudo;
  try {
    crudo = JSON.parse(readFileSync(ruta, 'utf8'));
  } catch (e) {
    throw new Error(`registro JSON invalido: ${String(e)}`);
  }
  if (crudo.version !== 1) throw new Error(`registro: version!=1 (${crudo.version})`);
  if (!Array.isArray(crudo.proyectos)) throw new Error('registro: proyectos no es array');
  const entradas = new Map();
  for (const e of crudo.proyectos) {
    validarEntrada(e);
    if (entradas.has(e.id)) throw new Error(`registro: id duplicado '${e.id}'`);
    entradas.set(e.id, e);
  }
  const noAplica = crudo.noAplica ?? {};
  if (typeof noAplica !== 'object' || Array.isArray(noAplica)) {
    throw new Error('registro: noAplica no es objeto');
  }
  for (const [clave, motivo] of Object.entries(noAplica)) validarMotivo(motivo, `noAplica.${clave}`);
  // [por que] Lista curada de terceros/sistema en loopback (opcional). Falla
  // cerrado: una exencion mal formada no debe callar un listener por accidente.
  const ignoradosSistema = crudo.ignoradosSistema ?? [];
  if (!Array.isArray(ignoradosSistema)) throw new Error('registro: ignoradosSistema no es array');
  ignoradosSistema.forEach((s, i) => validarIgnoradoSistema(s, `ignoradosSistema[${i}]`));
  // [por que] Apps propias ejecutadas fuera de la carpeta del area (p. ej. C:\tmp):
  // mismo formato y mismo fallo cerrado que ignoradosSistema, pero no son de terceros.
  const externosPropios = crudo.externosPropios ?? [];
  if (!Array.isArray(externosPropios)) throw new Error('registro: externosPropios no es array');
  externosPropios.forEach((s, i) => validarIgnoradoSistema(s, `externosPropios[${i}]`));
  // [por que] Dos proyectos no pueden reclamar el mismo puerto (puertos o
  // auxiliares): sin esto el choque solo aparecia al arrancar (glory-pulse y
  // proyecto-i compartian 3000). Aviso en la entrada posterior, no error global
  // (mismo criterio que 06AA-1).
  const reclamados = new Map();
  for (const e of entradas.values()) {
    const puertos = [
      ...(Array.isArray(e.puertos) ? e.puertos : []),
      ...(Array.isArray(e.auxiliares) ? e.auxiliares.map((a) => a?.puerto) : []),
    ];
    for (const p of puertos) {
      const dueno = reclamados.get(p);
      if (dueno === undefined) reclamados.set(p, e.id);
      else if (dueno !== e.id) e._avisoRegistro ??= `registro: '${e.id}' reclama el puerto ${p} ya declarado por '${dueno}'`;
    }
  }
  // [por que 06AA-1] Dependencia colgada = aviso de la entrada dependiente,
  // no error global: el resto del mando sigue clasificando y `up` la
  // rehusara con ese motivo si se la pide.
  for (const e of entradas.values()) {
    for (const d of Array.isArray(e.requiere) ? e.requiere : []) {
      if (!entradas.has(d) && !e._avisoRegistro) {
        e._avisoRegistro = `registro: '${e.id}' requiere id inexistente '${d}'`;
      }
    }
  }
  // [por que F9.2] Equipos donde corre el taller. `completo` = el manager puede escribir
  // (alias SSH propio); `lectura` = solo consulta y NUNCA lleva alias: un alias ahi seria
  // un atajo a escribir en la VPS principal. Ausente = lista vacia (registro previo).
  const vps = crudo.vps ?? [];
  if (!Array.isArray(vps)) throw new Error('registro: vps no es array');
  const idsVps = new Set();
  for (const v of vps) {
    validarVps(v);
    if (idsVps.has(v.id)) throw new Error(`registro: vps id duplicado '${v.id}'`);
    idsVps.add(v.id);
  }
  return { version: 1, entradas, noAplica, ignoradosSistema, externosPropios, vps };
}


const MODOS_VPS = ['completo', 'lectura'];


export function validarVps(v) {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new Error('registro: vps[] no es objeto');
  for (const k of Object.keys(v)) {
    if (!['id', 'alias', 'modo', 'motivo'].includes(k)) throw new Error(`registro: vps clave desconocida '${k}'`);
  }
  if (typeof v.id !== 'string' || !/^[a-z0-9-]+$/.test(v.id)) throw new Error(`registro: vps.id no valido '${v.id}'`);
  if (!MODOS_VPS.includes(v.modo)) throw new Error(`registro: vps '${v.id}' modo debe ser completo|lectura`);
  if (v.modo === 'completo') {
    if (typeof v.alias !== 'string' || !/^[A-Za-z0-9_-]+$/.test(v.alias)) {
      throw new Error(`registro: vps '${v.id}' en modo completo necesita alias SSH`);
    }
  } else if (v.alias !== undefined && v.alias !== null) {
    throw new Error(`registro: vps '${v.id}' en modo lectura no admite alias SSH`);
  }
  if (v.motivo !== undefined && typeof v.motivo !== 'string') throw new Error(`registro: vps '${v.id}' motivo no es texto`);
}


export function validarIgnoradoSistema(s, ctx) {
  if (typeof s !== 'object' || s === null || Array.isArray(s)) throw new Error(`registro: ${ctx} no es objeto`);
  for (const k of Object.keys(s)) {
    if (!['exe', 'imagen', 'pid', 'puerto', 'servicio', 'cmdContiene', 'motivo'].includes(k)) throw new Error(`registro: ${ctx} clave desconocida '${k}'`);
  }
  // [por que] isAbsolute depende del SO: en Linux (la 89) no reconoce C:\... y el
  // registro de Windows fallaba alli. Se acepta ruta absoluta de cualquiera de los dos.
  const tieneExe = typeof s.exe === 'string' && (isAbsolute(s.exe) || /^[a-zA-Z]:[\\/]/.test(s.exe));
  // [por que] imagen = nombre de ejecutable sin ruta (p. ej. TpvNet.exe): para
  // terceros cuyo exe no es legible sin elevar. Sin separadores: nunca una ruta.
  const tieneImagen = typeof s.imagen === 'string' && /^[^\\/:*?"<>|]{3,80}\.exe$/i.test(s.imagen);
  const tienePid = Number.isInteger(s.pid) && s.pid > 0;
  // [por que 16AA-20] puerto = identidad por puerto, para el tercero elevado del
  // que Windows no deja leer ni exe ni linea de comando (el gateway local de
  // Claude Desktop en 8790). Se exige ademas que el proceso sea ilegible, asi
  // que no tapa a un proyecto que mañana quiera ese puerto: entonces el suyo
  // tendria exe y cmd y el ignorado no casaria.
  const tienePuerto = Number.isInteger(s.puerto) && s.puerto >= 1024 && s.puerto <= 65535;
  const tieneServicio = typeof s.servicio === 'string' && s.servicio.length >= 2 && s.servicio.length <= 200;
  if ([tieneExe, tieneImagen, tienePid, tienePuerto, tieneServicio].filter(Boolean).length !== 1) {
    throw new Error(`registro: ${ctx} requiere exactamente uno de exe (ruta absoluta), imagen (nombre .exe), pid, puerto o servicio`);
  }
  // [por que] Un exe generico (bun.exe) puede lanzar mas de un servicio: cmdContiene
  // acota el ignorado a una linea de comando concreta, nunca vale solo con pid.
  if (s.cmdContiene !== undefined) {
    if (!tieneExe || typeof s.cmdContiene !== 'string' || s.cmdContiene.length < 3 || s.cmdContiene.length > 200) {
      throw new Error(`registro: ${ctx} cmdContiene requiere exe y texto de 3-200 caracteres`);
    }
  }
  // [por que] El mensaje dice cuál es el fallo: falta, o su longitud está fuera de rango.
  if (typeof s.motivo !== 'string') {
    throw new Error(`registro: ${ctx} falta el motivo (texto de 3-120 caracteres)`);
  }
  if (s.motivo.length < 3 || s.motivo.length > 120) {
    throw new Error(`registro: ${ctx} motivo de ${s.motivo.length} caracteres; debe tener 3-120`);
  }
}

