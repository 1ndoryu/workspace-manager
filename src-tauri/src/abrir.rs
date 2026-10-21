// Enlaces externos: se abren en el navegador del sistema.
//
// [por que] El webview de la app no tiene barras ni pestañas. Un `window.open` o
// un `<a target="_blank">` abriria una ventana de WebView2 sin direccion y sin
// forma de volver, que no es lo que hacia el tablero en el navegador. El front se
// sirve con un enganche minimo (`enlaces.js`) que manda la URL aqui y se abre en
// el navegador de siempre. Los enlaces internos no pasan por aqui.

/// Abre `url` con el manejador del sistema. La URL la elige el registro, asi que
/// se valida: solo http/https y sin caracteres de control.
pub fn en_navegador(url: &str) -> Result<(), String> {
    let u = url.trim();
    if !(u.starts_with("http://") || u.starts_with("https://")) {
        return Err(format!("solo se abren http/https, no {u}"));
    }
    if u.len() > 4096 || u.chars().any(|c| c.is_control() || c.is_whitespace() || c == '"') {
        return Err("url con caracteres no admitidos".to_string());
    }

    #[cfg(windows)]
    {
        /* Sin `cmd`: `rundll32` recibe la URL como argumento y la pasa a
         * ShellExecute, asi que `&`, `^` o `;` no se interpretan. */
        std::process::Command::new("rundll32.exe")
            .args(["url.dll,FileProtocolHandler", u])
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("no se pudo abrir el navegador: {e}"))
    }
    #[cfg(not(windows))]
    {
        std::process::Command::new("xdg-open")
            .arg(u)
            .spawn()
            .map(|_| ())
            .map_err(|e| format!("no se pudo abrir el navegador: {e}"))
    }
}
