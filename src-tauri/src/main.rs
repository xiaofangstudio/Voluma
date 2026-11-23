#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if std::env::args().any(|a| a == "--mcp") {
        std::process::exit(voluma_lib::mcp::run_stdio());
    }
    voluma_lib::run()
}
