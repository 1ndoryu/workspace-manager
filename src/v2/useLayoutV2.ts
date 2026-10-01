/* Hook del layout persistido del shell v2 (anchos de paneles laterales y
 * alto de la consola). [por que] Extraido de AppV2 para que el componente
 * quede visual (regla componente-sin-hook): el estado del layout y su
 * persistencia en localStorage viven aqui. */
import { useEffect, useState } from 'react';
import { guardarJson, leerJson } from '../shared/storage.js';

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
  const d = leerJson<Partial<LayoutV2>>(CLAVE_LAYOUT, 'no se pudo leer el layout guardado:');
  if (
    !d ||
    typeof d.anchoDetalle !== 'number' ||
    typeof d.anchoLista !== 'number' ||
    typeof d.altoConsola !== 'number'
  ) {
    return LAYOUT_DEFECTO;
  }
  return { anchoDetalle: d.anchoDetalle, anchoLista: d.anchoLista, altoConsola: d.altoConsola };
}

/* Leido una sola vez por carga de pagina para inicializar el layout. */
const layoutInicial = layoutGuardado();

export function useLayoutV2() {
  const [anchoDetalle, setAnchoDetalle] = useState(layoutInicial.anchoDetalle);
  const [anchoLista, setAnchoLista] = useState(layoutInicial.anchoLista);
  const [altoConsola, setAltoConsola] = useState(layoutInicial.altoConsola);

  /* Persiste el layout en cada cambio para sobrevivir a recargas. */
  useEffect(() => {
    guardarJson(
      CLAVE_LAYOUT,
      { anchoDetalle, anchoLista, altoConsola } satisfies LayoutV2,
      'no se pudo guardar el layout:',
    );
  }, [anchoDetalle, anchoLista, altoConsola]);

  return { anchoDetalle, setAnchoDetalle, anchoLista, setAnchoLista, altoConsola, setAltoConsola };
}
