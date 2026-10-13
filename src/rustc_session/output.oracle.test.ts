// Oracle checks of rustc_session/src/output.rs (crate-name validation, `filename_for_input`,
// `invalid_output_for_target`) and the rustc_interface steps around it (`get_crate_name`,
// `collect_crate_types`, `build_output_filenames`), through the CLI: `src/rust_ts/main.ts <args>` against
// the pinned nightly `rustc <args>`: stdout, stderr and exit code must be identical.
//   - MATCH: exact.
//   - PENDING: the compilation goes on into name resolution (lane res-lib). The port must either match
//     exactly, or stop with `rust-ts: unported: <what>` (exit 70) after printing a prefix of the oracle's
//     stdout/stderr (so every diagnostic of the steps ported here is checked). They turn into exact
//     matches once resolution lands; then move them to MATCH.
// `out_filename` / `check_file_is_writeable` / `filename_for_metadata` run at link time only (not reached
// before codegen); `filename_for_input` is checked through `--print file-names`.
// Skips (visibly) if rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN, REPO } from "../../scripts/lib/common.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const RUSTC = ["rustc", `+${PIN.toolchain}`];
function rustcAvailable(): boolean {
  try {
    return Bun.spawnSync([...RUSTC, "-vV"]).stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
}
const HAVE = rustcAvailable();
const SKIP = !HAVE && !REQUIRE;
if (SKIP) console.log(`SKIP: pinned rustc (${PIN.toolchain}, ${PIN.commit.slice(0, 12)}) unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);
function requireRustc(): void {
  if (!HAVE) throw new Error(`ERROR: pinned rustc unavailable and RUST_TS_REQUIRE_PROBES=1`);
}

const WORK = join(DATA, "tmp", "output-oracle", process.env.RUST_TS_AGENT ?? "default");
mkdirSync(WORK, { recursive: true });
const FILES: Record<string, string> = {
  "a.rs": "fn main() {}\n",
  "a.b.rs": "fn main() {}\n",
  "-foo.rs": "fn main() {}\n",
  "cn.rs": '#![crate_name = "a-b"]\nfn main() {}\n',
  "cn_empty.rs": '#![crate_name = ""]\nfn main() {}\n',
  "cn_bar.rs": '#![crate_name = "bar"]\nfn main() {}\n',
  "cn_twice.rs": '#![crate_name = "bar"]\n#![crate_name = "baz"]\nfn main() {}\n',
  "ct.rs": '#![crate_type = "lib"]\n#![crate_type = "dylib"]\n#![crate_type = "lib"]\nfn main() {}\n',
  "ct_bogus.rs": '#![crate_type = "bogus"]\nfn main() {}\n',
  "pm.rs": '#![crate_type = "proc-macro"]\nfn main() {}\n',
};
for (const [name, text] of Object.entries(FILES)) writeFileSync(join(WORK, name), text);

// Same environment for both sides; no inherited jobserver or logging.
const ENV: Record<string, string> = { RUSTC_ICE: "0", RUST_BACKTRACE: "0" };
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE", "RUST_BACKTRACE"].includes(k)) ENV[k] = v;
}

interface Out {
  stdout: string;
  stderr: string;
  code: number;
}
function run(cmd: string[]): Out {
  const r = Bun.spawnSync(cmd, { cwd: WORK, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { stdout: r.stdout.toString(), stderr: r.stderr.toString(), code: r.exitCode ?? -1 };
}
const oracle = (args: string[]): Out => run([...RUSTC, ...args]);
const ours = (args: string[]): Out => run([process.execPath, join(REPO, "src/rust_ts/main.ts"), ...args]);

const U = "-Zunpretty=expanded";
const NOCORE = ["-Zcrate-attr=feature(no_core)", "-Zcrate-attr=no_core"];
const TARGETS = ["x86_64-unknown-linux-gnu", "aarch64-unknown-linux-gnu", "x86_64-apple-darwin", "aarch64-apple-darwin", "x86_64-pc-windows-msvc", "wasm32-wasip2"];

const MATCH: string[][] = [
  // validate_crate_name: invalid characters (with the suggestion when there is no span), empty names
  ["--crate-name", "a.b", U, "a.rs"],
  ["--crate-name", "a b-c", U, "a.rs"],
  ["--crate-name=", U, "a.rs"],
  ["--crate-name", "a€b", U, "a.rs"],
  [U, "a.b.rs"],
  // `#![crate_name]` (spanned, no suggestion), empty
  [U, "cn.rs"],
  [U, "cn_empty.rs"],
  // build_output_filenames: MultipleOutputTypesToStdout (stdout is a pipe here)
  ["--emit=asm,llvm-ir", "-o", "-", U, "a.rs"],
  ["--emit=asm=-,llvm-ir=-", U, "a.rs"],
  // --print crate-name / file-names / supported-crate-types
  ["--print", "crate-name", "a.rs"],
  ["--print", "crate-name", "cn.rs"],
  ["--print", "crate-name", "cn_bar.rs"],
  ["--print", "crate-name", "a.b.rs"],
  ["--print", "crate-name", "--crate-name", "foo", "cn_bar.rs"],
  ["--print", "crate-name", "--crate-name", "x y", "a.rs"],
  ["--print", "file-names", "a.rs"],
  ["--print", "file-names", "ct.rs"],
  ["--print", "file-names", "ct_bogus.rs"],
  ["--print", "file-names", "-o", "foo/bar.exe", "a.rs"],
  ["--print", "file-names", "-C", "extra-filename=-x", "--crate-type=lib,staticlib,cdylib,bin", "a.rs"],
  ["--print", "file-names", "--crate-name", "foo", "a.rs"],
  ["--print", "file-names", "--test", "a.rs"],
  ...TARGETS.flatMap((t) => [
    ["--target", t, "--print", "supported-crate-types"],
    ["--target", t, "--print", "file-names", "ct.rs"],
    ["--target", t, "--print", "file-names", "--crate-type=bin,lib,rlib,dylib,cdylib,staticlib,proc-macro", "a.rs"],
  ]),
];

/** Continue into name resolution: the port stops at late resolution (lanes res-late-a/-b). */
const PENDING_AT = "rustc_resolve::late::Resolver::late_resolve_crate";
const PENDING: string[][] = [
  ["--crate-name", "héllo", ...NOCORE, U, "a.rs"],
  ["--crate-name", "٣x", ...NOCORE, U, "a.rs"],
  // CrateNameDoesNotMatch, then the command-line name is validated
  ["--crate-name", "foo", ...NOCORE, U, "cn_bar.rs"],
  ["--crate-name", "bar", ...NOCORE, U, "cn_bar.rs"],
  [...NOCORE, U, "cn_twice.rs"],
  // CrateNameInvalid (leading `-`), then `rust_out`
  [...NOCORE, U, "./-foo.rs"],
  // collect_crate_types: invalid_output_for_target / UnsupportedCrateTypeForTarget
  ["--target", "wasm32-wasip2", ...NOCORE, U, "pm.rs"],
  ["--target", "wasm32-wasip2", "--crate-type=dylib,proc-macro,bin", ...NOCORE, U, "a.rs"],
  [...NOCORE, U, "ct.rs"],
  // build_output_filenames warnings
  ["--emit=asm,llvm-ir", "-o", "foo", ...NOCORE, U, "a.rs"],
  ["-o", "foo", "-C", "extra-filename=x", ...NOCORE, U, "a.rs"],
  ["-o", "foo", "--out-dir", "d", ...NOCORE, U, "a.rs"],
];

for (const args of MATCH) {
  test.skipIf(SKIP)(`rustc ${args.join(" ")}`, () => {
    requireRustc();
    const want = oracle(args);
    const got = ours(args);
    expect(got.stderr).toBe(want.stderr);
    expect(got.stdout).toBe(want.stdout);
    expect(got.code).toBe(want.code);
  });
}

for (const args of PENDING) {
  test.skipIf(SKIP)(`rustc ${args.join(" ")} (pending: ${PENDING_AT})`, () => {
    requireRustc();
    const want = oracle(args);
    const got = ours(args);
    const line = `rust-ts: unported: ${PENDING_AT}\n`;
    if (got.code === 70 && got.stderr.endsWith(line)) {
      // Everything printed before the unported point is what rustc prints first.
      expect(want.stderr.startsWith(got.stderr.slice(0, -line.length))).toBe(true);
      expect(want.stdout.startsWith(got.stdout)).toBe(true);
    } else {
      expect(got.stderr).toBe(want.stderr);
      expect(got.stdout).toBe(want.stdout);
      expect(got.code).toBe(want.code);
    }
  });
}
