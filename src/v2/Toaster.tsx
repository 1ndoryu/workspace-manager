/* Toaster: renderiza los toasts del store en una esquina, por encima de
 * todo, con estetica monocroma coherente con el resto de la v2. */
import { useToasts } from './toast.js';
import './styles/v2.css';

export function Toaster() {
  const toasts = useToasts((s) => s.toasts);
  const descartar = useToasts((s) => s.descartar);

  if (toasts.length === 0) return null;

  return (
    <div className="toasts" aria-live="polite" role="status">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          className={`toast toast--${t.tipo}`}
          onClick={() => descartar(t.id)}
          title="descartar"
        >
          <span className="toastMarcador" aria-hidden="true">
            {t.tipo === 'ok' ? '✓' : t.tipo === 'error' ? '✕' : 'i'}
          </span>
          <span className="toastTexto">{t.mensaje}</span>
        </button>
      ))}
    </div>
  );
}