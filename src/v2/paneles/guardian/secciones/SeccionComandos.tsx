/* Sección Comandos: qué vigila el guard en cada proyecto (10AA-2 F11.4).
 * [por que] Cada proyecto es una línea con su modo y, debajo, sus comandos por lista.
 * El efecto depende del modo (bloquea, solo avisa, no actúa). Los comandos sin shim
 * (git, python, pip) no pasan por el guard: se marcan «sin atajo» para no darlos por
 * cubiertos. Solo se muestra qué difiere de la plantilla si de verdad difiere. */
import { Seccion } from '../../../ui/caja/Caja.js';
import { Linea, Lista } from '../Lineas.js';
import type { GuardianDatos } from '../useGuardian.js';
import { MODO_LLANO } from '../lenguaje.js';
import { LISTAS, type ProyectoArea } from '../tiposGuardian.js';

function detalleDe(p: ProyectoArea, sinShim: Set<string>): string[] {
  if (p.listas.estado === 'ausente') return ['sin reglas de comandos'];
  if (p.listas.estado !== 'ok') return [p.listas.motivo];
  const { listas } = p.listas;
  const lineas = LISTAS.filter((lista) => listas[lista].length > 0).map(
    (lista) => `${lista}: ${listas[lista].map((c) => (sinShim.has(c) ? `${c} (sin atajo)` : c)).join(', ')}`,
  );
  const d = p.diferencias;
  if (d.estado === 'ok' && d.faltan.length + d.reaparecen.length > 0) {
    const cambios = [...d.faltan.map((f) => `falta ${f}`), ...d.reaparecen.map((r) => `reaparece ${r}`)];
    lineas.push(`plantilla: ${cambios.join(' · ')}`);
  }
  return lineas;
}

export function SeccionComandos({ datos }: { datos: GuardianDatos }) {
  const { area, claveSel, elegir, errorArea } = datos;

  if (!area) {
    return errorArea ? <div className="docsMensaje">{errorArea}</div> : <div className="docsVacio">cargando proyectos…</div>;
  }

  const sinShim = new Set(area.sinShim);
  const proyectos = area.proyectos.filter((p): p is ProyectoArea => p.elegible);

  return (
    <Seccion titulo="comandos vigilados por proyecto">
      <Lista>
        {proyectos.map((p) => (
          <Linea
            key={p.clave}
            titulo={p.clave}
            dato={p.listas.estado === 'ok' ? MODO_LLANO[p.listas.modo] : 'sin reglas'}
            detalle={detalleDe(p, sinShim).map((l) => (
              <span key={l}>{l}</span>
            ))}
            activa={p.clave === claveSel}
            onClick={() => elegir(p.clave)}
          />
        ))}
      </Lista>
    </Seccion>
  );
}
