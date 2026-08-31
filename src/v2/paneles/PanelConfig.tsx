/* Panel central 'config': configuracion por proyecto (ignorar + reglas de
 * sentinel/varsense) y gestion de excepciones (proyectos ignorados).
 * [por que] El usuario pidio que las excepciones no ocupen espacio en el
 * panel lateral: este es ahora un menu de opciones, y entre ellas esta
 * 'excepciones', que se abre en el contenido. Cada proyecto tambien es una
 * opcion que abre su configuracion en el contenido. */
import { useEffect, useState } from 'react';
import axios from 'axios';
import { useWorkspaceStore } from '../../hooks/useWorkspace.js';
import type { EstadoGate } from '../../shared/types.js';
import { mensajeDeError, toastError, toastOk } from '../toast.js';
import { EditorJson } from '../EditorJson.js';
import { EditorEsquema } from '../EditorEsquema.js';
import type { NodoEsquema } from '../../shared/gate/esquema.js';
import type { TipoGate } from '../../shared/gate/proveedores.js';
import './paneles.css';

/* Archivos de gate editables (whitelist del server: same list). */
const ARCHIVOS = ['sentinel.config.json', 'sentinel.lock.json', 'quality-tools.json', 'varsense.config.json'] as const;

/* Que archivo se edita por ESQUEMA (dirigido por esquema) y cual cae al
 * EditorJson generico. Mapea el archivo a su HERRAMIENTA del gate; el esquema
 * se carga por la API /gate/dinamico (el server lo resuelve) y el cliente es
 * 'tonto'. [por que] E1 gate-dinamico: el bundle deja de importar los ESQUEMA_*
 * estaticos; sentinel.config.json usa el esquema del server (curado contra su
 * runtime) y varsense.config.json el curado de los configs reales. lock y
 * quality-tools no tienen fuente canonica fiable -> EditorJson generico. */
const ARCHIVO_A_TOOL: Partial<Record<(typeof ARCHIVOS)[number], TipoGate>> = {
  'sentinel.config.json': 'sentinel',
  'varsense.config.json': 'varsense',
};

/* Vista del visor derecho: excepciones, escaneo de sentinel o la config de
 * un proyecto. [por que] El usario pidio que el escaneo tenga su propia
 * opcion de menu y no viva embebido dentro de las excepciones. */
type Vista = 'excepciones' | 'scan' | 'gate' | 'proyecto';

