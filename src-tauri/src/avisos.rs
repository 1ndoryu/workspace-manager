// Avisos del tablero como toast de Windows (20AA-27).
//
// [por que] La campana vive dentro del tablero: si la ventana está minimizada o detrás de otra, un
// sitio caído no se ve. Esto la saca al sistema sin abrir el webview a Tauri: el enganche
// `enlaces.js` abre un `EventSource` en el MISMO canal que la campana y reenvía cada sobre aquí por
// `POST /__aviso`. Ni estado propio, ni reglas, ni una segunda pasada por las fuentes: si mañana se
// añade una fuente al motor, el toast sale sin tocar este archivo.
// [por que lo abre el webview y no un hilo de Rust] Un hilo propio tendría que guardar la posición
// y reconectar con su propia máquina de estados; un `EventSource` de la página ya reanuda solo con
// `Last-Event-ID`. Y como la página es la misma del tablero, aquí no hace falta el token: el
// servidor local ya lo pone al proxyar `/api`.
// [por que WinRT a mano] El plugin oficial pinta por `notify-rust` con el identificador de Tauri,
// que nadie registró en el menú Inicio; sin AUMID registrado Windows descarta el toast en silencio.

use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Identificador de la app para Windows. Es el `identifier` de `tauri.conf.json`; tiene que ser
/// igual en el acceso directo del menú Inicio y en el proceso, o el toast no aparece.
#[cfg_attr(not(windows), allow(dead_code))]
pub const AUMID: &str = "es.area.workspace-manager";

/// Tope de goteo (E3): lo que exceda se junta y sale en un solo resumen, nunca se pierde.
const MAX_POR_MINUTO: usize = 3;
const MAX_POR_HORA: usize = 10;

/// Un aviso, con los campos que el toast pinta. El servidor manda más; serde ignora el resto.
#[derive(Deserialize, Serialize, Clone)]
pub struct Aviso {
    pub id: i64,
    pub tipo: String,
    pub nivel: String,
    pub titulo: String,
    #[serde(default)]
    pub detalle: String,
    /// Cuántas entidades agrupó el motor en este aviso (1 = una).
    #[serde(default = "uno")]
    pub agrupados: i64,
}

fn uno() -> i64 {
    1
}

/// Lo que llega al servidor local por `POST /__aviso`.
#[derive(Deserialize)]
pub struct Pedido {
    /// El bloque `data:` del SSE, tal cual. Se vuelve a leer aquí porque es la única forma de
    /// distinguir «aviso» de «sinc» sin inventar otro contrato en JavaScript.
    pub datos: String,
    /// `document.hasFocus() && visibilityState === 'visible'` al llegar el aviso.
    #[serde(default)]
    pub al_frente: bool,
    /// Eventos que la página retuvo mientras estaba oculta. Cuentan para el cupo, para que un rato
    /// en segundo plano no acabe en una ráfaga de toasts.
    #[serde(default)]
    pub atrasados: usize,
}

/// Sobre de SSE: `{"tipo":"aviso","aviso":{…}}` o `{"tipo":"sinc","id":N}`.
#[derive(Deserialize)]
struct Sobre {
    aviso: Option<Aviso>,
    id: Option<i64>,
}

/// Lo que el sobre dice, ya clasificado.
enum SobrePedido {
    Aviso(Aviso),
    /// Posición del servidor: al abrir y al reconectar. No se pinta; sólo mueve la marca.
    Sinc(i64),
    /// Cualquier otro sobre: se ignora.
    Otro,
}

/// Lee un bloque `data:`. `None` si ni siquiera es JSON nuestro.
fn sobre_de_datos(datos: &str) -> Option<SobrePedido> {
    let sobre: Sobre = serde_json::from_str(datos).ok()?;
    Some(match (sobre.aviso, sobre.id) {
        (Some(a), _) => SobrePedido::Aviso(a),
        (None, Some(id)) => SobrePedido::Sinc(id),
        (None, None) => SobrePedido::Otro,
    })
}

