/* Catalogo de reglas de sentinel (indice `rules`).
 * [por que] El esquema canónico no lista reglas por nombre: las reglas viven en
 * el runtime (`out/config/defaultRules.js`). Extraje los 14 ids estaticos reales
 * de la version 0.7.4 para poder ofrecerlas todas (agregar la que falte) sin
 * depender de lo que haya escrito el agente. */

/* Severidad permitida por regla (defaultRules/ruleRegistry). */
export const SEVERIDADES = ['error', 'warning', 'information', 'hint'] as const;
export type SeveridadRegla = (typeof SEVERIDADES)[number];

/* 14 ids estaticos reales extraidos de defaultRules.js de sentinel v0.7.4. */
export const CATALOGO_REGLAS: string[] = [
  'at-generico-php',
  'barras-decorativas',
  'catch-vacio',
  'css-adhoc-button-style',
  'emoji-en-codigo',
  'eval-prohibido',
  'git-add-all',
  'hardcoded-secret',
  'inline-style-prohibido',
  'innerhtml-variable',
  'php-supresor-at',
  'sqlx-query-as-sin-macro',
  'sqlx-query-sin-macro',
  'todo-pendiente',
];