// Oracle checks of the driver CLI path (`src/rust_ts/main.ts` = rustc_driver_impl::main) against the
// pinned nightly rustc: stdout, stderr and exit code of `rustc <args>` must be identical.
//   - MATCH cases: CLI handling that needs no parser (version, bad flags, `-C help`, ...).
//   - PENDING cases: paths that reach code another lane is porting. They must either match the oracle
//     byte for byte, or stop with `rust-ts: unported: <expected what>` (exit 70) after printing a
//     prefix of the oracle's stdout/stderr. Once the parser (lane parser-core) lands, they turn into
//     exact matches without changes here.
//   - `--print` requests (cfg, target-spec-json, ...) are in src/rustc_driver_impl/print.oracle.test.ts.
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

const WORK = join(DATA, "tmp", "driver-oracle", process.env.RUST_TS_AGENT ?? "default");
mkdirSync(WORK, { recursive: true });
writeFileSync(join(WORK, "x.rs"), "fn main() {}\n");

// Same environment for both sides; no inherited jobserver or logging.
const ENV: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE"].includes(k)) ENV[k] = v;
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

const MATCH: string[][] = [
  ["-V"],
  ["--version"],
  ["-vV"],
  ["--version", "--verbose"],
  ["-Zfoo"],
  ["-Z", "foo=bar"],
  ["-Cfoo"],
  ["--foo"],
  ["--opt-level=3"],
  ["--edition=2099", "x.rs"],
  ["--edition", "2099", "x.rs"],
  ["-Zunpretty=bogus", "x.rs"],
  ["--color=x", "x.rs"],
  ["--error-format=bogus", "x.rs"],
  ["--json=artifacts", "x.rs"],
  ["--crate-type=bogus", "x.rs"],
  ["--emit=bogus", "x.rs"],
  ["--cap-lints=bogus", "x.rs"],
  ["--print=bogus"],
  ["--print=lints"],
  ["-Zthreads=x", "x.rs"],
  ["-Chelp"],
  ["-Zhelp"],
  ["-C", "help", "-Z", "help"],
  ["-W", "all"],
  ["a.rs", "b.rs"],
  ["--diagnostic-width=x", "x.rs"],
  ["--edition=future", "x.rs"],
  ["-Cpanic=immediate-abort", "x.rs"],
  ["--remap-path-prefix=x", "x.rs"],
  ["--remap-path-scope=bogus", "x.rs"],
  ["--jobs=2", "x.rs"],
  ["-Zunpretty=ast-tree"],
  ["--edition=2021"],
  ["--extern", "foo-bar", "x.rs"],
  ["-Wall"],
  ["--help"],
  [],
  ["-o"],
  ["--explain"],
];

/** [args, the `unported(..)` text the port may stop at until the pending lane lands] */
const PENDING: [string[], string][] = [
  [["--edition=2021", "-Zunpretty=ast-tree", "x.rs"], "rustc_parse::parser::item::Parser::parse_crate_mod"],
  [["--edition=2015", "-Zunpretty=ast-tree", "nonexist.rs"], "std::io::Error::kind (decode_error_kind, os error ENOENT)"],
  [["-Zunpretty=ast-tree", "x.rs"], "rustc_parse::parser::item::Parser::parse_crate_mod"],
  [["--edition=2024", "-Zunpretty=normal", "x.rs"], "rustc_parse::parser::item::Parser::parse_crate_mod"],
  [["x.rs"], "rustc_metadata::creader::CStore::from_tcx_mut (wave 11)"],
  [["-ooptimize", "x.rs"], "rustc_metadata::creader::CStore::from_tcx_mut (wave 11)"],
  [["-Zui-testing", "--edition=2021", "-Zunpretty=ast-tree", "x.rs"], "rustc_parse::parser::item::Parser::parse_crate_mod"],
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

for (const [args, pending] of PENDING) {
  test.skipIf(SKIP)(`rustc ${args.join(" ")} (pending: ${pending})`, () => {
    requireRustc();
    const want = oracle(args);
    const got = ours(args);
    const line = `rust-ts: unported: ${pending}\n`;
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
