/* Catalogo de traduccion de claves tecnicas -> nombres legibles en espanol.
 * [por que] El editor de config del gate muestra rutas tecnicas
 * (`analyzers › sentinel › config › directoryExceptions`) que los agentes
 * escriben pero que un humano no entiende. Este catalogo traduce cada segmento
 * a un nombre corto legible y una descripcion de una linea. Vive en shared/gate
 * porque lo usan el editor (cliente) y la consola de problemas (server).
 * Regla de robustez: NUNCA mostrar vacio. Si falta traduccion de un segmento,
 * se usa el segmento tecnico como nombre (fallback); solo se muestra la
 * descripcion cuando existe. */

export interface InfoSegmento {
  nombre: string;
  descripcion?: string;
}

/* Traduccion por segmento tecnico de ruta. La clave es el segmento EXACTO
 * tal como aparece en la ruta (case-sensitive). Si un segmento no esta,
 * se muestra tal cual (fallback). */
const CATALOGO: Record<string, InfoSegmento> = {
  /* ---- Raiz de sentinel.config.json ---- */
  schemaVersion: { nombre: 'Versión del esquema', descripcion: 'Versión del formato del archivo de configuración.' },
  mode: { nombre: 'Modo de operación', descripcion: 'Cómo aplica Sentinel las reglas (advisory = solo advierte).' },
  project: { nombre: 'Proyecto', descripcion: 'Identidad del repositorio (rama primaria, etc.).' },
  primaryBranch: { nombre: 'Rama primaria', descripcion: 'Rama principal del repositorio (normalmente main o master).' },
  includePatterns: { nombre: 'Patrones incluidos', descripcion: 'Archivos que el analizador considera en el análisis.' },
  excludePatterns: { nombre: 'Patrones excluidos', descripcion: 'Archivos excluidos del análisis.' },
  directoryExceptions: { nombre: 'Excepciones de directorios', descripcion: 'Carpetas que el analizador ignora por completo.' },
  rules: { nombre: 'Reglas', descripcion: 'Reglas activas del analizador y su severidad.' },
  portableBoundaries: { nombre: 'Límites portables', descripcion: 'Fronteras que el analizador debe respetar entre módulos.' },
  dom: { nombre: 'DOM', descripcion: 'Funciones o variables del DOM permitidas.' },
  window: { nombre: 'Window', descripcion: 'Accesos globales a window permitidos.' },
  services: { nombre: 'Servicios', descripcion: 'Servicios o módulos de servicio permitidos.' },
  loggerModules: { nombre: 'Módulos de log', descripcion: 'Módulos de logging permitidos.' },
  gate: { nombre: 'Gate', descripcion: 'Configuración del comando de cierre (gate).' },
  command: { nombre: 'Comando', descripcion: 'Comandos permitidos al ejecutar el gate.' },
  taskIdRequired: { nombre: 'ID de tarea obligatorio', descripcion: 'Exige un ID de tarea para cerrar el gate.' },
  guard: { nombre: 'Guard', descripcion: 'Comandos directos protegidos por el guard.' },
  directCommands: { nombre: 'Comandos directos', descripcion: 'Comandos que se ejecutan directamente sin intermediarios.' },
  runtime: { nombre: 'Runtime', descripcion: 'Versiones y archivos del runtime de Sentinel.' },
  minimumVersion: { nombre: 'Versión mínima', descripcion: 'Versión mínima de Sentinel requerida.' },
  protocolVersion: { nombre: 'Versión del protocolo', descripcion: 'Versión del protocolo del lock file.' },
  lockFile: { nombre: 'Archivo de lock', descripcion: 'Nombre del archivo de lock generado por Sentinel.' },
  analyzers: { nombre: 'Analizadores', descripcion: 'Analizadores activos y su configuración.' },
  sentinel: { nombre: 'Sentinel', descripcion: 'Configuración del analizador Sentinel.' },
  enabled: { nombre: 'Habilitado', descripcion: 'Activa o desactiva esta opción.' },
  config: { nombre: 'Configuración', descripcion: 'Configuración del analizador (se anida al esquema).' },
  profile: { nombre: 'Perfil', descripcion: 'Perfil de análisis activo.' },

  /* ---- Raiz de varsense.config.json ---- */
  variableFiles: { nombre: 'Archivos de variables', descripcion: 'Archivos que definen variables de entorno.' },
  scanAllFiles: { nombre: 'Escanear todos los archivos', descripcion: 'Analiza todos los archivos, no solo los de variables.' },
  hardcodedDetection: { nombre: 'Detección de valores fijos', descripcion: 'Detecta secretos o valores hardcodeados.' },
  allowedValues: { nombre: 'Valores permitidos', descripcion: 'Valores que no se marcan como sospechosos.' },
  properties: { nombre: 'Propiedades', descripcion: 'Propiedades o claves a analizar.' },
  inlineDetection: { nombre: 'Detección en línea', descripcion: 'Detecta valores en el código, no solo en variables.' },
  tokenDetection: { nombre: 'Detección de tokens', descripcion: 'Detecta tokens duplicados o sin usar.' },
  duplicate: { nombre: 'Duplicados', descripcion: 'Detecta tokens duplicados.' },
  unused: { nombre: 'Sin uso', descripcion: 'Detecta tokens definidos pero sin usar.' },
  bannedProperties: { nombre: 'Propiedades prohibidas', descripcion: 'Propiedades que no se permiten en el código.' },
  orphanClassDetection: { nombre: 'Detección de clases huérfanas', descripcion: 'Detecta clases CSS sin usar.' },
  minClassLength: { nombre: 'Longitud mínima de clase', descripcion: 'Tamaño mínimo para considerar una clase sospechosa.' },
  excludeClassPatterns: { nombre: 'Patrones de clase excluidos', descripcion: 'Clases que no se analizan.' },

  /* ---- Claves comunes ---- */
  severity: { nombre: 'Severidad', descripcion: 'Nivel de severidad del hallazgo (error, warning, etc.).' },
  mapa: { nombre: 'Mapa', descripcion: 'Pares clave-valor.' },

  /* ---- Claves de config de una regla (REGLA en sentinel.ts) ---- */
  habilitada: { nombre: 'Habilitada', descripcion: 'Activa o desactiva esta regla.' },
  severidad: { nombre: 'Severidad', descripcion: 'Severidad con la que se reporta la regla.' },

  /* ---- Reglas estaticas conocidas (CATALOGO_REGLAS en reglas.ts).
   * Las reglas dinamicas de cada proyecto (no en el catalogo) caen al
   * fallback tecnico, que es el comportamiento correcto (nunca vacio). ---- */
  'at-generico-php': { nombre: '@ genérico en PHP', descripcion: 'Detecta el supresor de errores @ en código PHP.' },
  'barras-decorativas': { nombre: 'Barras decorativas', descripcion: 'Detecta bloques de comentario solo decorativos.' },
  'catch-vacio': { nombre: 'Catch vacío', descripcion: 'Detecta bloques catch que se tragan el error.' },
  'css-adhoc-button-style': { nombre: 'Estilo CSS ad-hoc en botones', descripcion: 'Detecta estilos de botón definidos a mano en lugar de usar el sistema de diseño.' },
  'emoji-en-codigo': { nombre: 'Emoji en código', descripcion: 'Detecta emojis en el código fuente.' },
  'eval-prohibido': { nombre: 'Eval prohibido', descripcion: 'Detecta el uso de eval o equivalentes inseguros.' },
  'git-add-all': { nombre: 'Git add all', descripcion: 'Detecta git add . o git add -A.' },
  'hardcoded-secret': { nombre: 'Secreto hardcodeado', descripcion: 'Detecta secretos o credenciales en el código.' },
  'inline-style-prohibido': { nombre: 'Estilo inline prohibido', descripcion: 'Detecta estilos CSS inline en el HTML.' },
  'innerhtml-variable': { nombre: 'InnerHTML con variable', descripcion: 'Detecta asignaciones de innerHTML con contenido dinámico.' },
  'php-supresor-at': { nombre: 'Supresor @ en PHP', descripcion: 'Detecta el operador de supresión de errores @ en PHP.' },
  'sqlx-query-as-sin-macro': { nombre: 'SQLx query_as sin macro', descripcion: 'Detecta query_as sin la macro verificada en compile-time.' },
  'sqlx-query-sin-macro': { nombre: 'SQLx query sin macro', descripcion: 'Detecta query sin la macro verificada en compile-time.' },
  'todo-pendiente': { nombre: 'TODO pendiente', descripcion: 'Detecta comentarios TODO/FIXME sin resolver.' },
};

/* Devuelve la traduccion de un segmento tecnico, o el propio segmento si no
 * hay traduccion (fallback: nunca mostrar vacio). */
export function infoSegmento(seg: string): InfoSegmento {
  return CATALOGO[seg] ?? { nombre: seg };
}

/* Devuelve el nombre legible de una ruta completa (segmentos unidos por ' › '),
 * traduciendo cada segmento y con fallback al segmento tecnico. */
export function nombreDeRuta(ruta: (string | number)[]): string {
  if (ruta.length === 0) return '(configuración)';
  return ruta.map((x) => infoSegmento(String(x)).nombre).join(' › ');
}

/* Devuelve la descripcion corta de una ruta: la del SEGMENTO MAS PROFUNDO que
 * tenga descripcion (la mas especifica). Si ninguno tiene, undefined. */
export function descripcionDeRuta(ruta: (string | number)[]): string | undefined {
  for (let i = ruta.length - 1; i >= 0; i--) {
    const d = infoSegmento(String(ruta[i])).descripcion;
    if (d) return d;
  }
  return undefined;
}
