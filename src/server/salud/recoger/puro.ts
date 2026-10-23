/* Funciones puras de la salud del roadmap: lee títulos sin tocar
 * disco. Reexportadas desde recoger.ts. [por que] Separadas de la lectura de disco de
 * recoger.ts para bajar de 300 líneas (19AA-13) y poder probarlas sin E/S. */
export function encabezados(texto: string | null): string[] {
  if (texto === null) return [];
  return texto
    .split('\n')
    .map((l) => l.match(/^#{1,2}\s+(.+?)\s*$/)?.[1])
    .filter((t): t is string => t !== undefined);
}
