/* Sección Comandos: matriz proyecto × comando de todo el área (10AA-2 F11.4).
 * [por que] Cada celda dice qué hace el guard con ese comando en ese proyecto. El
 * efecto depende del modo del proyecto (enforce bloquea, observe observa,
 * pass-through no hace nada). Los comandos sin shim (git, python, pip) no pasan por
 * el guard: se marcan aparte para no darlos por cubiertos. La última columna dice
 * qué difiere de la plantilla de su stack. */
import { Seccion } from '../../../ui/caja/Caja.js';
import type { GuardianDatos } from '../useGuardian.js';
import {
  LISTAS,
  type ListaGuard,
  type ModoGuard,
  type ProyectoArea,
  type ProyectoSinGuardian,
} from '../tiposGuardian.js';

const EFECTO: Record<ModoGuard, string> = {
  enforce: 'bloqueado',
  observe: 'observado',
  'pass-through': 'permitido',
};

const NO_INTERCEPTADO = 'no interceptado';
const FUERA_DE_LISTA = '—';

type Proyecto = ProyectoArea | ProyectoSinGuardian;

interface Columna {
  lista: ListaGuard;
  comando: string;
}

/* Columnas = pares (lista, comando) que aparecen en algún proyecto con política legible.
 * [por que] Un mismo comando puede estar en dos listas: son dos columnas distintas. */
function columnasDe(proyectos: Proyecto[]): Columna[] {
  return LISTAS.flatMap((lista) => {
    const comandos = new Set<string>();
    for (const p of proyectos) {
      if (p.elegible && p.listas.estado === 'ok') for (const c of p.listas.listas[lista]) comandos.add(c);
    }
    return [...comandos].sort((a, b) => a.localeCompare(b)).map((comando) => ({ lista, comando }));
  });
}

function celda(p: ProyectoArea, col: Columna, sinShim: Set<string>): string {
  if (p.listas.estado !== 'ok' || !p.listas.listas[col.lista].includes(col.comando)) return FUERA_DE_LISTA;
  if (sinShim.has(col.comando)) return NO_INTERCEPTADO;
  return EFECTO[p.listas.modo];
}

function plantillaDe(p: ProyectoArea): string {
  const d = p.diferencias;
  if (d.estado === 'sin-plantilla') return 'sin plantilla';
  if (d.estado === 'sin-politica') return 'sin política';
  if (d.faltan.length === 0 && d.reaparecen.length === 0) return 'conforme';
  return [...d.faltan.map((f) => `falta ${f}`), ...d.reaparecen.map((r) => `reaparece ${r}`)].join(' · ');
}

export function SeccionComandos({ datos }: { datos: GuardianDatos }) {
  const { area, claveSel, elegir, errorArea } = datos;

  if (!area) {
    return (
      <Seccion titulo="proyectos × comandos">
        {errorArea ? <div className="docsMensaje">{errorArea}</div> : <div className="docsVacio">cargando proyectos…</div>}
      </Seccion>
    );
  }

  const columnas = columnasDe(area.proyectos);
  const sinShim = new Set(area.sinShim);
  const elegibles = area.proyectos.filter((p) => p.elegible).length;
  const grupos = LISTAS.map((lista) => ({ lista, n: columnas.filter((c) => c.lista === lista).length })).filter(
    (g) => g.n > 0,
  );
  /* [por que] Ancho de las filas sin comandos: al menos una celda, para que el colSpan sea válido. */
  const ancho = Math.max(columnas.length, 1);

  return (
    <Seccion titulo="proyectos × comandos">
      <div className="guardianNota">
        {area.total} proyectos · {elegibles} con guardián. bloqueado: el guard corta el comando · observado: lo
        registra sin cortarlo · permitido: sin efecto · no interceptado: está en la lista pero no pasa por el guard ·
        —: no está en la lista del proyecto
      </div>
      {columnas.length === 0 && <div className="docsVacio">ningún proyecto tiene comandos en las listas</div>}
      <div className="guardianMatriz">
        <table className="guardianTabla">
          <thead>
            <tr>
              <th rowSpan={2}>proyecto</th>
              <th rowSpan={2}>modo</th>
              {grupos.map((g) => (
                <th key={g.lista} colSpan={g.n}>
                  {g.lista}
                </th>
              ))}
              <th rowSpan={2}>plantilla</th>
            </tr>
            {columnas.length > 0 && (
              <tr>
                {columnas.map((c) => (
                  <th key={`${c.lista}:${c.comando}`}>{c.comando}</th>
                ))}
              </tr>
            )}
          </thead>
          <tbody>
            {area.proyectos.map((p) => {
              const activa = p.clave === claveSel;
              const clase = activa ? 'guardianFila--activa' : undefined;
              if (!p.elegible) {
                return (
                  <tr key={p.clave} className={clase}>
                    <td>{p.clave}</td>
                    <td colSpan={columnas.length + 2}>sin guardián: su puerta no es sentinel</td>
                  </tr>
                );
              }
              return (
                <tr key={p.clave} className={clase}>
                  <td>
                    <button
                      type="button"
                      className="guardianEnlace"
                      aria-pressed={activa}
                      onClick={() => elegir(p.clave)}
                    >
                      {p.clave}
                    </button>
                  </td>
                  {p.listas.estado === 'ok' ? (
                    <>
                      <td>{p.listas.modo}</td>
                      {columnas.map((c) => (
                        <td key={`${c.lista}:${c.comando}`}>{celda(p, c, sinShim)}</td>
                      ))}
                    </>
                  ) : (
                    <>
                      <td>{FUERA_DE_LISTA}</td>
                      <td colSpan={ancho}>
                        {p.listas.estado === 'ausente' ? 'sin política de listas' : p.listas.motivo}
                      </td>
                    </>
                  )}
                  <td>{plantillaDe(p)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Seccion>
  );
}
