fn main() {
    #[cfg(target_os = "macos")]
    {
        println!("cargo:rustc-link-lib=framework=LocalAuthentication");
        cc::Build::new()
            .file("src/biometrics_macos.m")
            .flag("-Wno-unused-parameter")
            .compile("teledrive_biometrics_macos");
    }
    tauri_build::build();
}
