/* Seccion de reglas del EditorEsquema: pestanas por categoria + toggle y
 * severidad por regla. [por que] Vive en modulo propio para que
 * EditorEsquema.tsx no supere el limite de lineas. */
import { useState } from 'react';
import { infoSegmento } from '../shared/gate/etiquetas.js';
import type { NodoEsquema, Ruta, ValorJson } from '../shared/gate/esquema.js';
import type { ReglaCatalogo } from '../shared/gate/reglas.js';
import { EtiquetaDeRuta } from './EtiquetaDeRuta.js';
import { Selector } from './ui/selector/Selector.js';

export function SeccionReglas({
  clave,
  item,
  reglas,
  valor,
  setEn,
  readOnly,
}: {
  clave: string;
  item: NodoEsquema;
  /* Catalogo inyectado (vivo del runtime o estatico). Fuente unica de
   * verdad para los ids, categorias, defaults de severidad/habilitada. */
  reglas: ReglaCatalogo[];
  valor: ValorJson | undefined;
  setEn: (r: Ruta, v: ValorJson) => void;
  readOnly?: boolean;
}) {
  /* Defaults REALES del esquema por regla (no hardcodeados). */
  const nodoHab = 'objeto' in item ? item.objeto['habilitada'] : undefined;
  const nodoSev = 'objeto' in item ? item.objeto['severidad'] : undefined;
  const defaultHabilitada = nodoHab && 'tipo' in nodoHab ? nodoHab.default !== false : true;
  const defaultSeveridad = nodoSev && 'tipo' in nodoSev && typeof nodoSev.default === 'string'
    ? nodoSev.default
    : 'error';
  const valoresSev =
    nodoSev && 'tipo' in nodoSev && nodoSev.tipo === 'enum' ? (nodoSev.valores ?? []) : [];

  const presente =
    valor !== null && typeof valor === 'object' && !Array.isArray(valor)
      ? (valor as Record<string, ValorJson>)
      : {};
  const ids = reglas.map((r) => r.id);
  const conoce = new Set(ids);
  const desconocidas = Object.keys(presente).filter((id) => !conoce.has(id)).sort();

  /* Agrupa por categoria desde el catalogo inyectado (data viva). Las
   * desconocidas (ids que escribio el agente y no estan en el catalogo) van en
   * su propio grupo al final, para no perderlas. */
  const porCategoria = new Map<string, ReglaCatalogo[]>();
  for (const r of reglas) {
    const arr = porCategoria.get(r.categoria) ?? [];
    arr.push(r);
    porCategoria.set(r.categoria, arr);
  }
  /* Preserva el orden natural del catalogo (primera aparicion), estable y
   * predecible. [por que] Reordenar por tamano o alfabetico cambiaria el orden
   * que el usuario ya conoce; el catalogo trae su orden. */
  const categorias: string[] = [];
  for (const r of reglas) if (!categorias.includes(r.categoria)) categorias.push(r.categoria);
  const [activa, setActiva] = useState<string>(categorias[0] ?? '');

  const enCatalogo = ids.filter((id) => Object.prototype.hasOwnProperty.call(presente, id)).length;
  const activas = [...ids, ...desconocidas].filter((id) => {
    const v = presente[id];
    const obj = v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, ValorJson>) : undefined;
    /* Reglas ausentes: heredan su default real por-regla (2 nacen apagadas). */
    const habCat = reglas.find((x) => x.id === id)?.habilitada;
    return obj ? obj['habilitada'] !== false : (habCat ?? defaultHabilitada);
  }).length;

  const idsDeCategoria = (cat: string): string[] =>
    (porCategoria.get(cat) ?? []).filter((r) => conoce.has(r.id)).map((r) => r.id);

  return (
    <section className="ejReglas">
      <header className="ejReglasCabecera">
        <span className="ejReglasTitulo">{infoSegmento(clave).nombre}</span>
        <span className="ejReglasMeta">
          {enCatalogo} de {ids.length} en config · {activas} activas
        </span>
      </header>
      <div className="ejTabs" role="tablist">
        {categorias.map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={activa === c}
            className={`ejTab${activa === c ? ' ejTab--activo' : ''}`}
            onClick={() => setActiva(c)}
          >
            {categoriaNombre(c)} · {idsDeCategoria(c).length}
          </button>
        ))}
        {desconocidas.length > 0 && (
          <button
            type="button"
            role="tab"
            aria-selected={activa === '__desconocidas'}
            className={`ejTab${activa === '__desconocidas' ? ' ejTab--activo' : ''}`}
            onClick={() => setActiva('__desconocidas')}
          >
            Desconocidas · {desconocidas.length}
          </button>
        )}
      </div>
      <div className="ejReglasLista">
        {(activa === '__desconocidas' ? desconocidas : idsDeCategoria(activa)).map((id) => {
          const v = presente[id];
          const obj = v !== null && typeof v === 'object' && !Array.isArray(v)
            ? (v as Record<string, ValorJson>)
            : undefined;
          const ausente = obj === undefined;
          const desconocida = !conoce.has(id);
          /* Default real por regla del catalogo (habilitada/severidad). [por
           * que] No todas las reglas nacen activas: 2 de las 105 vienen
           * desactivadas por defecto (nomenclatura-css-ingles, default-export),
           * y cada una tiene su severidad propia. Solo las desconocidas caen al
           * default global del esquema. */
          const rCat = reglas.find((x) => x.id === id);
          const habilitada = obj ? obj['habilitada'] !== false : (rCat?.habilitada ?? defaultHabilitada);
          const severidad =
            obj && typeof obj['severidad'] === 'string'
              ? obj['severidad']
              : (rCat?.severidad ?? defaultSeveridad);

          const toggle = () => {
            if (readOnly) return;
            const nuevo = !habilitada;
            if (ausente) setEn([clave, id], { habilitada: nuevo, severidad });
            else setEn([clave, id, 'habilitada'], nuevo);
          };
          const cambiarSeveridad = (s: string) => {
            if (readOnly) return;
            if (ausente) setEn([clave, id], { habilitada, severidad: s });
            else setEn([clave, id, 'severidad'], s);
          };

          return (
            <div
              key={id}
              className={`ejRegla${ausente ? ' ejRegla--ausente' : ''}${desconocida ? ' ejRegla--desconocida' : ''}${!habilitada ? ' ejRegla--off' : ''}`}
            >
              <span className="ejReglaSwitch">
                {readOnly ? (
                  <span className="ejValorTexto">{habilitada ? 'sí' : 'no'}</span>
                ) : (
                  <button
                    type="button"
                    className={`fjSwitch${habilitada ? ' fjSwitch--on' : ''}`}
                    onClick={toggle}
                    aria-pressed={habilitada}
                    title={habilitada ? 'desactivar regla' : 'activar regla'}
                  >
                    <span className="fjSwitchPalo" />
                  </button>
                )}
              </span>
              <span className="ejReglaInfo">
                <EtiquetaDeRuta ruta={[clave, id]} texto={nombreRegla(id, reglas)} />
                <span className="ejReglaNotas">
                  {ausente && <span className="ejReglaPorDefecto">por defecto</span>}
                  {desconocida && <span className="ejMarcaTexto">desconocida</span>}
                </span>
              </span>
              <span className="ejReglaSev">
                {readOnly ? (
                  <span className="ejValorTexto">{severidad}</span>
                ) : (
                  <Selector
                    valor={severidad}
                    opciones={[...new Set([...valoresSev, severidad])]}
                    onChange={cambiarSeveridad}
                    titulo="severidad de la regla"
                  />
                )}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* Nombre legible de una regla desde el catalogo (vivo o estatico). [por que]
 * El nombre de `etiquetas.ts` solo cubria las 14 reglas viejas; las 105 nuevas
 * usan el `nombre` del runtime 0.7.4. Fallback al id. */
function nombreRegla(id: string, reglas: ReglaCatalogo[]): string {
  const r = reglas.find((x) => x.id === id);
  return r ? r.nombre : infoSegmento(id).nombre;
}

/* Nombre legible de una categoria (traduccion corta). [por que] Los ids de
 * categoria son tecnicos (react-patrones, glory-schema...); se traducen para la
 * UI. Fallback al id tecnico si no hay. */
function categoriaNombre(c: string): string {
  const mapa: Record<string, string> = {
    'react-patrones': 'React',
    'glory-schema': 'Glory',
    'estructura-nomenclatura': 'Estructura',
    'wordpress-php': 'WordPress/PHP',
    'patrones-prohibidos': 'Prohibidos',
    'rust-patrones': 'Rust',
    'limites-archivo': 'Límites',
    'seguridad-sql': 'SQL',
  };
  return mapa[c] ?? c;
}