/// Por qué un sobre no llega a toast. Va en la respuesta para poder medirlo (E4).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Motivo {
    Sinc,
    Otro,
    NoEsSobre,
    Repetido,
    NoToca,
    /// Cabía, pero el cupo del minuto/hora estaba gastado: queda en la lista de pendientes y
    /// saldrá en el resumen del próximo hueco. Se distingue de `NoToca` para poder medir (E3).
    Encolado,
}

impl Motivo {
    /// Palabra para el JSON, en minúsculas y con guion como el resto del API.
    pub fn como_texto(self) -> &'static str {
        match self {
            Motivo::Sinc => "sinc",
            Motivo::Otro => "otro",
            Motivo::NoEsSobre => "no-es-sobre",
            Motivo::Repetido => "repetido",
            Motivo::NoToca => "no-toca",
            Motivo::Encolado => "encolado",
        }
    }
}

/// Avisos que salen fuera del tablero: sólo lo de nivel `alta` (D3.5) y sólo con la ventana detrás.
/// `silenciados` es la lista de la campana: su interruptor dice «no mostrar fuera de la app» y este
/// es ese «fuera», así que se consulta aquí y no en la página (el canal lleva todo, sin filtrar).
fn a_toast(aviso: &Aviso, al_frente: bool, silenciados: &[String]) -> bool {
    !al_frente && aviso.nivel == "alta" && !silenciados.iter().any(|t| t == &aviso.tipo)
}

/// Título y cuerpo del toast, separados porque Windows los pinta en dos tamaños.
fn texto(aviso: &Aviso) -> (String, String) {
    let titulo = if aviso.agrupados > 1 {
        format!("{} (+{})", aviso.titulo, aviso.agrupados - 1)
    } else {
        aviso.titulo.clone()
    };
    (limpio(&titulo), limpio(&aviso.detalle))
}

/// El texto acaba dentro del XML del toast, que la biblioteca escapa, pero un carácter de control
/// no tiene representación válida y corta el bloque: se cambia por espacio y se acota.
fn limpio(s: &str) -> String {
    s.chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .take(240)
        .collect::<String>()
        .trim()
        .to_string()
}

/// Resumen de lo que el cupo no dejó pasar. `None` si no había nada pendiente.
/// `ocultos` son los avisos que la página ya había juntado en un solo envío: cuentan en el texto
/// aunque no haya un objeto por cada uno.
fn resumen(pendientes: &[Aviso], ocultos: usize, ultimo_id: i64) -> Option<Aviso> {
    let primero = pendientes.first()?;
    Some(Aviso {
        id: ultimo_id,
        tipo: primero.tipo.clone(),
        nivel: primero.nivel.clone(),
        titulo: format!("{} avisos más", pendientes.len() + ocultos),
        detalle: primero.titulo.clone(),
        agrupados: 1,
    })
}

/// Por dónde va el canal. Sobrevive a la página para que una recarga no repita historia.
static ULTIMO_ID: std::sync::atomic::AtomicI64 = std::sync::atomic::AtomicI64::new(0);

/// Sube la marca y devuelve la anterior.
fn avanzar(id: i64) -> i64 {
    ULTIMO_ID.fetch_max(id, std::sync::atomic::Ordering::Relaxed)
}

/// Freno de goteo deslizante: `false` cuando el cupo está gastado.
struct Goteo {
    minuto: Vec<Instant>,
    hora: Vec<Instant>,
}

impl Goteo {
    fn nuevo() -> Self {
        Self { minuto: Vec::new(), hora: Vec::new() }
    }

    /// Gasta un hueco del cupo y pone `extra` más (los avisos que la página retuvo).
    fn cabe(&mut self, ahora: Instant, extra: usize) -> bool {
        self.minuto.retain(|t| ahora.duration_since(*t) < Duration::from_secs(60));
        self.hora.retain(|t| ahora.duration_since(*t) < Duration::from_secs(3600));
        let pedidas = 1 + extra;
        if self.minuto.len() + pedidas > MAX_POR_MINUTO || self.hora.len() + pedidas > MAX_POR_HORA {
            return false;
        }
        self.minuto.extend(std::iter::repeat_n(ahora, pedidas));
        self.hora.extend(std::iter::repeat_n(ahora, pedidas));
        true
    }
}

