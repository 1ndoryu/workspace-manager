/* Boundary de plataforma web (DOM + window).
 * [por que] sentinel solo permite tocar document/window desde un boundary de
 * plataforma (dom-access/window-reference-outside-platform; este modulo vive
 * en /platform/ y es boundary por defecto, sin config extra). La consola es
 * web-only de escritorio, asi que el adapter delega directo: no abstrae
 * entornos que no existen, solo concentra los toques para que sean
 * auditables en un unico punto. */
export function anchoVentana(): number {
  return window.innerWidth;
}

export function altoVentana(): number {
  return window.innerHeight;
}

export function cuerpoDocumento(): HTMLElement {
  return document.body;
}

export function elementoPorId(id: string): HTMLElement | null {
  return document.getElementById(id);
}

export function suscribirVentana<K extends keyof WindowEventMap>(
  tipo: K,
  oyente: (e: WindowEventMap[K]) => void,
  opciones?: AddEventListenerOptions,
): void {
  window.addEventListener(tipo, oyente as EventListener, opciones);
}

export function bajarVentana<K extends keyof WindowEventMap>(
  tipo: K,
  oyente: (e: WindowEventMap[K]) => void,
  opciones?: AddEventListenerOptions,
): void {
  window.removeEventListener(tipo, oyente as EventListener, opciones);
}

/* Abre una URL en una pestana nueva. [por que] El acceso al navegador va por esta
 * capa, para que los componentes no toquen `window` directamente. `noopener` corta el
 * enlace con la pestana de origen: la URL la elige el registro, no nosotros. */
export function abrirPestana(url: string): void {
  window.open(url, '_blank', 'noopener');
}

export function suscribirDocumento<K extends keyof DocumentEventMap>(
  tipo: K,
  oyente: (e: DocumentEventMap[K]) => void,
): void {
  document.addEventListener(tipo, oyente as EventListener);
}

export function bajarDocumento<K extends keyof DocumentEventMap>(
  tipo: K,
  oyente: (e: DocumentEventMap[K]) => void,
): void {
  document.removeEventListener(tipo, oyente as EventListener);
}

/* Canal de eventos en vivo del servidor (SSE). [por que un constructor y no `new EventSource`
 * suelto] El día que la app de escritorio sirva su propio origen, o que haya que sustituir el
 * canal, se cambia aquí y no en cada consumidor; y el DOM queda tocado sólo en el boundary. */
export function abrirCanalEventos(url: string): EventSource {
  return new EventSource(url);
}

/* Reloj del navegador, para textos relativos («hace 4 min»). [por que] Sin esto cada componente
 * leería `Date.now()` por su cuenta y no habría forma de probar el texto. */
export function ahoraMs(): number {
  return Date.now();
}

/* ¿Está la pestaña a la vista? [por que] Lo que se entrega en vivo (el canal SSE) no hace falta
 * en una pestaña oculta: con esto, la pestaña en segundo plano cierra su canal y el servidor deja
 * de hacer pasadas para nadie. */
export function pestanaVisible(): boolean {
  return document.visibilityState !== 'hidden';
}
