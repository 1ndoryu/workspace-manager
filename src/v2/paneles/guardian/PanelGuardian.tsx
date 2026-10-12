/* Panel central 'guardian': controla el guardián de los proyectos desde una sola
 * pestaña. Sustituye a la interfaz anterior, retirada en F11.1 (decisión D6).
 * [por que] Menú a la izquierda con los proyectos sueltos (como el mapa) y las
 * entradas del área; dentro de cada proyecto, pestañas con todo lo suyo. */
import { useState } from 'react';
import { Caja } from '../../ui/caja/Caja.js';
import { FilaCajas } from '../../ui/caja/FilaCajas.js';
import { Button } from '../../ui/form/Button.js';
import { useGuardian, type GuardianDatos } from './useGuardian.js';
import { SeccionArea, SeccionResumen } from './secciones/SeccionEstado.js';
import { SeccionComandos } from './secciones/SeccionComandos.js';
import { SeccionEditar } from './secciones/SeccionEditar.js';
import { SeccionPlantilla } from './secciones/SeccionPlantilla.js';
import { SeccionTopes } from './secciones/SeccionTopes.js';
import { SeccionProbar } from './secciones/SeccionProbar.js';
import { SeccionMantenimiento } from './secciones/SeccionMantenimiento.js';
import type { ProyectoArea } from './tiposGuardian.js';
import '../paneles.css';
import './PanelGuardian.css';

type VistaProyecto = 'resumen' | 'comandos' | 'politica' | 'topes' | 'probar';
type VistaArea = 'area' | 'plantilla' | 'mantenimiento';
type Vista = VistaProyecto | VistaArea;

interface Entrada<V extends Vista> {
  clave: V;
  etiqueta: string;
  /* Una frase que dice para qué sirve la sección, mostrada sobre su contenido. */
  ayuda: string;
}

/* [por que] Los proyectos van sueltos en el menú, como en el mapa; todo lo que se
 * puede ver o tocar de uno vive dentro, en estas pestañas. */
const PESTANAS: Entrada<VistaProyecto>[] = [
  { clave: 'resumen', etiqueta: 'resumen', ayuda: 'Cómo está este proyecto de un vistazo.' },
  { clave: 'comandos', etiqueta: 'qué se bloquea', ayuda: 'Qué hace el guardián con cada comando de este proyecto.' },
  { clave: 'politica', etiqueta: 'reglas', ayuda: 'Qué comandos permite el proyecto y si el guardián bloquea o solo avisa.' },
  { clave: 'topes', etiqueta: 'límites', ayuda: 'Cuántas veces puede ejecutarse cada comando pesado. La suite completa tiene un enfriamiento de 180 min; los tests filtrados no.' },
  { clave: 'probar', etiqueta: 'probar un comando', ayuda: 'Pregunta qué haría el guardián con un comando, sin ejecutarlo ni cambiar nada.' },
];

const AREA: Entrada<VistaArea>[] = [
  { clave: 'area', etiqueta: 'toda el área', ayuda: 'Qué proyectos piden atención; ábrelos desde aquí o desde el menú.' },
  { clave: 'plantilla', etiqueta: 'plantilla', ayuda: 'Reglas base por tipo de proyecto; sirven de punto de partida para todos.' },
  { clave: 'mantenimiento', etiqueta: 'mantenimiento', ayuda: 'Reinstala los atajos que hacen pasar los comandos por el guardián.' },
];

const VISTAS_AREA = new Set<Vista>(AREA.map((e) => e.clave));

export function PanelGuardian() {
  const datos = useGuardian();
  const [vista, setVista] = useState<Vista>('area');
  const elegibles = datos.area?.proyectos.filter((p): p is ProyectoArea => p.elegible) ?? [];
  const esArea = VISTAS_AREA.has(vista);
  const entrada = esArea ? AREA.find((e) => e.clave === vista) : PESTANAS.find((e) => e.clave === vista);

  function abrir(clave: string) {
    datos.elegir(clave);
    if (esArea) setVista('resumen');
  }

  return (
    <FilaCajas fila="guardian" ids={['menu', 'contenido']} defectos={[1, 3]}>
      <Caja titulo="guardián" etiqueta="Menú del guardián">
        <div className="guardianMenuGrupo">
          {datos.errorArea && <div className="docsMensaje">{datos.errorArea}</div>}
          {!datos.errorArea && elegibles.length === 0 && <div className="docsVacio">sin proyectos con guardián</div>}
          {elegibles.map((p) => (
            <Button
              key={p.clave}
              className={`docsFila${!esArea && datos.claveSel === p.clave ? ' docsFila--activa' : ''}`}
              onClick={() => abrir(p.clave)}
            >
              <span className="docsFilaNombre">{p.clave}</span>
            </Button>
          ))}
        </div>
        <div className="guardianMenuGrupo">
          {AREA.map((e) => (
            <Button
              key={e.clave}
              className={`docsFila${vista === e.clave ? ' docsFila--activa' : ''}`}
              onClick={() => setVista(e.clave)}
              title={e.ayuda}
            >
              <span className="docsFilaNombre">{e.etiqueta}</span>
            </Button>
          ))}
        </div>
      </Caja>

      <Caja titulo={esArea ? (entrada?.etiqueta ?? '') : (datos.claveSel ?? '')} etiqueta="Contenido del guardián">
        {!esArea && (
          <div className="guardianPestanas">
            {PESTANAS.map((e) => (
              <Button
                key={e.clave}
                pequeno
                className={`guardianPestana${vista === e.clave ? ' guardianPestana--activa' : ''}`}
                aria-pressed={vista === e.clave}
                title={e.ayuda}
                onClick={() => setVista(e.clave)}
              >
                {e.etiqueta}
              </Button>
            ))}
          </div>
        )}
        <div className="guardianCuerpo">
          {!esArea && !datos.claveSel ? (
            <div className="docsVacio">elige un proyecto en el menú de la izquierda</div>
          ) : (
            <Contenido vista={vista} datos={datos} onAbrir={abrir} />
          )}
        </div>
      </Caja>
    </FilaCajas>
  );
}

function Contenido({ vista, datos, onAbrir }: { vista: Vista; datos: GuardianDatos; onAbrir: (clave: string) => void }) {
  switch (vista) {
    case 'area':
      return <SeccionArea datos={datos} onAbrir={onAbrir} />;
    case 'resumen':
      return <SeccionResumen datos={datos} />;
    case 'comandos':
      return <SeccionComandos datos={datos} />;
    case 'politica':
      return <SeccionEditar datos={datos} />;
    case 'topes':
      return <SeccionTopes datos={datos} />;
    case 'probar':
      return <SeccionProbar datos={datos} />;
    case 'plantilla':
      return <SeccionPlantilla datos={datos} />;
    case 'mantenimiento':
      return <SeccionMantenimiento datos={datos} />;
  }
}
