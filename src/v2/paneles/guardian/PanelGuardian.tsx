/* Panel central 'guardian': controla el guardián de los proyectos desde una sola
 * pestaña. Sustituye a la interfaz anterior, retirada en F11.1 (decisión D6).
 * [por que] Menú a la izquierda con secciones y proyectos elegibles. Las secciones
 * que actúan sobre un proyecto usan el elegido; plantilla, actividad y
 * mantenimiento son del área y no lo necesitan. */
import { useState } from 'react';
import { Caja, Seccion } from '../../ui/caja/Caja.js';
import { FilaCajas } from '../../ui/caja/FilaCajas.js';
import { Button } from '../../ui/form/Button.js';
import { useGuardian, type GuardianDatos } from './useGuardian.js';
import { SeccionEstado } from './secciones/SeccionEstado.js';
import { SeccionComandos } from './secciones/SeccionComandos.js';
import { SeccionEditar } from './secciones/SeccionEditar.js';
import { SeccionPlantilla } from './secciones/SeccionPlantilla.js';
import { SeccionTopes } from './secciones/SeccionTopes.js';
import { SeccionProbar } from './secciones/SeccionProbar.js';
import { SeccionActividad } from './secciones/SeccionActividad.js';
import { SeccionMantenimiento } from './secciones/SeccionMantenimiento.js';
import type { ProyectoArea } from './tiposGuardian.js';
import '../paneles.css';
import './PanelGuardian.css';

type Vista =
  | 'estado'
  | 'comandos'
  | 'politica'
  | 'plantilla'
  | 'topes'
  | 'probar'
  | 'actividad'
  | 'mantenimiento';

const SECCIONES: { clave: Vista; etiqueta: string }[] = [
  { clave: 'estado', etiqueta: 'estado' },
  { clave: 'comandos', etiqueta: 'comandos' },
  { clave: 'politica', etiqueta: 'política' },
  { clave: 'plantilla', etiqueta: 'plantilla' },
  { clave: 'topes', etiqueta: 'presupuestos' },
  { clave: 'probar', etiqueta: 'probar comando' },
  { clave: 'actividad', etiqueta: 'actividad' },
  { clave: 'mantenimiento', etiqueta: 'mantenimiento' },
];

export function PanelGuardian() {
  const datos = useGuardian();
  const [vista, setVista] = useState<Vista>('estado');
  const elegibles = datos.area?.proyectos.filter((p): p is ProyectoArea => p.elegible) ?? [];
  const actual = SECCIONES.find((s) => s.clave === vista);

  return (
    <FilaCajas fila="guardian" ids={['menu', 'contenido']} defectos={[1, 3]}>
      <Caja titulo="guardián" etiqueta="Menú del guardián">
        <Seccion titulo="secciones">
          {SECCIONES.map((s) => (
            <Button
              key={s.clave}
              className={`docsFila${vista === s.clave ? ' docsFila--activa' : ''}`}
              onClick={() => setVista(s.clave)}
            >
              <span className="docsFilaNombre">{s.etiqueta}</span>
            </Button>
          ))}
        </Seccion>
        <Seccion titulo="proyectos con guardián">
          {datos.errorArea && <div className="docsMensaje">{datos.errorArea}</div>}
          {!datos.errorArea && elegibles.length === 0 && (
            <div className="docsVacio">sin proyectos con guardián</div>
          )}
          {elegibles.map((p) => (
            <Button
              key={p.clave}
              className={`docsFila${datos.claveSel === p.clave ? ' docsFila--activa' : ''}`}
              onClick={() => datos.elegir(p.clave)}
              title={p.ruta}
            >
              <span className="docsFilaNombre">{p.clave}</span>
            </Button>
          ))}
        </Seccion>
      </Caja>

      <Caja titulo={actual?.etiqueta ?? ''} meta={datos.claveSel ?? undefined} etiqueta="Contenido del guardián">
        <Contenido vista={vista} datos={datos} />
      </Caja>
    </FilaCajas>
  );
}

function Contenido({ vista, datos }: { vista: Vista; datos: GuardianDatos }) {
  switch (vista) {
    case 'estado':
      return <SeccionEstado datos={datos} />;
    case 'comandos':
      return <SeccionComandos datos={datos} />;
    case 'politica':
      return <SeccionEditar datos={datos} />;
    case 'plantilla':
      return <SeccionPlantilla datos={datos} />;
    case 'topes':
      return <SeccionTopes datos={datos} />;
    case 'probar':
      return <SeccionProbar datos={datos} />;
    case 'actividad':
      return <SeccionActividad datos={datos} />;
    case 'mantenimiento':
      return <SeccionMantenimiento datos={datos} />;
  }
}
