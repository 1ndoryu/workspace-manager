/* Validacion de una entrada del registro (schema v1): falla cerrado.
 * Orquestador: las reglas puras viven en validacion-reglas.mjs y las que tocan disco
 * en validacion-fs.mjs. Aqui solo queda el ORDEN de comprobaciones: el primer fallo es el que se anota. */

import { readFileSync } from 'node:fs';
import { isAbsolute, normalize, resolve } from 'node:path';

import { rutaConfigPrivada } from '../../../shared/rutas.mjs';

import { validarConsumeArtefacto } from './consume-artefacto.mjs';

import { RAIZ_REPO } from '../base.mjs';
import {
  idValido,
  motivoAlineacion,
  motivoAnalisisEn,
  motivoAreaRuta,
  motivoAuxiliares,
  motivoBanderas,
  motivoBloqueBuild,
  motivoBoton,
  motivoBuildMode,
  motivoCamposTaller,
  motivoClaveDesconocida,
  motivoDominio,
  motivoEnv,
  motivoExpectedCmdline,
  motivoHealths,
  motivoHost,
  motivoLanzamiento,
  motivoPuertoProtegido,
  motivoPuertos,
  motivoRequiere,
  motivoSinServicioCampos,
  motivoTipoSinServicio,
} from './validacion-reglas.mjs';
import { motivoExes, motivoReconstruir, motivoRutaInexistente } from './validacion-fs.mjs';

export { validarMotivo } from './motivo.mjs';

/* Alias SSH del taller, tal y como lo declara `config/taller.json`, o null.
 * [por que] El alias de la máquina no puede vivir en el código: en otro entorno no
 * existe y una ficha ya escrita con él dejaría de entenderse. Se lee una vez y se
 * memoriza (esto valida una entrada por proyecto). Sin taller, la forma válida del
 * modo es solo el papel. */
let aliasTallerCache;
function hostDelTaller() {
  if (aliasTallerCache === undefined) {
    aliasTallerCache = null;
    try {
      const t = JSON.parse(readFileSync(rutaConfigPrivada('taller.json'), 'utf8'));
      if (typeof t?.host === 'string' && t.host.trim()) aliasTallerCache = t.host.trim();
    } catch {
      /* sin taller declarado no hay alias que aceptar */
    }
  }
  return aliasTallerCache;
}

export function validarEntrada(e) {
  // [por que 06AA-1] Un desvio en UNA entrada jamas bloquea el mando global:
  // se anota en `e._avisoRegistro` (la entrada queda no-actuable: ni `up` ni
  // `status` la tocan, sale como deriva con ese motivo) y el resto sigue.
  // Solo lo estructural sin id atribuible (no-objeto, sin id, id duplicado)
  // sigue siendo error global: sin id no hay a quien anotar.
  if (typeof e !== 'object' || e === null) throw new Error('registro: entrada no objeto');
  const mal = (motivo) => {
    if (!e._avisoRegistro) e._avisoRegistro = motivo;
  };
  // Devuelve true si hubo fallo: el llamador corta y no sigue con el resto de reglas.
  const comprobar = (motivo) => {
    if (!motivo) return false;
    mal(motivo);
    return true;
  };

  if (comprobar(motivoTipoSinServicio(e))) return;
  const sinServicio = e.sinServicio === true;
  // [por que] Sin id atribuible no hay a quien anotar el aviso: se lanza error global.
  const requeridas = sinServicio ? ['id', 'ruta'] : ['id', 'ruta', 'boton', 'puertos', 'expectedCmdline'];
  const falta = requeridas.find((k) => !(k in e));
  if (falta !== undefined) {
    if (!idValido(e)) throw new Error(`registro: entrada sin '${falta}' (${JSON.stringify(e).slice(0, 80)})`);
    mal(`registro: '${e.id}' entrada sin '${falta}'`);
    return;
  }
  if (comprobar(motivoClaveDesconocida(e))) return;
  if (comprobar(motivoBanderas(e))) return;
  if (comprobar(motivoHost(e))) return;
  if (sinServicio) {
    if (comprobar(motivoSinServicioCampos(e))) return;
    Object.assign(e, { boton: [], puertos: [], expectedCmdline: [] });
  }
  const rutaAbs = isAbsolute(e.ruta) ? normalize(e.ruta) : resolve(RAIZ_REPO, e.ruta);
  if (comprobar(motivoAreaRuta(e, rutaAbs))) return;
  if (comprobar(motivoRutaInexistente(e, rutaAbs))) return;
  if (comprobar(motivoReconstruir(e, rutaAbs))) return;
  if (comprobar(motivoBoton(e, sinServicio))) return;
  if (comprobar(motivoPuertos(e))) return;
  if (comprobar(motivoEnv(e))) return;
  if (comprobar(motivoCamposTaller(e))) return;
  if (comprobar(motivoAnalisisEn(e, hostDelTaller()))) return;
  if (comprobar(motivoBuildMode(e))) return;
  if (comprobar(motivoAlineacion(e))) return;
  if (comprobar(motivoExes(e, rutaAbs))) return;
  if (comprobar(motivoPuertoProtegido(e, rutaAbs))) return;
  if (comprobar(motivoHealths(e))) return;
  if (comprobar(motivoBloqueBuild(e))) return;
  if (comprobar(motivoDominio(e))) return;
  if (comprobar(motivoRequiere(e))) return;
  if (comprobar(motivoLanzamiento(e))) return;
  if (comprobar(motivoAuxiliares(e))) return;
  // [por que 20AA-7] `consumeArtefacto` = esta entrada empotra el artefacto de
  // compilacion de OTRO proyecto (proyecto-escritorio <- proyecto-web/frontend/dist).
  // El sub-esquema vive en su modulo: aqui el archivo esta en el limite de 300
  // lineas efectivas del gate.
  if ('consumeArtefacto' in e && !validarConsumeArtefacto(e, mal)) return;
  comprobar(motivoExpectedCmdline(e));
}
