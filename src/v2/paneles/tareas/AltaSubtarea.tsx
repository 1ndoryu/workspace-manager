/* Alta de una subtarea en linea (20AA-10 F4): una entrada sangrada bajo la
 * tarjeta padre, donde va a quedar la subtarea.
 * [por que en linea y no un modal] El alta de tarea es un modal (08AA-7)
 * porque la tarea es una unidad suelta; una subtarea es un paso dentro de
 * otra tarea y su sitio se ve: se escribe donde va a aparecer. Enter guarda,
 * Escape y el vacio cierran sin escribir nada. */
import { useState } from 'react';
import { CornerDownRight } from 'lucide-react';

interface AltaSubtareaProps {
  padre: string;
  onGuardar: (texto: string) => void;
  onCerrar: () => void;
}

export function AltaSubtarea(p: AltaSubtareaProps) {
  const [texto, setTexto] = useState('');
  const cerrar = () => {
    const limpio = texto.trim();
    if (limpio !== '') p.onGuardar(limpio);
    else p.onCerrar();
  };

  return (
    <div className="tareasFila tareasFila--sub tareasFila--alta">
      <span className="tareasSangria" aria-hidden>
        <CornerDownRight size={10} />
      </span>
      <input
        className="tareasRenombre"
        value={texto}
        autoFocus
        maxLength={1000}
        placeholder={`Nueva subtarea de «${p.padre}»…`}
        aria-label={`Texto de la nueva subtarea de ${p.padre}`}
        onChange={(ev) => setTexto(ev.target.value)}
        onBlur={cerrar}
        onKeyDown={(ev) => {
          if (ev.key === 'Enter') cerrar();
          if (ev.key === 'Escape') p.onCerrar();
        }}
      />
    </div>
  );
}
