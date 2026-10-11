/* Diff y vista previa de las ediciones de la pestaña Guardián.
 * [por que] Toda escritura pasa por dos pasos: la vista previa (sin confirmar)
 * enseña el diff; confirmar repite la misma petición con `confirmar: true` y el
 * mismo hashPrevio, así que el servidor vuelve a comprobar el archivo. Quitado se
 * tacha y puesto lleva un borde: sin color (monocromo v2). */
import { Button } from '../../ui/form/Button.js';
import type { BloqueVista, VistaPrevia } from './vistas.js';

export function DiffGuardian({ etiqueta, diff }: BloqueVista) {
  if (!diff) return null;
  return (
    <div className="guardianDiff">
      <div className="guardianNota">
        {etiqueta} · línea {diff.desde}
      </div>
      {diff.quitar.map((linea, i) => (
        <div key={`quitar-${i}`} className="guardianDiffLinea guardianDiffLinea--quitar">
          {linea}
        </div>
      ))}
      {diff.poner.map((linea, i) => (
        <div key={`poner-${i}`} className="guardianDiffLinea guardianDiffLinea--poner">
          {linea}
        </div>
      ))}
    </div>
  );
}

interface PreviaProps {
  vista: VistaPrevia;
  enviando: boolean;
  onConfirmar: () => void;
  onDescartar: () => void;
}

export function PreviaGuardian({ vista, enviando, onConfirmar, onDescartar }: PreviaProps) {
  const confirmable = vista.cambia && !vista.motivo;
  return (
    <div className="guardianPrevia" role="region" aria-label="Vista previa">
      {vista.motivo && <div className="docsMensaje">{vista.motivo}</div>}
      {!vista.motivo && !vista.cambia && <div className="docsVacio">sin cambios que escribir</div>}
      {vista.bloques.map((b) => (
        <DiffGuardian key={b.etiqueta} etiqueta={b.etiqueta} diff={b.diff} />
      ))}
      <div className="guardianAcciones">
        {confirmable && (
          <Button pequeno disabled={enviando} onClick={onConfirmar}>
            confirmar escritura
          </Button>
        )}
        <Button pequeno disabled={enviando} onClick={onDescartar}>
          descartar
        </Button>
      </div>
    </div>
  );
}
