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
import { analizarTodo, analisisVigentes } from '../gate/analizador.js';
import { auditarTodo, auditoriasVigentes } from '../gate/vulnerabilidades/vulnerabilidades.js';
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
  /* [por que] `local=1` (emergencia, `problemas --local`) implica una corrida viva: un dato
   * cacheado no dice dónde corrió, y el aviso de emergencia solo sale al analizar. */
  const emergencia = url.searchParams.get('local') === '1';
  const forzar = url.searchParams.get('forzar') === '1' || emergencia;
  const fuentes = await recogerFuentes(forzar, emergencia);
  const proyectos = agruparProblemas(fuentes);
  const total = proyectos.reduce((n, g) => n + g.total, 0);
  const { snapshot, analisis, vulnerabilidades, dev, saludDelArea } = fuentes;
  json(res, 200, {
    total,
    escaneadoEn: new Date().toISOString(),
    vigencia: {
      snapshotEn: snapshot.escaneadoEn,
      analisisEn: Object.fromEntries(analisis.map((a) => [a.clave, a.analizadoEn])),
      vulnerabilidadesEn: Object.fromEntries(vulnerabilidades.map((v) => [v.clave, v.analizadoEn])),
      devEn: dev.tomadoEn,
      saludEn: saludDelArea.calculadoEn,
    },
    proyectos,
  });
  return true;
}

/* Lee todas las fuentes de la consola. [por que] Tras el snapshot, análisis, auditoría,
 * vigilancia, salud y taller no se necesitan entre sí: en paralelo tarda lo que el más
 * lento, en vez de sumar sus tiempos. La vigilancia no se fuerza: trae TTL 60 s y
 * single-flight propios, y su frescura viaja en `vigencia.devEn`. */
async function recogerFuentes(forzar: boolean, emergencia: boolean) {
  /* [por que] snapshotArea(true) invalida la memoria del server (igual que
   * analizarTodo): si no, un commit reciente seguiría mostrando el HEAD
   * viejo en las entradas sinCommit/sinPush. */
  const { snapshot } = await snapshotArea(forzar);
  const [analisis, vulnerabilidades, { informe: dev }, [saludPorProyecto, saludDelArea], hallazgosTaller] =
    await Promise.all([
      forzar ? analizarTodo(snapshot.proyectos, true, emergencia) : analisisVigentes(snapshot.proyectos),
      forzar ? auditarTodo(snapshot.proyectos, true) : auditoriasVigentes(snapshot.proyectos),
      obtenerVigilancia(),
      Promise.all([saludProyectos(forzar), saludArea(forzar)]),
      hallazgosDelTaller(),
    ]);
  return { snapshot, analisis, vulnerabilidades, dev, saludPorProyecto, saludDelArea, hallazgosTaller };
}

type Fuentes = Awaited<ReturnType<typeof recogerFuentes>>;

/* Agrupa por proyecto las entradas de la consola. [por que] Sin E/S: recibe las fuentes
 * ya leídas, así la ruta solo orquesta y el agrupado no depende del disco ni de la red. */
export function agruparProblemas(f: Fuentes): { clave: string; id: string; entradas: Entrada[]; total: number }[] {
  const porAnalisis = new Map(f.analisis.map((a) => [a.clave, a]));
  const porVuln = new Map(f.vulnerabilidades.map((v) => [v.clave, v]));
  const porProyecto = new Map<string, { clave: string; id: string; entradas: Entrada[] }>();
  const poner = (clave: string, id: string, entradas: Entrada[]) => {
    const ex = porProyecto.get(clave);
    if (ex) ex.entradas.push(...entradas);
    else porProyecto.set(clave, { clave, id, entradas: [...entradas] });
  };
  for (const p of f.snapshot.proyectos) {
    const base = problemasDe(p);
    if (base) poner(p.clave, p.id, base.entradas);
    const sen = problemasSentinelDe(p, porAnalisis.get(p.clave));
    if (sen) poner(p.clave, p.id, sen.entradas);
    const vul = problemasVulnerabilidadDe(p, porVuln.get(p.clave));
    if (vul) poner(p.clave, p.id, vul.entradas);
    const dv = problemasDevDe(p, f.dev, null);
    if (dv) poner(p.clave, p.id, dv.entradas);
    const salud = problemasSaludDe(p, f.saludPorProyecto.get(p.clave));
    if (salud) poner(p.clave, p.id, salud.entradas);
  }
  /* Grupo sintético del área (comprobaciones de disco, runtime, AGENTS.md...). */
  const salArea = problemaSaludArea(f.saludDelArea);
  if (salArea) poner(CLAVE_AREA, salArea.p.id, salArea.entradas);
  const taller = problemasTallerDe(f.hallazgosTaller);
  if (taller) poner(CLAVE_AREA, taller.p.id, taller.entradas);
  /* Grupo sintético de huérfanos sin proyecto (misma regla que el hook:
   * nunca participa en selección, solo en el conteo). */
  const solos = problemaHuerfanosSinProyecto(f.dev);
  if (solos) poner('', solos.p.id, solos.entradas);

  /* [por que] El total cuenta todas las entradas que la consola muestra. */
  return [...porProyecto.values()].map((g) => ({ ...g, total: contarProblemas(g.entradas) }));
}
