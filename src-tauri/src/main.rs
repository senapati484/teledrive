// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    #[cfg(target_os = "linux")]
    {
        // Work around a WebKitGTK 2.42+ DMABUF renderer bug that leaves the
        // window permanently grey/blank on Arch, CachyOS, Fedora, Wayland,
        // and integrated/hybrid GPU setups (especially inside AppImages).
        // Must execute single-threaded before GTK/WebKit initializes.
        if std::env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_none() {
            std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
        }
    }

    teledrive_lib::run()
}
