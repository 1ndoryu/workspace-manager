/* Single-flight por clave: si la clave ya vuela, comparte la promesa; si no,
 * arranca el trabajo y lo registra hasta que settle.
 * [por que] F0 midió el bloque check+set duplicado en analizador y
 * vulnerabilidades; un dueño único evita que diverjan. El check+set es
 * atómico (sin await en el medio): arrancar() se invoca dentro. */
export function compartirVuelo<T>(
  enVuelo: Map<string, Promise<T>>,
  clave: string,
  arrancar: () => Promise<T>,
): Promise<T> {
  const ya = enVuelo.get(clave);
  if (ya) return ya;
  const vuelo = arrancar();
  enVuelo.set(clave, vuelo);
  void vuelo.then(
    () => {
      enVuelo.delete(clave);
    },
    () => {
      enVuelo.delete(clave);
    },
  );
  return vuelo;
}
