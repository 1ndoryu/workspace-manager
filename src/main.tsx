/* Punto de entrada del cliente: monta la App v2 (monocromo).
 * [por que] El usuario pidio reiniciar el front en v2 con reglas estrictas
 * (blanco/negro, sin radios, sin sombras, sin bold). La v1 queda en
 * src/components y src/App.tsx por si se necesita revertir. */
import { createRoot } from 'react-dom/client';
import { AppV2 } from './v2/AppV2.js';

const contenedor = document.getElementById('root');
if (!contenedor) throw new Error('No existe #root');

createRoot(contenedor).render(<AppV2 />);
