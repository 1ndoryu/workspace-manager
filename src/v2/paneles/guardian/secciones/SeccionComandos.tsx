/* Sección Comandos: qué vigila el guard en el proyecto elegido (10AA-2 F11.4).
 * [por que] El efecto depende del modo (bloquea, solo avisa, no actúa). Los comandos
 * sin shim (git, python, pip) no pasan por el guard: se marcan «sin atajo» para no
 * darlos por cubiertos. Solo se muestra qué difiere de la plantilla si de verdad difiere. */
import { Linea, Lista } from '../Lineas.js';
import type { GuardianDatos } from '../useGuardian.js';
import { MODO_LLANO } from '../lenguaje.js';
import { LISTAS, type ProyectoArea } from '../tiposGuardian.js';

interface LineaComando {
  titulo: string;
  dato: string;
}

function lineasDe(p: ProyectoArea, sinShim: Set<string>): LineaComando[] {
  if (p.listas.estado === 'ausente') return [];
  if (p.listas.estado !== 'ok') return [{ titulo: p.listas.motivo, dato: '' }];
  const { listas } = p.listas;
  const lineas: LineaComando[] = LISTAS.filter((lista) => listas[lista].length > 0).map((lista) => ({
    titulo: lista,
    dato: listas[lista].map((c) => (sinShim.has(c) ? `${c} (sin atajo)` : c)).join(', '),
  }));
  const d = p.diferencias;
  if (d.estado === 'ok' && d.faltan.length + d.reaparecen.length > 0) {
    const cambios = [...d.faltan.map((f) => `falta ${f}`), ...d.reaparecen.map((r) => `reaparece ${r}`)];
    lineas.push({ titulo: 'plantilla', dato: cambios.join(' · ') });
  }
  return lineas;
}

export function SeccionComandos({ datos }: { datos: GuardianDatos }) {
  const { area, claveSel, errorArea } = datos;

  if (!area) {
    return errorArea ? <div className="docsMensaje">{errorArea}</div> : <div className="docsVacio">cargando proyectos…</div>;
  }
  const p = area.proyectos.find((x): x is ProyectoArea => x.elegible && x.clave === claveSel);
  if (!p) return <div className="docsVacio">proyecto sin guardián</div>;

  const lineas = lineasDe(p, new Set(area.sinShim));
  return (
    <>
      <div className="guardianNota">
        {p.listas.estado === 'ok' ? MODO_LLANO[p.listas.modo] : 'sin reglas de comandos'}
      </div>
      <Lista>
        {lineas.map((l) => (
          <Linea key={l.titulo} titulo={l.titulo} detalle={l.dato} />
        ))}
      </Lista>
    </>
  );
}
