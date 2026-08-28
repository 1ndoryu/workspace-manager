/* Componente atomico: Badge de estado.
 * [por que] Estados (ok/warn/danger/muted) centralizados, reutilizable en lista,
 * mapa y detalle. Sin decisiones de diseno locales. */
import type { ReactNode } from 'react';
import './badge.css';

export type EstadoBadge = 'ok' | 'warn' | 'danger' | 'muted' | 'info';

export interface BadgeProps {
  estado: EstadoBadge;
  children: ReactNode;
  titulo?: string;
}

export function Badge({ estado, children, titulo }: BadgeProps) {
  return (
    <span className={`badge badge--${estado}`} title={titulo}>
      {children}
    </span>
  );
}
