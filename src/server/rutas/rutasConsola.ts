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
import { auditarTodo, leerTodasVulnerabilidades } from '../gate/vulnerabilidades.js';
import { obtenerVigilancia } from '../dev/vigilancia.js';
import {
  problemaHuerfanosSinProyecto,
  problemasDe,
  problemasDevDe,
  problemasSentinelDe,
  problemasVulnerabilidadDe,
  type Entrada,
} from '../../shared/clasificacionConsola.js';
import type { AnalisisSentinel, AnalisisVulnerabilidades } from '../../shared/types.js';

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
  const { snapshot } = snapshotArea(forzar);
  const analisis: AnalisisSentinel[] = forzar
    ? await analizarTodo(snapshot.proyectos, true)
    : leerTodas();
  const vulnerabilidades: AnalisisVulnerabilidades[] = forzar
    ? await auditarTodo(snapshot.proyectos, true)
    : leerTodasVulnerabilidades();
  /* [por que] La vigilancia ya trae TTL 60 s + single-flight propios: no se
   * fuerza aquí; su frescura viaja en `vigencia.devEn`. */
  const { informe: dev } = await obtenerVigilancia();

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
  }
  /* Grupo sintético de huérfanos sin proyecto (misma regla que el hook:
   * nunca participa en selección, solo en el conteo). */
  const solos = problemaHuerfanosSinProyecto(dev);
  if (solos) poner('', solos.p.id, solos.entradas);

  const proyectos = [...porProyecto.values()].map((g) => ({ ...g, total: g.entradas.length }));
  const total = proyectos.reduce((n, g) => n + g.total, 0);
  json(res, 200, {
    total,
    escaneadoEn: new Date().toISOString(),
    vigencia: {
      snapshotEn: (snapshot as { escaneadoEn?: string }).escaneadoEn ?? null,
      analisisEn: Object.fromEntries([...porAnalisis].map(([k, a]) => [k, a.analizadoEn])),
      vulnerabilidadesEn: Object.fromEntries([...porVuln].map(([k, v]) => [k, v.analizadoEn])),
      devEn: dev.tomadoEn,
    },
    proyectos,
  });
  return true;
}
