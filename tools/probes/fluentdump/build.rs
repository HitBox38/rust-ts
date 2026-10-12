//! Checks that every `// BEGIN verbatim <path>:<line>` ... `// END verbatim` block of main.rs is a
//! byte-for-byte copy of the pinned upstream file `<path>`, starting at line `<line>`. Fails the
//! build otherwise, so the copied rustc functions cannot drift from the pin.
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
    let main_rs = meta("main-rs");
    println!("cargo::rerun-if-changed={main_rs}");
    let src = std::fs::read_to_string(&main_rs).unwrap();

    let mut lines = src.lines();
    let mut blocks = 0;
    while let Some(line) = lines.next() {
        let Some(spec) = line.strip_prefix("// BEGIN verbatim ") else { continue };
        let (path, start) = spec.rsplit_once(':').expect("BEGIN verbatim <path>:<line>");
        let start: usize = start.parse().expect("line number");
        let mut block = vec![];
        loop {
            let l = lines.next().unwrap_or_else(|| panic!("unterminated verbatim block {spec}"));
            if l == "// END verbatim" {
                break;
            }
            block.push(l);
        }
        let file = format!("{upstream}/{path}");
        println!("cargo::rerun-if-changed={file}");
        let up = std::fs::read_to_string(&file).unwrap();
        let up: Vec<&str> = up.lines().collect();
        let got = up.get(start - 1..start - 1 + block.len());
        assert!(got == Some(&block[..]), "verbatim block {spec} differs from upstream");
        blocks += 1;
    }
    assert!(blocks > 0, "no verbatim blocks found");
}
