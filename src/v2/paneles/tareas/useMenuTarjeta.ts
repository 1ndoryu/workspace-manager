/* Ancla del menu de la tarjeta del kanban (07AA-16): posicion fija del menu
 * en el viewport + cierre en scroll/resize/Escape.
 * [por que] El menu es `position:absolute` dentro de la tarjeta y el
 * contenedor de columnas lleva `overflow-x:auto`: sin portal se recorta.
 * El ancla se calcula de la tarjeta (`getBoundingClientRect`) con clamp al
 * viewport (precedente `EtiquetaDeRuta.tsx`); la posicion viaja por CSS vars
 * y el cierre por el boundary de plataforma (`plataforma.js`, precedente
 * `MenuContextual`), sin `window`/`document` directos en el componente. */
import { useEffect, useState } from 'react';
import {
  altoVentana,
  anchoVentana,
  bajarDocumento,
  bajarVentana,
  suscribirDocumento,
  suscribirVentana,
} from '../../../shared/platform/plataforma.js';
import type { PosMenuTarea } from './MenuTarea.js';

const ANCHO_MENU = 260;
const ALTO_MENU = 400;

export function useMenuTarjeta(): {
  abierto: boolean;
  ancla: PosMenuTarea | null;
  abrir: (origen: Element | null) => void;
  cerrar: () => void;
} {
  const [ancla, setAncla] = useState<PosMenuTarea | null>(null);

  useEffect(() => {
    if (ancla === null) return;
    const cerrar = () => setAncla(null);
    const escape = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') cerrar();
    };
    suscribirVentana('scroll', cerrar, { capture: true });
    suscribirVentana('resize', cerrar);
    suscribirDocumento('keydown', escape);
    return () => {
      bajarVentana('scroll', cerrar, { capture: true });
      bajarVentana('resize', cerrar);
      bajarDocumento('keydown', escape);
    };
  }, [ancla]);

  function abrir(origen: Element | null): void {
    const r = origen?.getBoundingClientRect();
    const derecha = r?.right ?? anchoVentana() - 8;
    const x = Math.max(8, Math.min(derecha - ANCHO_MENU, anchoVentana() - ANCHO_MENU - 8));
    const abajo = (r?.bottom ?? 8) + 6;
    const y =
      abajo + ALTO_MENU > altoVentana() - 8
        ? Math.max(8, (r?.top ?? altoVentana()) - 6 - ALTO_MENU)
        : abajo;
    setAncla({ x, y });
  }

  function cerrar(): void {
    setAncla(null);
  }

  return { abierto: ancla !== null, ancla, abrir, cerrar };
}
