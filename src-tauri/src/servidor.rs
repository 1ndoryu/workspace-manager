// Servidor local que alimenta la ventana.
//
// [por que] La ventana apunta a `127.0.0.1:<puerto libre>` servido desde este
// proceso, no al backend directo. Asi hay un solo origen (sin CORS, sin tocar el
// front) y el token lo pone Rust al proxyar `/api`, exactamente como el proxy de
// Vite en el navegador. El front va empotrado en el exe (`frontendDist`).

use crate::ajustes::{self, PUERTO_API};
use crate::proxy::{self, Peticion};
use crate::abrir;
use std::io::Read;
use std::sync::{Arc, Mutex};
use tauri::AppHandle;
use tiny_http::{Header, Response, Server};
use crate::backend::Backend;

/// Pantalla de aviso: va empotrada porque tiene que verse justo cuando la API
/// no esta, y entonces no hay front del que fiarse.
const SIN_BACKEND: &str = include_str!("sin-backend.html");

/// Enganche de enlaces externos, inyectado al servir `index.html`.
const ENLACES: &str = include_str!("enlaces.js");

/// Peticiones atendidas a la vez. El backend tarda (escaneo del area, sondas de
/// la 89), asi que varias en vuelo importan mas que el coste de los hilos.
const HILOS: usize = 8;

/// Tope del cuerpo entrante (las escrituras son JSON pequenos).
const MAX_PETICION: u64 = 16 * 1024 * 1024;

type Salida = Response<std::io::Cursor<Vec<u8>>>;

/// Levanta el servidor en un puerto libre de 127.0.0.1 y devuelve ese puerto.
pub fn arrancar(app: AppHandle, proceso: Arc<Mutex<Option<Backend>>>) -> Result<u16, String> {
    let servidor = Server::http("127.0.0.1:0").map_err(|e| format!("no se pudo abrir el puerto: {e}"))?;
    let puerto = servidor
        .server_addr()
        .to_ip()
        .ok_or("el servidor no quedo en una IP")?
        .port();
    let servidor = Arc::new(servidor);
    let propio = Arc::new(puerto);

    for _ in 0..HILOS {
        let servidor = Arc::clone(&servidor);
        let propio = Arc::clone(&propio);
        let app = app.clone();
        let proceso = Arc::clone(&proceso);
        std::thread::spawn(move || {
            // `recv` solo falla si el servidor se cerro: ahi el hilo termina.
            while let Ok(peticion) = servidor.recv() {
                if let Err(e) = atender(&app, *propio, &proceso, peticion) {
                    eprintln!("[servidor] {e}");
                }
            }
        });
    }
    Ok(puerto)
}

/// ¿El navegador que llama es esta misma ventana? Se exige `Origin` cuando lo
/// trae (escrituras y SSE) y se compara con el puerto efimero del propio
/// servidor: una pagina web ajena no puede disparar nada aunque conozca el
/// puerto. Sin `Origin` se admite: el token sigue siendo la llave y no lo tiene
/// nadie mas.
fn origen_propio(peticion: &tiny_http::Request, puerto: u16) -> bool {
    match cabecera(peticion, "origin") {
        None => true,
        Some(o) => {
            let o = o.to_ascii_lowercase();
            o == format!("http://127.0.0.1:{puerto}") || o == format!("http://localhost:{puerto}")
        }
    }
}

