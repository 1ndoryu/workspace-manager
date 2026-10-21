// Ciclo de vida del backend Node del tablero.
//
// [por que] El tablero ya se arranca al iniciar sesion (el VBS de Startup lanza
// `Arranque up workspace-manager`). La app NO levanta un segundo proceso: usa el
// que ya corre y solo lanza el suyo si `/api/ping` no contesta. Al cerrarse se
// lleva unicamente el que arranco ella; dos `node` peleando por el 8787 seria
// justo el desastre que hay que evitar (decision 0.1 del plan).

use crate::ajustes::PUERTO_API;
use crate::proxy;
use std::net::TcpStream;
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

/// Espera maxima a que el backend conteste tras lanzarlo.
const ESPERA: Duration = Duration::from_secs(20);
/// Sondeo entre intentos.
const SONDA: Duration = Duration::from_millis(250);

/// Quien atiende la API: el proceso de siempre o el que arranco la app.
pub enum Backend {
    Externo,
    Propio(Child),
}

impl Backend {
    /// ¿Sigue vivo el proceso propio? Uno muerto no debe bloquear el reintento.
    pub fn sigue(&mut self) -> bool {
        match self {
            Backend::Propio(hijo) => matches!(hijo.try_wait(), Ok(None)),
            /* El de siempre: lo vigila su propio lanzador, no nosotros. */
            Backend::Externo => true,
        }
    }

    /// Para el proceso propio al cerrar la ventana. El externo no se toca.
    pub fn parar(&mut self) {
        if let Backend::Propio(hijo) = self {
            let _ = hijo.kill();
            let _ = hijo.wait();
        }
    }
}

fn responde() -> bool {
    proxy::salud(PUERTO_API)
}

/// Reutiliza el backend vivo o lanza uno. `Err` trae el motivo para la pantalla
/// de aviso; la ventana se abre igual.
pub fn asegurar() -> (Option<Backend>, String) {
    if responde() {
        return (Some(Backend::Externo), String::new());
    }
    let raiz = match crate::ajustes::raiz_repo() {
        Some(r) => r,
        None => return (None, "no encuentro la carpeta del repo (dist-server compilado)".into()),
    };

    let log = raiz.join("logs").join("app-escritorio.log");
    if let Some(dir) = log.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let salida = std::fs::OpenOptions::new().create(true).append(true).open(&log);
    let mut orden = Command::new("node");
    orden
        .arg("dist-server/server/index.js")
        .current_dir(&raiz)
        /* Sin consola: la app no tiene ninguna y Windows abriria una negra. */
        .stdin(Stdio::null());
    match salida {
        Ok(a) => {
            orden.stdout(a.try_clone().map(Stdio::from).unwrap_or_else(|_| Stdio::null()));
            orden.stderr(Stdio::from(a));
        }
        Err(_) => {
            orden.stdout(Stdio::null()).stderr(Stdio::null());
        }
    }

    let hijo = match orden.spawn() {
        Ok(h) => h,
        Err(e) => return (None, format!("no se pudo lanzar `node`: {e}")),
    };

    let limite = Instant::now() + ESPERA;
    while Instant::now() < limite {
        if responde() {
            return (Some(Backend::Propio(hijo)), String::new());
        }
        std::thread::sleep(SONDA);
    }
    let detalle = format!(
        "`node dist-server/server/index.js` no respondio en {} s (log: {})",
        ESPERA.as_secs(),
        log.display()
    );
    // Sigue vivo y sin responder: se mata para no dejar dos backends tras el reintento.
    let mut hijo = hijo;
    let _ = hijo.kill();
    let _ = hijo.wait();
    (None, detalle)
}

/// ¿Alguien escucha en el puerto? Sirve para distinguir «no hay nada» de «hay
/// algo que no es nuestro» en el detalle del aviso.
pub fn puerto_ocupado() -> bool {
    TcpStream::connect_timeout(
        &format!("127.0.0.1:{PUERTO_API}").parse().expect("direccion fija"),
        Duration::from_millis(300),
    )
    .is_ok()
}
