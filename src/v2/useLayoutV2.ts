/* Hook del layout persistido del shell v2 (anchos de paneles laterales y
 * alto de la consola). [por que] Extraido de AppV2 para que el componente
 * quede visual (regla componente-sin-hook): el estado del layout y su
 * persistencia en localStorage viven aqui. */
import { useEffect, useState } from 'react';
import { logger } from '../shared/logger.js';

export interface LayoutV2 {
  anchoDetalle: number;
  anchoLista: number;
  altoConsola: number;
}

export const MIN_ANCHO = 160;
export const MAX_ANCHO = 600;
export const MIN_ALTO = 120;
export const MAX_ALTO = 500;

const CLAVE_LAYOUT = 'workspaceManager:layout';
const LAYOUT_DEFECTO: LayoutV2 = { anchoDetalle: 300, anchoLista: 260, altoConsola: 200 };

function layoutGuardado(): LayoutV2 {
  try {
    const raw = localStorage.getItem(CLAVE_LAYOUT);
    if (!raw) return LAYOUT_DEFECTO;
    const d = JSON.parse(raw) as Partial<LayoutV2>;
    if (
      typeof d.anchoDetalle !== 'number' ||
      typeof d.anchoLista !== 'number' ||
      typeof d.altoConsola !== 'number'
    ) {
      return LAYOUT_DEFECTO;
    }
    return { anchoDetalle: d.anchoDetalle, anchoLista: d.anchoLista, altoConsola: d.altoConsola };
  } catch (err) {
    logger.warn('no se pudo leer el layout guardado:', err);
    return LAYOUT_DEFECTO;
  }
}

/* Leido una sola vez por carga de pagina para inicializar el layout. */
const layoutInicial = layoutGuardado();

export function useLayoutV2() {
  const [anchoDetalle, setAnchoDetalle] = useState(layoutInicial.anchoDetalle);
  const [anchoLista, setAnchoLista] = useState(layoutInicial.anchoLista);
  const [altoConsola, setAltoConsola] = useState(layoutInicial.altoConsola);

  /* Persiste el layout en cada cambio para sobrevivir a recargas. */
  useEffect(() => {
    try {
      localStorage.setItem(
        CLAVE_LAYOUT,
        JSON.stringify({ anchoDetalle, anchoLista, altoConsola } satisfies LayoutV2),
      );
    } catch (err) {
      logger.warn('no se pudo guardar el layout:', err);
    }
  }, [anchoDetalle, anchoLista, altoConsola]);

  return { anchoDetalle, setAnchoDetalle, anchoLista, setAnchoLista, altoConsola, setAltoConsola };
}
