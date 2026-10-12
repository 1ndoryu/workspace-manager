/* Panel central 'guardian': controla el guardián de los proyectos desde una sola
 * pestaña. Sustituye a la interfaz anterior, retirada en F11.1 (decisión D6).
 * [por que] Menú a la izquierda en tres grupos (ver, un proyecto, toda el área) y un
 * selector de proyecto. Las secciones de un proyecto usan el elegido y piden elegirlo
 * si falta; el resto son del área y no lo necesitan. */
import { useState } from 'react';
import { Caja } from '../../ui/caja/Caja.js';
import { FilaCajas } from '../../ui/caja/FilaCajas.js';
import { Button } from '../../ui/form/Button.js';
import { Selector } from '../../ui/selector/Selector.js';
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

interface Entrada {
  clave: Vista;
  etiqueta: string;
  /* Una frase que dice para qué sirve la sección, mostrada sobre su contenido. */
  ayuda: string;
}

/* Tres grupos: ver cómo está todo, tocar un proyecto y ajustes de toda el área.
 * [por que] Ocho entradas planas mezclaban lo que necesita un proyecto con lo que
 * no; agrupadas, el menú dice qué se puede hacer sin saber cómo se llama cada cosa. */
const GENERAL: Entrada[] = [
  { clave: 'estado', etiqueta: 'resumen', ayuda: 'Cómo está cada proyecto de un vistazo.' },
  {
    clave: 'comandos',
    etiqueta: 'qué se bloquea',
    ayuda: 'Qué hace el guardián con cada comando, proyecto por proyecto.',
  },
  { clave: 'actividad', etiqueta: 'historial', ayuda: 'Lo que el guardián ha bloqueado o anotado, sin poder cambiarlo.' },
];

const PROYECTO: Entrada[] = [
  {
    clave: 'politica',
    etiqueta: 'reglas',
    ayuda: 'Qué comandos permite el proyecto y si el guardián bloquea o solo avisa.',
  },
  { clave: 'topes', etiqueta: 'límites', ayuda: 'Cuántas veces puede ejecutarse cada comando pesado.' },
  {
    clave: 'probar',
    etiqueta: 'probar un comando',
    ayuda: 'Pregunta qué haría el guardián con un comando, sin ejecutarlo ni cambiar nada.',
  },
];

const AREA: Entrada[] = [
  {
    clave: 'plantilla',
    etiqueta: 'plantilla',
    ayuda: 'Reglas base por tipo de proyecto; sirven de punto de partida para todos.',
  },
  {
    clave: 'mantenimiento',
    etiqueta: 'mantenimiento',
    ayuda: 'Reinstala los atajos que hacen pasar los comandos por el guardián.',
  },
];

const SECCIONES: Entrada[] = [...GENERAL, ...PROYECTO, ...AREA];
const NECESITAN_PROYECTO = new Set<Vista>(PROYECTO.map((e) => e.clave));
const SIN_ELEGIR = 'elige un proyecto';

export function PanelGuardian() {
  const datos = useGuardian();
  const [vista, setVista] = useState<Vista>('estado');
  const elegibles = datos.area?.proyectos.filter((p): p is ProyectoArea => p.elegible) ?? [];
  const actual = SECCIONES.find((s) => s.clave === vista);

  function boton(e: Entrada) {
    return (
      <Button
        key={e.clave}
        className={`docsFila${vista === e.clave ? ' docsFila--activa' : ''}`}
        onClick={() => setVista(e.clave)}
        title={e.ayuda}
      >
        <span className="docsFilaNombre">{e.etiqueta}</span>
      </Button>
    );
  }

  return (
    <FilaCajas fila="guardian" ids={['menu', 'contenido']} defectos={[1, 3]}>
      <Caja titulo="guardián" etiqueta="Menú del guardián">
        <div className="guardianMenuGrupo">{GENERAL.map(boton)}</div>
        <div className="guardianMenuGrupo">
          {datos.errorArea && <div className="docsMensaje">{datos.errorArea}</div>}
          {!datos.errorArea && elegibles.length === 0 && (
            <div className="docsVacio">sin proyectos con guardián</div>
          )}
          {elegibles.length > 0 && (
            <div className="guardianMenuCampo">
              <Selector
                titulo="proyecto"
                valor={datos.claveSel ?? SIN_ELEGIR}
                opciones={elegibles.map((p) => p.clave)}
                onChange={datos.elegir}
              />
            </div>
          )}
          {PROYECTO.map(boton)}
        </div>
        <div className="guardianMenuGrupo">{AREA.map(boton)}</div>
      </Caja>

      <Caja titulo={actual?.etiqueta ?? ''} meta={datos.claveSel ?? undefined} etiqueta="Contenido del guardián">
        <div className="guardianCuerpo">
          {actual && <div className="guardianNota guardianNota--tenue">{actual.ayuda}</div>}
          {NECESITAN_PROYECTO.has(vista) && !datos.claveSel ? (
            <div className="docsVacio">elige un proyecto en el menú de la izquierda</div>
          ) : (
            <Contenido vista={vista} datos={datos} onIr={setVista} />
          )}
        </div>
      </Caja>
    </FilaCajas>
  );
}

function Contenido({
  vista,
  datos,
  onIr,
}: {
  vista: Vista;
  datos: GuardianDatos;
  onIr: (v: 'politica' | 'topes' | 'probar') => void;
}) {
  switch (vista) {
    case 'estado':
      return <SeccionEstado datos={datos} onIr={onIr} />;
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
