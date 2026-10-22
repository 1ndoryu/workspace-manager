// Rutas y secretos del arranque.
//
// [por que] La app no es portable (decision 0.4 del plan): necesita la carpeta
// del repo para el backend, la config y `data/`. El token del manager vive en
// la carpeta del usuario y lo lee Rust; el front nunca lo ve, igual que con el
// proxy de Vite en el navegador.

use std::path::{Path, PathBuf};

/// Puerto del backend del tablero: `WS_PORT`, con el defecto de `puertos.ts`. [por que] Era una
/// constante: el backend honraba `WS_PORT` y la app seguía llamando a 8787, así que mover el puerto
/// dejaba el .exe sin backend. Es una función para leerlo al arrancar, no al cargar el binario.
pub fn puerto_api() -> u16 {
    std::env::var("WS_PORT")
        .ok()
        .and_then(|v| v.trim().parse::<u16>().ok())
        .filter(|p| *p > 0)
        .unwrap_or(8787)
}

/// Carpeta del area, derivada del perfil (sin rutas absolutas de una maquina).
/// [por que] El ultimo recurso buscaba `Documentos/area-trabajo`, que es el nombre de NUESTRA
/// area: en un clon con otro nombre la app no encontraba el backend. Ahora se deriva de las
/// variables y, si no hay ninguna, se busca el repo por su contenido, no por su nombre.
fn carpeta_area() -> Option<PathBuf> {
    if let Some(a) = std::env::var_os("WM_AREA") {
        return Some(PathBuf::from(a));
    }
    if let Some(r) = std::env::var_os("WM_REPO") {
        return PathBuf::from(r).parent().map(Path::to_path_buf);
    }
    /* OneDrive puede redirigir Documentos; su propia variable manda si existe. */
    let docs = std::env::var_os("OneDrive")
        .map(|o| PathBuf::from(o).join("Documentos"))
        .or_else(|| std::env::var_os("USERPROFILE").map(|p| PathBuf::from(p).join("OneDrive").join("Documentos")))?;
    buscar_repo(&docs, 3).and_then(|repo| repo.parent().map(Path::to_path_buf))
}

/// Busca un repo del tablero por su contenido (`dist-server/server/index.js`) hasta `profundidad`
/// niveles bajo `raiz`. [por que] Sin variables no hay nombre que consultar; el contenido sí
/// distingue un repo del tablero de cualquier otra carpeta.
fn buscar_repo(raiz: &std::path::Path, profundidad: u8) -> Option<PathBuf> {
    if raiz.join("dist-server").join("server").join("index.js").is_file() {
        return Some(raiz.to_path_buf());
    }
    if profundidad == 0 {
        return None;
    }
    for entrada in std::fs::read_dir(raiz).ok()? {
        let hijo = entrada.ok()?.path();
        if hijo.is_dir() {
            if let Some(hallado) = buscar_repo(&hijo, profundidad - 1) {
                return Some(hallado);
            }
        }
    }
    None
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
