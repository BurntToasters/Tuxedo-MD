fn main() {
    println!("cargo:rerun-if-env-changed=TUXEDO_EDITION");
    match std::env::var("TUXEDO_EDITION") {
        Ok(edition) if edition == "community" || edition == "full" => {
            println!("cargo:rustc-env=TUXEDO_EDITION={edition}");
        }
        Ok(edition) => {
            panic!("TUXEDO_EDITION must be 'community' or 'full' (got {edition:?})");
        }
        Err(_) => {}
    }
    tauri_build::build();
}
