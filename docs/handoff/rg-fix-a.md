# Handoff: rg-fix-a (M7d, wave 40t): ripgrep 15.2.0's release build through the port

Branch `t3/ripgrep-release-build-port` (from `6a74a1de`; no merges). Commits at the end.

## Summary
- **With one model gap filled, the stock `cargo build --release` of ripgrep 15.2.0 succeeds, with every rustc call going to the
  port.** That is 50 calls: 35 crates, 10 build scripts and 5 build-script probes. The port-built `rg` behaves like the oracle-built
  one: **36/36 scripted queries MATCH**, and **ripgrep's own integration suite passes 323/323** against the port-built `rg`. The
  port also built that test binary, with only `serde_derive` compiled by the oracle.
- **The gap is `llir: LLVMRustGetSymbols`, in the IR model.** It is outside this lane (`src/rust_ts/llvm/**` belongs to
  llir-callbr-mangler). Every rlib's archive writer calls it (`LLVM_OBJECT_READER`, back/archive.rs:25). With committed code
  only, **all 33 libs that cargo reaches stop there, after their front end and codegen**: rmeta is written and every CGU's
  object is made. Nothing else on the release path stops. The model patch I used to get past it is in appendix C. It was
  never committed.
- **Before the archive step, the port's work equals the oracle's:**
  - every unit's `.rmeta` is byte-identical when both builds use one target path (33/33);
  - every unit's pre-pass IR (`-Cno-prepopulate-passes --emit=llvm-ir`) is identical at N1 (35/35, `rg` included: 642k lines);
  - every unit's stderr (cargo's JSON diagnostics) is the oracle's (50/50);
  - every build script's run prints the oracle's stdout and stderr (10/10).
- Objects and binaries differ by design: plan-m7 D8 makes the ThinLocal LTO a recorded no-op, and the port uses `opt`/`llc`.
- **One compiler fix outside the model: `rustc_fs_util::link_or_copy`,** for `EmitObj::Bitcode` (`-C linker-plugin-lto`).
  ripgrep's **`release-lto` profile** (fat LTO, `-C strip=symbols`, `panic=abort`, 1 CGU, `-C linker-plugin-lto` on every
  dependency) stopped there. With the fix and two more model gaps filled in scratch (appendix C), `release-lto` builds too, and
  its `rg` also MATCHes 36/36 queries and passes 323/323 integration tests.
