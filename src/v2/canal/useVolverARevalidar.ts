/* Revalidación al volver a la pestaña (20AA-24 F4).
 * [por que] El canal cubre el snapshot y los vivos, pero hay datos caros que cambian poco y no
 * viajan por ahí (análisis, salud, config privada, plantillas del guardián, tareas del puente).
 * Cargados sólo al montar, un cambio hecho fuera del tablero no aparecía nunca; recargar la página
 * era la única salida. Con esto, al volver a la pestaña se pide la foto de nuevo.
 * [por que un módulo aparte del canal] No necesita `EventSource` ni sabe de temas: es una regla de
 * visibilidad, y así la pueden usar paneles que no escuchan el canal.
 * [por que una referencia a la última función] El llamante pasa una lambda nueva en cada render;
 * suscribirse con ella obligaría a desuscribirse y volver a suscribirse sesenta veces por segundo
 * con un escaneo en marcha. Con la referencia se suscribe una vez y siempre se llama a la última. */
import { useEffect, useRef } from 'react';
import { pestanaVisible, suscribirDocumento, bajarDocumento } from '../../shared/platform/plataforma.js';

export function useVolverARevalidar(revalidar: () => void): void {
  const ultima = useRef(revalidar);
  ultima.current = revalidar;

  useEffect(() => {
    const alCambiar = (): void => {
      /* `visibilitychange` llega también al irse: revalidar ahí gastaría peticiones para una
       * pestaña que nadie mira. */
      if (pestanaVisible()) ultima.current();
    };
    suscribirDocumento('visibilitychange', alCambiar);
    return () => bajarDocumento('visibilitychange', alCambiar);
  }, []);
}