impl Buzon {
    fn nuevo() -> Self {
        Self { goteo: Goteo::nuevo(), pendientes: Vec::new(), ocultos: 0 }
    }
}

/// Los avisos de una página comparten goteo y lista de pendientes.
struct Buzon {
    /// Uno solo para toda la app: si cada página empezara con el cupo entero, recargar la ventana
    /// daría tres toasts más, y tres más, sin fin.
    goteo: Goteo,
    pendientes: Vec<Aviso>,
    /// Avisos que viajaron como «atrasados» de un envío agrupado y quedaron retenidos: no tienen
    /// objeto propio, pero el resumen tiene que contarlos.
    ocultos: usize,
}

static BUZON: Mutex<Option<Buzon>> = Mutex::new(None);

fn con_buzon<R>(f: impl FnOnce(&mut Buzon) -> R) -> R {
    let mut guardia = BUZON.lock().unwrap_or_else(|e| e.into_inner());
    /* [por que no se pierde nada] Si la página se recarga, el buzón es el mismo: los pendientes y
     * el cupo son de la app, no de la pestaña. Así recargar no regala tres toasts. */
    f(guardia.get_or_insert_with(Buzon::nuevo))
}

/// Los tipos que la campana mandó callar, leídos del backend cada vez.
///
/// [por que una consulta por aviso] La lista cambia al pulsar el interruptor y ningún evento lo
/// anuncia; una copia en memoria se quedaría vieja justo cuando más importa. Es una petición de
/// bytes a un backend local, y sólo se hace cuando hay algo que podría salir como toast.
/// [por que fail-closed] Si el backend no contesta vienen los avisos sin silenciar: un sitio caído
/// es demasiado caro como para callarlo por un fallo de red.
fn silenciados_de_la_campana() -> Vec<String> {
    let peticion = crate::proxy::Peticion {
        metodo: "GET".to_string(),
        ruta: "/api/notificaciones/preferencias".to_string(),
        autorizacion: None,
        tipo: None,
        cuerpo: Vec::new(),
    };
    let token = crate::ajustes::token();
    let Ok(r) = crate::proxy::reenviar(crate::ajustes::PUERTO_API, &peticion, token.as_deref()) else {
        return Vec::new();
    };
    if r.estado != 200 {
        return Vec::new();
    }
    serde_json::from_slice::<Preferencias>(&r.cuerpo).map(|p| p.silenciados).unwrap_or_default()
}

#[derive(Deserialize)]
struct Preferencias {
    #[serde(default)]
    silenciados: Vec<String>,
}

/// Lee el sobre ya clasificado, mueve la marca y dice si hay toast. `Err` cuando no pide nada.
fn desea(sobre: SobrePedido, pedido: &Pedido, silenciados: &[String]) -> Result<Aviso, Motivo> {
    match sobre {
        SobrePedido::Sinc(id) => {
            avanzar(id);
            Err(Motivo::Sinc)
        }
        SobrePedido::Otro => Err(Motivo::Otro),
        SobrePedido::Aviso(aviso) => {
            /* Repetido: la página reintentó o el canal reenvió el mismo bloque. */
            if aviso.id <= avanzar(aviso.id) {
                return Err(Motivo::Repetido);
            }
            if !a_toast(&aviso, pedido.al_frente, silenciados) {
                return Err(Motivo::NoToca);
            }
            Ok(aviso)
        }
    }
}