fn atender(
    app: &AppHandle,
    puerto: u16,
    proceso: &Mutex<Option<Backend>>,
    mut peticion: tiny_http::Request,
) -> Result<(), String> {
    /* La ruta sin query decide el enrutado; la completa viaja al backend, cuyas
     * rutas llevan parámetros (`tab`, `id`) y perderlos da 400. */
    let completa = peticion.url().to_string();
    let ruta = completa.split('?').next().unwrap_or("/").to_string();

    if !origen_propio(&peticion, puerto) {
        return responder(peticion, respuesta(403, "text/plain", b"origin no permitido".to_vec(), false));
    }

    let salida = if ruta == "/__sin-backend" {
        respuesta(200, "text/html; charset=utf-8", SIN_BACKEND.as_bytes().to_vec(), false)
    } else if ruta == "/__reintentar" {
        reintentar(proceso)
    } else if ruta == "/__abrir" {
        /* POST del enganche: el cuerpo es pequeño y solo lleva la URL. */
        let mut cuerpo = String::new();
        if let Err(e) = peticion.as_reader().take(8192).read_to_string(&mut cuerpo) {
            return responder(peticion, respuesta(400, "text/plain", format!("cuerpo ilegible: {e}").into_bytes(), false));
        }
        abrir_json(&cuerpo)
    } else if ruta.starts_with("/api/") {
        /* El SSE no se puede bufferizar: se responde en flujo, copiando trozos
         * en cuanto llegan (el escaneo de la tab PC dura minutos). */
        let aceptar = cabecera(&peticion, "accept");
        if proxy::pide_eventos(aceptar.as_deref()) {
            return flujo(peticion, &completa);
        }
        reenviar(&mut peticion, &completa)
    } else {
        estatico(app, &ruta)
    };
    responder(peticion, salida)
}

fn responder<R: Read>(peticion: tiny_http::Request, salida: Response<R>) -> Result<(), String> {
    let ruta = peticion.url().to_string();
    peticion
        .respond(salida)
        .map_err(|e| format!("no se pudo responder {ruta}: {e}"))
}

