/* Sección Probar: pregunta al guard qué decidiría para un comando del proyecto elegido.
 * [por que] El servidor ejecuta el guard con la raíz fijada al proyecto, sin shell y
 * con 5 s de tiempo máximo. Es una consulta: no cambia la política. */
import { useState } from 'react';
import { Seccion } from '../../../ui/caja/Caja.js';
import { Button } from '../../../ui/form/Button.js';
import { Campo } from '../../../ui/form/Campo.js';
import { Linea, Lista } from '../Lineas.js';
import { mensajeDeError, toastError } from '../../../toast.js';
import { probarComando, resultadoEdicion } from '../apiGuardian.js';
import type { GuardianDatos } from '../useGuardian.js';
import type { DecisionProbada, ResultadoProbar } from '../tiposGuardian.js';

function lineas(texto: string): string[] {
  return texto
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
}

export function SeccionProbar({ datos }: { datos: GuardianDatos }) {
  const { claveSel } = datos;
  const [ejecutable, setEjecutable] = useState('npm');
  const [args, setArgs] = useState('run\nbuild');
  const [resultado, setResultado] = useState<ResultadoProbar | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function probar(): Promise<void> {
    if (!claveSel) return;
    setEnviando(true);
    try {
      const r = resultadoEdicion(
        await probarComando({ clave: claveSel, ejecutable: ejecutable.trim(), args: lineas(args) }),
      );
      setResultado(r);
    } catch (err) {
      toastError(mensajeDeError(err));
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Seccion titulo={claveSel ? `probar en ${claveSel}` : 'probar comando'}>
      {!claveSel && <div className="docsVacio">elige un proyecto en el menú</div>}
      <Campo htmlFor="probar-ejecutable" etiqueta="ejecutable">
        <input
          id="probar-ejecutable"
          value={ejecutable}
          onChange={(e) => setEjecutable(e.target.value)}
        />
      </Campo>
      <Campo htmlFor="probar-args" etiqueta="argumentos, uno por línea">
        <textarea id="probar-args" rows={3} value={args} onChange={(e) => setArgs(e.target.value)} />
      </Campo>
      <div className="guardianAcciones">
        <Button pequeno disabled={!claveSel || enviando} onClick={() => void probar()}>
          probar
        </Button>
      </div>
      {resultado?.estado === 'error' && <div className="docsMensaje">{resultado.motivo}</div>}
      {resultado?.estado === 'ok' && (
        <Decision codigo={resultado.codigo} decision={resultado.decision} />
      )}
    </Seccion>
  );
}

function Decision({ codigo, decision: d }: { codigo: number; decision: DecisionProbada }) {
  const filas: Array<[string, string]> = [
    ['bloqueado', d.blocked ? 'sí' : 'no'],
    ['modo', d.mode ?? '—'],
    ['acción', d.action ?? '—'],
    ['observado', d.observed === undefined ? '—' : String(d.observed)],
    ['motivo', d.reason ?? '—'],
    ['categoría', d.category ?? '—'],
    ['estado de política', d.policyStatus ?? '—'],
    ['alternativa', d.alternativa ?? '—'],
  ];
  return (
    <Lista>
      {filas
        .filter(([, valor]) => valor !== '—')
        .map(([nombre, valor]) => (
          <Linea key={nombre} titulo={nombre} dato={valor} />
        ))}
      <div className="guardianNota guardianNota--tenue">código de salida {codigo}</div>
    </Lista>
  );
}