- **`serde_derive` is not on the build path.** No proc macro is built by `cargo build --release` (plan-m7 §3 was right, and
  `docs/next.md`'s M7d line is not). `serde_derive` is a **dev**-dependency, used only by the integration tests. For those, my
  driver sent the one `--crate-type proc-macro` compile to the oracle (pm-self owns the port's proc-macro output). Its
  dependencies `proc_macro2`, `quote`, `syn` and `unicode_ident` were built by the port as host rlibs, and the oracle linked them
  into the dylib without trouble.

## How far the build gets
| tree | committed code only | + appendix C's model patch |
|---|---|---|
| `release` (the stock profile: opt 3, 16 CGUs, `debug = 1`) | 10 build scripts + 5 probes compile and run; **33/33 libs stop at `llir: LLVMRustGetSymbols`**; `rg` is not reached | **50/50 calls exit 0; `cargo build` exit 0** (6 min 21 s; 4 min 40 s on a second run) |
| `release` + `cargo test --release --test integration --no-run` | not tried | 11 more calls, all exit 0 (1 min), `serde_derive` on the oracle |
| `release-lto` (fat LTO, strip, panic=abort) | as above (archive) | with GetSymbols for objects only: 32 libs stop at `link_or_copy` (fixed here); then 48/50, and `regex_automata` ICEs on gap G3; with all of appendix C, **exit 0** |

**First remaining stop with committed code:** `unported: llir: LLVMRustGetSymbols`, at archive time for every rlib (gap G1).

### Per-unit table (release, port side, run `rgfa-p2`)
Seconds are the port's wall time per call under `cargo -j4`; the oracle's whole build took 11 s.

| unit | calls | port s | exit | rmeta (same path) | N1 IR | stderr |
|---|---|---|---|---|---|---|
| aho_corasick | 1 | 47.2 | 0 | same | same | same |
| anyhow (+1 probe compile) | 2 | 18.9 | 0 0 | same | same (2) | same |
| bstr | 1 | 26.0 | 0 | same | same | same |
| cfg_if | 1 | 1.1 | 0 | same | same | same |
| crossbeam_deque / epoch / utils | 3 | 10.7 / 13.5 / 27.4 | 0 | same | same | same |
| encoding_rs / encoding_rs_io | 2 | 53.0 / 5.5 | 0 | same | same | same |
| globset | 1 | 27.2 | 0 | same | same | same |
| grep / grep_cli / grep_matcher | 3 | 2.0 / 14.2 / 4.6 | 0 | same | same | same |
| grep_printer / grep_regex / grep_searcher | 3 | 23.5 / 20.5 / 17.6 | 0 | same | same | same |
| ignore | 1 | 35.2 | 0 | same | same | same |
| itoa / lexopt / libc / log | 4 | 8.0 / 6.9 / 8.9 / 3.8 | 0 | same | same | same |
| memchr / memmap2 | 2 | 8.4 / 12.2 | 0 | same | same | same |
| regex_automata | 1 | 167.8 | 0 | same | same (504k lines) | same |
| regex_syntax | 1 | 69.8 | 0 | same | same | same |
| same_file | 1 | 5.0 | 0 | same | same | same |
| serde / serde_core / serde_json | 3 | 27.4 / 94.9 / 51.2 | 0 | same | same | same |
| termcolor / textwrap / walkdir / zmij | 4 | 15.3 / 14.7 / 14.7 / 9.7 | 0 | same | same | same |
| **rg** (bin, linked by the port) | 1 | 53.2 | 0 | (bin) | same (642k lines) | same |
| build_script_build ×10 (anyhow, crossbeam-deque/epoch/utils, libc, ripgrep, serde, serde_core, serde_json, zmij) | 10 | 41.5 total | 0 | (bin) | not compared | same; **each run's stdout/stderr = oracle's** |
| build-script probes (`rustc --version`) | 5 | 5.2 total | 0 | - | - | same |

Total port wall: 967 s over the 50 calls; oracle 49 s CPU. Notes:
- At different target paths, 5 rmetas differ: serde and serde_core `include!` a file from `OUT_DIR`, and their dependents carry
  their hashes. At one path all 33 are byte-identical (run `rgfa-same`), as check-rg found.
- **What the expected list held, and what happened.** All of these went through with no stop:
  - multi-CGU at `-O` (16 CGUs; the ThinLocal no-op per D8);
  - `-Cdebuginfo=1` with `-Csplit-debuginfo=unpacked`;
  - `-Cembed-bitcode=no` and `--cap-lints allow`;
  - build scripts: compiled, linked and **run** by the port's output;
  - `cfg` from build-script output (libc's 27 lines, serde's 13, ...);
  - real-world generics.

  `-Cstrip=symbols` is only in `release-lto`, and it works there.
- Port `rg` 7,072,528 bytes against the oracle's 6,624,256. The objects differ by D8: the oracle's ThinLocal pass promotes and
  imports across CGUs (`….llvm.<hash>` symbols), and the port skips it.

## Fixes
| # | stop | where | fix | upstream | test |
|---|---|---|---|---|---|
| 1 | `unported: rustc_fs_util: compiler/rustc_fs_util/src/lib.rs link_or_copy` (every lib of `release-lto`: cargo passes `-C linker-plugin-lto`, so `EmitObj::Bitcode` hard-links the bitcode to the object path) | `src/rustc_fs_util/lib.ts` (new `LinkOrCopy`, `link_or_copy`); `src/rustc_codegen_llvm/back/write.ts` drops its cross-lane stub and imports it | ported: `hard_link`, the `AlreadyExists` retry after `remove_file`, then the copy fallback | `compiler/rustc_fs_util/src/lib.rs:55` `LinkOrCopy`, `:62` `link_or_copy` | `src/rustc_fs_util/lib.test.ts` (link, relink over an existing file, fallback stops); `src/rustc_codegen_llvm/back/linker_plugin_lto.oracle.test.ts` (`-Copt-level=3 -Clinker-plugin-lto --emit=obj` of a small lib: the port writes the oracle's single file, Darwin-wrapped bitcode, exit 0, no stderr; it stopped with exit 70 before) |

`src/rustc_codegen_llvm/skeleton.test.ts`'s count of `unported` stops per crate drops its `rustc_fs_util: 1` entry.

### `unported(...)` left
- `std::fs::copy (rustc_fs_util::link_or_copy's fallback after a failed hard link)`: src/std has no `std::fs::copy`, and lanes do
  not edit src/std. It is reached only when a hard link fails, for example across file systems. **For root:** port
  `std::fs::copy` (library/std/src/fs.rs `copy`, the macOS `fclonefileat`/`fcopyfile` path) in a src/std batch. The fallback's
  `fs::copy(p, q).map(|_| LinkOrCopy::Copy)` then replaces the stop.

### `// PORT:` decisions
- `link_or_copy`'s copy fallback: the `unported` above, with its reason.

## Model gaps (for llir-callbr-mangler or the next llir lane; `src/rust_ts/llvm/**`)
- **G1. `LLVMRustGetSymbols` for object files (blocks `rg-build`).**
  - rustc's wrapper (`compiler/rustc_llvm/llvm-wrapper/SymbolWrapper.cpp:66`) works like this:
    - `getSymbolicFile` (:43) returns null for a non-symbolic file type, and the result is then 0;
    - otherwise every `isArchiveSymbol` (:24) symbol goes to the callback: not `SF_FormatSpecific`, `SF_Global`, not
      `SF_Undefined`;
    - errors go through `ErrorCallback`.
  - For Mach-O members this is what vendor ar_archive_writer's `get_native_object_symbols` computes through the object crate.
    That is the scratch patch (appendix C), which made all 33 rlibs.
  - The archive's `__.SYMDEF` was not compared byte for byte against the oracle's. The object files differ (D8), so the symbol
    sets differ, as with `….llvm.<hash>`.
  - A faithful port wants LLVM's `MachOObjectFile::getSymbolFlags` (`N_STAB` → format-specific, `N_EXT`/`N_PEXT` → global,
    `N_UNDF` → undefined), pinned through `llvm-src.ts add`. `llvm/lib/Object/SymbolicFile.cpp` and `Magic.cpp` decide
    "symbolic".
  - `LLVMRustIs64BitSymbolicFile`, `LLVMRustIsECObject` and `LLVMRustIsAnyArm64Coff` were not reached on this build.
- **G2. `LLVMRustGetSymbols` for bitcode members (`release-lto`).** `-C linker-plugin-lto` rlibs hold bitcode objects. LLVM reads
  them as an `IRObjectFile`. No pinned tool lists those symbols (opt, llc, llvm-as, llvm-dis, llvm-link). My scratch patch used
  the oracle toolchain's `llvm-nm -j -p --extern-only --defined-only`, which is not acceptable as is. Upstream's own fallback,
  `get_llvm_object_symbols`, only warns when LLVM *fails* to read bitcode, so "no symbols" is not upstream's behaviour either.
  Options for the model lane: pin `llvm-nm` (a tools batch), or read the symbols from `llvm-dis` text (globals' linkage and
  declarations).
- **G3. Long local names do not survive the model's text round trip (an ICE in `regex_automata` under `release-lto`).**
  - What happens: LLVM truncates a non-global value name to `-non-global-value-max-name-size` (1024), then uniquifies it with a
    suffix. So `opt`'s output prints names of 1,027 characters (`%` + 1024 + `.2`). The next tool parses that text, truncates
    the names to 1024 again, and fails: `opt: error: multiple definition of local value named '.sroa.29.sroa.0.…'`.
  - Where: `LLVMRustModuleSerialize` (tools.ts:808, the pre-LTO module's `assign-guid` run).
  - Checked by hand on the kept 19.6 MB module: `opt -disable-output` fails; `opt -non-global-value-max-name-size=-1
    -disable-output` exits 0.
  - Fix for the model: pass `-non-global-value-max-name-size=-1` to every tool that **parses** model text, and keep the default
    for the run whose naming should match in-process LLVM. Appendix C passes it to every tool, which also lifts truncation in
    the first `opt` (names only).
  - Unrelated to fat LTO: any module with names this long hits it after one `opt` round trip.
- **Fat LTO in `release-lto`:** with G1-G3 filled in scratch, the `llvm-link` fat-LTO path linked `rg`. Behaviour matches.

## For harness-m7d (`rg-build`, `rg-behaviour`)
- **Routing:** with every compile on the port, the stock release build needs **no oracle compile at all** (no proc macros).
  Building the integration tests needs `serde_derive` (a dev-dependency) on the oracle until pm-self lands.
- **The jobserver warning:** rustc warns `failed to connect to jobserver from environment variable CARGO_MAKEFLAGS=… Bad file
  descriptor (os error 9)` on every unit, on both sides. The wrapper's `Bun.spawnSync` does not pass cargo's jobserver fds (3, 5
  here) to the compiler, and the port prints the oracle's warning byte for byte. A suite should pass them (Bun's `stdio` array)
  or accept the warning on both sides.
- **Integration tests:** they find `rg` at `<test exe dir>/../rg`. This cargo's build-dir layout puts the test binary under
  `target/release/build/ripgrep/<hash>/out/`, so copy it to `target/release/deps/` first, as cargo's old layout had it. There
  are **323** tests at 15.2.0, not 333.
- **Timing masks for `rg-behaviour`:** `--stats` (`… seconds spent searching`, `… seconds total`) and `--json`'s `elapsed` /
  `elapsed_total` objects vary from run to run. Everything else, including `--generate man`, `--type-list` and color output,
  matched byte for byte.
- Cost: port about 6.5 min wall at `-j4` (967 s summed over calls, peak load about 5 cores), oracle 11 s.
  `regex_automata` 168 s and `serde_core` 95 s are the long poles; `rg` 53 s.

## For pm-self
The proc-macro dependency chain (`proc_macro2`, `quote`, `syn`, `unicode_ident`, and their build scripts) builds through the port
as host rlibs. An oracle-built `serde_derive` dylib linked them, and the derive it produced was loaded by the **port** when it
compiled ripgrep's integration test (`integration`, 32 s, exit 0). That is the existing pm-host path.

## Evidence
- `bunx tsc --noEmit -p .`: clean.
- `bun scripts/coverage.ts --check`: markers ok (27,350). `--missing compiler/rustc_fs_util/src/lib.rs`: **2/10** (was 1/10;
  `link_or_copy` added).
- `RUST_TS_REQUIRE_PROBES=1 bun test src/rustc_fs_util src/rustc_codegen_llvm ./scripts/lib/unit-steps.test.ts`: **177 pass,
  0 fail** (20.7 s for the set). Added unit-test wall about 4 s: the oracle test 3.9 s, the fs test under 0.1 s.
- Samples (`--sample 200 --jobs 6`, `RUST_TS_AGENT=rg-fix-a`): no protected case left MATCH.
  - run-pass-native: 198 MATCH, 1 UNPORTED, 1 UNSTABLE (run `rgfixa-run-pass-native`). The UNPORTED case is
    `lto/all-crates.rs`, `-Clto=thin` (D8); it is not protected.
  - ir-run-pass: 197 MATCH, 3 UNPORTED (run `rgfixa-ir-run-pass`): `lto/all-crates.rs` and two `sanitizer/cfi` cases, all
    unprotected.
  - check-ui: 200/200 MATCH.
  - mir-o2: 200/200 MATCH.
- Scratch target directories under `$RUST_TS_DATA/tmp/rgfa-*`, deleted at the end: oracle 145 MB, port (with the test build)
  133 MB, release-lto 59 MB + 54 MB. Peak about 500 MB, plus the 363 MB IR comparison tree (deleted after use).

## Appendix A: the scratch driver (`rgall-rustc.ts`, cargo's `RUSTC` through a two-line `wrap.sh`)
```ts
// Scratch `RUSTC` for cargo (lane rg-fix-a): every rustc call goes to the port, after scripts/rg-rustc.ts's idea.
// - probes (`-vV`, `-`, `--print`) go to the port too;
// - `--crate-type proc-macro` goes to the oracle while RGALL_PM_ORACLE=1 (lane pm-self owns the port's proc-macro output);
// - RGALL_ORACLE=1 sends everything to the oracle (the reference build).
// Each call writes `<RGALL_LOG>/<n>-<crate>.json` (argv, cwd, exit, seconds, side) and `.stderr`.
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const env = (k: string): string => {
  const v = process.env[k];
  if (v === undefined) {
    console.error(`rgall-rustc: ${k} is not set`);
    process.exit(2);
  }
  return v;
};
const args = process.argv.slice(2);
const oracle = [env("RGALL_ORACLE_RUSTC")];
const port = [env("RGALL_BUN"), env("RGALL_PORT_MAIN"), "--sysroot", env("RGALL_SYSROOT")];
const argValue = (flag: string): string | undefined => {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag) return args[i + 1];
    if (args[i]!.startsWith(flag + "=")) return args[i]!.slice(flag.length + 1);
  }
  return undefined;
};
const probe = args.some((a) => a === "-vV" || a === "-" || a === "--print" || a.startsWith("--print="));
const pm = argValue("--crate-type") === "proc-macro";
const side = process.env.RGALL_ORACLE === "1" || (pm && process.env.RGALL_PM_ORACLE === "1") ? "oracle" : "port";
const compiler = side === "oracle" ? oracle : port;
if (probe) {
  const p = Bun.spawnSync([...compiler, ...args], { stdin: "inherit", stdout: "inherit", stderr: "inherit" });
  process.exit(p.exitCode ?? 101);
}
const log = env("RGALL_LOG");
mkdirSync(log, { recursive: true });
const crate = argValue("--crate-name") ?? "unknown";
const id = `${crate}-${Date.now()}-${process.pid}`;
const t0 = performance.now();
const p = Bun.spawnSync([...compiler, ...args], { stdin: "ignore", stdout: "inherit", stderr: "pipe", env: { ...process.env, RUSTC_ICE: "0" } });
const secs = (performance.now() - t0) / 1000;
const code = p.exitCode ?? 101;
process.stderr.write(p.stderr);
writeFileSync(join(log, `${id}.stderr`), p.stderr);
writeFileSync(join(log, `${id}.json`), JSON.stringify({ crate, side, code, secs, args, cwd: process.cwd(), out_dir: process.env.OUT_DIR }));
appendFileSync(join(log, "calls.tsv"), `${crate}\t${side}\t${code}\t${secs.toFixed(1)}\t${argValue("--crate-type") ?? "?"}\t${id}\n`);
process.exit(code);
```

## Appendix B: the runner (`run.sh <label> <oracle|port>`; `RGALL_CMD=test`, `RGALL_PROFILE="--profile release-lto"`) and the IR comparer
```sh
#!/bin/sh
# usage: run.sh <label> <oracle|port> [extra cargo args]   — one cargo build --release of ripgrep 15.2.0
set -e
S=$(cd "$(dirname "$0")" && pwd)
LABEL=$1; SIDE=$2; shift 2
D=/Users/tomernorman/Documents/personal/rust-ts/.data
REPO=/Users/tomernorman/.t3/worktrees/rust-ts/t3-c74fca0d-00482386945b70af
SYSROOT=/Users/tomernorman/.rustup/toolchains/nightly-2026-10-11-aarch64-apple-darwin
T=$D/tmp/rgfa-$LABEL
mkdir -p "$T"
printf '#!/bin/sh\nexec "$RGALL_BUN" "%s/rgall-rustc.ts" "$@"\n' "$S" > "$S/wrap.sh"; chmod +x "$S/wrap.sh"
unset RUSTFLAGS CARGO_ENCODED_RUSTFLAGS RUSTC_WRAPPER RUSTC_WORKSPACE_WRAPPER GIT_DIR GIT_WORK_TREE
export CARGO_HOME=$D/ripgrep/cargo CARGO_INCREMENTAL=0 GIT_CEILING_DIRECTORIES=$D/ripgrep RUST_BACKTRACE=0 RUSTC_ICE=0
export RUSTC="$S/wrap.sh" RGALL_BUN=$(which bun) RGALL_PORT_MAIN=$REPO/src/rust_ts/main.ts RGALL_SYSROOT=$SYSROOT RGALL_ORACLE_RUSTC=$SYSROOT/bin/rustc
export RGALL_LOG=$T/logs RUST_TS_HOST_TUPLE=aarch64-apple-darwin RUST_TS_DATA=$D
[ "$SIDE" = oracle ] && export RGALL_ORACLE=1
cd $D/ripgrep/ripgrep-15.2.0
exec "$SYSROOT/bin/cargo" ${RGALL_CMD:-build} ${RGALL_PROFILE:---release} --locked --offline $([ "${RGALL_CMD:-build}" = build ] && echo --keep-going) -j4 --target-dir "$T/target" "$@" > "$T/cargo${RGALL_CMD:+-$RGALL_CMD}.log" 2>&1
```
`ir-units.ts`: for each recorded unit, its argv without `--emit`/`--out-dir`/`--error-format`/`--json`, plus
`-Cno-prepopulate-passes --emit=llvm-ir`. Both sides run through `scripts/ir-run.ts --tier N1` at one `--out`, with the unit's
cwd and `OUT_DIR`, and are compared with `scripts/lib/ir-diff.ts`'s `firstIrDifference`.

## Appendix C: the scratch model patch (NOT committed; for the model lane, G1-G3)
```diff
diff --git a/src/rust_ts/llvm/ffi.ts b/src/rust_ts/llvm/ffi.ts
index 7ad3dc17..b6f081f2 100644
--- a/src/rust_ts/llvm/ffi.ts
+++ b/src/rust_ts/llvm/ffi.ts
@@ -4,6 +4,7 @@ import type { Attribute, BasicBlock, Buffer, Builder, Comdat, ConstantInt, Conte
 import type { Bool, MetadataKindId, MutRef, PtrLenStr, RawEnum, SanitizerOptions, ThinLTOModule } from "./support.ts";
 import type { AllocKindFlags, AsmDialect, AtomicOrdering, AtomicRmwBinOp, AttributeKind, CallConv, ChecksumKind, CodeGenOptLevel, CodeModel, CompressionKind, DIFlags, DISPFlags, DLLStorageClass, DebugEmissionKind, DebugNameTableKind, DiagnosticKind, DiagnosticLevel, FileType, FloatAbi, FramePointerKind, GEPNoWrapFlags, IntPredicate, LLVMRustResult, Linkage, MemoryEffects, ModuleFlagMergeBehavior, Opcode, OptStage, PassBuilderOptLevel, RealPredicate, RelocModel, TailCallKind, ThreadLocalMode, TypeKind, UWTableKind, UnnamedAddr, Visibility } from "./ffi_types.ts";
 import { bind, stub } from "./trace.ts";
+import { get_native_object_symbols } from "../../vendor/ar_archive_writer/object_reader.ts"; // SCRATCH rg-fix-a
 import * as impl0 from "./core.ts";
 import * as impl1 from "./build.ts";
 import * as impl2 from "./intrinsics.ts";
@@ -1473,7 +1474,21 @@ export const LLVMRustLLVMHasZlibCompression: () => boolean = stub("LLVMRustLLVMH
 export const LLVMRustLLVMHasZstdCompression: () => boolean = stub("LLVMRustLLVMHasZstdCompression");
 
 // rustc: compiler/rustc_codegen_llvm/src/llvm/ffi.rs:2606 LLVMRustGetSymbols
-export const LLVMRustGetSymbols: (buf_ptr: Uint8Array | undefined, buf_len: number, state: unknown, callback: unknown, error_callback: unknown) => unknown = stub("LLVMRustGetSymbols");
+// SCRATCH (rg-fix-a, NOT FOR COMMIT): object files through the object crate's reader; a non-object file is "not symbolic" (null).
+export const LLVMRustGetSymbols: (buf_ptr: Uint8Array | undefined, buf_len: number, state: unknown, callback: unknown, error_callback: unknown) => unknown = (buf, _len, state, callback) => {
+  const b = buf!;
+  if ((b[0] === 0xde && b[1] === 0xc0 && b[2] === 0x17 && b[3] === 0x0b) || (b[0] === 0x42 && b[1] === 0x43 && b[2] === 0xc0 && b[3] === 0xde)) {
+    // SCRATCH exploration only: the oracle toolchain's llvm-nm (not a pinned model tool).
+    const nm = Bun.spawnSync(["<oracle sysroot>/lib/rustlib/aarch64-apple-darwin/bin/llvm-nm", "-j", "-p", "--extern-only", "--defined-only", "-"], { stdin: b });
+    let e: unknown = undefined;
+    for (const n of nm.stdout.toString().split("\n").filter((x) => x !== "")) { e = (callback as (s: unknown, n: Uint8Array) => unknown)(state, new TextEncoder().encode(n)); if (e !== undefined) return e; }
+    return undefined;
+  }
+  let err: unknown = undefined;
+  const r = get_native_object_symbols(b, (name) => { const e = (callback as (s: unknown, n: Uint8Array) => unknown)(state, name); if (e !== undefined) { err = e; return { $: "Err", _0: e } as never; } return { $: "Ok", _0: null } as never; });
+  void r;
+  return err;
+};
 
 // rustc: compiler/rustc_codegen_llvm/src/llvm/ffi.rs:2614 LLVMRustIs64BitSymbolicFile
 export const LLVMRustIs64BitSymbolicFile: (buf_ptr: Uint8Array | undefined, buf_len: number) => boolean = stub("LLVMRustIs64BitSymbolicFile");
diff --git a/src/rust_ts/llvm/tools.ts b/src/rust_ts/llvm/tools.ts
index d7da6076..747f414c 100644
--- a/src/rust_ts/llvm/tools.ts
+++ b/src/rust_ts/llvm/tools.ts
@@ -115,7 +115,7 @@ export interface ToolRun {
  */
 export function run_pinned_tool(name: PinnedTool, args: readonly string[], stdin?: Uint8Array): ToolRun {
   const path = pinned_tool(name);
-  const r = Bun.spawnSync([path, ...args], { stdin: stdin ?? "ignore", stdout: "pipe", stderr: "pipe" });
+  const r = Bun.spawnSync([path, "-non-global-value-max-name-size=-1" /* SCRATCH rg-fix-a, NOT FOR COMMIT */, ...args], { stdin: stdin ?? "ignore", stdout: "pipe", stderr: "pipe" });
   // The tool's own path starts its messages (`<argv0>: ...`) and its stack dumps: keep the machine's paths out of them.
   const stderr = r.stderr.toString().replaceAll(path, name);
   const stdout = new Uint8Array(r.stdout);
```