/// Reintento del boton de la pantalla de aviso: vuelve a mirar el backend. Solo
/// lo pulsa alguien cuando ya sabe que no funciona, asi que el bloqueo es corto.
fn reintentar(proceso: &Mutex<Option<Backend>>) -> Salida {
    if proxy::salud(PUERTO_API) {
        let json = serde_json::json!({ "backend": true }).to_string();
        return respuesta(200, "application/json", json.into_bytes(), false);
    }

    /* Un proceso propio que murio (node no esta en el PATH, dist-server roto)
     * no debe impedir el reintento: se suelta antes de volver a intentarlo. */
    let mut guarda = proceso.lock().expect("candado del backend");
    if guarda.as_mut().is_some_and(|b| !b.sigue()) {
        *guarda = None;
    }
    let detalle = if guarda.is_some() {
        "el backend que lanzo la app sigue arrancando; espera unos segundos".to_string()
    } else {
        let (quien, motivo) = crate::backend::asegurar();
        *guarda = quien;
        if motivo.is_empty() {
            return respuesta(200, "application/json", br#"{"backend":true}"#.to_vec(), false);
        }
        if crate::backend::puerto_ocupado() {
            format!("{motivo}; y el 8787 esta ocupado por algo que no es el backend del tablero")
        } else {
            motivo
        }
    };
    let json = serde_json::json!({ "backend": false, "detalle": detalle }).to_string();
    respuesta(200, "application/json", json.into_bytes(), false)
}

/// `{"url":"https://..."}` → se abre en el navegador del sistema.
fn abrir_json(cuerpo: &str) -> Salida {
    let url = serde_json::from_str::<serde_json::Value>(cuerpo)
        .ok()
        .and_then(|v| v.get("url").and_then(|u| u.as_str()).map(str::to_string));
    let Some(url) = url else {
        return respuesta(400, "application/json", br#"{"ok":false,"detalle":"falta url"}"#.to_vec(), false);
    };
    match abrir::en_navegador(&url) {
        Ok(()) => respuesta(200, "application/json", br#"{"ok":true}"#.to_vec(), false),
        Err(e) => {
            let json = serde_json::json!({ "ok": false, "detalle": e }).to_string();
            respuesta(400, "application/json", json.into_bytes(), false)
        }
    }
}

/// Proxy hacia el backend. El token lo pone `proxy.rs`; el cliente no lo trae.
fn reenviar(peticion: &mut tiny_http::Request, ruta: &str) -> Salida {
    let mut cuerpo = Vec::new();
    if peticion.body_length().is_some_and(|n| n as u64 > MAX_PETICION) {
        return respuesta(413, "text/plain", b"cuerpo demasiado grande".to_vec(), false);
    }
    if let Err(e) = peticion.as_reader().take(MAX_PETICION).read_to_end(&mut cuerpo) {
        return respuesta(400, "text/plain", format!("peticion ilegible: {e}").into_bytes(), false);
    }

    let peticion_api = Peticion {
        metodo: peticion.method().as_str().to_string(),
        ruta: ruta.to_string(),
        autorizacion: cabecera(peticion, "authorization"),
        tipo: cabecera(peticion, "content-type"),
        cuerpo,
    };

    match proxy::reenviar(PUERTO_API, &peticion_api, ajustes::token().as_deref()) {
        Ok(r) => respuesta(r.estado, &r.tipo, r.cuerpo, false),
        Err(e) => respuesta(502, "text/plain", e.into_bytes(), false),
    }
}

/// Proxy en flujo para `text/event-stream`.
fn flujo(peticion: tiny_http::Request, ruta: &str) -> Result<(), String> {
    let peticion_api = Peticion {
        metodo: "GET".to_string(),
        ruta: ruta.to_string(),
        autorizacion: cabecera(&peticion, "authorization"),
        tipo: None,
        cuerpo: Vec::new(),
    };
    let (estado, tipo, lector) =
        match proxy::reenviar_flujo(PUERTO_API, &peticion_api, ajustes::token().as_deref()) {
            Ok(t) => t,
            Err(e) => return responder(peticion, respuesta(502, "text/plain", e.into_bytes(), false)),
        };

    let mut salida = Response::new(estado.into(), Vec::new(), lector, None, None);
    if let Ok(h) = Header::from_bytes(&b"content-type"[..], tipo.as_bytes()) {
        salida = salida.with_header(h);
    }
    /* Algunos intermediarios bufferean el SSE y la pantalla no pinta hasta el
     * final del escaneo; estas dos cabeceras lo evitan. */
    if let Ok(h) = Header::from_bytes(&b"cache-control"[..], &b"no-cache"[..]) {
        salida = salida.with_header(h);
    }
    if let Ok(h) = Header::from_bytes(&b"x-accel-buffering"[..], &b"no"[..]) {
        salida = salida.with_header(h);
    }
    responder(peticion, salida)
}

/// Sirve un archivo empotrado. Sin coincidencia, cae a `index.html`.
fn estatico(app: &AppHandle, ruta: &str) -> Salida {
    // El resolutor de Tauri ya cae solo a `index.html` cuando la ruta no existe
    // (en tauri 2.12.4, `get_asset`), que es justo lo que necesita un front de
    // una sola pagina al recargar.
    let rel = ruta.trim_start_matches('/');
    let rel = if rel.is_empty() { "index.html" } else { rel };
    match app.asset_resolver().get(rel.to_string()) {
        Some(a) => {
            let tipo = a.mime_type().to_string();
            /* El enganche de enlaces va en el HTML y no en el bundle: asi el
             * front compilado no depende de la app y en el navegador no existe. */
            if rel == "index.html" {
                let html = String::from_utf8_lossy(a.bytes());
                let html = html.replace("</head>", &format!("<script>{ENLACES}</script></head>"));
                return respuesta(200, &tipo, html.into_bytes(), false);
            }
            respuesta(200, &tipo, a.bytes().to_vec(), false)
        }
        None => respuesta(404, "text/plain", b"no encontrado".to_vec(), false),
    }
}

/// Valor de una cabecera de la peticion, sin distinguir mayusculas.
fn cabecera(peticion: &tiny_http::Request, nombre: &str) -> Option<String> {
    peticion
        .headers()
        .iter()
        .find(|h| h.field.to_string().eq_ignore_ascii_case(nombre))
        .map(|h| h.value.to_string())
}

fn respuesta(estado: u16, tipo: &str, cuerpo: Vec<u8>, inmutable: bool) -> Salida {
    let mut salida = Response::from_data(cuerpo).with_status_code(estado);
    if let Ok(h) = Header::from_bytes(&b"content-type"[..], tipo.as_bytes()) {
        salida = salida.with_header(h);
    }
    let cache = if inmutable {
        "public, max-age=31536000, immutable"
    } else {
        // El front se sirve desde memoria: no tiene sentido que el webview
        // guarde una version que el proximo build cambia.
        "no-store"
    };
    if let Ok(h) = Header::from_bytes(&b"cache-control"[..], cache.as_bytes()) {
        salida = salida.with_header(h);
    }
    salida
}
