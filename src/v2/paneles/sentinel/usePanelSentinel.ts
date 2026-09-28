/* Logica del PanelSentinel en hook dedicado.
 * [por que] Regla componente-sin-hook-glory: Componente.tsx (solo JSX) +
 * useComponente.ts (logica). Todo este bloque se MOVIO desde usePanelConfig
 * (tab config) sin cambio de comportamiento: la vista de proyecto/gate vivia
 * abajo de config y ahora tiene su propio tab 'sentinel'. */
import { useEffect, useState } from 'react';
import axios from 'axios';
import { useWorkspaceStore } from '../../../hooks/useWorkspace.js';
import type { EstadoGate } from '../../../shared/types.js';
import { mensajeDeError, toastError, toastInfo, toastOk } from '../../toast.js';
import type { NodoEsquema } from '../../../shared/gate/esquema.js';
import type { TipoGate } from '../../../shared/gate/proveedores.js';

/* Archivos de gate editables (whitelist del server: same list). */
export const ARCHIVOS = ['sentinel.config.json', 'sentinel.lock.json', 'quality-tools.json', 'varsense.config.json'] as const;

/* Que archivo se edita por ESQUEMA (dirigido por esquema) y cual cae al
 * EditorJson generico. Mapea el archivo a su HERRAMIENTA del gate; el esquema
 * se carga por la API /gate/dinamico (el server lo resuelve) y el cliente es
 * 'tonto'. [por que] E1 gate-dinamico: el bundle deja de importar los ESQUEMA_*
 * estaticos; sentinel.config.json usa el esquema del server (curado contra su
 * runtime) y varsense.config.json el curado de los configs reales. lock y
 * quality-tools no tienen fuente canonica fiable -> EditorJson generico. */
export const ARCHIVO_A_TOOL: Partial<Record<(typeof ARCHIVOS)[number], TipoGate>> = {
  'sentinel.config.json': 'sentinel',
  'varsense.config.json': 'varsense',
};

export interface GateRespuesta {
  clave: string;
  estado: EstadoGate | null;
  archivos: { nombre: (typeof ARCHIVOS)[number]; existe: boolean }[];
  contenidos: Partial<Record<(typeof ARCHIVOS)[number], string | null>>;
}

/* Respuesta del POST de guardado: ok + avisos de esquema no bloqueantes
 * (el server diagnostica sentinel/varsense.config.json contra su esquema
 * curado; guardar con avisos es legítimo a mitad de edición). */
export interface GuardadoGate {
  ok: boolean;
  avisos?: { ruta: string; severidad: string }[];
  totalErrores?: number;
  totalAdvertencias?: number;
}

/* Resultado del parseo de los archivos de gate del proyecto abierto. */
interface EditorPreparado {
  inicial: Record<string, string>;
  editado: Record<string, unknown>;
  errores: Record<string, string>;
}

/* Prepara el estado del editor desde la respuesta del gate: copia los
 * contenidos en texto (para el EditorJson) y parsea cada archivo valido a su
 * valor JSON. [por que] Aislar el parseo en una funcion pura mantiene el
 * `.then` corto (el analyzer promise-sin-catch solo mira 20 lineas) y separa
 * la transformacion del efecto. */
function prepararEditor(data: GateRespuesta): EditorPreparado {
  const inicial: Record<string, string> = {};
  const pars: Record<string, unknown> = {};
  const errs: Record<string, string> = {};
  for (const a of ARCHIVOS) {
    const c = data.contenidos[a];
    if (typeof c !== 'string') continue;
    inicial[a] = c;
    if (!c.trim()) continue;
    try {
      /* Cast controlado: JSON.parse devuelve cualquier valor; EditorJson
       * espera un JsonValue, que sanitizamos recursivamente al renderizar. */
      pars[a] = JSON.parse(c) as unknown;
    } catch (e) {
      errs[a] = e instanceof Error ? e.message : 'JSON inválido';
    }
  }
  return { inicial, editado: pars, errores: errs };
}

