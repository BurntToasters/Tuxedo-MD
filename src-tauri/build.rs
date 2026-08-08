fn main() {
    println!("cargo:rerun-if-env-changed=TUXEDO_EDITION");
    if let Ok(edition) = std::env::var("TUXEDO_EDITION") {
        println!("cargo:rustc-env=TUXEDO_EDITION={edition}");
    }
    tauri_build::build();
}
