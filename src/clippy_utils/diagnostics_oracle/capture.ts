// Writes the oracle fixtures of src/clippy_utils/{diagnostics,msrvs}.test.ts from the pinned clippy-preview tarball
// (plan-m8 D2). Not a test and not ported code: run it by hand after a pin change (about 3 s):
//   bun src/clippy_utils/diagnostics_oracle/capture.ts
// Every run is `clippy-driver <file> --edition=2024 --emit=metadata` from this directory, with no clippy.toml
// (CLIPPY_CONF_DIR is an empty scratch directory) and the `-Aunused` style flags left out, so only clippy's own lints
// and the `#[warn(..)]` / `#[deny(..)]` "on by default" notes appear. It records:
// - case.stderr: the stderr on case.rs (one on-by-default lint per `diagnostics` wrapper);
// - case.nodocs.stderr: the same with `CLIPPY_DISABLE_DOCS_LINKS=1` (`docs_link` adds nothing);
// - case.json: the same with `--error-format=json`, which shows each suggestion's applicability (review N1);
// - hir_case.stderr: the stderr on hir_case.rs (`span_lint_hir`'s level comes from the given HirId; review N2);
// - msrv_attrs.stderr: the stderr on msrv_attrs.rs (`msrvs::check_attrs`'s errors);
// - msrv_stability.stderr: the stderr on msrv_stability.rs (`incompatible_msrv`'s stability versions; review N4);
// - msrv.json: whether `redundant_field_names` (an early lint gated on `msrvs::FIELD_INIT_SHORTHAND`, 1.17.0, through
//   `MsrvStack`) fires on `S { x: x }` with `#![clippy::msrv = "<v>"]`, or with no attribute and
//   `CARGO_PKG_RUST_VERSION=<v>` (Cargo.toml's `rust-version`, which clippy_config's `Conf::read` parses with
//   `parse_version`), for each `<v>` in VERSIONS; plus the attribute errors each `<v>` gives.
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN, die } from "../../../scripts/lib/common.ts";

const host = process.env.RUST_TS_HOST_TUPLE ?? "aarch64-apple-darwin";
const DIR = import.meta.dir;

function clippyBin(name: string): string {
  const root = join(DATA, "tools");
  for (const d of existsSync(root) ? readdirSync(root) : []) {
    const dir = join(root, d, `clippy-nightly-${host}`);
    const bin = join(dir, "clippy-preview", "bin", name);
    if (existsSync(bin) && readFileSync(join(dir, "git-commit-hash"), "utf8").trim() === PIN.commit) return bin;
  }
  die(`no clippy-preview for ${PIN.commit} under ${root}`);
}

const env0: Record<string, string> = {};
for (const k of ["PATH", "HOME", "RUSTUP_HOME", "CARGO_HOME"]) if (process.env[k] !== undefined) env0[k] = process.env[k]!;
env0.RUSTUP_AUTO_INSTALL = "0";
const sysroot = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "--print", "sysroot"], { env: env0 }).stdout.toString().trim();
const work = mkdtempSync(join(DATA, "tmp", "clippy-utils-oracle-"));
const confDir = join(work, "conf");
Bun.spawnSync(["mkdir", confDir]);

function run(file: string, cwd: string, extraEnv: Record<string, string> = {}, args: string[] = []): string {
  const p = Bun.spawnSync([clippyBin("clippy-driver"), "--sysroot", sysroot, file, "--edition=2024", "--emit=metadata", "--out-dir", work, ...args], {
    env: { ...env0, DYLD_LIBRARY_PATH: join(sysroot, "lib"), CLIPPY_CONF_DIR: confDir, RUSTC_ICE: "0", RUST_BACKTRACE: "0", ...extraEnv },
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (p.exitCode !== 0 && p.exitCode !== 1) die(`clippy-driver exit ${p.exitCode} on ${file}`);
  return p.stderr.toString();
}

writeFileSync(join(DIR, "case.stderr"), run("case.rs", DIR));
writeFileSync(join(DIR, "case.nodocs.stderr"), run("case.rs", DIR, { CLIPPY_DISABLE_DOCS_LINKS: "1" }));
writeFileSync(join(DIR, "case.json"), run("case.rs", DIR, {}, ["--error-format=json"]));
writeFileSync(join(DIR, "hir_case.stderr"), run("hir_case.rs", DIR));
writeFileSync(join(DIR, "msrv_attrs.stderr"), run("msrv_attrs.rs", DIR));
writeFileSync(join(DIR, "msrv_stability.stderr"), run("msrv_stability.rs", DIR));

const VERSIONS = [
  "1.16",
  "1.17",
  "1.16.9",
  "1.17.0",
  "1.17.1",
  "1.18",
  "2.0",
  "1",
  "1.16.0.0",
  "1.17.0.0",
  "1.17-nightly",
  "1.17.0-nightly",
  "1.16.0-beta",
  "abc",
  "",
  " 1.17",
  "1.17 ",
  "+1.16",
  "1.+16",
  "01.016",
  "1.65535",
  "1.65536",
  "65535.0.0",
  "1..0",
  "1.16.",
];
const FIRES = "warning: redundant field names in struct initialization";
const SRC = (attr: string) => `${attr}\nstruct S {\n    x: i32,\n}\n\nfn main() {\n    let x = 1;\n    let _s = S { x: x };\n}\n`;
const cases: { version: string; attr_fires: boolean; attr_errors: string[]; env_fires: boolean }[] = [];
for (const v of VERSIONS) {
  writeFileSync(join(work, "m.rs"), SRC(`#![feature(custom_inner_attributes)]\n#![clippy::msrv = ${JSON.stringify(v)}]`));
  const a = run("m.rs", work);
  writeFileSync(join(work, "m.rs"), SRC(""));
  const e = run("m.rs", work, { CARGO_PKG_RUST_VERSION: v });
  cases.push({
    version: v,
    attr_fires: a.includes(FIRES),
    attr_errors: a.split("\n").filter((l) => l.startsWith("error: ") && !l.startsWith("error: aborting")),
    env_fires: e.includes(FIRES),
  });
  if (e.includes("error")) die(`CARGO_PKG_RUST_VERSION=${v}: unexpected error`);
}
writeFileSync(join(DIR, "msrv.json"), JSON.stringify({ commit: PIN.commit, cases }, null, 1) + "\n");
rmSync(work, { recursive: true });
console.log(`wrote case.stderr, case.nodocs.stderr, case.json, hir_case.stderr, msrv_attrs.stderr, msrv_stability.stderr, msrv.json (${cases.length} versions)`);
