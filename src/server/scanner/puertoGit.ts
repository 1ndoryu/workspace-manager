/* Puerto de git: lo que el escáner necesita de git, sin depender del proceso concreto.
 * [por que] Vive en su propio archivo para que quien solo necesita el TIPO (rutas, escáner)
 * no importe la implementación de scanner/git.ts. La implementación por defecto sigue en git.ts. */
export interface PuertoGit {
  git(ruta: string, args: string[]): string | null;
  gitAsync(ruta: string, args: string[]): Promise<string | null>;
}