/* Formatea el estado del gate en etiquetas legibles. */
export function badgesDe(estado: EstadoGate | null): { texto: string; clave: string }[] {
  if (!estado) return [{ texto: 'gate: no', clave: 'configBadge--sin' }];
  const b: { texto: string; clave: string }[] = [];
  b.push({ texto: `gate: ${estado.declarado ? 'sí' : 'no'}`, clave: estado.declarado ? 'badge' : 'configBadge--sin' });
  b.push({ texto: `sentinel: ${estado.sentinel}`, clave: estado.sentinel === 'none' ? 'configBadge--sin' : 'badge' });
  b.push({ texto: `varsense: ${estado.varsense ? 'sí' : 'no'}`, clave: estado.varsense ? 'badge' : 'configBadge--sin' });
  b.push({ texto: `puerta: ${estado.puerta}`, clave: estado.puerta === 'none' ? 'configBadge--sin' : 'badge' });
  return b;
}

export function usePanelSentinel() {
  const snapshot = useWorkspaceStore((s) => s.snapshot);
  const cargar = useWorkspaceStore((s) => s.cargar);
  const proyectoAConfigurar = useWorkspaceStore((s) => s.proyectoAConfigurar);
  const cambiarIgnorado = useWorkspaceStore((s) => s.cambiarIgnorado);
  /* Catalogo de reglas vivo del gate (el server lo resuelve del runtime);
   * el store lo pide una vez y cae al estatico si falla. [por que] R1
   * gate-dinamico: el editor debe usar las reglas reales del runtime, no el
   * snapshot congelado del bundle. */
  const reglasCatalogo = useWorkspaceStore((s) => s.reglasCatalogo);
  const cargarReglas = useWorkspaceStore((s) => s.cargarReglas);
  const cargarEsquema = useWorkspaceStore((s) => s.cargarEsquema);

  /* Esquemas por herramienta ya rehidratados desde la API (cache local a la
   * vista; el store cachea a nivel global). */
  const [esquemas, setEsquemas] = useState<Partial<Record<TipoGate, NodoEsquema>>>({});

  /* Al montar el panel, se asegura de que el catalogo de reglas este cargado
   * (fetch una vez; si ya esta, no repite). */
  useEffect(() => {
    void cargarReglas();
  }, [cargarReglas]);

  /* Clave del proyecto abierto en el visor derecho. */
  const [claveVisor, setClaveVisor] = useState<string | null>(null);
  /* Secuencia de recarga del gate: `guardar` la incrementa para releer
   * del server lo recién escrito (el efecto depende de ella además de la
   * clave). [por que] Tras guardar, el server re-escanea el snapshot pero
   * el visor seguía mostrando el texto anterior (stale) hasta cambiar de
   * proyecto y volver. */
  const [seqGate, setSeqGate] = useState(0);
  const [gate, setGate] = useState<GateRespuesta | null>(null);
  /* Valores editados por el EditorJson (parsed por archivo). */
  const [editado, setEditado] = useState<Record<string, unknown>>({});
  const [contenidos, setContenidos] = useState<Record<string, string>>({});
  /* Errores de parseo si el JSON de un archivo no es valido. */
  const [parseErrores, setParseErrores] = useState<Record<string, string>>({});
  const [cargandoGate, setCargandoGate] = useState(false);
  const [guardando, setGuardando] = useState<string | null>(null);

  /* [por que] El menu contextual abre el tab 'sentinel' con un proyecto
   * determinado: a cada cambio, si llega un proyecto, se muestra su
   * configuracion en vez del aviso de lista vacia. */
  useEffect(() => {
    if (proyectoAConfigurar) {
      setClaveVisor(proyectoAConfigurar);
    }
  }, [proyectoAConfigurar]);

  /* Carga el gate del proyecto abierto cada vez que cambia la clave. */
  useEffect(() => {
    if (!claveVisor) {
      setGate(null);
      return;
    }
    let viva = true;
    setCargandoGate(true);
    axios
      .get<GateRespuesta>(`/api/proyecto/gate?clave=${encodeURIComponent(claveVisor)}`)
      .then(({ data }) => {
        if (!viva) return;
        setGate(data);
        const { inicial, editado, errores } = prepararEditor(data);
        setContenidos(inicial);
        setEditado(editado);
        setParseErrores(errores);
      })
      .catch((err) => {
        if (!viva) return;
        toastError(`no se pudo leer el gate: ${mensajeDeError(err)}`);
        setGate(null);
      })
      .finally(() => {
        if (viva) setCargandoGate(false);
      });
    return () => {
      viva = false;
    };
  }, [claveVisor, seqGate]);

  /* Carga por API el esquema de las herramientas cuyo archivo declara el
   * proyecto abierto. [por que] El esquema se sirve serializado por
   * /gate/dinamico y se rehidrata; el store lo cachea para no repetir el fetch
   * por cada proyecto. (E1 gate-dinamico: el bundle deja de importar ESQUEMA_*.) */
  useEffect(() => {
    if (!gate) return;
    let viva = true;
    for (const a of gate.archivos) {
      const tool = ARCHIVO_A_TOOL[a.nombre];
      if (!tool || esquemas[tool]) continue;
      void cargarEsquema(tool)
        .then((nodo) => {
          if (viva && nodo) setEsquemas((e) => ({ ...e, [tool]: nodo }));
        })
        /* [por que] Pre-carga de cache; si la API falla, el bundle sigue usando
         * el esquema embebido, asi que un rechazo aqui es tolerante y no debe
         * convertirse en unhandled rejection. */
        .catch(() => {});
    }
    return () => {
      viva = false;
    };
  }, [gate, esquemas, cargarEsquema]);

  if (!snapshot) return null;

  const ignorados = snapshot.config.ignorados;
  const proyectos = snapshot.proyectos;
  const proyectoVisor = proyectos.find((p) => p.clave === claveVisor);
  const visorIgnorado = claveVisor !== null && ignorados.includes(claveVisor);

  /* Duplicado minimo de usePanelConfig (tambien lo usa VistaExcepciones).
   * [por que] Ambos tabs son independientes; compartir el hook entero
   * acoplaria sentinel con el estado de scan/gate-central de config. */
  async function alternarIgnorado(clave: string, ignorar: boolean) {
    try {
      await cambiarIgnorado(clave, ignorar);
      toastOk(ignorar ? 'ignorado ✓' : 'ya no se ignora ✓');
    } catch (err) {
      toastError(mensajeDeError(err));
    }
  }

  /* Guarda el JSON editado de un archivo de gate del proyecto del visor
   * y recarga el visor con lo que quedó escrito. */
  async function guardar(a: string) {
    if (!claveVisor) return;
    setGuardando(a);
    try {
      /* Serializa el valor editado (indent 2) y lo envia; el server valida
       * JSON de nuevo antes de escribir y devuelve avisos de esquema. */
      const contenido = JSON.stringify(editado[a] ?? null, null, 2);
      const { data } = await axios.post<GuardadoGate>(
        `/api/proyecto/gate?clave=${encodeURIComponent(claveVisor)}`,
        { nombre: a, contenido },
      );
      toastOk(`${a} guardado ✓`);
      const errores = data.totalErrores ?? 0;
      const advertencias = data.totalAdvertencias ?? 0;
      if (errores > 0 || advertencias > 0) {
        const primero = data.avisos?.[0];
        toastInfo(
          `esquema: ${errores} errores, ${advertencias} advertencias` +
          (primero ? ` (p.ej. ${primero.ruta})` : '') +
          ' — ver consola',
        );
      }
      await cargar(true);
      /* Relee el gate del server: sin esto el visor muestra el texto
       * anterior (stale) hasta cambiar de proyecto y volver. */
      setSeqGate((s) => s + 1);
    } catch (err) {
      toastError(`no se pudo guardar: ${mensajeDeError(err)}`);
    } finally {
      setGuardando(null);
    }
  }

  /* Guarda la clave y muestra un proyecto concreto en el visor. */
  function abrirProyecto(clave: string) {
    setClaveVisor(clave);
  }

  return {
    snapshot,
    claveVisor, setClaveVisor,
    gate, contenidos, setContenidos, editado, setEditado, parseErrores,
    cargandoGate, guardando,
    proyectos, proyectoVisor, visorIgnorado,
    esquemas, reglasCatalogo,
    abrirProyecto, alternarIgnorado, guardar,
  };
}

/* Paquete de datos que el panel entrega a la vista. [por que] La vista recibe
 * un solo prop (`datos`) en vez de 15 props sueltas: evita interfaces de props
 * gigantes (large-interface-isp) y el trasiego no cambia. */
export type DatosPanelSentinel = NonNullable<ReturnType<typeof usePanelSentinel>>;