/// Un sobre completo: decide y pinta. Devuelve cuántos toasts salieron y, si ninguno, por qué.
pub fn atender(pedido: &Pedido) -> (usize, Option<Motivo>) {
    let Some(sobre) = sobre_de_datos(&pedido.datos) else {
        return (0, Some(Motivo::NoEsSobre));
    };
    /* La lista sólo importa cuando el aviso podría salir y aún no se sabe si está callado; pedirla
     * por cada sobre del canal, incluidos los de una ventana al frente, sería una consulta por
     * latido para nada. */
    let silenciados = match &sobre {
        SobrePedido::Aviso(a) if !pedido.al_frente && a.nivel == "alta" => silenciados_de_la_campana(),
        _ => Vec::new(),
    };
    let aviso = match desea(sobre, pedido, &silenciados) {
        Ok(a) => a,
        Err(m) => return (0, Some(m)),
    };
    /* Lo que el cupo no deja pasar no se pierde: se junta y sale como resumen en cuanto haya
     * hueco (E3). */
    let pintar = con_buzon(|b| {
        let ahora = Instant::now();
        let mut salida = Vec::new();
        if b.goteo.cabe(ahora, pedido.atrasados) {
            let pendientes = std::mem::take(&mut b.pendientes);
            let ocultos = std::mem::replace(&mut b.ocultos, 0);
            if let Some(r) = resumen(&pendientes, ocultos, aviso.id) {
                salida.push(r);
            }
            salida.push(aviso);
        } else {
            /* Se retiene el aviso y también la cuenta de los que venían agrupados con él: si no,
             * el resumen diría «1 aviso más» cuando en realidad fueron cuarenta. */
            b.pendientes.push(aviso);
            b.ocultos += pedido.atrasados;
        }
        salida
    });
    for a in &pintar {
        pintar_toast(a);
    }
    /* Encolado no es «no toca»: el aviso no se pierde, sale en cuanto el cupo da un hueco. */
    if pintar.is_empty() {
        return (0, Some(Motivo::Encolado));
    }
    (pintar.len(), None)
}

/// Lo que la página retuvo mientras estaba oculta, para que lo diga ella al volver. Vacía la lista.
pub fn pendiente() -> Vec<Aviso> {
    let mut guardia = BUZON.lock().unwrap_or_else(|e| e.into_inner());
    guardia.as_mut().map(|b| std::mem::take(&mut b.pendientes)).unwrap_or_default()
}

/// Registra el AUMID en un acceso directo del menú Inicio. Sin esto Windows descarta en silencio
/// los toasts de un proceso cuyo AppUserModelID no está ahí. Se reescribe en cada arranque porque
/// el `.exe` cambia de sitio al actualizar la app.
pub fn preparar() {
    #[cfg(windows)]
    if let Err(e) = com::registrar(AUMID) {
        crate::dicho::anotar(&format!(
            "[avisos] AUMID sin registrar ({e}); el toast saldrá sin nombre\n"
        ));
    }
}

/// Pinta el toast. Dos intentos: con el AUMID de la app (sale con su nombre y se agrupa en el
/// centro de actividades) y, si falla, con el de PowerShell (sale igual, sin nombre propio). Si
/// ambos fallan, una línea en el log: sin toasts la campana sigue funcionando.
#[cfg(windows)]
fn pintar_toast(aviso: &Aviso) {
    let (titulo, detalle) = texto(aviso);
    /* Un sitio caído se queda en pantalla hasta que alguien lo vea. */
    let alto = aviso.nivel == "alta";
    if toast(AUMID, &titulo, &detalle, alto, true).is_ok() {
        return;
    }
    /* El respaldo no trae al frente: PowerShell no es esta app y Windows no podría invocarla. */
    if toast(tauri_winrt_notification::Toast::POWERSHELL_APP_ID, &titulo, &detalle, alto, false).is_ok() {
        return;
    }
    crate::dicho::anotar(&format!("[avisos] no se pudo pintar el toast: {titulo}\n"));
}

/* Fuera de Windows no hay toasts. El destino no es un portátil Linux ni un servidor: es que los
 * tests de este archivo puedan correr donde se compila (la 89 no tiene `wine` ni `link.exe` de
 * MSVC), sin compilar WinRT, que sólo existe en Windows. En el `.exe` manda la rama de arriba. */
#[cfg(not(windows))]
fn pintar_toast(aviso: &Aviso) {
    crate::dicho::anotar(&format!("[avisos] sin toast fuera de Windows: {}\n", texto(aviso).0));
}

