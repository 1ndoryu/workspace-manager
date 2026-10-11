/* Sección Mantenimiento: shims y perfiles del guard. Primero se simula (--dry-run);
 * aplicar exige una simulación correcta con las mismas opciones.
 * [por que] Cambia archivos locales del entorno, así que aplicar no es un paso
 * directo: cambiar una opción invalida la simulación anterior. */
import { Seccion } from '../../../ui/caja/Caja.js';
import { Button } from '../../../ui/form/Button.js';
import type { GuardianDatos } from '../useGuardian.js';
import { useMantenimiento } from '../useMantenimiento.js';

export function SeccionMantenimiento({ datos }: { datos: GuardianDatos }) {
  const {
    conShims,
    conPerfiles,
    cambiarShims,
    cambiarPerfiles,
    resultado,
    enviando,
    aplicable,
    simular,
    aplicar,
  } = useMantenimiento(datos);

  return (
    <Seccion titulo="shims y perfiles">
      <label className="guardianCasilla">
        <input
          type="checkbox"
          checked={conShims}
          onChange={(e) => cambiarShims(e.target.checked)}
        />
        incluir shims
      </label>
      <label className="guardianCasilla">
        <input
          type="checkbox"
          checked={conPerfiles}
          onChange={(e) => cambiarPerfiles(e.target.checked)}
        />
        incluir perfiles
      </label>
      <div className="guardianAcciones">
        <Button pequeno disabled={enviando} onClick={() => void simular()}>
          simular
        </Button>
        <Button pequeno disabled={!aplicable || enviando} onClick={() => void aplicar()}>
          aplicar
        </Button>
      </div>
      {resultado && (
        <>
          <div className="guardianNota">
            {resultado.modo} · estado {resultado.estado}
            {resultado.codigo !== null ? ` · código ${resultado.codigo}` : ''}
          </div>
          {resultado.motivo && <div className="docsMensaje">{resultado.motivo}</div>}
          <pre className="guardianSalida">{resultado.salida || '(sin salida)'}</pre>
        </>
      )}
    </Seccion>
  );
}
