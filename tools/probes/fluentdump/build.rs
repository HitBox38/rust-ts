//! Build-time guards, so the oracle cannot silently drift from the pinned rustc:
//! 1. main.rs contains exactly the `// BEGIN verbatim <path>:<line>` ... `// END verbatim` blocks
//!    listed in `BLOCKS` (no more, no fewer, no stray `// END verbatim`), and each is a
//!    byte-for-byte copy of the pinned upstream file `<path>` starting at line `<line>`.
//! 2. Every registry package of the probe's resolved Cargo.lock appears in the pinned upstream
//!    Cargo.lock with the same name, version, source and checksum.

/// The upstream code main.rs copies (see its header for why it is copied, not linked).
const BLOCKS: &[&str] = &[
    "compiler/rustc_error_messages/src/lib.rs:13",  // register_functions
    "compiler/rustc_error_messages/src/lib.rs:231", // icu_locale_from_unic_langid, fluent_value_from_str_list_sep_by_and
    "compiler/rustc_error_messages/src/lib.rs:300", // DiagArg, DiagArgName
    "compiler/rustc_error_messages/src/lib.rs:311", // DiagArgValue
    "compiler/rustc_error_messages/src/lib.rs:344", // From<DiagArgValue> for FluentValue
    "compiler/rustc_errors/src/formatting.rs:10",   // to_fluent_args
    "compiler/rustc_errors/src/formatting.rs:39",   // format_fluent_str
];

fn main() {
    let dir = std::env::var("CARGO_MANIFEST_DIR").unwrap();
    let manifest = std::fs::read_to_string(format!("{dir}/Cargo.toml")).unwrap();
    let meta = |key: &str| -> String {
        manifest
            .lines()
            .find_map(|l| l.strip_prefix(&format!("{key} = \"")))
            .and_then(|l| l.strip_suffix('"'))
            .unwrap_or_else(|| panic!("{key} in [package.metadata.rust-ts]"))
            .to_string()
    };
    let upstream = meta("upstream");
    check_verbatim(&upstream, &meta("main-rs"));
    check_lock(&format!("{dir}/Cargo.lock"), &format!("{upstream}/Cargo.lock"));
}

fn check_verbatim(upstream: &str, main_rs: &str) {
    println!("cargo::rerun-if-changed={main_rs}");
    let src = std::fs::read_to_string(main_rs).unwrap();
    let mut seen: Vec<String> = vec![];
    let mut lines = src.lines();
    while let Some(line) = lines.next() {
        assert!(line != "// END verbatim", "`// END verbatim` without a matching `// BEGIN verbatim`");
        let Some(spec) = line.strip_prefix("// BEGIN verbatim ") else { continue };
        let (path, start) = spec.rsplit_once(':').expect("BEGIN verbatim <path>:<line>");
        let start: usize = start.parse().expect("line number");
        let mut block = vec![];
        loop {
            let l = lines.next().unwrap_or_else(|| panic!("unterminated verbatim block {spec}"));
            if l == "// END verbatim" {
                break;
            }
            assert!(!l.starts_with("// BEGIN verbatim"), "nested verbatim block in {spec}");
            block.push(l);
        }
        let file = format!("{upstream}/{path}");
        println!("cargo::rerun-if-changed={file}");
        let up = std::fs::read_to_string(&file).unwrap();
        let up: Vec<&str> = up.lines().collect();
        let got = up.get(start - 1..start - 1 + block.len());
        assert!(got == Some(&block[..]), "verbatim block {spec} differs from upstream");
        seen.push(spec.to_string());
    }
    assert!(seen == BLOCKS, "verbatim blocks {seen:?} are not exactly the expected {BLOCKS:?}");
}

/// `(name, version, source, checksum)` of every `[[package]]` with a `source` (registry packages).
fn registry_packages(lock: &str) -> Vec<[String; 4]> {
    let mut out = vec![];
    for pkg in lock.split("[[package]]").skip(1) {
        let field = |k: &str| -> String {
            pkg.lines()
                .find_map(|l| l.strip_prefix(&format!("{k} = \"")))
                .and_then(|l| l.strip_suffix('"'))
                .unwrap_or("")
                .to_string()
        };
        if !field("source").is_empty() {
            out.push([field("name"), field("version"), field("source"), field("checksum")]);
        }
    }
    out
}

fn check_lock(probe_lock: &str, upstream_lock: &str) {
    println!("cargo::rerun-if-changed={probe_lock}");
    println!("cargo::rerun-if-changed={upstream_lock}");
    let probe = std::fs::read_to_string(probe_lock).expect("the probe's resolved Cargo.lock");
    let upstream = registry_packages(&std::fs::read_to_string(upstream_lock).unwrap());
    let ours = registry_packages(&probe);
    assert!(!ours.is_empty(), "no registry packages in {probe_lock}");
    for p in &ours {
        assert!(
            upstream.contains(p),
            "{} {} ({}) is not in upstream's Cargo.lock with that version and checksum; pin it in Cargo.toml.in",
            p[0],
            p[1],
            p[2]
        );
    }
}
