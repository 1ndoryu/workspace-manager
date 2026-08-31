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
  /* Explicacion detallada para el tooltip del editor: breve, clara y
   * suficiente para entender de que trata la opcion sin mirar la doc. */
  detalle?: string;
}

/* Traduccion por segmento tecnico de ruta. La clave es el segmento EXACTO
 * tal como aparece en la ruta (case-sensitive). Si un segmento no esta,
 * se muestra tal cual (fallback). */
import { CATALOGO_REGLAS } from './etiquetas-reglas.js';

const CATALOGO_BASE: Record<string, InfoSegmento> = {
  /* ---- Raiz de sentinel.config.json ---- */
  schemaVersion: {
    nombre: 'Versión del esquema',
    descripcion: 'Versión del formato del archivo de configuración.',
    detalle: 'Indica la versión del formato de sentinel.config.json que entiende este runtime de Sentinel. No la cambies a mano: debe coincidir con la versión que espera la instalada.',
  },
  mode: {
    nombre: 'Modo de operación',
    descripcion: 'Cómo aplica Sentinel las reglas (advisory = solo advierte).',
    detalle: 'Define cómo aplica Sentinel las reglas. El valor habitual es advisory, que solo informa y advierte sin bloquear; otros modos pueden exigir cumplimiento estricto antes de cerrar.',
  },
  project: {
    nombre: 'Proyecto',
    descripcion: 'Identidad del repositorio (rama primaria, etc.).',
    detalle: 'Identifica el repositorio que vigila Sentinel. Aquí se declara la rama primaria sobre la que se integra el trabajo y contra la que se validan las ramas de tarea.',
  },
  primaryBranch: {
    nombre: 'Rama primaria',
    descripcion: 'Rama principal del repositorio (normalmente main o master).',
    detalle: 'Rama principal del repositorio, normalmente main o master. Sentinel la usa como destino de integración y como referencia para validar claims y ramas de tarea.',
  },
  includePatterns: {
    nombre: 'Patrones incluidos',
    descripcion: 'Archivos que el analizador considera en el análisis.',
    detalle: 'Lista de patrones glob de archivos que el analizador SÍ considera. Si está vacía, se asume que analiza todo el proyecto. Útil para limitar el análisis a ciertas carpetas o extensiones.',
  },
  excludePatterns: {
    nombre: 'Patrones excluidos',
    descripcion: 'Archivos excluidos del análisis.',
    detalle: 'Lista de patrones glob de archivos que el analizador se salta por completo. Se usa para build, código generado, dependencias o plantillas que no deben evaluarse.',
  },
  directoryExceptions: {
    nombre: 'Excepciones de directorios',
    descripcion: 'Carpetas que el analizador ignora por completo.',
    detalle: 'Carpetas que el analizador ignora por completo y no recorre, p. ej. node_modules, dist o .git. Útil cuando un directorio tiene código que no debe evaluarse.',
  },
  rules: {
    nombre: 'Reglas',
    descripcion: 'Reglas activas del analizador y su severidad.',
    detalle: 'Reglas activas del analizador. Cada regla puede activarse o desactivarse con habilitada y ajustar su severidad (error, warning, information, hint).',
  },
  portableBoundaries: {
    nombre: 'Límites portables',
    descripcion: 'Fronteras que el analizador debe respetar entre módulos.',
    detalle: 'Fronteras entre capas o módulos portables que el analizador debe respetar. Aquí declaras qué símbolos globales (DOM, window, servicios, logs) están permitidos en cada frontera.',
  },
  dom: {
    nombre: 'DOM',
    descripcion: 'Funciones o variables del DOM permitidas.',
    detalle: 'Funciones o variables del DOM que se permiten cruzar la frontera portable sin marcarlas como violación.',
  },
  window: {
    nombre: 'Window',
    descripcion: 'Accesos globales a window permitidos.',
    detalle: 'Accesos globales a window que están permitidos en el código, p. ej. window.location o window.fetch.',
  },
  services: {
    nombre: 'Servicios',
    descripcion: 'Servicios o módulos de servicio permitidos.',
    detalle: 'Módulos de servicio que pueden cruzarse en la frontera portable y no se consideran violación.',
  },
  loggerModules: {
    nombre: 'Módulos de log',
    descripcion: 'Módulos de logging permitidos.',
    detalle: 'Módulos de logging permitidos a través de la frontera portable, para que el código pueda registrar sin violar los límites.',
  },
  gate: {
    nombre: 'Gate',
    descripcion: 'Configuración del comando de cierre (gate).',
    detalle: 'Configura el comando de cierre (gate): qué comandos puede ejecutar al cerrar una tarea y si exige un ID de tarea para hacerlo.',
  },
  command: {
    nombre: 'Comando',
    descripcion: 'Comandos permitidos al ejecutar el gate.',
    detalle: 'Comandos que el gate permite ejecutar al cerrar una tarea. Solo estos comandos pasan el control de cierre.',
  },
  taskIdRequired: {
    nombre: 'ID de tarea obligatorio',
    descripcion: 'Exige un ID de tarea para cerrar el gate.',
    detalle: 'Si está activado, el gate exige un ID de tarea para cerrar. Evita cerrar trabajo sin trazabilidad y asegura que cada cierre corresponde a una tarea registrada.',
  },
  guard: {
    nombre: 'Guard',
    descripcion: 'Comandos directos protegidos por el guard.',
    detalle: 'Protege comandos directos: define qué comandos pueden ejecutarse sin pasar por el flujo normal de coordinación. Es una lista de excepciones controladas.',
  },
  directCommands: {
    nombre: 'Comandos directos',
    descripcion: 'Comandos que se ejecutan directamente sin intermediarios.',
    detalle: 'Mapa de comandos que se ejecutan directamente, sin intermediarios. Cada entrada define un comando directo permitido y su configuración.',
  },
  runtime: {
    nombre: 'Runtime',
    descripcion: 'Versiones y archivos del runtime de Sentinel.',
    detalle: 'Declara la versión mínima de Sentinel, la versión del protocolo del lock y el nombre del lock file. Sirve para validar que la instalación coincide con lo que espera el proyecto.',
  },
  minimumVersion: {
    nombre: 'Versión mínima',
    descripcion: 'Versión mínima de Sentinel requerida.',
    detalle: 'Versión mínima de Sentinel requerida para operar. Si la versión instalada es menor, el gate avisa o falla según la configuración.',
  },
  protocolVersion: {
    nombre: 'Versión del protocolo',
    descripcion: 'Versión del protocolo del lock file.',
    detalle: 'Versión del protocolo del lock file (sentinel.lock.json). Define la compatibilidad del formato de lock entre versiones de Sentinel.',
  },
  lockFile: {
    nombre: 'Archivo de lock',
    descripcion: 'Nombre del archivo de lock generado por Sentinel.',
    detalle: 'Nombre del archivo de lock que genera Sentinel al coordinar tareas. Se usa para guardar el estado de coordinación y evitar conflictos.',
  },
  analyzers: {
    nombre: 'Analizadores',
    descripcion: 'Analizadores activos y su configuración.',
    detalle: 'Lista de analizadores activos (sentinel, varsense, php, sql…) y su configuración. Cada analizador tiene enabled (activo), profile (perfil) y config (ajustes).',
  },
  sentinel: {
    nombre: 'Sentinel',
    descripcion: 'Configuración del analizador Sentinel.',
    detalle: 'Configuración del analizador Sentinel dentro de analyzers. Aquí se activa, se elige el perfil y se anidan los ajustes de análisis.',
  },
  enabled: {
    nombre: 'Habilitado',
    descripcion: 'Activa o desactiva esta opción.',
    detalle: 'Activa o desactiva esta opción. Desactivada no se evalúa ni se reporta.',
  },
  config: {
    nombre: 'Configuración',
    descripcion: 'Configuración del analizador (se anida al esquema).',
    detalle: 'Configuración específica del analizador. Puede ser un objeto anidado con las mismas opciones del esquema o una ruta a otro archivo de configuración.',
  },
  profile: {
    nombre: 'Perfil',
    descripcion: 'Perfil de análisis activo.',
    detalle: 'Perfil de análisis que usa este analizador. Si está vacío, se usa la configuración por defecto del proyecto.',
  },

  /* ---- Raiz de varsense.config.json ---- */
  variableFiles: {
    nombre: 'Archivos de variables',
    descripcion: 'Archivos que definen variables de entorno.',
    detalle: 'Archivos que definen variables de entorno, p. ej. .env, .env.local o .env.production. VarSense los lee para conocer los tokens y variables del proyecto.',
  },
  scanAllFiles: {
    nombre: 'Escanear todos los archivos',
    descripcion: 'Analiza todos los archivos, no solo los de variables.',
    detalle: 'Si está activado, analiza todos los archivos del proyecto, no solo los de variables. Útil para detectar valores hardcodeados en cualquier parte del código.',
  },
  hardcodedDetection: {
    nombre: 'Detección de valores fijos',
    descripcion: 'Detecta secretos o valores hardcodeados.',
    detalle: 'Detecta valores fijos sospechosos (secretos, claves API, tokens) escritos directamente en el código en lugar de usar variables de entorno.',
  },
  allowedValues: {
    nombre: 'Valores permitidos',
    descripcion: 'Valores que no se marcan como sospechosos.',
    detalle: 'Lista de valores que NO se marcan como sospechosos aunque parezcan secretos, p. ej. placeholders de ejemplo como your-api-key o test.',
  },
  properties: {
    nombre: 'Propiedades',
    descripcion: 'Propiedades o claves a analizar.',
    detalle: 'Propiedades o claves a vigilar. Cada entrada define si la propiedad está habilitada o no para la detección.',
  },
  inlineDetection: {
    nombre: 'Detección en línea',
    descripcion: 'Detecta valores en el código, no solo en variables.',
    detalle: 'Detecta valores sospechosos directamente en el código fuente, no solo en archivos de variables. Complementa a hardcodedDetection.',
  },
  tokenDetection: {
    nombre: 'Detección de tokens',
    descripcion: 'Detecta tokens duplicados o sin usar.',
    detalle: 'Detecta problemas con tokens del proyecto: duplicados (misma clave en varios sitios) o sin uso (definidos pero nunca referenciados).',
  },
  duplicate: {
    nombre: 'Duplicados',
    descripcion: 'Detecta tokens duplicados.',
    detalle: 'Detecta tokens o variables definidos más de una vez con el mismo nombre. Ayuda a evitar ambigüedad entre archivos de variables.',
  },
  unused: {
    nombre: 'Sin uso',
    descripcion: 'Detecta tokens definidos pero sin usar.',
    detalle: 'Detecta tokens o variables definidos pero nunca usados en el código. Ayuda a mantener las variables de entorno limpias.',
  },
  bannedProperties: {
    nombre: 'Propiedades prohibidas',
    descripcion: 'Propiedades que no se permiten en el código.',
    detalle: 'Propiedades o claves que están prohibidas en el código. Si aparece alguna, se reporta con la severidad configurada.',
  },
  orphanClassDetection: {
    nombre: 'Detección de clases huérfanas',
    descripcion: 'Detecta clases CSS sin usar.',
    detalle: 'Detecta clases CSS definidas pero nunca usadas en el código. Ayuda a detectar estilos muertos que ensucian la hoja de estilos.',
  },
  minClassLength: {
    nombre: 'Longitud mínima de clase',
    descripcion: 'Tamaño mínimo para considerar una clase sospechosa.',
    detalle: 'Longitud mínima del nombre de una clase para considerarla huérfana. Los nombres muy cortos (p. ej. .a) se ignoran para evitar falsos positivos.',
  },
  excludeClassPatterns: {
    nombre: 'Patrones de clase excluidos',
    descripcion: 'Clases que no se analizan.',
    detalle: 'Patrones de clases CSS que nunca se analizan como huérfanas, p. ej. clases de librerías o utilitarias que se usan dinámicamente.',
  },

  /* ---- Claves comunes ---- */
  severity: {
    nombre: 'Severidad',
    descripcion: 'Nivel de severidad del hallazgo (error, warning, etc.).',
    detalle: 'Nivel de severidad con el que se reporta un hallazgo: error (bloquea), warning (avisa), information (informa) o hint (sugerencia).',
  },
  mapa: {
    nombre: 'Mapa',
    descripcion: 'Pares clave-valor.',
    detalle: 'Colección de pares clave-valor. Cada clave del mapa se trata como una entrada independiente.',
  },

  /* ---- Claves de config de una regla (REGLA en sentinel.ts) ---- */
  habilitada: {
    nombre: 'Habilitada',
    descripcion: 'Activa o desactiva esta regla.',
    detalle: 'Activa o desactiva esta regla. Desactivada no se evalúa y no genera hallazgos.',
  },
  severidad: {
    nombre: 'Severidad',
    descripcion: 'Severidad con la que se reporta la regla.',
    detalle: 'Severidad con la que se reporta la regla: error (bloquea el gate), warning, information o hint.',
  },

};

const CATALOGO: Record<string, InfoSegmento> = {
  ...CATALOGO_BASE,
  ...CATALOGO_REGLAS,
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

/* Devuelve el DETALLE de una ruta (para el tooltip del editor): el `detalle`
 * del segmento mas profundo que lo tenga; si no tiene detalle, su
 * `descripcion`. Si ninguno, undefined. [por que] El tooltip debe explicar
 * cada opcion con texto breve, claro y suficiente, no solo con la linea corta. */
export function detalleDeRuta(ruta: (string | number)[]): string | undefined {
  for (let i = ruta.length - 1; i >= 0; i--) {
    const s = infoSegmento(String(ruta[i]));
    if (s.detalle) return s.detalle;
    if (s.descripcion) return s.descripcion;
  }
  return undefined;
}
