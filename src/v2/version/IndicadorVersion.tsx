/* Versión en el nav (2026-10-22): el número que dice qué código está sirviendo el backend, y un
 * botón que abre el changelog. [por que aquí y no en el panel de configuración] La pregunta de la
 * usuaria —«¿está actualizada la aplicación?»— se contesta mirando la barra, sin entrar a ningún
 * sitio. [por que el distintivo] Un número suelto no dice nada: cuando el proceso arrancó antes del
 * último commit, el indicador se marca y el tooltip dice qué hacer (reiniciar el backend). */
import { useState } from 'react';
import { Tag } from 'lucide-react';
import { Button } from '../ui/form/Button.js';
import { PanelChangelog } from './PanelChangelog.js';
import { useVersion } from './useVersion.js';
import './version.css';

export function IndicadorVersion() {
  const { info, desactualizada, error } = useVersion();
  const [abierto, setAbierto] = useState(false);

  /* Sin datos todavía no se pinta nada: un «v…» vacío es ruido y un «0.0.0» mentiría. El error sí
   * se dice, porque callarlo dejaría el nav sin explicación. */
  if (error) {
    return (
      <span className="v2NavVersion v2NavVersionError" title={`no se pudo leer la versión: ${error}`}>
        versión ?
      </span>
    );
  }
  if (!info) return null;

  const titulo = desactualizada
    ? `El backend arrancó antes del commit ${info.commit ?? ''}: reinícialo para servir el código actual`
    : info.commit
      ? `${info.rama ?? 'sin rama'} · ${info.commit}`
      : 'versión del manager';

  return (
    <>
      <Button
        className={`v2NavVersion${desactualizada ? ' v2NavVersionVieja' : ''}`}
        onClick={() => setAbierto(true)}
        title={`versión ${info.version} · ${titulo} — abre el changelog`}
        aria-label={`Versión ${info.version}${desactualizada ? ', hay código más nuevo sin servir' : ''}. Abrir changelog`}
      >
        <Tag size={12} aria-hidden />
        <span className="v2NavVersionTexto">{info.version}</span>
        {desactualizada && <span className="v2NavVersionPunto" aria-hidden />}
      </Button>
      {abierto && <PanelChangelog info={info} desactualizada={desactualizada} onCerrar={() => setAbierto(false)} />}
    </>
  );
}
