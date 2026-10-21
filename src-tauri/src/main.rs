// Workspace Manager en el escritorio (Windows, Tauri 2).
//
// [por que] El tablero es un front de Vite y un backend Node: en el navegador
// funciona, y la app no reescribe nada de eso. Rust sirve el front empotrado
// desde un puerto libre de 127.0.0.1 y hace de proxy de `/api` al backend del
// portatil, inyectando el token que el front nunca ve. Un solo origen, sin CORS,
// sin tocar el front y sin un segundo backend (plan `20AA-19`).

// Sin consola en release: es una app de escritorio, no un programa de terminal.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod abrir;
mod ajustes;
mod avisos;
mod backend;
mod dicho;
mod proxy;
mod servidor;

use std::sync::{Arc, Mutex};
use tauri::{WebviewUrl, WebviewWindowBuilder};

fn main() {
    dicho::vigilar_panicos();
    /* El backend arrancado por la app se para al cerrar la ventana; el que ya
     * corria (el del VBS de inicio de sesion) no se toca. */
    let proceso: Arc<Mutex<Option<backend::Backend>>> = Arc::new(Mutex::new(None));
    let al_cerrar = Arc::clone(&proceso);
    let al_arrancar = Arc::clone(&proceso);

    let resultado = tauri::Builder::default()
        .setup(move |app| {
            /* [por que] Arrancar el backend puede tardar hasta 20 s (node frio).
             * Eso no puede pasar dentro de `setup`: la ventana no existiria y no
             * habria nada que mirar. Se sonda 2 s; si no hay backend, la ventana
             * abre en el aviso, que se reintenta solo, mientras un hilo lo
             * levanta y anota quien es para poder pararlo al cerrar. */
            if proxy::salud(crate::ajustes::PUERTO_API) {
                *proceso.lock().expect("candado del backend") = Some(backend::Backend::Externo);
            } else {
                let hilo = Arc::clone(&al_arrancar);
                std::thread::spawn(move || {
                    let (quien, detalle) = backend::asegurar();
                    if let Some(b) = quien {
                        *hilo.lock().expect("candado del backend") = Some(b);
                    }
                    if !detalle.is_empty() {
                        dicho::anotar(&format!("el backend del tablero no arranco: {detalle}"));
                    }
                });
            }
            /* [por que] El backend puede caerse con la app abierta (alguien mata
             * el `node`). Sin vigilante, la ventana se queda en 502 hasta que se
             * reinicia la app; con el, se vuelve a levantar en unos segundos. */
            std::thread::spawn({
                let proceso = Arc::clone(&al_arrancar);
                move || backend::vigilar(proceso)
            });
            let sin_backend = !proxy::salud(crate::ajustes::PUERTO_API);

            /* Toast del sistema (20AA-27): registra el AUMID en el menú Inicio (sin eso Windows
             * descarta el toast en silencio). El canal lo abre la página, en `enlaces.js`. */
            avisos::preparar();

            let puerto = servidor::arrancar(app.handle().clone(), Arc::clone(&al_arrancar))?;
            let inicial = if sin_backend { "/__sin-backend" } else { "/" };
            let url: tauri::Url = format!("http://127.0.0.1:{puerto}{inicial}").parse()?;

            WebviewWindowBuilder::new(app, "principal", WebviewUrl::External(url))
                .title("Workspace Manager")
                .inner_size(1440.0, 900.0)
                .min_inner_size(1024.0, 640.0)
                .build()?;
            Ok(())
        })
        .build(tauri::generate_context!());

    let app = match resultado {
        Ok(a) => a,
        Err(e) => dicho::morir(&format!("no se pudo arrancar: {e}")),
    };

    app.run(move |_, evento| {
        /* Solo al salir: parar en cada `RunEvent` dejaria el backend muerto al
         * recargar la ventana. */
        if let tauri::RunEvent::Exit = evento {
            if let Some(mut b) = al_cerrar.lock().expect("candado del backend").take() {
                b.parar();
            }
        }
    });
}
