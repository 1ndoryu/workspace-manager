/* Punto de entrada del cliente: monta la App React. */
import { createRoot } from 'react-dom/client';
import { App } from './App.js';

const contenedor = document.getElementById('root');
if (!contenedor) throw new Error('No existe #root');

createRoot(contenedor).render(<App />);
