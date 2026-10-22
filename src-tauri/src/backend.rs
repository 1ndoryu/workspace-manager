// Ciclo de vida del backend Node del tablero.
//
// [por que] El tablero ya se arranca al iniciar sesion (el VBS de Startup lanza
// `Arranque up workspace-manager`). La app NO levanta un segundo proceso: usa el
// que ya corre y solo lanza el suyo si `/api/ping` no contesta. Al cerrarse se
// lleva unicamente el que arranco ella; dos `node` peleando por el 8787 seria
// justo el desastre que hay que evitar (decision 0.1 del plan).

use crate::ajustes::puerto_api;
use crate::proxy;
use std::net::TcpStream;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
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
    proxy::salud(puerto_api())
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
    /* [por que] `node` es un programa de consola: al lanzarlo desde un proceso
     * GUI sin consola, Windows le crea una ventana propia aunque stdout y stderr
     * vayan a un fichero. Esa ventana era la que se veia (y cerrarla mataba el
     * backend: de ahi el 502). CREATE_NO_WINDOW la evita sin tocar el proceso. */
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        orden.creation_flags(CREATE_NO_WINDOW);
    }
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

/// Vigila el backend mientras la app vive: si el que lanzamos murio (o nadie
/// contesta y el puerto quedo libre), lo vuelve a levantar.
///
/// [por que] Sin esto, matar el backend deja la ventana en 502 para siempre y la
/// unica salida es cerrar y abrir la app. Solo actua cuando el puerto esta
/// LIBRE: si Arranque esta reiniciando el suyo, no compite con el.
pub fn vigilar(proceso: Arc<Mutex<Option<Backend>>>) {
    const CADA: Duration = Duration::from_secs(3);
    /* Dos comprobaciones seguidas antes de actuar: un backend que arranca tarda
     * un par de segundos en abrir el puerto y no queremos pisarlo. */
    let mut libres = 0u8;
    loop {
        std::thread::sleep(CADA);
        let mut guarda = proceso.lock().expect("candado del backend");
        let propio_muerto = guarda.as_mut().is_some_and(|b| !b.sigue());
        if propio_muerto {
            *guarda = None;
        }
        if responde() || puerto_ocupado() {
            libres = 0;
            continue;
        }
        libres += 1;
        if libres < 2 {
            continue;
        }
        libres = 0;
        drop(guarda);
        let (quien, detalle) = asegurar();
        *proceso.lock().expect("candado del backend") = quien;
        if !detalle.is_empty() {
            crate::dicho::anotar(&format!("el backend del tablero se cayo: {detalle}"));
        }
    }
}

/// ¿Alguien escucha en el puerto? Sirve para distinguir «no hay nada» de «hay
/// algo que no es nuestro» en el detalle del aviso.
pub fn puerto_ocupado() -> bool {
    TcpStream::connect_timeout(
        &format!("127.0.0.1:{}", puerto_api()).parse().expect("direccion fija"),
        Duration::from_millis(300),
    )
    .is_ok()
}
