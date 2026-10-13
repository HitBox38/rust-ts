// Oracle checks of the target spec, cfg and session-validation paths (lane target-cfg) against the pinned
// nightly rustc: `bun src/rust_ts/main.ts <args>` and `rustc +nightly <args>` must print the same stdout and
// stderr and exit with the same code.
//   - `--print cfg` / `target-spec-json` / `check-cfg` / `sysroot` / `target-libdir` / ... for every built-in
//     target whose spec is ported (rustc_target/spec/targets), with and without `--cfg`/`--check-cfg`.
//   - `--cfg`/`--check-cfg` parse errors (interface.rs `parse_cfg`/`parse_check_cfg`).
//   - `validate_commandline_args_with_session_available` and the LLVM-input guards.
//   - The host tuple (`RUST_TS_HOST_TUPLE`) against `rustc -vV`.
// PENDING cases must either match exactly or stop at the named `unported(..)` (exit 70) after printing a
// prefix of the oracle's output: `--cfg`/`--check-cfg` need `FileName::cfg_spec_source_code`, i.e. the
// StableHasher of lane stable-hash; once it lands they match without changes here.
// Skips (visibly) if rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN, REPO } from "../../scripts/lib/common.ts";
import { TARGET_CONFIG_TARGETS } from "../../tools/codegen/target-config.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const RUSTC = ["rustc", `+${PIN.toolchain}`];
function rustcVersion(): string | undefined {
  try {
    const out = Bun.spawnSync([...RUSTC, "-vV"]).stdout.toString();
    return out.includes(`commit-hash: ${PIN.commit}`) ? out : undefined;
  } catch {
    return undefined;
  }
}
const VERSION = rustcVersion();
const HAVE = VERSION !== undefined;
const SKIP = !HAVE && !REQUIRE;
if (SKIP) console.log(`SKIP: pinned rustc (${PIN.toolchain}, ${PIN.commit.slice(0, 12)}) unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);
function requireRustc(): void {
  if (!HAVE) throw new Error(`ERROR: pinned rustc unavailable and RUST_TS_REQUIRE_PROBES=1`);
}

const WORK = join(DATA, "tmp", "print-oracle", process.env.RUST_TS_AGENT ?? "default");
mkdirSync(WORK, { recursive: true });
writeFileSync(join(WORK, "x.rs"), "fn main() {}\n");

const ENV: Record<string, string> = {};
for (const [k, v] of Object.entries(process.env)) {
  if (v !== undefined && !["MAKEFLAGS", "CARGO_MAKEFLAGS", "MFLAGS", "RUSTC_LOG", "RUSTC_BOOTSTRAP", "RUSTC_ICE", "RUST_TARGET_PATH"].includes(k)) ENV[k] = v;
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

function sysroot(): string {
  return HAVE ? run([...RUSTC, "--print", "sysroot"]).stdout.trim() : "<no sysroot>";
}
const SYSROOT = sysroot();

function exact(args: string[]): void {
  test.skipIf(SKIP)(`rustc ${args.join(" ")}`, () => {
    requireRustc();
    const want = oracle(args);
    const got = ours(args);
    expect(got.stderr).toBe(want.stderr);
    expect(got.stdout).toBe(want.stdout);
    expect(got.code).toBe(want.code);
  });
}

function pending(args: string[], what: string): void {
  test.skipIf(SKIP)(`rustc ${args.join(" ")} (pending: ${what})`, () => {
    requireRustc();
    const want = oracle(args);
    const got = ours(args);
    const line = `rust-ts: unported: ${what}\n`;
    if (got.code === 70 && got.stderr.endsWith(line)) {
      expect(want.stderr.startsWith(got.stderr.slice(0, -line.length))).toBe(true);
      expect(want.stdout.startsWith(got.stdout)).toBe(true);
    } else {
      expect(got.stderr).toBe(want.stderr);
      expect(got.stdout).toBe(want.stdout);
      expect(got.code).toBe(want.code);
    }
  });
}

/** `--cfg`/`--check-cfg` parse their argument from a `FileName::CfgSpec` (StableHasher, lane stable-hash). */
const CFG_SPEC = "rustc_data_structures::stable_hasher::StableHasher";

test.skipIf(SKIP)("RUST_TS_HOST_TUPLE (CFG_COMPILER_HOST_TRIPLE) is the oracle's `rustc -vV` host", () => {
  requireRustc();
  const host = /^host: (\S+)$/m.exec(VERSION ?? "")?.[1];
  expect(ours(["--print", "host-tuple"]).stdout).toBe(`${host}\n`);
});

for (const target of TARGET_CONFIG_TARGETS) {
  const t = ["--target", target];
  exact(["--print", "cfg", ...t]);
  exact(["-Zunstable-options", "--print", "target-spec-json", ...t]);
  exact(["--print", "cfg", "-Copt-level=3", "-Cpanic=abort", "-Coverflow-checks=on", ...t]);
  exact(["--print", "cfg", "-Cdebug-assertions=off", "-Zfmt-debug=shallow", "-Zub-checks=no", "-Zcontract-checks", ...t]);
  exact(["--print", "cfg", "--crate-type=proc-macro", "--test", ...t]);
  exact(["--print", "split-debuginfo", ...t]);
  exact(["--print", "target-libdir", "--sysroot", SYSROOT, ...t]);
  pending(["--print", "cfg", "--cfg", "foo", "--cfg", 'bar="baz"', "--cfg", "unix", ...t], CFG_SPEC);
  pending(["--print", "check-cfg", "--check-cfg", "cfg(foo)", ...t], CFG_SPEC);
  pending(["-Zunstable-options", "--print", "check-cfg", "--check-cfg", "cfg(test,FALSE)", "--check-cfg", "cfg(feature,values(any()))", ...t], CFG_SPEC);
  exact(["-Zunstable-options", "--print", "check-cfg", ...t]);
  exact(["-Zunpretty=ast-tree", "x.rs", ...t]);
}

exact(["--print", "target-list"]);
exact(["--print", "host-tuple"]);
exact(["--print", "wasm-proc-macro-tuple"]);
exact(["--print", "sysroot", "--sysroot", SYSROOT]);
exact(["--print", "target-libdir", "--sysroot", SYSROOT]);
exact(["--print", "cfg", "--target", "nonexistent-target"]);
exact(["--print", "cfg", "--target", "x86_64-unknwon-linux-gnu"]);
pending(["--print", "cfg", "--target", "i686-unknown-linux-gnu"], "rustc_target::spec::targets::i686_unknown_linux_gnu (built-in target i686-unknown-linux-gnu)");

// `--cfg` / `--check-cfg` errors (interface.rs parse_cfg / parse_check_cfg).
for (const cfg of ["bar=baz", "a::b", "self", "x=1", '"x"', "x(", "x y"]) {
  pending(["--cfg", cfg, "x.rs"], CFG_SPEC);
}
pending(["--cfg", "x(y)", "--print", "cfg"], CFG_SPEC);
for (const spec of [
  "cfg(foo,",
  "foo(bar)",
  "cfg",
  'cfg(values("a"))',
  "cfg(foo, values(1))",
  "cfg(any(), foo)",
  "cfg(any(), any())",
  "cfg(any(1))",
  "cfg(foo, any(1))",
  'cfg(foo, values("a"), values("b"))',
  'cfg(foo, values("a", any()))',
  "cfg(foo, values(any(), any()))",
  "cfg(foo, values(none(1)))",
  'cfg(foo, values("a"), bar)',
  "cfg(self)",
  "cfg(foo = 1)",
]) {
  pending(["--check-cfg", spec, "x.rs"], CFG_SPEC);
}

// validate_commandline_args_with_session_available (review parser-b, finding 1).
for (const flag of [
  "-Cdwarf-version=7",
  "-Zdwarf-version=1",
  "-Zregparm=5",
  "-Cprofile-use=/nonexistent.profdata",
  "-Cprofile-sample-use=/nonexistent.prof",
  "-Zvirtual-function-elimination",
  "-Zreg-struct-return",
  "-Zpacked-stack",
  "-Zfunction-return=thunk-extern",
  "-Zembed-source",
  "-Zsmall-data-threshold=4",
  "-Zsanitizer-cfi-canonical-jump-tables=no",
  "-Zsanitizer-cfi-generalize-pointers",
  "-Zbranch-protection=bti",
  "-Cforce-unwind-tables=no",
  "-Zinstrument-mcount",
  "-Zinstrument-xray",
  "-Clinker-flavor=msvc",
  "-Clinker-flavor=gnu",
  "-Zindirect-branch-cs-prefix",
]) {
  exact(["-Zunpretty=ast-tree", flag, "x.rs", "--target", "x86_64-unknown-linux-gnu"]);
}
exact(["-Zunpretty=ast-tree", "-Csplit-debuginfo=unpacked", "--target", "x86_64-pc-windows-msvc", "x.rs"]);
exact(["-Zunpretty=ast-tree", "-Cforce-unwind-tables=no", "--target", "x86_64-pc-windows-msvc", "x.rs"]);
exact(["-Zunpretty=ast-tree", "-Zunstable-options", "-Clinker-flavor=gnu-cc", "--target", "x86_64-unknown-linux-gnu", "x.rs"]);
exact(["-Zunpretty=ast-tree", "-Clink-self-contained=+linker,-linker", "-Zunstable-options", "x.rs"]);

// LLVM inputs rust-ts only knows the default of (review parser-b, finding 2): never silently skipped.
pending(["-Zunpretty=ast-tree", "-Cllvm-args=-bogus", "x.rs"], "rustc_codegen_llvm::llvm_util::configure_llvm (-C llvm-args)");
pending(["-Zunpretty=ast-tree", "-Ctarget-feature=+bogus", "x.rs"], "rustc_codegen_llvm::llvm_util::configure_llvm (-C target-feature)");
pending(["-Zunpretty=ast-tree", "-Ctarget-cpu=bogus", "x.rs"], "rustc_codegen_llvm::llvm_util::configure_llvm (-C target-cpu)");
pending(["-Zunpretty=ast-tree", "-Zretpoline", "--target", "x86_64-unknown-linux-gnu", "x.rs"], "rustc_codegen_llvm::llvm_util::configure_llvm (-Z retpoline)");
pending(["-Zunpretty=ast-tree", "-Zsanitizer=memory", "x.rs"], "rustc_codegen_llvm::llvm_util::target_config (-Z sanitizer)");
