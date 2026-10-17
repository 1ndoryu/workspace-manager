/* Guardas de tipo sobre `unknown`: la comprobacion minima antes de confiar en
 * un JSON externo (respuesta de la VPS, fichero de config, sonda del taller).
 * [por que] `esObjeto` estaba copiado en cinco modulos del server y `esNumero`
 * en dos, con el cuerpo identico byte a byte. Siete sitios que deciden lo mismo
 * por separado: el dia que uno cambie (p. ej. aceptar arrays), los otros seis
 * mienten. Aqui hay un solo dueno.
 * [por que] No vive en el server aunque hoy solo lo use el server: es puro (no
 * toca node: ni el entorno) y el front tambien parsea JSON de la API, asi que
 * `shared/` es su sitio natural. */

/** Objeto plano: ni null ni array (los dos son `typeof 'object'`). */
export function esObjeto(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Numero utilizable: `NaN` e `Infinity` son `typeof 'number'` pero no sirven
 * para pintar ni para comparar. */
export function esNumero(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}
