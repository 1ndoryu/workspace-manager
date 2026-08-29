/* Menu contextual global (clic derecho) sobre un proyecto.
 * [por que] El usuario pidio un menu contextual para proyectos: al hacer
 * clic derecho en la lista, las cajas del mapa o la consola aparece para
 * configurar (ir a la pagina 'config' con ese proyecto) o ignorar. */
import { useEffect } from 'react';
import { useWorkspaceStore } from '../hooks/useWorkspace.js';
import './MenuContextual.css';

export function MenuContextual() {
  const menu = useWorkspaceStore((s) => s.menuContextual);
  const cerrar = useWorkspaceStore((s) => s.cerrarMenuContextual);
  const configurar = useWorkspaceStore((s) => s.configurarProyecto);
  const snapshot = useWorkspaceStore((s) => s.snapshot);
  const cambiarIgnorado = useWorkspaceStore((s) => s.cambiarIgnorado);

  /* Cierra con clic fuera, Escape, scroll o al redimensionar. */
  useEffect(() => {
    if (!menu) return;
    const cerrarFuera = () => cerrar();
    const escape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cerrar();
    };
    document.addEventListener('pointerdown', cerrarFuera);
    window.addEventListener('scroll', cerrarFuera, true);
    window.addEventListener('resize', cerrarFuera);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', cerrarFuera);
      window.removeEventListener('scroll', cerrarFuera, true);
      window.removeEventListener('resize', cerrarFuera);
      document.removeEventListener('keydown', escape);
    };
  }, [menu, cerrar]);

  if (!menu) return null;

  const ignorado = snapshot?.config.ignorados.includes(menu.clave) ?? false;

  return (
    <div
      className="menuContextual"
      style={{ left: menu.x, top: menu.y }}
      onPointerDown={(e) => e.stopPropagation()}
      role="menu"
      aria-label="Menú del proyecto"
    >
      <button
        type="button"
        role="menuitem"
        className="menuContextualItem"
        onClick={() => configurar(menu.clave)}
      >
        configurar
      </button>
      <button
        type="button"
        role="menuitem"
        className="menuContextualItem"
        onClick={() => {
          void cambiarIgnorado(menu.clave, !ignorado);
          cerrar();
        }}
      >
        {ignorado ? 'dejar de ignorar' : 'ignorar'}
      </button>
    </div>
  );
}