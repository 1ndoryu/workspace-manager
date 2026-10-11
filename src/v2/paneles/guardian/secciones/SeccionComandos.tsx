/* Sección Comandos: qué comandos intercepta el guard en el proyecto elegido.
 * [por que] El efecto depende del modo: enforce bloquea, observe observa y
 * pass-through no hace nada. Los comandos sin shim (git, python, pip) no pasan
 * por el guard: se marcan aparte para no darlos por cubiertos. */
import { Seccion } from '../../../ui/caja/Caja.js';
import type { GuardianDatos } from '../useGuardian.js';
import { LISTAS, type ModoGuard } from '../tiposGuardian.js';

const EFECTO: Record<ModoGuard, string> = {
  enforce: 'bloquea',
  observe: 'observa',
  'pass-through': 'sin efecto',
};

const SIN_SHIM = 'no interceptado (sin shim)';

interface Fila {
  lista: string;
  comando: string;
  efecto: string;
}

export function SeccionComandos({ datos }: { datos: GuardianDatos }) {
  const { area, detalle, claveSel, errorDetalle } = datos;
  const titulo = claveSel ? `comandos de ${claveSel}` : 'comandos';

  if (!detalle) {
    return (
      <Seccion titulo={titulo}>
        {errorDetalle ? (
          <div className="docsMensaje">{errorDetalle}</div>
        ) : (
          <div className="docsVacio">{claveSel ? 'cargando proyecto…' : 'elige un proyecto en el menú'}</div>
        )}
      </Seccion>
    );
  }

  const { listas } = detalle;
  if (listas.estado !== 'ok') {
    return (
      <Seccion titulo={titulo}>
        <div className="docsMensaje">
          {listas.estado === 'ausente' ? 'sin política de listas' : listas.motivo}
        </div>
      </Seccion>
    );
  }

  const sinShim = area?.sinShim ?? [];
  const filas: Fila[] = LISTAS.flatMap((lista) =>
    listas.listas[lista].map((comando) => ({
      lista,
      comando,
      efecto: sinShim.includes(comando) ? SIN_SHIM : EFECTO[listas.modo],
    })),
  );
  for (const comando of sinShim) {
    if (!filas.some((f) => f.comando === comando)) {
      filas.push({ lista: '—', comando, efecto: SIN_SHIM });
    }
  }

  return (
    <Seccion titulo={titulo}>
      <div className="guardianNota">modo del proyecto: {listas.modo}</div>
      {filas.length === 0 ? (
        <div className="docsVacio">sin comandos en las listas</div>
      ) : (
        <table className="guardianTabla">
          <thead>
            <tr>
              <th>lista</th>
              <th>comando</th>
              <th>efecto</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f) => (
              <tr key={`${f.lista}-${f.comando}`}>
                <td>{f.lista}</td>
                <td>{f.comando}</td>
                <td>{f.efecto}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Seccion>
  );
}