#[cfg(windows)]
fn toast(
    app_id: &str,
    titulo: &str,
    detalle: &str,
    alto: bool,
    al_frente: bool,
) -> Result<(), String> {
    use tauri_winrt_notification::{Duration as Largo, Toast};
    let mut t = Toast::new(app_id).title(titulo);
    if !detalle.is_empty() {
        t = t.text1(detalle);
    }
    t = t.duration(if alto { Largo::Long } else { Largo::Short });
    /* [por que el clic trae la ventana] Con la app viva, el proceso que pintó el toast sigue ahí:
     * no hace falta registrar un activador COM, sólo subir la ventana que ya existe. */
    if al_frente {
        t = t.on_activated(|_| {
            com::traer_al_frente();
            Ok(())
        });
    }
    t.show().map_err(|e| e.to_string())
}

#[cfg(windows)]
mod com {
    use std::os::windows::ffi::OsStrExt;
    use std::path::{Path, PathBuf};
    use windows::core::{Interface, HSTRING, PCWSTR};
    use windows::Win32::Foundation::PROPERTYKEY;
    use windows::Win32::Storage::EnhancedStorage::PKEY_AppUserModel_ID;
    use windows::Win32::System::Com::StructuredStorage::PROPVARIANT;
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER,
        COINIT_APARTMENTTHREADED,
    };
    use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};

    pub fn registrar(aumid: &str) -> Result<(), String> {
        let ruta = acceso_directo()?;
        unsafe {
            /* STA: `IShellLink` e `IPropertyStore` lo exigen. Si este hilo ya tenía COM en otro
             * modo, `RPC_E_CHANGED_MODE` no impide seguir y no toca desinicializar. */
            let iniciado = CoInitializeEx(None, COINIT_APARTMENTTHREADED).is_ok();
            let r = escribir(&ruta, aumid);
            if iniciado {
                CoUninitialize();
            }
            r
        }
    }

    /// `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Workspace Manager.lnk`
    fn acceso_directo() -> Result<PathBuf, String> {
        let appdata = std::env::var_os("APPDATA").ok_or("sin APPDATA")?;
        let carpeta = Path::new(&appdata)
            .join("Microsoft")
            .join("Windows")
            .join("Start Menu")
            .join("Programs");
        std::fs::create_dir_all(&carpeta).map_err(|e| e.to_string())?;
        Ok(carpeta.join("Workspace Manager.lnk"))
    }

    unsafe fn escribir(ruta: &Path, aumid: &str) -> Result<(), String> {
        let enlace: IShellLinkW =
            CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER).map_err(|e| e.to_string())?;
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let exe_ancho = ancha(&exe.to_string_lossy());
        enlace.SetPath(PCWSTR(exe_ancho.as_ptr())).map_err(|e| e.to_string())?;
        /* Sin argumentos: abre el tablero. El directorio sí importa, el backend busca ahí. */
        if let Some(carpeta) = exe.parent() {
            let carpeta = ancha(&carpeta.to_string_lossy());
            enlace
                .SetWorkingDirectory(PCWSTR(carpeta.as_ptr()))
                .map_err(|e| e.to_string())?;
        }
        let _ = enlace.SetIconLocation(PCWSTR(exe_ancho.as_ptr()), 0);
        enlace
            .SetDescription(&HSTRING::from("Tablero del area"))
            .map_err(|e| e.to_string())?;

        /* El AUMID va en la propiedad PKEY_AppUserModel_ID del acceso directo.
         * [por que `PROPVARIANT::from(&str)` y no un `VT_LPWSTR` a mano] `windows` pone un `Drop`
         * sobre `PROPVARIANT` que llama a `PropVariantClear`, y ése libera la cadena con
         * `CoTaskMemFree`. Con un `VT_LPWSTR` apuntando a un `Vec<u16>` de Rust, el propio `Drop`
         * liberaba memoria del montón de Rust con el del COM: corrupción de montón
         * (`0xC0000374`) al arrancar, antes de que `dicho` pudiera anotar nada. `From<&str>` guarda
         * un `BSTR` del COM, que es lo que `PropVariantClear` sabe liberar. */
        let guardar: IPropertyStore =
            enlace.cast().map_err(|e: windows::core::Error| e.to_string())?;
        let clave: PROPERTYKEY = PKEY_AppUserModel_ID;
        let variante = PROPVARIANT::from(aumid);
        guardar.SetValue(&clave, &variante).map_err(|e| e.to_string())?;
        guardar.Commit().map_err(|e| e.to_string())?;

        let fichero: IPersistFile =
            enlace.cast().map_err(|e: windows::core::Error| e.to_string())?;
        let destino = ancha(&ruta.to_string_lossy());
        fichero
            .Save(PCWSTR(destino.as_ptr()), true)
            .map_err(|e| e.to_string())
    }

    /// Trae la ventana `principal` al frente con la API nativa.
    ///
    /// [por que no `AppHandle`] `avisos.rs` no lo tiene (se registra desde `main`) y pasarlo hasta
    /// aquí obligaría a meterlo en el cierre COM del toast. Buscar la ventana por su título no
    /// necesita nada de Tauri y funciona igual con la ventana minimizada.
    pub fn traer_al_frente() {
        use windows::Win32::System::Threading::GetCurrentProcessId;
        use windows::Win32::UI::WindowsAndMessaging::{
            FindWindowW, GetWindowThreadProcessId, IsIconic, SetForegroundWindow, ShowWindow,
            SW_RESTORE,
        };
        let titulo: Vec<u16> = std::ffi::OsStr::new("Workspace Manager")
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        unsafe {
            let Ok(ventana) = FindWindowW(PCWSTR::null(), PCWSTR(titulo.as_ptr())) else {
                return;
            };
            /* [por que se comprueba el proceso] El título no es único: sin esto, una ventana ajena
             * con el mismo nombre se llevaría el foco al pulsar nuestro toast. */
            let mut dueno = 0u32;
            GetWindowThreadProcessId(ventana, Some(&mut dueno));
            if dueno != GetCurrentProcessId() {
                return;
            }
            if IsIconic(ventana).as_bool() {
                let _ = ShowWindow(ventana, SW_RESTORE);
            }
            let _ = SetForegroundWindow(ventana);
        }
    }

    fn ancha(s: &str) -> Vec<u16> {
        std::ffi::OsStr::new(s).encode_wide().chain(std::iter::once(0)).collect()
    }
}

