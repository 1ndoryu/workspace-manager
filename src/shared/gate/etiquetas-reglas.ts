/* Catalogo de traduccion de las reglas estaticas conocidas de Sentinel.
 * [por que] El editor de config del gate muestra las claves tecnicas de las
 * reglas (`css-adhoc-button-style`, `sqlx-query-sin-macro`, ...) que los
 * agentes escriben pero que un humano no entiende. Este modulo traduce cada
 * ID de regla a un nombre corto legible y una descripcion de una linea.
 * Vive separado de `etiquetas.ts` (claves de configuracion) para mantener
 * ambos catalogos por debajo del limite de lineas y con un unico responsable. */

import type { InfoSegmento } from './etiquetas.js';

/* Reglas estaticas conocidas (CATALOGO_REGLAS en reglas.ts).
 * Las reglas dinamicas de cada proyecto (no en el catalogo) caen al
 * fallback tecnico, que es el comportamiento correcto (nunca vacio). */
export const CATALOGO_REGLAS: Record<string, InfoSegmento> = {
  'at-generico-php': {
    nombre: '@ genérico en PHP',
    descripcion: 'Detecta el supresor de errores @ en código PHP.',
    detalle: 'Detecta el uso del supresor de errores @ en PHP. Oculta errores reales y dificulta el diagnóstico; es mejor manejarlos explícitamente.',
  },
  'barras-decorativas': {
    nombre: 'Barras decorativas',
    descripcion: 'Detecta bloques de comentario solo decorativos.',
    detalle: 'Detecta bloques de comentario puramente decorativos (líneas de barras o adornos). Añaden ruido sin aportar información; se prefieren comentarios con contenido.',
  },
  'catch-vacio': {
    nombre: 'Catch vacío',
    descripcion: 'Detecta bloques catch que se tragan el error.',
    detalle: 'Detecta bloques catch que capturan una excepción y no hacen nada, tragándose el error en silencio. Mejor registrar el error o propagarlo.',
  },
  'css-adhoc-button-style': {
    nombre: 'Estilo CSS ad-hoc en botones',
    descripcion: 'Detecta estilos de botón definidos a mano en lugar de usar el sistema de diseño.',
    detalle: 'Detecta estilos de botón definidos a mano en lugar de usar el sistema de diseño del proyecto. Mantiene la interfaz consistente y reutilizable.',
  },
  'emoji-en-codigo': {
    nombre: 'Emoji en código',
    descripcion: 'Detecta emojis en el código fuente.',
    detalle: 'Detecta emojis en el código fuente. Suelen colarse en mensajes o textos de interfaz y pueden romper codificaciones o estilos.',
  },
  'eval-prohibido': {
    nombre: 'Eval prohibido',
    descripcion: 'Detecta el uso de eval o equivalentes inseguros.',
    detalle: 'Detecta el uso de eval o equivalentes inseguros. Ejecutar código desde cadenas es un riesgo de seguridad y dificulta el análisis estático.',
  },
  'git-add-all': {
    nombre: 'Git add all',
    descripcion: 'Detecta git add . o git add -A.',
    detalle: 'Detecta git add . o git add -A. Añadir todo sin revisar puede incluir basura, artefactos o secretos en el commit; se prefiere añadir por archivo.',
  },
  'hardcoded-secret': {
    nombre: 'Secreto hardcodeado',
    descripcion: 'Detecta secretos o credenciales en el código.',
    detalle: 'Detecta secretos o credenciales escritos literalmente en el código (API keys, contraseñas, tokens). Deben ir en variables de entorno, nunca en el código.',
  },
  'inline-style-prohibido': {
    nombre: 'Estilo inline prohibido',
    descripcion: 'Detecta estilos CSS inline en el HTML.',
    detalle: 'Detecta estilos CSS inline en HTML o JSX. Dificultan mantener el diseño centralizado; se prefiere usar clases y hojas de estilos.',
  },
  'innerhtml-variable': {
    nombre: 'InnerHTML con variable',
    descripcion: 'Detecta asignaciones de innerHTML con contenido dinámico.',
    detalle: 'Detecta asignaciones de innerHTML con contenido dinámico. Es un riesgo de inyección XSS si el contenido no está sanitizado.',
  },
  'php-supresor-at': {
    nombre: 'Supresor @ en PHP',
    descripcion: 'Detecta el operador de supresión de errores @ en PHP.',
    detalle: 'Detecta el operador @ de supresión de errores en PHP. Oculta errores y dificulta el diagnóstico; se prefiere manejar los errores explícitamente.',
  },
  'sqlx-query-as-sin-macro': {
    nombre: 'SQLx query_as sin macro',
    descripcion: 'Detecta query_as sin la macro verificada en compile-time.',
    detalle: 'Detecta query_as de SQLx sin la macro verificada en tiempo de compilación. Sin la macro pierdes la validación de tipos y columnas de la consulta.',
  },
  'sqlx-query-sin-macro': {
    nombre: 'SQLx query sin macro',
    descripcion: 'Detecta query sin la macro verificada en compile-time.',
    detalle: 'Detecta query de SQLx sin la macro verificada en tiempo de compilación. La macro valida la consulta y sus tipos antes de ejecutarla.',
  },
  'todo-pendiente': {
    nombre: 'TODO pendiente',
    descripcion: 'Detecta comentarios TODO/FIXME sin resolver.',
    detalle: 'Detecta comentarios TODO, FIXME u otros marcadores de trabajo pendiente sin resolver. Ayuda a no acumular deuda invisible en el código.',
  },
};