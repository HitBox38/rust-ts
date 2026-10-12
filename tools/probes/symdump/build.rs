//! Generates `$OUT_DIR/names.rs`: `KW` and `SYM`, every constant name declared in the
//! `Keywords { .. }` and `Symbols { .. }` blocks of upstream's `symbols!` invocation, paired with
//! the compiled constant (`kw::Name` / `sym::Name`). Only the names come from this parse; every
//! value comes from the compiled rustc_span, and a misparsed name fails to compile.
use std::fmt::Write as _;

fn main() {
    let dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let manifest = std::fs::read_to_string(format!("{dir}/Cargo.toml")).unwrap();
    let path = manifest
        .lines()
        .find_map(|l| l.strip_prefix("symbol-rs = \""))
        .and_then(|l| l.strip_suffix('"'))
        .expect("symbol-rs in [package.metadata.rust-ts]");
    println!("cargo::rerun-if-changed={path}");
    let src = std::fs::read_to_string(path).unwrap();

    let mut out = String::new();
    for (block, module, konst) in [("    Keywords {", "kw", "KW"), ("    Symbols {", "sym", "SYM")] {
        let start = src.lines().position(|l| l == block).expect(block);
        writeln!(out, "pub const {konst}: &[(&str, rustc_span::Symbol)] = &[").unwrap();
        let mut in_string = false;
        for line in src.lines().skip(start + 1) {
            if line == "    }" {
                break;
            }
            // Multi-line string values (`name: "...\` continued on the next lines).
            if in_string {
                in_string = !closes_string(line);
                continue;
            }
            let code = line.split("//").next().unwrap().trim();
            if code.is_empty() {
                continue;
            }
            // Entries: `Name,` / `Name: "str",` / `Name: env!("X"),`; several per line allowed when
            // they have no value (`little, big,`).
            if let Some((name, rest)) = code.split_once(':') {
                emit(&mut out, module, name.trim());
                in_string = rest.matches('"').count() % 2 == 1;
            } else {
                for name in code.split(',').map(str::trim).filter(|n| !n.is_empty()) {
                    emit(&mut out, module, name);
                }
            }
        }
        writeln!(out, "];").unwrap();
    }
    let out_dir = std::env::var("OUT_DIR").unwrap();
    std::fs::write(format!("{out_dir}/names.rs"), out).unwrap();
}

fn closes_string(line: &str) -> bool {
    line.matches('"').count() % 2 == 1
}

fn emit(out: &mut String, module: &str, name: &str) {
    assert!(name.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'), "bad symbol name {name:?}");
    writeln!(out, "    ({name:?}, rustc_span::symbol::{module}::{name}),").unwrap();
}