#[cfg(test)]
mod pruebas {
    use super::*;

    fn aviso(nivel: &str, tipo: &str) -> Aviso {
        Aviso {
            id: 1,
            tipo: tipo.to_string(),
            nivel: nivel.to_string(),
            titulo: "sitio caído".to_string(),
            detalle: "pulse".to_string(),
            agrupados: 1,
        }
    }

    fn pedido(datos: &str) -> Pedido {
        Pedido { datos: datos.to_string(), al_frente: false, atrasados: 0 }
    }

    /// Envuelve `datos` como lo hace `atender` (clasificar y decidir son dos pasos distintos).
    fn desear(datos: &str, al_frente: bool, silenciados: &[String]) -> Result<Aviso, Motivo> {
        let sobre = sobre_de_datos(datos).expect("el sobre es JSON nuestro");
        desea(sobre, &Pedido { al_frente, ..pedido(datos) }, silenciados)
    }

    const SOBRE: &str = r#"{"tipo":"aviso","aviso":{"id":7,"tipo":"sitio-caido","nivel":"alta","titulo":"t","detalle":"d","agrupados":2}}"#;

    /* El buzón es del proceso y los tests corren en paralelo: los dos que lo tocan se turnan y
     * cada uno lo deja vacío al empezar, o el resultado dependería del orden. */
    static CANDADO: Mutex<()> = Mutex::new(());

