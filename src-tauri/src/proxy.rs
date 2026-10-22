// Puente de `/api` desde el servidor local hacia el backend del portatil.
//
// [por que] El front del tablero pide rutas relativas (`/api/...`) y nunca lleva
// el token: en el navegador lo inyecta el proxy de Vite. Aqui lo inyecta Rust,
// que es el unico que lee el token del disco. Como todo sale del mismo origen
// (127.0.0.1:<puerto de la app>), no hace falta CORS ni tocar el front.

use std::io::Read;
use std::time::Duration;

/// Tope de lectura de una respuesta normal.
const MAX_RESPUESTA: u64 = 64 * 1024 * 1024;

/// Origen del tablero que se presenta al backend en las escrituras.
/// [por que] La guardia de escritura exige un Origin de la lista del tablero
/// (`guardian/operacion/seguridad.ts`), que sale de `WS_WEB_PORT`; el del webview es el puerto
/// efimero de esta app, que no esta en la lista. Se presenta el del front del tablero. Era una
/// constante con 5175: mover el front con `WS_WEB_PORT` dejaba todas las escrituras en 403.
pub fn origen_tablero() -> String {
    let puerto = std::env::var("WS_WEB_PORT")
        .ok()
        .and_then(|v| v.trim().parse::<u16>().ok())
        .filter(|p| *p > 0)
        .unwrap_or(5175);
    format!("http://127.0.0.1:{puerto}")
}

pub struct Peticion {
    pub metodo: String,
    pub ruta: String,
    pub autorizacion: Option<String>,
    pub tipo: Option<String>,
    pub cuerpo: Vec<u8>,
}

pub struct Respuesta {
    pub estado: u16,
    pub tipo: String,
    pub cuerpo: Vec<u8>,
}

fn agente(segundos: u64) -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(segundos))
        .timeout(Duration::from_secs(segundos))
        .build()
}

pub fn url(api: u16, ruta: &str) -> String {
    format!("http://127.0.0.1:{api}{ruta}")
}

/// GET /api/ping: existe y no pide token, justo para esto.
pub fn salud(api: u16) -> bool {
    agente(2)
        .get(&url(api, "/api/ping"))
        .call()
        .map(|r| r.status() == 200)
        .unwrap_or(false)
}

/// ¿El cliente pide un flujo de eventos (`text/event-stream`)? El escaneo de
/// la tab PC lo usa: el trabajo dura minutos y cada fase llega al pintarse.
pub fn pide_eventos(aceptar: Option<&str>) -> bool {
    aceptar.is_some_and(|v| v.to_ascii_lowercase().contains("text/event-stream"))
}

fn construir(
    agente: &ureq::Agent,
    api: u16,
    p: &Peticion,
    token: Option<&str>,
) -> Result<ureq::Response, String> {
    let destino = url(api, &p.ruta);
    let mut peticion = match p.metodo.as_str() {
        "GET" => agente.get(&destino),
        "POST" => agente.post(&destino),
        "PUT" => agente.put(&destino),
        "PATCH" => agente.patch(&destino),
        "DELETE" => agente.delete(&destino),
        otro => return Err(format!("metodo no soportado: {otro}")),
    };
    /* El token lo pone Rust porque el front no lo tiene. Si el cliente ya trae
     * su propia cabecera se respeta. Nunca se registra. `/api/ping` no lo pide. */
    let portador = match (&p.autorizacion, token) {
        (Some(cabecera), _) => Some(cabecera.clone()),
        (None, Some(t)) => Some(format!("Bearer {t}")),
        (None, None) => None,
    };
    if let Some(v) = portador {
        peticion = peticion.set("authorization", &v);
    }
    peticion = peticion.set("origin", &origen_tablero());
    if let Some(t) = &p.tipo {
        peticion = peticion.set("content-type", t);
    }
    let resultado = if p.cuerpo.is_empty() {
        peticion.call()
    } else {
        peticion.send_bytes(&p.cuerpo)
    };
    /* `Error::Status` ya trae la respuesta del servidor: es una respuesta
     * valida, no un fallo de red. */
    match resultado {
        Ok(r) => Ok(r),
        Err(ureq::Error::Status(_, r)) => Ok(r),
        Err(e) => Err(format!("sin respuesta de {destino}: {e}")),
    }
}

/// Respuesta completa (lo normal: JSON y estaticos).
pub fn reenviar(api: u16, p: &Peticion, token: Option<&str>) -> Result<Respuesta, String> {
    let respuesta = construir(&agente(30), api, p, token)?;
    let estado = respuesta.status();
    let tipo = respuesta
        .header("content-type")
        .unwrap_or("application/octet-stream")
        .to_string();
    let mut cuerpo = Vec::new();
    respuesta
        .into_reader()
        .take(MAX_RESPUESTA)
        .read_to_end(&mut cuerpo)
        .map_err(|e| format!("respuesta cortada: {e}"))?;
    Ok(Respuesta { estado, tipo, cuerpo })
}

/// Respuesta en flujo: devuelve el lector sin esperar a que el backend cierre.
/// La espera total es de una hora y no de 30 s: un SSE pasa minutos en silencio
/// entre fases y cortarlo dejaria el escaneo a medias en la ventana. Lo que
/// corta de verdad es que el cliente cierre.
pub fn reenviar_flujo(
    api: u16,
    p: &Peticion,
    token: Option<&str>,
) -> Result<(u16, String, Box<dyn Read + Send>), String> {
    let largo = ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(5))
        .timeout(Duration::from_secs(3600))
        .build();
    let respuesta = construir(&largo, api, p, token)?;
    let estado = respuesta.status();
    let tipo = respuesta
        .header("content-type")
        .unwrap_or("text/event-stream")
        .to_string();
    Ok((estado, tipo, Box::new(respuesta.into_reader())))
}
