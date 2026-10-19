/* Ruta de la consola de problemas (/api/consola/problemas, 07AA-1 F1b):
 * agrega en el servidor lo mismo que la cabecera calcula en el navegador
 * (usePanelConsola.contar('todos')), con los mismos clasificadores puros de
 * `shared/clasificacionConsola.ts` — una sola clasificacion en ambos lados.
 * Solo lectura por defecto (lee cachés persistidas); `?forzar=1` re-escanea
 * snapshot + análisis + auditoría antes de agregar (equivale al botón
 * «Escanear», tarda minutos: sentinel en serie + cargo audit con timeout).
 * Devuelve true si atendió la ruta, false si no es suya. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { json } from '../http.js';
import { snapshotArea } from '../snapshot.js';
import { analizarTodo, leerTodas } from '../gate/analizador.js';
import { auditarTodo } from '../gate/vulnerabilidades/vulnerabilidades.js';
import { leerTodasVulnerabilidades } from '../gate/vulnerabilidades/almacen.js';
import { obtenerVigilancia } from '../dev/vigilancia.js';
import { saludArea, saludProyectos } from '../salud/runner.js';
import {
  contarProblemas,
  problemaHuerfanosSinProyecto,
  problemaSaludArea,
  problemasDe,
  problemasDevDe,
  problemasSaludDe,
  problemasSentinelDe,
  problemasTallerDe,
  problemasVulnerabilidadDe,
  type Entrada,
} from '../../shared/consola/clasificacionConsola.js';
import { CLAVE_AREA } from '../../shared/salud/salud.js';
import { estadoTaller } from '../taller/estado.js';
import type { Hallazgo } from '../../shared/taller/conformidad.js';

/* Conformidad del taller remoto (S3): VPS 89, HTTP público y laptop. [por que] Va en la
 * caché de 60 s de estado.ts (sin SSH por consulta). Si la evaluación lanza, no tumba la
 * consola: se avisa con T0 en vez de callarlo. */
async function hallazgosDelTaller(): Promise<Hallazgo[]> {
  try {
    return (await estadoTaller()).hallazgos;
  } catch (err) {
    return [{
      id: 'T0', ambito: 'local', severidad: 'advertencia',
      detalle: `no se pudo evaluar el taller: ${String(err)}`,
      remedio: 'Revisar config/registro.json y el log del manager.',
    }];
  }
}

export async function manejarRutasConsola(
  req: IncomingMessage,
  res: ServerResponse,
  url: URL,
  ruta: string,
): Promise<boolean> {
  if (ruta !== '/api/consola/problemas') return false;
  if (req.method !== 'GET') {
    json(res, 405, { error: 'Metodo no permitido' });
    return true;
  }
  const forzar = url.searchParams.get('forzar') === '1';
  /* [por que] snapshotArea(true) invalida la memoria del server (igual que
   * analizarTodo): si no, un commit reciente seguiría mostrando el HEAD
   * viejo en las entradas sinCommit/sinPush. */
  const { snapshot } = await snapshotArea(forzar);
  /* [por que] Tras el snapshot, análisis, auditoría, vigilancia, salud y taller no se
   * necesitan entre sí: en serie sumaban sus tiempos (≈30 s en frío); en paralelo tarda
   * lo que tarda el más lento. La vigilancia no se fuerza: trae TTL 60 s y single-flight
   * propios, y su frescura viaja en `vigencia.devEn`. */
  const [analisis, vulnerabilidades, { informe: dev }, [saludPorProyecto, saludDelArea], hallazgosTaller] =
    await Promise.all([
      forzar ? analizarTodo(snapshot.proyectos, true) : leerTodas(),
      forzar ? auditarTodo(snapshot.proyectos, true) : leerTodasVulnerabilidades(),
      obtenerVigilancia(),
      Promise.all([saludProyectos(forzar), saludArea(forzar)]),
      hallazgosDelTaller(),
    ]);

  const porAnalisis = new Map(analisis.map((a) => [a.clave, a]));
  const porVuln = new Map(vulnerabilidades.map((v) => [v.clave, v]));
  const porProyecto = new Map<string, { clave: string; id: string; entradas: Entrada[] }>();
  const poner = (clave: string, id: string, entradas: Entrada[]) => {
    const ex = porProyecto.get(clave);
    if (ex) ex.entradas.push(...entradas);
    else porProyecto.set(clave, { clave, id, entradas: [...entradas] });
  };
  for (const p of snapshot.proyectos) {
    const base = problemasDe(p);
    if (base) poner(p.clave, p.id, base.entradas);
    const sen = problemasSentinelDe(p, porAnalisis.get(p.clave));
    if (sen) poner(p.clave, p.id, sen.entradas);
    const vul = problemasVulnerabilidadDe(p, porVuln.get(p.clave));
    if (vul) poner(p.clave, p.id, vul.entradas);
    const dv = problemasDevDe(p, dev, null);
    if (dv) poner(p.clave, p.id, dv.entradas);
    const salud = problemasSaludDe(p, saludPorProyecto.get(p.clave));
    if (salud) poner(p.clave, p.id, salud.entradas);
  }
  /* Grupo sintético del área (comprobaciones de disco, runtime, AGENTS.md...). */
  const salArea = problemaSaludArea(saludDelArea);
  if (salArea) poner(CLAVE_AREA, salArea.p.id, salArea.entradas);
  const taller = problemasTallerDe(hallazgosTaller);
  if (taller) poner(CLAVE_AREA, taller.p.id, taller.entradas);
  /* Grupo sintético de huérfanos sin proyecto (misma regla que el hook:
   * nunca participa en selección, solo en el conteo). */
  const solos = problemaHuerfanosSinProyecto(dev);
  if (solos) poner('', solos.p.id, solos.entradas);

  /* [por que] El total cuenta todas las entradas que la consola muestra. */
  const proyectos = [...porProyecto.values()].map((g) => ({ ...g, total: contarProblemas(g.entradas) }));
  const total = proyectos.reduce((n, g) => n + g.total, 0);
  json(res, 200, {
    total,
    escaneadoEn: new Date().toISOString(),
    vigencia: {
      snapshotEn: (snapshot as { escaneadoEn?: string }).escaneadoEn ?? null,
      analisisEn: Object.fromEntries([...porAnalisis].map(([k, a]) => [k, a.analizadoEn])),
      vulnerabilidadesEn: Object.fromEntries([...porVuln].map(([k, v]) => [k, v.analizadoEn])),
      devEn: dev.tomadoEn,
      saludEn: saludDelArea.calculadoEn,
    },
    proyectos,
  });
  return true;
}
