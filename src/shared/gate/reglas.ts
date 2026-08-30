/* Catalogo COMPLETO de reglas de sentinel (indice `rules`).
 * [por que] El esquema canónico no lista reglas por nombre: las reglas viven en
 * el runtime (`out/config/ruleRegistry.js`). Contaba solo con 14 ids estaticos,
 * pero contra la version fijada (0.7.4) el registro expone 105 reglas reales con
 * nombre, categoria y severidad por defecto. Extraje las 105 (datos estaticos,
 * para que el app no dependa de que el runtime este instalado) para poder
 * ofrecerlas TODAS en el editor, organizadas en tabs por categoria, sin
 * depender de lo que haya escrito el agente. Vive en shared/gate (no v2/schemas)
 * para que tambien lo use el server al diagnosticar la config. */

/* Severidad permitida por regla (ruleRegistry). */
export const SEVERIDADES = ['error', 'warning', 'information', 'hint'] as const;
export type SeveridadRegla = (typeof SEVERIDADES)[number];

export interface ReglaCatalogo {
  id: string;
  nombre: string;
  categoria: string;
  severidad: SeveridadRegla;
}

/* 8 categorias reales del runtime (campo `categoria` de cada regla), en orden
 * de presentacion (mayor a menor numero de reglas). */
export const CATEGORIAS_REGLAS: string[] = [
  'react-patrones',
  'glory-schema',
  'estructura-nomenclatura',
  'wordpress-php',
  'patrones-prohibidos',
  'rust-patrones',
  'limites-archivo',
  'seguridad-sql',
];

