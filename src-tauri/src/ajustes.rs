// Rutas y secretos del arranque.
//
// [por que] La app no es portable (decision 0.4 del plan): necesita la carpeta
// del repo para el backend, la config y `data/`. El token del manager vive en
// la carpeta del usuario y lo lee Rust; el front nunca lo ve, igual que con el
// proxy de Vite en el navegador.

use std::path::PathBuf;

/// Puerto del backend del tablero (el del registro, `puertos.ts`).
pub const PUERTO_API: u16 = 8787;

/// Carpeta del area, derivada del perfil (sin rutas absolutas de una maquina).
fn carpeta_area() -> Option<PathBuf> {
    if let Some(a) = std::env::var_os("WM_AREA") {
        return Some(PathBuf::from(a));
    }
    /* OneDrive puede redirigir Documentos; su propia variable manda si existe. */
    let docs = std::env::var_os("OneDrive")
        .map(|o| PathBuf::from(o).join("Documentos"))
        .or_else(|| std::env::var_os("USERPROFILE").map(|p| PathBuf::from(p).join("OneDrive").join("Documentos")))?;
    let area = docs.join("area-trabajo");
    area.is_dir().then_some(area)
}

/// Raiz del repo. Orden: `WM_REPO` > `%WM_AREA%` > la del perfil.
/// `None` si ahi no hay backend compilado: sin el no hay tablero que servir.
pub fn raiz_repo() -> Option<PathBuf> {
    let candidata = std::env::var_os("WM_REPO")
        .map(PathBuf::from)
        .or_else(|| carpeta_area().map(|a| a.join("workspace-manager")))?;
    let entrada = candidata.join("dist-server").join("server").join("index.js");
    entrada.is_file().then_some(candidata)
}

/// Token de portador del manager. Mismo orden que el backend
/// (`seguridad/token.ts`): `WM_TOKEN`, luego el fichero. Se lee DESPUES de
/// arrancar el backend, que es quien lo crea la primera vez.
pub fn token() -> Option<String> {
    if let Ok(t) = std::env::var("WM_TOKEN") {
        let t = t.trim().to_string();
        return (!t.is_empty()).then_some(t);
    }
    let ruta = std::env::var_os("WM_TOKEN_FILE")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("USERPROFILE")
                .map(|h| PathBuf::from(h).join(".workspace-manager").join("token"))
        })?;
    let token = std::fs::read_to_string(ruta).ok()?.trim().to_string();
    /* El backend exige 32 caracteres; uno corto es un fichero tocado a mano. */
    (token.len() >= 32).then_some(token)
}
