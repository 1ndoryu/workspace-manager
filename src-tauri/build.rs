fn main() {
    // Empotra el front de Vite (`frontendDist`) y el icono del exe.
    // [por que] cargo no vigila los iconos por su cuenta: sin esta linea, cambiar
    // `icons/` reutiliza el `resource.lib` viejo y el exe sale con el icono anterior.
    println!("cargo:rerun-if-changed=icons");
    tauri_build::build()
}
