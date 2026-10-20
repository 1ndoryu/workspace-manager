/* Funciones puras de la salud de planes y roadmap: cuentan casillas y títulos sin tocar
 * disco. Reexportadas desde recoger.ts. [por que] Separadas de la lectura de disco de
 * recoger.ts para bajar de 300 líneas (19AA-13) y poder probarlas sin E/S. */
/* Trabajo abierto de un plan: sus casillas sin marcar (`- [ ]`, `* [ ]`) y, si el roadmap lo
 * declara en «Planes activos», al menos una más. [por que] El roadmap solo lista trabajo
 * abierto (D8): un plan declarado sigue activo aunque use pasos numerados (F4.1, F4.2) en vez
 * de casillas. Contarlo como cerrado daba un «ciérralo» falso. */
export function abiertasDelPlan(texto: string, declarados: string[], archivo: string): number {
  const casillas = texto.match(/^\s*[-*]\s\[ \]/gm)?.length ?? 0;
  return casillas + (declarados.includes(archivo) ? 1 : 0);
}

export function encabezados(texto: string | null): string[] {
  if (texto === null) return [];
  return texto
    .split('\n')
    .map((l) => l.match(/^#{1,2}\s+(.+?)\s*$/)?.[1])
    .filter((t): t is string => t !== undefined);
}