interface GateRespuesta {
  clave: string;
  estado: EstadoGate | null;
  archivos: { nombre: (typeof ARCHIVOS)[number]; existe: boolean }[];
  contenidos: Partial<Record<(typeof ARCHIVOS)[number], string | null>>;
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
function badgesDe(estado: EstadoGate | null): { texto: string; clave: string }[] {
  if (!estado) return [{ texto: 'gate: no', clave: 'badge--sin' }];
  const b: { texto: string; clave: string }[] = [];
  b.push({ texto: `gate: ${estado.declarado ? 'sí' : 'no'}`, clave: estado.declarado ? 'badge' : 'badge--sin' });
  b.push({ texto: `sentinel: ${estado.sentinel}`, clave: estado.sentinel === 'none' ? 'badge--sin' : 'badge' });
  b.push({ texto: `varsense: ${estado.varsense ? 'sí' : 'no'}`, clave: estado.varsense ? 'badge' : 'badge--sin' });
  b.push({ texto: `puerta: ${estado.puerta}`, clave: estado.puerta === 'none' ? 'badge--sin' : 'badge' });
  return b;
}

export function PanelConfig() {
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
  /* Analisis real de sentinel: config scan + boton 'Escanea todo'. */
  const configurarScan = useWorkspaceStore((s) => s.configurarScan);
  const escanearTodo = useWorkspaceStore((s) => s.escanearTodo);
  const analisis = useWorkspaceStore((s) => s.analisis);
  /* Vulnerabilidades (308A-4 V1): boton 'Auditar todo' + badges por severidad. */
  const auditarTodo = useWorkspaceStore((s) => s.auditarTodo);
  const vulnerabilidades = useWorkspaceStore((s) => s.vulnerabilidades);
  /* Estado del checkout compartido del gate (plan 308A-1 F7). */
  const sincronizacion = useWorkspaceStore((s) => s.sincronizacion);
  const cargarSincronizacion = useWorkspaceStore((s) => s.cargarSincronizacion);

  /* Esquemas por herramienta ya rehidratados desde la API (cache local a la
   * vista; el store cachea a nivel global). */
  const [esquemas, setEsquemas] = useState<Partial<Record<TipoGate, NodoEsquema>>>({});

  /* Al montar el panel, se asegura de que el catalogo de reglas este cargado
   * (fetch una vez; si ya esta, no repite). */
  useEffect(() => {
    void cargarReglas();
  }, [cargarReglas]);

  /* Vista actual y, si es 'proyecto', la clave del proyecto abierto. */
  const [vista, setVista] = useState<Vista>('excepciones');

  /* Al abrir la vista 'gate' (plan 308A-1 F7) se refresca el estado del
   * checkout compartido (GET barato de quality-sync). [por que] No se corre en
   * el arranque para no lanzar git en cada carga; solo cuando el usuario pide
   * ver esta vista o pulsa 'verificar'. */
  useEffect(() => {
    if (vista === 'gate') void cargarSincronizacion();
  }, [vista, cargarSincronizacion]);

  const [claveVisor, setClaveVisor] = useState<string | null>(null);
  const [gate, setGate] = useState<GateRespuesta | null>(null);
  const [contenidos, setContenidos] = useState<Record<string, string>>({});
  /* Valores editados por el EditorJson (parsed por archivo). */
  const [editado, setEditado] = useState<Record<string, unknown>>({});
  /* Errores de parseo si el JSON de un archivo no es valido. */
  const [parseErrores, setParseErrores] = useState<Record<string, string>>({});
  const [cargandoGate, setCargandoGate] = useState(false);
  const [guardando, setGuardando] = useState<string | null>(null);
  /* Config de escaneo (switch + intervalo) editable en este panel. */
  const [auto, setAuto] = useState<boolean>(snapshot?.config?.scan?.automatico ?? false);
  const [intervalo, setIntervalo] = useState<number>(snapshot?.config?.scan?.intervaloMin ?? 30);
  const [escaneando, setEscaneando] = useState(false);
  const [scanAviso, setScanAviso] = useState<string | null>(null);
  const [auditando, setAuditando] = useState(false);
  const [auditAviso, setAuditAviso] = useState<string | null>(null);

  /* [por que] El menu contextual abre la pagina 'config' con un proyecto
   * determinado: inicial/a cada cambio, si llega un proyecto, se muestra su
   * configuracion (vista proyecto) en vez de las excepciones. */
  useEffect(() => {
    if (proyectoAConfigurar) {
      setClaveVisor(proyectoAConfigurar);
      setVista('proyecto');
    }
  }, [proyectoAConfigurar]);

  /* Carga el gate del proyecto abierto cada vez que cambia la clave. */
  useEffect(() => {
    if (vista !== 'proyecto' || !claveVisor) {
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
  }, [vista, claveVisor]);

  /* Mantiene los controles de escaneo al dia con la config persistida (p. ej.
   * tras configurarScan o al llegar un snapshot recargado). [por que] El input
   * de intervalo es controlado; sin esto, quedaria stale con el valor del store. */
  useEffect(() => {
    const sc = snapshot?.config?.scan;
    if (!sc) return;
    setAuto(sc.automatico);
    setIntervalo(sc.intervaloMin);
  }, [snapshot?.config?.scan, snapshot?.config?.scan?.automatico, snapshot?.config?.scan?.intervaloMin]);

  /* Carga por API el esquema de las herramientas cuyo archivo declara el
   * proyecto abierto. [por que] El esquema se sirve serializado por
   * /gate/dinamico y se rehidrata; el store lo cachea para no repetir el fetch
   * por cada proyecto. (E1 gate-dinamico: el bundle deja de importar ESQUEMA_*.) */
  useEffect(() => {
    if (vista !== 'proyecto' || !gate) return;
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
  }, [vista, gate, esquemas, cargarEsquema]);

  if (!snapshot) return null;

  const ignorados = snapshot.config.ignorados;
  const proyectos = snapshot.proyectos;
  const proyectoVisor = proyectos.find((p) => p.clave === claveVisor);
  const visorIgnorado = claveVisor !== null && ignorados.includes(claveVisor);

  async function alternarIgnorado(clave: string, ignorar: boolean) {
    try {
      await cambiarIgnorado(clave, ignorar);
      toastOk(ignorar ? 'ignorado ✓' : 'ya no se ignora ✓');
    } catch (err) {
      toastError(mensajeDeError(err));
    }
  }

  /* Guarda el JSON editado de un archivo de gate del proyecto del visor. */
  async function guardar(a: string) {
    if (!claveVisor) return;
    setGuardando(a);
    try {
      /* Serializa el valor editado (indent 2) y lo envia; el server valida
       * JSON de nuevo antes de escribir. */
      const contenido = JSON.stringify(editado[a] ?? null, null, 2);
      await axios.post(
        `/api/proyecto/gate?clave=${encodeURIComponent(claveVisor)}`,
        { nombre: a, contenido },
      );
      toastOk(`${a} guardado ✓`);
      await cargar(true);
    } catch (err) {
      toastError(`no se pudo guardar: ${mensajeDeError(err)}`);
    } finally {
      setGuardando(null);
    }
  }

  /* Guarda la clave y pasa a la vista de un proyecto concreto. */
  function abrirProyecto(clave: string) {
    setClaveVisor(clave);
    setVista('proyecto');
  }

  /* [por que] Persiste la config scan cuando se cambia automatico o intervalo
   * (el server valida intervalo minimo por frescura). Se llama desde los
   * controles, no en cada teclado de intervalo. */
  function guardarScan(autoNuevo: boolean, intervaloNuevo: number) {
    void configurarScan({ automatico: autoNuevo, intervaloMin: intervaloNuevo })
      .then(() => setScanAviso('preferencias de escaneo guardadas ✓'))
      .catch((err: unknown) => toastError(`no se pudo guardar el escaneo: ${mensajeDeError(err)}`));
  }

  /* Boton 'Escanea todo': recorre el workspace con la cola serial del server.
   * [por que] forzar=true: el usuario quiere un escaneo GENUINO (re-escanea
   * git/HEAD y re-ejecuta sentinel aunque la frescura no cambio). Si no se
   * forzara, la cache de analisis del server se serviria sin re-ejecutar y el
   * contador no reflejaria los fixes aunque esten commiteados. */
  async function escanearAhora() {
    setEscaneando(true);
    setScanAviso(null);
    try {
      await escanearTodo(true);
      setScanAviso('análisis completado ✓');
    } catch (err) {
      setScanAviso(null);
      toastError(`no se pudo analizar: ${mensajeDeError(err)}`);
    } finally {
      setEscaneando(false);
    }
  }

  /* Total de hallazgos por severidad de los proyectos analizados (para la
   * cabecera del escaneo en el panel). */
  function totalesEscaneo(): { error: number; warning: number } {
    let error = 0;
    let warning = 0;
    for (const a of Object.values(analisis)) {
      error += a.resumen.error;
      warning += a.resumen.warning + a.resumen.information + a.resumen.hint;
    }
    return { error, warning };
  }
  /* Boton 'Auditar todo': recorre el workspace auditando dependencias.
   * forzar=true para que sea genuino (re-audita aunque la cache de hash-de-
   * lockfile no cambio); el server single-flight igual evita solaparse. */
  async function auditarAhora() {
    setAuditando(true);
    setAuditAviso(null);
    try {
      await auditarTodo(true);
      setAuditAviso('auditoría completa ✓');
    } catch (err) {
      setAuditAviso(null);
      toastError(`no se pudo auditar: ${mensajeDeError(err)}`);
    } finally {
      setAuditando(false);
    }
  }

  /* Totales de vulnerabilidades por severidad sobre los proyectos auditados. */
  function totalesVuln(): { critical: number; high: number; moderate: number; low: number } {
    const t = { critical: 0, high: 0, moderate: 0, low: 0 };
    for (const v of Object.values(vulnerabilidades)) {
      t.critical += v.resumen.critical;
      t.high += v.resumen.high;
      t.moderate += v.resumen.moderate;
      t.low += v.resumen.low;
    }
    return t;
  }
  const tVuln = totalesVuln();
  const tieneVuln = tVuln.critical + tVuln.high + tVuln.moderate + tVuln.low > 0;
  const totales = totalesEscaneo();
  const ultimaActualizacion = Object.values(analisis).reduce<number>((mx, a) => {
    const t = new Date(a.analizadoEn).getTime();
    return Number.isNaN(t) ? mx : Math.max(mx, t);
  }, 0);

  return (
    <div className="panelDocs" aria-label="Configuración">
      {/* Menu lateral de opciones: excepciones + proyectos a configurar. */}
      <div className="panelDocsLista">
        <section className="panelDocsSeccion">
          <header className="panelDocsCabecera">opciones</header>
          <div className="panelDocsEntradas">
            <button
              type="button"
              className={`docsFila${vista === 'excepciones' ? ' docsFila--activa' : ''}`}
              onClick={() => {
                setVista('excepciones');
                setClaveVisor(null);
              }}
            >
              <span className="docsFilaNombre">excepciones ({ignorados.length})</span>
            </button>
            <button
              type="button"
              className={`docsFila${vista === 'scan' ? ' docsFila--activa' : ''}`}
              onClick={() => {
                setVista('scan');
                setClaveVisor(null);
              }}
            >
              <span className="docsFilaNombre">escaneo sentinel</span>
            </button>
            <button
              type="button"
              className={`docsFila${vista === 'gate' ? ' docsFila--activa' : ''}`}
              onClick={() => {
                setVista('gate');
                setClaveVisor(null);
              }}
            >
              <span className="docsFilaNombre">gate centralizado</span>
            </button>
          </div>
        </section>
        <section className="panelDocsSeccion">
          <header className="panelDocsCabecera">configurar proyecto</header>
          <div className="panelDocsEntradas">
            {proyectos.length === 0 && <div className="docsVacio">sin proyectos visibles</div>}
            {proyectos.map((p) => (
              <button
                key={p.clave}
                type="button"
                className={`docsFila${
                  vista === 'proyecto' && p.clave === claveVisor ? ' docsFila--activa' : ''
                }`}
                onClick={() => abrirProyecto(p.clave)}
                title={p.ruta}
              >
                <span className="docsFilaNombre">{p.clave}</span>
              </button>
            ))}
          </div>
        </section>
      </div>

      <div className="panelDocsContenido">
        {/* Vista por defecto: elige una opcion. */}
        {vista === 'excepciones' && (
          <>
            <header className="panelDocsVisorCabecera">
              <span className="panelDocsVisorTitulo">excepciones ({ignorados.length})</span>
            </header>

            {ignorados.length === 0 ? (
              <div className="docsVacio">
                no hay excepciones guardadas. usa el menú contextual (clic derecho) sobre un proyecto
                para ignorarlo
              </div>
            ) : (
              <div className="excListaContenido">
                {/* [por que] Cada excepcion es una fila tipo lista: quitar la
                 * vuelve a ser un proyecto visible al instante. */}
                {ignorados.map((clave) => (
                  <div key={clave} className="excFila">
                    <span className="excFilaNombre">{clave}</span>
                    <button
                      type="button"
                      className="excBoton"
                      onClick={() => void alternarIgnorado(clave, false)}
                      title="dejar de ignorar este proyecto"
                    >
                      quitar
                    </button>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {/* Vista 'scan': config del auto-escaneo + boton 'Escanea todo'.
         * [por que] El usuario pidio que el escaneo tenga su propia opcion
         * de menu y no viva dentro de las excepciones. */}
        {vista === 'scan' && (
          <>
            <header className="panelDocsVisorCabecera">
              <span className="panelDocsVisorTitulo">escaneo de sentinel</span>
            </header>
            <section className="scanCfg" aria-label="Escaneo de sentinel">
              <div className="scanCfgFila">
                <label className="scanCfgEtiqueta" htmlFor="scan-auto">
                  análisis automático
                </label>
                <input
                  id="scan-auto"
                  type="checkbox"
                  className="scanCfgCheck"
                  checked={auto}
                  onChange={(ev) => {
                    const v = ev.target.checked;
                    setAuto(v);
                    guardarScan(v, intervalo);
                  }}
                />
                <span className="scanCfgIntervalo">cada</span>
                <input
                  type="number"
                  className="scanCfgNum"
                  min={1}
                  max={1440}
                  value={intervalo}
                  disabled={!auto}
                  onChange={(ev) => setIntervalo(Number(ev.target.value) || 30)}
                  onBlur={() => guardarScan(auto, intervalo)}
                />
                <span className="scanCfgIntervalo">min</span>
              </div>
              <div className="scanCfgAcciones">
                <button
                  type="button"
                  className="excBoton"
                  onClick={() => void escanearAhora()}
                  disabled={escaneando}
                >
                  {escaneando ? 'analizando…' : 'escaneá ahora'}
                </button>
                <span
                  className="scanCfgMeta"
                  title={Object.entries(analisis)
                    .map(([k, a]) => `${k}: ${a.estado}`)
                    .join('\n')}
                >
                  {Object.keys(analisis).length} proyectos analizados
                </span>
              </div>
              {(totales.error > 0 || totales.warning > 0) && (
                <div className="scanCfgResumen">
                  <span className="scanCfgBadge scanCfgBadge--error">{totales.error} error{totales.error === 1 ? '' : 'es'}</span>
                  <span className="scanCfgBadge scanCfgBadge--warn">{totales.warning} aviso{totales.warning === 1 ? '' : 's'}</span>
                  {ultimaActualizacion > 0 && (
                    <span className="scanCfgMeta">última: {new Date(ultimaActualizacion).toLocaleTimeString()}</span>
                  )}
                </div>
              )}
              {scanAviso && <div className="scanCfgAviso">{scanAviso}</div>}

              {/* Vulnerabilidades de dependencias (308A-4 V1): el usuario pidio
               * que aparezcan solas en la consola, con auditoria por proyecto.
               * Boton 'Auditar todo' + badges por severidad de la cache. */}
              <div className="scanCfgSeparador">vulnerabilidades</div>
              <div className="scanCfgAcciones">
                <button
                  type="button"
                  className="excBoton"
                  onClick={() => void auditarAhora()}
                  disabled={auditando}
                >
                  {auditando ? 'auditando…' : 'auditá toda la consola'}
                </button>
                <span className="scanCfgMeta">
                  {Object.keys(vulnerabilidades).length} proyectos auditados
                </span>
              </div>
              {tieneVuln && (
                <div className="scanCfgResumen">
                  <span className="scanCfgBadge scanCfgBadge--crit">{tVuln.critical} crític{tVuln.critical === 1 ? 'a' : 'as'}</span>
                  <span className="scanCfgBadge scanCfgBadge--high">{tVuln.high} alta{tVuln.high === 1 ? '' : 's'}</span>
                  <span className="scanCfgBadge scanCfgBadge--mod">{tVuln.moderate} moderada{tVuln.moderate === 1 ? '' : 's'}</span>
                  <span className="scanCfgBadge scanCfgBadge--low">{tVuln.low} baja{tVuln.low === 1 ? '' : 's'}</span>
                </div>
              )}
              {auditAviso && <div className="scanCfgAviso">{auditAviso}</div>}
            </section>
          </>
        )}

        {/* Vista 'gate': estado del checkout compartido del runtime (plan
         * 308A-1 F7). [por que] Muestra en la UI que cada consumidor apunta al
         * checkout compartido con el MISMO commit, con badges verde/desync y
         * boton 'verificar' para refrescarlo. Reusa la validacion de
         * quality-sync (el server la expone por GET, no duplica logica). */}
        {vista === 'gate' && (
          <>
            <header className="panelDocsVisorCabecera">
              <span className="panelDocsVisorTitulo">gate centralizado</span>
            </header>
            <section className="syncVista" aria-label="Centralización del gate">
              <div className="scanCfgAcciones">
                <button
                  type="button"
                  className="excBoton"
                  onClick={() => void cargarSincronizacion()}
                >
                  verificar alineación
                </button>
                <span className="scanCfgMeta">
                  {sincronizacion
                    ? `${sincronizacion.consumidores.length} consumidores · ${sincronizacion.problemas} desync`
                    : 'pulsá verificar para comprobar el checkout compartido'}
                </span>
              </div>
              {sincronizacion && (
                <div className="syncLista">
                  {(sincronizacion.checkout_sentinel || sincronizacion.checkout_varsense) && (
                    <div className="syncCheckout">
                      <span className="syncTitulo">checkout compartido {sincronizacion.checkout}</span>
                      {sincronizacion.checkout_sentinel && (
                        <span className="syncMeta">
                          sentinel@{sincronizacion.checkout_sentinel.head ?? 'no-provisto'}
                          {sincronizacion.checkout_sentinel.sucio ? ` (sucio ${sincronizacion.checkout_sentinel.sucio})` : ''}
                        </span>
                      )}
                      {sincronizacion.checkout_varsense && (
                        <span className="syncMeta">
                          varsense@{sincronizacion.checkout_varsense.head ?? 'no-provisto'}
                          {sincronizacion.checkout_varsense.sucio ? ` (sucio ${sincronizacion.checkout_varsense.sucio})` : ''}
                        </span>
                      )}
                    </div>
                  )}
                  {sincronizacion.consumidores.map((c) => (
                    <div key={c.nombre} className="syncFila">
                      <span
                        className={`syncBadge syncBadge--${c.estado === 'ok' ? 'ok' : 'warn'}`}
                        title={c.detalle || c.problemas?.join('; ') || c.estado}
                      >
                        {c.estado === 'ok' ? '✓' : c.estado}
                      </span>
                      <span className="syncNombre">{c.nombre}</span>
                      {c.sentinel && (
                        <span className={`syncMeta syncMeta--${c.sentinel.estado === 'ok' ? 'ok' : 'warn'}`}>
                          sentinel={c.sentinel.estado}
                        </span>
                      )}
                      {c.varsense && (
                        <span className={`syncMeta syncMeta--${c.varsense.estado === 'ok' ? 'ok' : 'warn'}`}>
                          varsense={c.varsense.estado}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {vista === 'proyecto' && !claveVisor && (
          <div className="docsVacio">elige un proyecto de la lista</div>
        )}

        {vista === 'proyecto' && claveVisor && cargandoGate && <div className="docsVacio">cargando gate…</div>}

        {vista === 'proyecto' && claveVisor && !cargandoGate && (
          <>
            <header className="docsVisorCabecera">
              <span className="docsVisorTitulo">{visorIgnorado ? `${claveVisor} (ignorado)` : claveVisor}</span>
              <button
                type="button"
                className="excBoton"
                onClick={() => void alternarIgnorado(claveVisor, !visorIgnorado)}
              >
                {visorIgnorado ? 'dejar de ignorar' : 'ignorar'}
              </button>
            </header>

            {proyectoVisor && <div className="configMeta">{proyectoVisor.ruta}</div>}

            {/* Estado del gate en badges. */}
            <div className="configBadges">
              {badgesDe(gate?.estado ?? null).map((b) => (
                <span key={b.texto} className={`configBadge ${b.clave}`}>
                  {b.texto}
                </span>
              ))}
            </div>

            {!gate || gate.archivos.length === 0 ? (
              <div className="docsVacio">este proyecto no declara archivos de gate (sentinel/varsense)</div>
            ) : (
              <div className="gateEditores">
                {gate.archivos.map((a) => {
                  /* Si el archivo no es JSON valido, mostramos el error en vez
                   * del editor (para no corromper el archivo sin querer). */
                  if (parseErrores[a.nombre]) {
                    return (
                      <section key={a.nombre} className="gateEditor">
                        <header className="gateEditorCabecera">
                          <span className="gateEditorNombre">{a.nombre}</span>
                        </header>
                        <div className="ejError">JSON inválido: {parseErrores[a.nombre]}</div>
                        <textarea
                          className="panelDocsTexto gateEditorTexto"
                          value={contenidos[a.nombre] ?? ''}
                          onChange={(ev) =>
                            setContenidos((c) => ({ ...c, [a.nombre]: ev.target.value }))
                          }
                          spellCheck={false}
                          aria-label={`Contenido de ${a.nombre} (inválido)`}
                        />
                      </section>
                    );
                  }
                  const tool = ARCHIVO_A_TOOL[a.nombre];
                  const esquema = tool ? esquemas[tool] : undefined;
                  const valor = (editado[a.nombre] ?? null) as import('../EditorJson.js').JsonValue;
                  return (
                    <section key={a.nombre} className="gateEditor">
                      <header className="gateEditorCabecera">
                        <span className="gateEditorNombre">{a.nombre}</span>
                        <button
                          type="button"
                          className="docsGuardar"
                          onClick={() => void guardar(a.nombre)}
                          disabled={guardando === a.nombre}
                        >
                          {guardando === a.nombre ? 'guardando…' : 'guardar'}
                        </button>
                      </header>
                      {esquema ? (
                        <EditorEsquema
                          key={`${claveVisor}:${a.nombre}`}
                          esquema={esquema}
                          value={valor}
                          reglas={reglasCatalogo.reglas}
                          onChange={(nv) => setEditado((e) => ({ ...e, [a.nombre]: nv }))}
                        />
                      ) : (
                        <EditorJson
                          key={`${claveVisor}:${a.nombre}`}
                          value={valor}
                          onChange={(nv) => setEditado((e) => ({ ...e, [a.nombre]: nv }))}
                        />
                      )}
                    </section>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}