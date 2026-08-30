# Plan: saneamiento de AGENTS.md y auditoría integral del workspace

> Estado: S2 en ejecución controlada · Fecha: 2026-08-30
> Regla de seguridad: toda operación peligrosa empieza con backup verificable; ningún backup se considera problema del proyecto.

## 1. Objetivo

Mantener un inventario confiable de proyectos, gates, estados Git y documentos de agentes, con reparaciones reversibles y sin falsos positivos producidos por los propios backups.

## 2. Protocolo obligatorio de backup

Antes de cualquier acción que pueda borrar, mover, sobrescribir, cambiar configuraciones, locks, worktrees, referencias Git, dependencias o `AGENTS.md`:

1. Crear un directorio de backup fuera de la raíz activa del proyecto, con fecha, ID de operación y motivo.
2. Copiar el contenido y conservar ruta relativa, modo/tamaño cuando aplique.
3. Generar `manifest.sha256` con hash del original y de la copia.
4. Comparar todos los hashes; si uno falla, detener la operación.
5. Crear una restauración de prueba en un directorio temporal aislado y comparar nuevamente.
6. Registrar exactamente qué se cambiará, qué no se cambiará, timestamp y herramienta usada.
7. Aplicar una operación acotada y guardar diff/resultado.
8. Verificar después y conservar rollback mediante la copia y el diff.

Los backups no se guardan dentro de una raíz de proyecto escaneada. Si por una limitación operativa deben estar bajo el área, se ubican únicamente en `data/inventarios/` y se excluyen por ruta antes de clasificar proyectos, cambios Git o hallazgos.

## 3. Exclusiones de backups y artefactos

El descubridor y los diagnósticos deben excluir explícitamente, sin ocultar su existencia en el informe:

- `data/inventarios/**` del manager;
- `.archivado/**`, `.freebuff/**`, `.sentinel/**`, `.quality-tools/**`;
- `node_modules/**`, `dist/**`, caches y artefactos temporales;
- cualquier directorio registrado en `BACKUP_ROOTS` o con un manifiesto `manifest.sha256` generado por este plan.

La exclusión solo evita falsos positivos de proyecto/estado; cada backup continúa apareciendo en el inventario de seguridad con ruta, hash y fecha.

## 4. Fases y estado

### S0 — Inventario y backup de AGENTS.md
Completada. Inventario y copias verificadas en `data/inventarios/agents-s0-20260830-012243/`.

### S1 — Auditoría inicial
Completada. Informe en `data/inventarios/s1-auditoria-20260830-012405.md`.

### S2 — Reparaciones priorizadas
En ejecución controlada. Registro en `data/inventarios/s2-plan-reparaciones-20260830-012405.md`.

- **S2-01:** auditoría Sentinel fresca acotada, una ejecución por proyecto elegible, timeout y cache.
- **S2-02:** detector completo de Git: staged, unstaged, untracked, ahead/behind, detached, submódulos y worktrees.
- **S2-03:** descubrimiento de repos anidados con profundidad y deduplicación limitadas.
- **S2-04:** worktree prunable; backup/verificación antes de cualquier reparación o prune.
- **S2-05:** VarSense solo mediante CLI/API/fuente canónica verificable; si no existe, estado `no disponible`.
- **S2-06/S2-07:** reparaciones de problemas/configuración por proyecto, preservando claves desconocidas y con backup previo.
- **S2-08:** revisión SOLID, límites, caché, single-flight, timeouts y tests.

## 5. Seguridad de mutaciones

La autorización del usuario permite ejecutar las acciones planificadas, pero no convierte un diagnóstico ambiguo en un arreglo inventado. Se mantiene backup antes de cada operación y se bloquea cualquier acción sin rollback comprobable. No se borra contenido si la copia no fue verificada.

La consolidación/eliminación de `AGENTS.md`, limpieza de cambios locales, commits externos, instalación de runtimes y `git worktree prune` requieren evidencia concreta del objetivo y se ejecutan uno por uno, nunca en lote ciego.

## 6. Definición de árboles huérfanos

Solo son huérfanos confirmados los worktrees Git o referencias Git abandonadas/rotas. Las carpetas normales, backups y snapshots no son árboles huérfanos.

## 7. Auditoría y límites

Cada ejecución debe tener ID, motivo, límite de tiempo y salida persistida. No hay auto-reintentos infinitos. El análisis profundo usa cache por HEAD/rama/versión/configuración; el escaneo de raíz permanece barato.

## 8. Definition of Done

- Backups completos, hasheados y restaurables.
- Backups excluidos de descubrimiento y problemas, pero visibles en inventario.
- Todos los proyectos clasificados con causa explícita.
- Git y gates auditados sin borrar contenido sin copia verificable.
- Cada reparación con diff, validación y rollback.
- Type-check/tests y revisión final documentados.
