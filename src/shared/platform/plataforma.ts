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
