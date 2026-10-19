/* Dominio config: configuracion del area (escaneo, ignorados, excepciones).
 * [por que] El server la lee y la UI la edita; se persiste aparte del snapshot
 * (data/workspace.config.json). */
/* Seccion 'scan' de la config del area: analisis real de sentinel por
 * proyecto, a demanda (boton) o automatico cada cierto intervalo. [por que] El
 * plan analisis-sentinel-consola A2: el auto-escaneo es opt-in y apagado por
 * defecto (con la app cerrada no hay timer -> cero recursos); el intervalo
 * minimo lo valida el server por frescura, no se re-analiza sin cambios. */
export interface ConfigScan {
  automatico: boolean;
  intervaloMin: number;
  /* Si se pide, filtra a la severidad < warning al pedir (opcional). */
  pedirSoloProblemas?: boolean;
}

export interface ConfigWorkspace {
  version: number;
  /* Claves (rutas relativas al area) de proyectos ignorados: no aparecen en
   * el snapshot, se listan en la pagina de excepciones. */
  ignorados: string[];
  /* Claves de proyectos pertenecientes al gate que NO llevan gate (plan
   * 308A-1, excepcion explícita). A diferencia de ignorados, el proyecto
   * SIGUE visible en mapa/lista, pero su puerta se fuerza a 'none' y no
   * genera problema "sin gate" en la consola. Solo se registra el papel
   * `sentinel` de config/area.json (el propio repo del runtime; instalarle
   * gate seria autorreferencial). */
  sinGate?: string[];
  /* Claves de proyectos con sentinel declarado pero exentos de varsense: la
   * consola no genera "varsense ausente" y el analisis no exige varsense.
   * Opt-in por excepcion explicita en data/workspace.config.json (v4). */
  varsenseOpcional?: string[];
  /* Nombres de carpeta de ESTA area que el escaner no trata como proyecto
   * (v5). [por que] El escaner traia `TRABAJOS CLIENTES` y `3D` incrustados:
   * son carpetas de una area concreta, no del producto. Las estructurales
   * (node_modules, .git, dist, temp...) siguen en el codigo, porque no son
   * nuestras: cualquier area las tiene. */
  carpetasIgnoradas?: string[];
  /* Nombres de carpeta bajo los que SI hay proyectos, un nivel mas abajo
   * (v5). Ejemplo: una carpeta de clientes con un repo dentro. */
  carpetasRecursivas?: string[];
  /* Nombres de carpeta que no viajan al audit remoto por pesadas (v5).
   * Se suman a las de siempre (node_modules, target, data, uploads...). */
  carpetasPesadas?: string[];
  /* Analisis automatico de sentinel por proyecto (ausente => apagado). */
  scan?: ConfigScan;
}
