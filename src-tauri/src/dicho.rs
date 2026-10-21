// Registro de fallos de arranque.
//
// [por que] En release no hay consola (`windows_subsystem = "windows"`) y el
// perfil lleva `panic = "abort"`: un fallo en `setup` (puerto, WebView2, backend)
// cerraria la app sin decir nada. Se deja una linea en un fichero para que el
// fallo se pueda diagnosticar despues.

use std::io::Write;
use std::path::PathBuf;

/// `%LOCALAPPDATA%\WorkspaceManager\errores.log`, fuera del repo y del area.
fn ruta() -> Option<PathBuf> {
    let base = std::env::var_os("LOCALAPPDATA")?;
    let dir = PathBuf::from(base).join("WorkspaceManager");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("errores.log"))
}

pub fn anotar(texto: &str) {
    let Some(ruta) = ruta() else { return };
    if let Ok(mut f) = std::fs::OpenOptions::new().create(true).append(true).open(ruta) {
        let _ = f.write_all(texto.as_bytes());
    }
}

/// Falla con aviso por consola (si la hay) y en el fichero, y sale.
pub fn morir(motivo: &str) -> ! {
    eprintln!("[workspace-manager] {motivo}");
    anotar(&format!("[{}] {motivo}\n", marca()));
    std::process::exit(1);
}

/// Fecha de la marca, sin dependencias: segundos desde la epoca.
fn marca() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Instala el gancho de panico: un panico tambien deja rastro.
pub fn vigilar_panicos() {
    std::panic::set_hook(Box::new(|info| {
        eprintln!("[workspace-manager] panico: {info}");
        anotar(&format!("[{}] panico: {info}\n", marca()));
    }));
}