    fn buzon_limpio() -> std::sync::MutexGuard<'static, ()> {
        let guardia = CANDADO.lock().unwrap_or_else(|e| e.into_inner());
        con_buzon(|b| *b = Buzon::nuevo());
        /* `avanzar` es `fetch_max`: no baja la marca. Para dejarla en cero hace falta un `store`,
         * que sólo se usa aquí (en la app la marca nunca retrocede: es lo que evita repetir). */
        ULTIMO_ID.store(0, std::sync::atomic::Ordering::Relaxed);
        guardia
    }

    #[test]
    fn solo_lo_alto_y_solo_con_la_ventana_detras() {
        assert!(a_toast(&aviso("alta", "sitio-caido"), false, &[]));
        /* Con la ventana delante ya se ve en la campana. */
        assert!(!a_toast(&aviso("alta", "sitio-caido"), true, &[]));
        /* Lo de nivel medio nunca sale del tablero. */
        assert!(!a_toast(&aviso("media", "tarea-nueva"), false, &[]));
        /* Lo que la campana mandó callar no sale fuera, aunque sea de nivel alto. */
        assert!(!a_toast(&aviso("alta", "sitio-caido"), false, &["sitio-caido".to_string()]));
    }

    #[test]
    fn el_goteo_corta_a_tres_por_minuto_y_el_resto_va_en_resumen() {
        let mut goteo = Goteo::nuevo();
        let ahora = Instant::now();
        assert!(goteo.cabe(ahora, 0));
        assert!(goteo.cabe(ahora, 0));
        assert!(goteo.cabe(ahora, 0));
        assert!(!goteo.cabe(ahora, 0), "el cuarto del minuto no cabe");

        let pendientes = vec![aviso("alta", "sitio-caido"), aviso("alta", "sitio-caido")];
        let r = resumen(&pendientes, 0, 9).expect("hay resumen");
        assert_eq!(r.titulo, "2 avisos más");
        assert_eq!(r.id, 9);
        assert_eq!(r.detalle, "sitio caído", "el resumen dice el primero");
    }

    #[test]
    fn cincuenta_de_golpe_no_pasan_de_tres_y_el_resto_sale_en_un_resumen() {
        let mut goteo = Goteo::nuevo();
        let ahora = Instant::now();
        let pasan = (0..50).filter(|_| goteo.cabe(ahora, 0)).count();
        assert_eq!(pasan, MAX_POR_MINUTO);
        /* Los 47 que no caben van a la lista de pendientes y salen en un solo toast. */
        let pendientes = vec![aviso("alta", "sitio-caido"); 47];
        assert_eq!(resumen(&pendientes, 0, 99).unwrap().titulo, "47 avisos más");
        /* Los que viajaron agrupados («atrasados») también cuentan: es lo que evita decir «1 aviso
         * más» cuando la página retuvo cuarenta. */
        assert_eq!(resumen(&pendientes, 3, 99).unwrap().titulo, "50 avisos más");
    }

    #[test]
    fn los_atrasados_cuentan_para_el_goteo_y_un_rechazo_no_gasta() {
        let mut goteo = Goteo::nuevo();
        let ahora = Instant::now();
        /* Tres avisos de golpe: caben en el minuto entero. */
        assert!(goteo.cabe(ahora, 2));
        assert!(!goteo.cabe(ahora, 0), "el cupo del minuto quedó gastado");
        /* Pedir más de lo que cabe no gasta nada. */
        let mut otro = Goteo::nuevo();
        assert!(!otro.cabe(ahora, MAX_POR_HORA));
        assert!(otro.cabe(ahora, 0), "el rechazo no consumió cupo");
    }

    #[test]
    fn lee_los_dos_sobres_del_canal() {
        let Some(SobrePedido::Aviso(a)) = sobre_de_datos(SOBRE) else {
            panic!("el primer sobre trae aviso");
        };
        assert_eq!(a.agrupados, 2);

        let Some(SobrePedido::Sinc(id)) = sobre_de_datos(r#"{"tipo":"sinc","id":42}"#) else {
            panic!("el segundo sobre dice la posición");
        };
        assert_eq!(id, 42);

        assert!(sobre_de_datos("no es json").is_none());
    }

    #[test]
    fn el_titulo_dice_cuantos_agrupó() {
        let mut a = aviso("alta", "sitio-caido");
        a.agrupados = 3;
        assert_eq!(texto(&a).0, "sitio caído (+2)");
    }

    #[test]
    fn el_texto_del_servidor_no_rompe_el_bloque_del_toast() {
        let a = Aviso {
            titulo: "a\u{0}b".to_string(),
            detalle: "uno\ndos\ttres".to_string(),
            ..aviso("alta", "sitio-caido")
        };
        let (titulo, detalle) = texto(&a);
        assert!(!titulo.chars().any(char::is_control));
        assert_eq!(detalle, "uno dos tres");
    }

    #[test]
    fn el_sobre_que_no_cabe_dice_encolado_y_luego_sale() {
        /* Sobre el buzón real (goteo y pendientes compartidos), no una maqueta: es la única forma
         * de comprobar que un rechazo del cupo no pierde el aviso. */
        let _turno = buzon_limpio();
        for i in 1..=MAX_POR_MINUTO as i64 {
            let datos = SOBRE.replace("\"id\":7", &format!("\"id\":{i}"));
            assert_eq!(atender(&pedido(&datos)).0, 1, "los {MAX_POR_MINUTO} del minuto caben");
        }
        let sobra = Pedido { atrasados: 4, ..pedido(&SOBRE.replace("\"id\":7", "\"id\":99")) };
        assert_eq!(atender(&sobra), (0, Some(Motivo::Encolado)));

        /* Cuando el cupo se renueva, el retenido sale junto al nuevo: un resumen y el aviso. */
        con_buzon(|b| {
            b.goteo = Goteo::nuevo();
            b.pendientes.push(aviso("alta", "sitio-caido"));
        });
        let siguiente = SOBRE.replace("\"id\":7", "\"id\":100");
        let (pintados, motivo) = atender(&pedido(&siguiente));
        assert_eq!((pintados, motivo), (2, None), "un resumen y el aviso nuevo");
        /* Lo retenido se vació al salir, cuenta de agrupados incluida: si no, el próximo resumen
         * los volvería a contar. */
        let (pendientes, ocultos) = con_buzon(|b| (b.pendientes.len(), b.ocultos));
        assert_eq!((pendientes, ocultos), (0, 0));
    }

    #[test]
    fn sinc_primero_y_el_mismo_id_no_repite() {
        /* La marca es del proceso y la comparten los tests: se deja en un estado conocido. */
        let _turno = buzon_limpio();
        assert!(matches!(desear(r#"{"tipo":"sinc","id":7}"#, false, &[]), Err(Motivo::Sinc)));
        /* El aviso 7 ya estaba dicho por la sincronización: repetido. */
        assert!(matches!(desear(SOBRE, false, &[]), Err(Motivo::Repetido)));
        /* Uno nuevo pasa. */
        assert!(desear(&SOBRE.replace("\"id\":7", "\"id\":8"), false, &[]).is_ok());
        /* Con la ventana al frente no toca toast. */
        assert!(matches!(
            desear(&SOBRE.replace("\"id\":7", "\"id\":9"), true, &[]),
            Err(Motivo::NoToca)
        ));
        /* Con su tipo callado no sale. La marca sí avanza: al desilenciar no se sueltan de golpe
         * los avisos de mientras estaba callado. */
        let callado = SOBRE.replace("\"id\":7", "\"id\":10");
        assert!(matches!(
            desear(&callado, false, &["sitio-caido".to_string()]),
            Err(Motivo::NoToca)
        ));
    }

    #[test]
    fn la_pagina_no_regala_cupo_al_recargar() {
        /* El cupo es de la app, no de la pestaña: una recarga no vuelve a empezar de cero. */
        let _turno = buzon_limpio();
        let ahora = Instant::now();
        let pintar = con_buzon(|b| {
            (0..MAX_POR_MINUTO).filter(|_| b.goteo.cabe(ahora, 0)).count()
        });
        assert_eq!(pintar, MAX_POR_MINUTO);
        let despues = con_buzon(|b| b.goteo.cabe(ahora, 0));
        assert!(!despues, "el buzón sobrevive a la página");
    }
}
