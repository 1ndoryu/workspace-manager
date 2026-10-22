/* Lectura del CHANGELOG.md para el panel (2026-10-22). [por que fuera del componente] Así se
 * prueba sin React y sin DOM: son dos funciones puras sobre un texto.
 */
/* Una línea del changelog ya interpretada. `seccion` = `##`, `titulo` = `#`, `punto` = `- …`.
 * `n` es el número de línea del fichero donde empieza el bloque: da una clave estable para la
 * lista de React (el índice no identifica nada cuando entran líneas nuevas al hacer scroll). */
export type Linea = { n: number; tipo: 'titulo' | 'seccion' | 'subtitulo' | 'punto' | 'texto'; texto: string };

/* Marcas inline: `código`, **negrita** y [texto](url). [por que quitarlas y no pintarlas] El
 * panel es de lectura; ver «`package.json`» o «**El mapa**» con las marcas puestas parece un
 * fallo del panel. El código sí se pinta —es lo que se lee mal—, y el enlace se queda con su
 * texto: aquí no se navega. */
export function trozos(texto: string): Array<{ codigo: boolean; texto: string }> {
  const salida: Array<{ codigo: boolean; texto: string }> = [];
  const sinMarcas = texto.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  for (const parte of sinMarcas.split(/(`[^`]*`)/g)) {
    if (parte === '') continue;
    if (parte.startsWith('`') && parte.endsWith('`') && parte.length > 2) {
      salida.push({ codigo: true, texto: parte.slice(1, -1) });
    } else {
      salida.push({ codigo: false, texto: parte });
    }
  }
  return salida;
}

export function interpretar(markdown: string): Linea[] {
  const salida: Linea[] = [];
  /* Todo lo anterior a la primera sección es la nota de cabecera del fichero (formato,
   * dónde vive la versión): contexto de quien lo edita, ruido para quien lo lee. */
  const desde = markdown.search(/^## /m);
  const previas = desde >= 0 ? markdown.slice(0, desde).split('\n').length - 1 : 0;
  const cuerpo = desde >= 0 ? markdown.slice(desde) : markdown;
  let n = previas;
  for (const cruda of cuerpo.split('\n')) {
    n += 1;
    const linea = cruda.trim();
    if (linea === '') continue;
    /* [por que unir] El fichero se escribe a 100 columnas: una entrada ocupa varias líneas y,
     * pintadas sueltas, cada trozo parece una entrada nueva. Las continuaciones se pegan al
     * bloque anterior, que es lo que el markdown significa. */
    const anterior = salida[salida.length - 1];
    if (!/^(#{1,3} |- )/.test(linea) && anterior && anterior.tipo !== 'titulo' && anterior.tipo !== 'seccion' && anterior.tipo !== 'subtitulo') {
      anterior.texto += ` ${linea}`;
      continue;
    }
    if (linea.startsWith('### ')) salida.push({ n, tipo: 'subtitulo', texto: linea.slice(4) });
    else if (linea.startsWith('## ')) salida.push({ n, tipo: 'seccion', texto: linea.slice(3) });
    else if (linea.startsWith('# ')) salida.push({ n, tipo: 'titulo', texto: linea.slice(2) });
    else if (linea.startsWith('- ')) salida.push({ n, tipo: 'punto', texto: linea.slice(2) });
    else salida.push({ n, tipo: 'texto', texto: linea });
  }
  return salida;
}

