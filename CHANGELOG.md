# Changelog — workspace-manager

Formato: [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/). La versión vive en
`package.json` y `src-tauri/tauri.conf.json`; `scripts/app/version.mjs` comprueba que las dos
coincidan y que este fichero tenga una sección para ella (gate `check:version`).

## [0.2.0] — 2026-10-22

### Cambiado

- **El mapa ya no da por vivo lo que no puede ver.** El doctor arrancaba en
  `bajo-mando · probe verde` y solo lo corregía si encontraba algo que sondear: una ficha sin
  puertos (`sinServicio`, `puertosRemotos: []`) salía CONECTADA sin abrir un socket. Ahora el
  verde se gana con un probe HTTP 200 real; sin nada que sondear, `no-aplica · sin-servicio`.
- `notaModo` entra en las claves admitidas del registro: al no estarlo, una ficha con esa nota
  quedaba en `deriva · clave desconocida` y el clasificador cortaba antes de sondear nada.
- Las dos fichas de servicios remotos que se sirven desde la 89 pasan a `permanente`: el
  supervisor rearma sus túneles en vez de depender de que alguien los abra a mano.

### Añadido

- Versión visible en el nav, con un botón que abre el changelog.
- Distintivo «desactualizada» cuando la app instalada no corresponde al código en `main`.
