/* Piezas pesadas bajo demanda (0110A-3 F3).
 * [por que] El legacy /api/vps/detalle corre 7 piezas SSH en serie
 * (~120 s en frio): aqui cada pieza se pide con su boton, con timeout
 * propio y AbortController por pieza; una pieza colgada no tumba a las
 * demas ni a la tab. Sin estilos nuevos: reutiliza .vpsLinea (podado
 * .vpsPre en 0610A-1, asi que el texto va en <pre> sin clase). */
import { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/form/Button.js';
import { piezaVps } from './apiVps.js';
import type { VpsPieza } from '../../shared/types.js';

/* Timeout de UX por pieza: el servidor responde timeout-pieza a los
 * 20 s; aqui se aborta a los 25 s como red de seguridad si el servidor
 * tampoco respondiera (no deberia: su carrera siempre resuelve). */
const TIMEOUT_MS = 25_000;

const PIEZAS: ReadonlyArray<{ nombre: string; etiqueta: string }> = [
  { nombre: 'salud', etiqueta: 'Salud' },
  { nombre: 'stats', etiqueta: 'Stats' },
  { nombre: 'inspeccion', etiqueta: 'Inspección' },
  { nombre: 'eventos', etiqueta: 'Eventos' },
  { nombre: 'bd', etiqueta: 'BD' },
  { nombre: 'diagnostico', etiqueta: 'Diagnóstico' },
  { nombre: 'logs', etiqueta: 'Logs' },
];

type EstadoPieza = VpsPieza | 'cargando';

function Resultado({ pieza }: { pieza: VpsPieza }) {
  if (!pieza.ok) return <div>{pieza.error ?? 'fallo'}</div>;
  if (typeof pieza.datos === 'string') return <pre>{pieza.datos}</pre>;
  return <pre>{JSON.stringify(pieza.datos, null, 2) ?? '—'}</pre>;
}

export function PiezasSitio({ sitio }: { sitio: string }) {
  const [piezas, setPiezas] = useState<Record<string, EstadoPieza>>({});
  const controles = useRef(new Map<string, AbortController>());

  /* Al desmontar (cambio de sitio, cierre del detalle): aborta lo que
   * siga en vuelo para no escribir estado de otro sitio. */
  useEffect(() => {
    const mapa = controles.current;
    return () => {
      for (const c of mapa.values()) c.abort();
      mapa.clear();
    };
  }, [sitio]);

  function pedir(nombre: string) {
    const enVuelo = controles.current.get(nombre);
    if (enVuelo) {
      /* Segundo clic: cancela (vuelve a reposo). */
      enVuelo.abort();
      controles.current.delete(nombre);
      setPiezas((prev) => {
        const sig = { ...prev };
        delete sig[nombre];
        return sig;
      });
      return;
    }
    const ctrl = new AbortController();
    controles.current.set(nombre, ctrl);
    setPiezas((prev) => ({ ...prev, [nombre]: 'cargando' }));
    const expira = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    void piezaVps(sitio, nombre, { senal: ctrl.signal })
      .then((pieza) => setPiezas((prev) => ({ ...prev, [nombre]: pieza })))
      .catch((err: unknown) =>
        setPiezas((prev) => ({
          ...prev,
          [nombre]: {
            ok: false,
            datos: null,
            error: err instanceof Error && err.name === 'AbortError' ? 'cancelado' : String(err).slice(0, 200),
          },
        })),
      )
      .finally(() => {
        clearTimeout(expira);
        controles.current.delete(nombre);
      });
  }

  return (
    <>
      {PIEZAS.map(({ nombre, etiqueta }) => {
        const actual = piezas[nombre];
        return (
          <div key={nombre} className="vpsLinea">
            <Button className="navegadorRutaChip" onClick={() => pedir(nombre)}>
              {etiqueta}
              {actual === 'cargando' ? ' …' : ''}
            </Button>{' '}
            {actual === 'cargando' ? (
              <span>cargando… (clic para cancelar)</span>
            ) : actual ? (
              <Resultado pieza={actual} />
            ) : (
              <span>sin pedir</span>
            )}
          </div>
        );
      })}
    </>
  );
}
