/* Leyenda del mapa: un color por ubicación y el halo de lo que está en marcha. */
const NODOS = [
  ['laptop', 'Laptop'],
  ['vps89', 'VPS 89'],
  ['produccion', 'Producción'],
] as const;

export function LeyendaMapa() {
  return (
    <ul className="mapaV2Leyenda" aria-label="Leyenda del mapa">
      {NODOS.map(([id, etiqueta]) => (
        <li key={id}>
          <span className={`mapaV2LeyendaLinea mapaV2Enlace--${id}`} />
          {etiqueta}
        </li>
      ))}
      <li>
        <span className="mapaV2LeyendaLinea mapaV2LeyendaLinea--vivo" />
        brillo = en marcha
      </li>
      <li>sin línea = sin conexión</li>
    </ul>
  );
}