/* 105 reglas reales extraidas de ruleRegistry.js (v0.7.4) via obtenerTodasLasReglas(). */
export const REGLAS: ReglaCatalogo[] = [
  { id: 'acceso-api-sin-fallback', nombre: 'Acceso a data.campo sin fallback', categoria: 'react-patrones', severidad: 'warning' },
  { id: 'button-clase-especifica', nombre: 'Clase específica en botón', categoria: 'react-patrones', severidad: 'warning' },
  { id: 'cola-sin-limite', nombre: 'push() a cola sin limite', categoria: 'react-patrones', severidad: 'warning' },
  { id: 'componente-artesanal', nombre: 'Componente artesanal detectado', categoria: 'react-patrones', severidad: 'warning' },
  { id: 'componente-sin-hook-glory', nombre: 'Componente sin hook dedicado', categoria: 'react-patrones', severidad: 'warning' },
  { id: 'dom-access-outside-platform', nombre: 'DOM fuera de plataforma', categoria: 'react-patrones', severidad: 'warning' },
  { id: 'error-enmascarado', nombre: 'Error enmascarado como exito', categoria: 'react-patrones', severidad: 'error' },
  { id: 'fallo-sin-feedback', nombre: 'Catch sin feedback al usuario', categoria: 'react-patrones', severidad: 'warning' },
  { id: 'fetch-sin-timeout', nombre: 'fetch() sin timeout', categoria: 'react-patrones', severidad: 'hint' },
  { id: 'handler-sin-trycatch', nombre: 'Handler async sin try-catch', categoria: 'react-patrones', severidad: 'warning' },
  { id: 'html-nativo-en-vez-de-componente', nombre: 'HTML nativo en vez de componente', categoria: 'react-patrones', severidad: 'warning' },
  { id: 'inline-style-prohibido', nombre: 'CSS inline con style={{}}', categoria: 'react-patrones', severidad: 'warning' },
  { id: 'key-index-lista', nombre: 'key={index} en lista', categoria: 'react-patrones', severidad: 'hint' },
  { id: 'listen-sin-cleanup', nombre: 'listen() sin cleanup', categoria: 'react-patrones', severidad: 'warning' },
  { id: 'menu-contextual-override-diseno', nombre: 'Override de diseño en MenuContextual', categoria: 'react-patrones', severidad: 'warning' },
  { id: 'modal-acciones-no-canonico', nombre: 'Clase de acciones no canónica en Modal', categoria: 'react-patrones', severidad: 'warning' },
  { id: 'modal-con-titulo', nombre: 'Título dentro de Modal', categoria: 'react-patrones', severidad: 'warning' },
  { id: 'modal-estructura-no-canonica', nombre: 'Estructura no canónica en Modal', categoria: 'react-patrones', severidad: 'warning' },
  { id: 'mutacion-directa-estado', nombre: 'Mutacion directa estado', categoria: 'react-patrones', severidad: 'warning' },
  { id: 'objeto-mutable-exportado', nombre: 'Objeto mutable exportado', categoria: 'react-patrones', severidad: 'hint' },
  { id: 'promise-sin-catch', nombre: 'Promise sin catch', categoria: 'react-patrones', severidad: 'warning' },
  { id: 'singleton-mutable-state', nombre: 'Singleton mutable', categoria: 'react-patrones', severidad: 'warning' },
  { id: 'status-http-generico', nombre: 'Status HTTP marca exito sin body', categoria: 'react-patrones', severidad: 'warning' },
  { id: 'update-optimista-sin-rollback', nombre: 'Update optimista sin rollback', categoria: 'react-patrones', severidad: 'warning' },
  { id: 'useeffect-dep-inestable', nombre: 'useEffect dep inestable', categoria: 'react-patrones', severidad: 'hint' },
  { id: 'useeffect-sin-cleanup', nombre: 'useEffect sin cleanup', categoria: 'react-patrones', severidad: 'warning' },
  { id: 'usestate-excesivo', nombre: 'useState excesivo', categoria: 'react-patrones', severidad: 'warning' },
  { id: 'window-reference-outside-platform', nombre: 'Window fuera de plataforma', categoria: 'react-patrones', severidad: 'warning' },
  { id: 'zustand-objeto-selector', nombre: 'Zustand selector crea ref nueva', categoria: 'react-patrones', severidad: 'warning' },
  { id: 'zustand-sin-selector', nombre: 'Zustand sin selector', categoria: 'react-patrones', severidad: 'warning' },
  { id: 'api-call-outside-service', nombre: 'API fuera de servicio', categoria: 'glory-schema', severidad: 'warning' },
  { id: 'api-response-mismatch', nombre: 'Mismatch clave API PHP vs TS', categoria: 'glory-schema', severidad: 'error' },
  { id: 'api-shape-mismatch', nombre: 'Shape mismatch array PHP vs TS', categoria: 'glory-schema', severidad: 'error' },
  { id: 'endpoint-accede-bd', nombre: 'Controller accede a BD', categoria: 'glory-schema', severidad: 'warning' },
  { id: 'glory-contenido-clave-incorrecta', nombre: "'content' en vez de 'contenido'", categoria: 'glory-schema', severidad: 'warning' },
  { id: 'glory-galeria-clave-incorrecta', nombre: "'galeria'/'gallery' en vez de 'galeriaAssets'", categoria: 'glory-schema', severidad: 'warning' },
  { id: 'glory-imagen-clave-incorrecta', nombre: "'imagen' en vez de 'imagenDestacadaAsset'", categoria: 'glory-schema', severidad: 'warning' },
  { id: 'glory-meta-clave-incorrecta', nombre: "'meta' en vez de 'metaEntrada'", categoria: 'glory-schema', severidad: 'error' },
  { id: 'glory-slug-clave-incorrecta', nombre: "'slug' en vez de 'slugDefault'", categoria: 'glory-schema', severidad: 'error' },
  { id: 'glory-titulo-clave-incorrecta', nombre: "'title'/'name' en vez de 'titulo'", categoria: 'glory-schema', severidad: 'error' },
  { id: 'hardcoded-enum-value', nombre: 'Valor enum hardcodeado', categoria: 'glory-schema', severidad: 'warning' },
  { id: 'hardcoded-sql-column', nombre: 'Columna SQL hardcodeada', categoria: 'glory-schema', severidad: 'warning' },
  { id: 'interval-sin-whitelist', nombre: 'INTERVAL sin whitelist', categoria: 'glory-schema', severidad: 'error' },
  { id: 'isla-no-registrada', nombre: 'Isla no registrada', categoria: 'glory-schema', severidad: 'warning' },
  { id: 'open-redirect', nombre: 'Redireccion insegura', categoria: 'glory-schema', severidad: 'error' },
  { id: 'return-void-critico', nombre: 'Escritura retorna void', categoria: 'glory-schema', severidad: 'warning' },
  { id: 'undefined-class-constant', nombre: 'Constante de clase indefinida', categoria: 'glory-schema', severidad: 'error' },
  { id: 'any-type-explicito', nombre: 'Tipo any explicito', categoria: 'estructura-nomenclatura', severidad: 'hint' },
  { id: 'barras-decorativas', nombre: 'Barras decorativas', categoria: 'estructura-nomenclatura', severidad: 'information' },
  { id: 'card-icono-debe-extender-base', nombre: 'CardIcono debe extender base compartida', categoria: 'estructura-nomenclatura', severidad: 'warning' },
  { id: 'controller-fqn-inline', nombre: 'FQN inline en PHP', categoria: 'estructura-nomenclatura', severidad: 'hint' },
  { id: 'css-elemento-html-directo', nombre: 'Selector HTML directo en componente', categoria: 'estructura-nomenclatura', severidad: 'warning' },
  { id: 'css-especificacion-diseno-local', nombre: 'Especificacion de diseno local en CSS', categoria: 'estructura-nomenclatura', severidad: 'warning' },
  { id: 'default-export', nombre: 'Default export', categoria: 'estructura-nomenclatura', severidad: 'hint' },
  { id: 'import-muerto', nombre: 'Import sin uso', categoria: 'estructura-nomenclatura', severidad: 'warning' },
  { id: 'large-interface-isp', nombre: 'Interface grande ISP', categoria: 'estructura-nomenclatura', severidad: 'hint' },
  { id: 'mixed-barrel-logic', nombre: 'Barrel con lógica', categoria: 'estructura-nomenclatura', severidad: 'warning' },
  { id: 'modal-semantica-no-canonica', nombre: 'Clase modal semantica no canonica', categoria: 'estructura-nomenclatura', severidad: 'warning' },
  { id: 'nomenclatura-css-ingles', nombre: 'CSS en ingles', categoria: 'estructura-nomenclatura', severidad: 'hint' },
  { id: 'non-null-assertion-excesivo', nombre: 'Non-null assertion excesivo', categoria: 'estructura-nomenclatura', severidad: 'hint' },
  { id: 'todo-pendiente', nombre: 'TODO/FIXME pendiente detectado', categoria: 'estructura-nomenclatura', severidad: 'hint' },
  { id: 'cadena-isset-update', nombre: 'Cadena isset-update', categoria: 'wordpress-php', severidad: 'warning' },
  { id: 'catch-critico-solo-log', nombre: 'Catch critico solo log', categoria: 'wordpress-php', severidad: 'warning' },
  { id: 'controller-sin-trycatch', nombre: 'Controller sin try-catch', categoria: 'wordpress-php', severidad: 'warning' },
  { id: 'curl-sin-verificacion', nombre: 'curl_exec sin curl_error', categoria: 'wordpress-php', severidad: 'warning' },
  { id: 'json-decode-inseguro', nombre: 'json_decode sin verificacion', categoria: 'wordpress-php', severidad: 'warning' },
  { id: 'json-sin-limite-bd', nombre: 'JSON sin limite a BD', categoria: 'wordpress-php', severidad: 'warning' },
  { id: 'lock-sin-finally', nombre: 'Lock sin finally', categoria: 'wordpress-php', severidad: 'error' },
  { id: 'php-array-asociativo-como-lista', nombre: 'Array asociativo retornado como lista', categoria: 'wordpress-php', severidad: 'warning' },
  { id: 'php-service-retorna-asociativo', nombre: 'Service retorna asociativo en vez de lista', categoria: 'wordpress-php', severidad: 'warning' },
  { id: 'php-sin-return-type', nombre: 'PHP sin return type', categoria: 'wordpress-php', severidad: 'hint' },
  { id: 'request-json-directo', nombre: 'JSON params sin filtrar', categoria: 'wordpress-php', severidad: 'warning' },
  { id: 'retorno-ignorado-repo', nombre: 'Retorno repo ignorado', categoria: 'wordpress-php', severidad: 'warning' },
  { id: 'sanitizacion-faltante', nombre: 'Request sin sanitizar', categoria: 'wordpress-php', severidad: 'warning' },
  { id: 'temp-sin-finally', nombre: 'tempnam sin finally', categoria: 'wordpress-php', severidad: 'warning' },
  { id: 'at-generico-php', nombre: 'Supresor @ generico PHP', categoria: 'patrones-prohibidos', severidad: 'warning' },
  { id: 'catch-vacio', nombre: 'Catch vacio', categoria: 'patrones-prohibidos', severidad: 'error' },
  { id: 'console-generico-en-catch', nombre: 'console.log en catch', categoria: 'patrones-prohibidos', severidad: 'warning' },
  { id: 'console-production', nombre: 'Console en producción', categoria: 'patrones-prohibidos', severidad: 'warning' },
  { id: 'emoji-en-codigo', nombre: 'Emoji Unicode en codigo', categoria: 'patrones-prohibidos', severidad: 'warning' },
  { id: 'eval-prohibido', nombre: 'eval prohibido', categoria: 'patrones-prohibidos', severidad: 'error' },
  { id: 'exec-sin-escapeshellarg', nombre: 'exec sin escapeshellarg', categoria: 'patrones-prohibidos', severidad: 'error' },
  { id: 'git-add-all', nombre: 'git add . / --all', categoria: 'patrones-prohibidos', severidad: 'warning' },
  { id: 'hardcoded-secret', nombre: 'Secret hardcodeado', categoria: 'patrones-prohibidos', severidad: 'error' },
  { id: 'innerhtml-variable', nombre: 'innerHTML con variable', categoria: 'patrones-prohibidos', severidad: 'warning' },
  { id: 'mime-type-cliente', nombre: 'MIME type del cliente', categoria: 'patrones-prohibidos', severidad: 'error' },
  { id: 'php-supresor-at', nombre: 'Supresor @ en PHP', categoria: 'patrones-prohibidos', severidad: 'error' },
  { id: 'unsafe-process-shell', nombre: 'Proceso shell inseguro', categoria: 'patrones-prohibidos', severidad: 'error' },
  { id: 'axum-ruta-sintaxis-rs', nombre: 'Ruta axum con {param} en vez de :param', categoria: 'rust-patrones', severidad: 'error' },
  { id: 'broadcast-mutex-riesgo-rs', nombre: 'tokio::sync::broadcast usa Mutex interno', categoria: 'rust-patrones', severidad: 'error' },
  { id: 'funcion-larga-rs', nombre: 'Funcion Rust excede 100 lineas', categoria: 'rust-patrones', severidad: 'warning' },
  { id: 'handler-accede-bd-rs', nombre: 'Handler Rust accede BD directamente', categoria: 'rust-patrones', severidad: 'warning' },
  { id: 'panic-produccion-rs', nombre: 'panic!/todo!/unimplemented! en produccion', categoria: 'rust-patrones', severidad: 'warning' },
  { id: 'parametros-excesivos-rs', nombre: 'Funcion Rust con 9+ parametros', categoria: 'rust-patrones', severidad: 'hint' },
  { id: 'unwrap-produccion-rs', nombre: '.unwrap() en produccion', categoria: 'rust-patrones', severidad: 'warning' },
  { id: 'directorio-abarrotado', nombre: 'Directorio con demasiados archivos', categoria: 'limites-archivo', severidad: 'warning' },
  { id: 'limite-lineas', nombre: 'Limite de lineas', categoria: 'limites-archivo', severidad: 'warning' },
  { id: 'limite-lineas-nivel-2', nombre: 'Limite de lineas nivel 2', categoria: 'limites-archivo', severidad: 'warning' },
  { id: 'limite-lineas-nivel-3', nombre: 'Limite de lineas nivel 3', categoria: 'limites-archivo', severidad: 'error' },
  { id: 'limite-lineas-nivel-4', nombre: 'Limite de lineas nivel 4', categoria: 'limites-archivo', severidad: 'error' },
  { id: 'n-plus-1-query', nombre: 'Query N+1 en loop', categoria: 'seguridad-sql', severidad: 'warning' },
  { id: 'query-doble-verificacion', nombre: 'Query doble verificacion', categoria: 'seguridad-sql', severidad: 'information' },
  { id: 'repository-sin-whitelist-columnas', nombre: 'SELECT * sin columnas', categoria: 'seguridad-sql', severidad: 'hint' },
  { id: 'toctou-select-insert', nombre: 'TOCTOU select-insert', categoria: 'seguridad-sql', severidad: 'error' },
  { id: 'wpdb-sin-prepare', nombre: '$wpdb sin prepare()', categoria: 'seguridad-sql', severidad: 'error' },
];

/* Compatibilidad con el esquema (nodo `mapaCatalogo` espera `catalogo: string[]`):
 * solo los ids de las reglas reales. */
export const CATALOGO_REGLAS: string[] = REGLAS.map((r) => r.id);

/* Numero de reglas por categoria (para el conteo de cada tab, sin hardcodear). */
export function reglasPorCategoria(): Map<string, ReglaCatalogo[]> {
  const m = new Map<string, ReglaCatalogo[]>();
  for (const r of REGLAS) {
    const arr = m.get(r.categoria) ?? [];
    arr.push(r);
    m.set(r.categoria, arr);
  }
  return m;
}