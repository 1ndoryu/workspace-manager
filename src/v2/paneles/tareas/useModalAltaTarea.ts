/* Estado del modal de alta rapida (08AA-8: extraido del componente por el
 * gate `usestate-excesivo`/`componente-sin-hook-glory`).
 * [por que] El componente solo renderiza; el hook posee los 4 estados
 * (texto/prioridad/urgencia/menu) + foco + gestos, igual que useMenuTarjeta
 * hace con el menu de la tarjeta. `DatosAltaTarea` vive aqui para no crear
 * un ciclo de tipos con el modal (el modal la re-exporta). */
import { useEffect, useRef, useState } from 'react';
import {
  ETIQUETAS_PRIORIDAD,
  ETIQUETAS_URGENCIA,
} from '../../../shared/tareasTab.js';

/* Subconjunto de DatosCreacion de TASKS que el proxy soporta. */
export interface DatosAltaTarea {
  texto: string;
  prioridad: string | null;
  urgencia: string;
}

/* Un solo menu abierto (como EstadoMenu de TASKS, recortado a lo que el
 * proxy soporta). */
export type MenuAlta = 'prioridad' | 'urgencia' | null;

interface AltaGestos {
  onCerrar: () => void;
  onGuardar: (datos: DatosAltaTarea) => Promise<void>;
}

export function useModalAltaTarea(g: AltaGestos) {
  const [texto, setTexto] = useState('');
  const [prioridad, setPrioridad] = useState<string | null>(null);
  const [urgencia, setUrgencia] = useState<string>('normal');
  const [menu, setMenu] = useState<MenuAlta>(null);
  const entradaRef = useRef<HTMLInputElement>(null);

  /* Autofocus al abrir (como useModalCreacionRapida: foco al montar). */
  useEffect(() => {
    entradaRef.current?.focus();
  }, []);

  const puedeGuardar = texto.trim() !== '';

  /* Cierre instantaneo (08AA-8: carga optimista): el hook de la tab pinta
   * la tarjeta fantasma al momento y la relectura la confirma; si el PUT
   * falla, el banner del panel canta el motivo (el error vive en el hook
   * de la tab, aqui no se espera nada). */
  const guardar = () => {
    const limpio = texto.trim();
    if (limpio === '') return;
    g.onCerrar();
    void g.onGuardar({ texto: limpio, prioridad, urgencia });
  };

  /* Escape cierra el menu si hay uno abierto, si no el modal (como TASKS:
   * los menus se cierran antes que el modal). */
  const teclaEntrada = (ev: React.KeyboardEvent) => {
    if (ev.key !== 'Escape') return;
    if (menu !== null) setMenu(null);
    else g.onCerrar();
  };

  const elegir = (siguiente: DatosAltaTarea) => {
    if (siguiente.prioridad !== prioridad) setPrioridad(siguiente.prioridad);
    if (siguiente.urgencia !== urgencia) setUrgencia(siguiente.urgencia);
    setMenu(null);
    entradaRef.current?.focus();
  };

  return {
    texto,
    setTexto,
    prioridad,
    urgencia,
    menu,
    setMenu,
    entradaRef,
    puedeGuardar,
    guardar,
    teclaEntrada,
    elegir,
    tituloPrioridad:
      prioridad === null ? 'Prioridad' : `Prioridad ${ETIQUETAS_PRIORIDAD[prioridad] ?? prioridad}`,
    tituloUrgencia: urgencia === 'normal' ? 'Urgencia' : (ETIQUETAS_URGENCIA[urgencia] ?? urgencia),
  };
}

export type ModalAltaApi = ReturnType<typeof useModalAltaTarea>;
