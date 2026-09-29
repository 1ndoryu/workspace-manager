/* Panel central 'sentinel': un tab al lado de config con su misma estructura
 * de dos columnas — abajo/opciones estan los proyectos y el panel muestra
 * las opciones del proyecto abierto (badges + editores de gate).
 * [por que] El usuario pidio no reinventar: es la vista 'proyecto' movida
 * desde config/ a su propia pagina, con la lista de proyectos como menu.
 * La logica vive en usePanelSentinel.ts y la vista en VistaProyecto.tsx:
 * este archivo solo arma el menu lateral y delega el contenido.
 * [299A-7] Dos CAJAS externas (primitiva `Caja`) en `.cajaFila`: proyectos
 * y contenido (titulo = proyecto + accion ignorar). Las clases
 * panelDocsSeccion/Cabecera/Entradas no tenian estilo: eliminadas. */
import { Button } from '../../ui/Button.js';
import { Caja } from '../../ui/Caja.js';
import { FilaCajas } from '../../ui/FilaCajas.js';
import { usePanelSentinel } from './usePanelSentinel.js';
import { VistaProyecto } from './VistaProyecto.js';
import '../paneles.css';

export function PanelSentinel() {
  const datos = usePanelSentinel();
  if (!datos) return null;
  const { claveVisor, proyectos, abrirProyecto, visorIgnorado, alternarIgnorado } = datos;

  return (
    /* [299A-9] Fila redimensionable (defecto [1,2.5], como docs). */
    <FilaCajas fila="sentinel" ids={['menu', 'contenido']} defectos={[1, 2.5]}>
      {/* Menu lateral: proyectos a configurar. */}
      <Caja titulo="proyectos" etiqueta="Proyectos a configurar">
        {proyectos.length === 0 && <div className="docsVacio">sin proyectos visibles</div>}
        {proyectos.map((p) => (
          <button
            key={p.clave}
            type="button"
            className={`docsFila${p.clave === claveVisor ? ' docsFila--activa' : ''}`}
            onClick={() => abrirProyecto(p.clave)}
            title={p.ruta}
          >
            <span className="docsFilaNombre">{p.clave}</span>
          </button>
        ))}
      </Caja>

      <Caja
        titulo={claveVisor ? (visorIgnorado ? `${claveVisor} (ignorado)` : claveVisor) : 'proyecto'}
        etiqueta="Opciones del proyecto"
        acciones={
          claveVisor ? (
            <Button pequeno onClick={() => void alternarIgnorado(claveVisor, !visorIgnorado)}>
              {visorIgnorado ? 'dejar de ignorar' : 'ignorar'}
            </Button>
          ) : undefined
        }
      >
        <VistaProyecto datos={datos} />
      </Caja>
    </FilaCajas>
  );
}
