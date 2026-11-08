# Handoff: lane fixers-48 (queued port findings)

Branch `t3/6b4c6b71`, on `main` at `519e6360`. Five commits, one per item, then this file.
Host: root host, AC power, load 12 to 22 (two other lanes). `RUST_TS_AGENT=fixers-48`, `RUST_TS_REQUIRE_PROBES=1`,
`RUSTUP_AUTO_INSTALL=0`, `RUSTC_ICE=0`. No gate, no full suite, no full unit step.

All five items reproduced first (items 1, 3 and 4 against the oracle, item 5 on `main`), and all five are fixed. Each fix has a test that fails
on the old code (checked against the previous file or in a scratch worktree of `519e6360`).

| Item | Source | Commit | Pinned by |
|---|---|---|---|
| 1 | fixers-47 review F1 | `6ff7d2a9` | `aarch64_oracle/big.rs` and `big_err.rs`, and the regenerated `big_err` fixture |
| 2 | fixers-47 review F2 | `2b7dc43f` | the header itself, checked by rebuilding the fixture from it |
| 3 | link-rlib-native review N1 | `e1f80cc4` | `rlib_native.oracle.test.ts` (new test) |
| 4 | link-rlib-native review N3 | `fbacf9ad` | `src/std/env.test.ts` (new test), `rlib_native.oracle.test.ts` (fat-file test extended) |
| 5 | unit-parallel review N2 | `76504908` | `src/rust_ts/first_import.test.ts` (new file) |

## 1. Array patterns past 2^53 (`src/rustc_hir_typeck/pat.ts`)

**Reproduced** on `main`. `pub fn g(x: &[u8; 9007199254740995]) -> usize { let [_, r @ .., _] = x; r.len() }`: the oracle exits 0, and the
port ICEs at `u64_to_number(pat_len, "Ty::new_array")`. `pub fn h(x: [u8; 9007199254740993]) { let [a, b] = x; }`: the oracle gives E0527, and the port ICEs
at `:2841`.

**Fix.** `check_array_pat_len` passes the `bigint` `pat_len` to `Ty::new_array`, which already takes `number | bigint`. It passes
`BigInt(min_len)` and `len` to the two diagnostics. `error_scrutinee_inconsistent_length` and `error_scrutinee_with_rest_inconsistent_length` take
`min_len: bigint, size: bigint`, as upstream's `u64`s (the `decls.ts` declarations too). `pluralize(Number(x))` matches upstream's `pluralize!`:
it tests `== 1`, and `Number(x) === 1` exactly when `x === 1n` (`must_use.ts:525` does the same). The `u64_to_number` import is gone.
`check_array_pat_len`'s own `min_len` stays a `number`: it counts the pattern's elements in the source.

**Pinned** beside the fixers-46/47 cases. `big.rs` gets `rest(x: &[u8; 2^53 + 3]) -> &[u8; 2^53 + 1]` with `let [_, r @ .., _] = x; r`. Its
oracle output is unchanged, so `big.aarch64-apple-darwin.txt` is the same file. `big_err.rs` gets `too_few(x: [u8; 2^53 + 1])` with `let [_a, _b] = x;`.
`regen.ts` rewrote only `big_err.aarch64-apple-darwin.txt`: E0527 at `big_err.rs:47`, 5 errors instead of 4. Every other fixture came out byte-identical.
**Mutant:** with the old `pat.ts`/`decls.ts`, `aarch64.oracle.test.ts` fails. `pat_b.test.ts` passes `bigint`s to the two diagnostics now.
Both scratch programs above are identical to the oracle's output (stdout, stderr and exit code).

## 2. `rlib_macho.test.ts`'s header

I rebuilt `nc.rs` from the review's description: no blank line between the lang items, and one after `#![no_core]` and one before `pub fn f() {}`. Built with the header's
command, its `libnc.rlib` is **byte-identical** to `HOST_RLIB` on the first try. The header now holds the file's 11 lines as `// |`-prefixed lines, with
the byte count (221) and the command that extracts them (`grep '^// |' rlib_macho.test.ts | sed 's/^\/\/ |//' > nc.rs`). That command's output
`cmp`s equal to the file that rebuilt the fixture. 7 pass.

## 3. A directory named like a native library (`src/rustc_data_structures/memmap.ts`)

**Reproduced.** `-Zcodegen-backend=dummy --crate-type rlib -L d3 -l static=dir` with a directory `d3/libdir.a/`: the oracle prints `error: failed to add
native library d3/libdir.a: Invalid argument (os error 22)`, and the port stops with `unported: std::io::Error raw OS error (darwin, UNKNOWN)`.

**Cause.** This was not a missing errno mapping. `Mmap::map`'s `try` caught its own `unported("…Mmap::map of a non-regular file")` and turned it into
`io_error_from_node(e)`, an `Os` error with no errno and code `UNKNOWN`. Displaying it then stopped in `io.ts:171`. The empty-file `unported`
on Windows was swallowed the same way.

**Fix: memmap2 0.2.3's own path.** `map_copy_read_only` takes `get_len` = `file.metadata()?.len()`. A zero length is `InvalidInput` ("memory map must have
a non-zero length") without calling mmap. Otherwise it calls `mmap(NULL, len, PROT_READ, MAP_PRIVATE, fd, 0)` and returns `last_os_error()` on `MAP_FAILED`.
The port now:
- catches only the Node calls' errors (`fstatSync`, `Bun.mmap`), so an `unported` or a panic propagates;
- tests the zero size first, for every file type, as memmap2 does;
- keeps `Bun.mmap` for regular files (unchanged);
- sends a non-regular file of non-zero `st_size` to a new `map_copy_read_only_ffi`, which calls the real `mmap(2)` through `bun:ffi`
  (`libSystem.B.dylib` or `libc.so.6`, opened lazily on first use) and reads `errno` with `env.ts`'s `errno_reader`, now exported. So the errno is the host's,
  as in upstream: EINVAL for a directory on darwin. I hard-coded no errno.

`// PORT:` (in the fn's doc): `libc::PROT_READ` is 1 and `MAP_PRIVATE` is 2 on darwin and linux. If the call succeeds (a device that maps), the bytes are copied
and the mapping is unmapped at once, where upstream keeps it until the `Mmap` drops. Windows stays `unported`.

**Against the oracle, all the same** (stdout, stderr and exit code). The directory case on the host and on `x86_64-unknown-linux-gnu` and `x86_64-apple-darwin`
(`#![no_core]`) is EINVAL. The packed form (`static:+whole-archive=dir`) is "failed to read file: Is a directory (os error 21)", which was already the same. A `libnull.a` linked to
`/dev/null` on the host and on ELF gives "memory map must have a non-zero length".
**Test:** `add_archive of a directory, or of /dev/null, gives memmap2's error`. The darwin text is checked only on darwin; other hosts check only
that it is an `Os` error. **Mutant:** with the old `memmap.ts`, it fails.

## 4. `std::env::temp_dir` (`src/std/env.ts`, `src/rustc_codegen_ssa/back/archive.ts`)

**Reproduced by reading** what the review describes, then **confirmed against the oracle**: the leftover `.tmpXXXXXXlibfat.a` goes to the darwin per-user dir with
`TMPDIR` unset, and to the cwd with `TMPDIR=` (empty). The port put both in Node's `os.tmpdir()`.

**Fix.** `env.ts` ports std's `temp_dir` (`library/std/src/sys/paths/unix.rs:442`), `darwin_temp_dir` (`:432`) and `confstr`
(`library/std/src/sys/pal/unix/conf.rs:16`):
- `var_os("TMPDIR")` as it is, even when empty;
- when unset: on darwin, `confstr(_CS_DARWIN_USER_TEMP_DIR, Some(64))` with `/tmp` on error; on linux, `/tmp`;
- Windows (`GetTempPath2W`) and any other host: `unported`.

`_CS_DARWIN_USER_TEMP_DIR` is 65537, from the pinned libc-0.2.189 (`src/unix/bsd/apple/mod.rs:3166`). `confstr` joins the lazy `env_libc()` table.
`// PORT:` on `confstr`: the buffer's capacity follows `Vec::reserve` (`max(2 * cap, needed, 8)`); only a truncated result, which makes it loop, could show it.

**Also tempfile 3.23.0's path handling**, which the oracle shows. `archive.ts` `tempfile_with_suffix` now follows `Builder::tempfile` → `util::create_helper` →
`file::create_named`:
- the base is `env::temp_dir()`, since rustc sets no `override_temp_dir`;
- a relative base (an empty or relative `TMPDIR`) is joined to `env::current_dir()?`;
- `AlreadyExists` and `AddrInUse` retry, up to `NUM_RETRIES` (65,536) names; after that comes "too many temporary files exist";
- a failed create's error is wrapped by `with_err_path`: `"{err} at path {path:?}"`, of the same kind.

That last point was a real difference. With `TMPDIR=/nonexistent` the oracle prints `failed to add native library fat/libfat.a: No such file or directory (os error 2) at
path "/nonexistent/.tmpA6nZXYlibfat.a"`, and the port printed no ` at path …`. The `node:os` `tmpdir` import is gone. `PathBuf` is a `string` here, so a
non-UTF-8 `TMPDIR` is decoded lossily (comment).

**Against the oracle** (the random 6 characters masked):
- `TMPDIR=/nonexistent` and `TMPDIR=nodir` (relative, missing): the same output, the latter with the cwd-joined absolute path;
- `TMPDIR=` (empty): one leftover file in the cwd on each side;
- unset: one leftover each in `getconf DARWIN_USER_TEMP_DIR`, and none in `/tmp`.

I removed the two leftovers my runs left in the per-user dir.

**Tests.** `env.test.ts` `temp_dir` covers raw non-UTF-8 bytes, empty, and unset (compared with `getconf DARWIN_USER_TEMP_DIR`, or `/tmp` on linux). It restores
`TMPDIR` in `finally`. **The fat-file test in `rlib_native.oracle.test.ts` had to change:** it set `process.env.TMPDIR`, which never reaches C's
`environ` (env.ts header), so with the port's new `temp_dir` its temp file would have gone to the real per-user dir. It now uses `set_var`/`remove_var`. It
checks that the one leftover lands in its own dir, and it adds the `with_err_path` case. **Mutant:** with the old `archive.ts`, that test fails.

## 5. Module-order cycles

**Reproduced** on `main`. I imported each module as the first module of a fresh `bun -e` process, from a scratch cwd. The modules tested were every value importer of
`rustc_hir/def.gen.ts`, `rustc_target/spec/mod.ts` and `rustc_middle/ty/print/mod.ts` (found with `Bun.Transpiler.scan`, so type-only imports are left out), plus
those three modules and `v0.ts`. 70 non-test modules: **32 fail on `main`, 20 at head** (the 20 are listed below). The 5 test files among the importers pass under `bun test --isolate`.

**The three cycles and their unsafe entries.** Each unsafe entry is a module whose children read its bindings at their top level before its own body runs:
- **`rustc_hir/def.gen.ts`** (`MacroKinds`): def.gen.ts → hir.ts → def.ts, whose top level spreads `gen.MacroKinds`. The safe entry is def.ts, which re-exports
  def.gen.ts.
- **`rustc_target/spec/mod.ts`** (`Os`): spec/mod.ts → lib.ts → spec/json.ts (`FIELD_TO_JSON` reads `Os.to_json`) and target_features.ts
  (`TargetClass.prototype…`). The safe entry is the crate root, lib.ts.
- **`rustc_middle/ty/print/mod.ts`** (`Printer`): print/mod.ts → pretty.ts, whose `PrettyPrinter extends Printer`. The safe entry is pretty.ts.
  symbol_export.ts and codegen_backend.ts reached it through `rustc_symbol_mangling/v0.ts`, which imported print/mod.ts before pretty.ts.

**Fixes** (each import carries a `// Load order:` comment naming the cycle):
- **def.gen.ts, all 9 importers** now import through def.ts, as unit-parallel did for `outlives_for_liveness.ts`: `fn_queries.ts`, `eval_queries.ts`,
  `inhabitedness/mod.ts`, `mir/pretty.ts`, `check.ts`, `wfcheck.ts`, `conflict_errors.ts` (merged with its `type DefKind` import from def.ts),
  `borrowck/type_check/mod.ts`, `diagnostics_b.test.ts`. No module but def.ts imports def.gen.ts now.
- **spec/mod.ts: every hand-written value importer outside the crate** imports `rustc_target/lib.ts` just before its spec/mod.ts import. stand_ins.ts and
  decoder.ts already do this (PORTING §8: a crate with extension modules is imported through its lib.ts from outside). The files: `miri/intrinsics/mod.ts`,
  `codegen_backend.ts`, `ast_validation.ts`, `test_harness.ts`, `back/link.ts`, `back/symbol_export.ts`, `rustc_interface/passes.ts`, `locator.ts`,
  `coroutine/mod.ts`, `remove_noop_landing_pads.ts`, `partitioning.ts`, `mitigation_coverage.ts`, and two tests (`codegen_backend.oracle`,
  `encoder_contract`). Placed right before, not at the top: in any entry that works today, lib.ts is in progress or done by then, so the new import is a no-op.
- **print/mod.ts:** `v0.ts`, `partitioning.ts`, and the five other importers that failed first (`legacy.ts`, `rustc_lint/context.ts`,
  `outlives/dump.ts`, `pattern_analysis/rustc/print.ts`, `print_oracle/test_printer.ts`) move their pretty.ts import above their print/mod.ts import.

**Importers left as they are, and why:**
- **spec/mod.ts, outside the crate:** `miri/shims/unix/env.ts` already imports `{ spec }` from lib.ts on the line before. `rustc_session/stand_ins.ts`
  already imports lib.ts first. `rustc_metadata/decodable.gen.ts` and `diagnostics.gen.ts` are generated (`tools/codegen`), so not mine to edit; both
  load first today, because an earlier import enters through lib.ts. A generator change would be its own batch.
- **The other 23 print/mod.ts importers** load first today, because an earlier import already evaluates pretty.ts or the crate. They are fine
  until an import above theirs changes. The new test does not cover them.
- **14 modules inside rustc_target that import `../mod.ts`** (callconv/mod.ts, json.ts, target_features.ts, base/{linux, linux_gnu, msvc, wasm,
  windows_msvc}.ts, six targets/*.ts) **still fail first, as they do on `main`** (base/apple/mod.ts loads first). They are part of the cycle, and every real entry and every test reaches them
  through lib.ts. spec/mod.ts itself cannot be made safe: its import of lib.ts (for lib.rs's `target_spec_enum`, `target_spec_other_enum` and
  `relative_target_rustlib_path`) is the cycle. Breaking it means moving lib.rs's items out of lib.ts or making json.ts's table lazy, both redesigns.
- **The unsafe entries themselves** (def.gen.ts, spec/mod.ts, print/mod.ts) fail first by construction.
- So the 20 failures at head are these 14, the 3 unsafe entries, and v0.ts, op.ts and method/suggest.ts, which fail on other cycles (below).

**Evaluation order of the real entries: unchanged.** I used a preload (`--preload` through `BUN_OPTIONS`, a sync `Bun.plugin` `onLoad` that prepends a log call to each
module) on a scratch worktree of `519e6360` and on head, run from the same scratch cwd:

| Entry | Modules | `main` vs head |
|---|---|---|
| `bun src/rust_ts/main.ts --edition 2021 --crate-type lib --sysroot <oracle> --emit=metadata hello.rs` (main.ts's static imports, then the driver) | 2,094 | identical; `.rmeta` byte-identical (md5 `7675c00a…`) |
| `bun src/miri/bin/miri.ts --version` (stack.ts, then miri.ts) | 2,276 | identical |
| `… --crate-type rlib -Zcodegen-backend=dummy -Zprint-mono-items hello.rs` (loads rustc_monomorphize, so partitioning.ts) | 2,105 | identical; rlib and stdout byte-identical |

Items 1 to 4's new imports (`env.ts` from memmap.ts and archive.ts, `fmt.ts` from archive.ts) are covered too: the head after item 4 was also identical. Every touched
non-test module is in at least one of these logs.

**Test.** `src/rust_ts/first_import.test.ts` loads the 11 modules that failed first on `main` and are fixed, each in its own process, in parallel (0.5 s).
On `main` it fails with all 11 errors.

**Other cycles found (not in this item, the same on `main`, for root's queue):**
- `rustc_symbol_mangling/v0.ts` first: `Cannot access 'BoundRegionKind'` at `rustc_type_ir/binder.ts:1000`, through `rustc_middle/ty/layout.ts` →
  `rustc_type_ir/binder.gen.ts` → `binder.ts`. This is the def.gen.ts pattern again. v0.ts's earlier `layout.ts` import enters it from the gen side.
- `rustc_hir_typeck/op.ts` first: `Cannot access 'ObligationCause'` at `rustc_middle/traits/mod.ts:89` (through `traits/mod.gen.ts`).
- `rustc_hir_typeck/method/suggest.ts` first: `Cannot access 'InferOk'` at `rustc_infer/infer/mod.ts:430` (through `rustc_infer/infer/mod.gen.ts`).

These are the importers of three files only. A sweep of every module would likely find more.

## Samples

Seed `fixers-48`, `--jobs 4`:

| Suite | Result | Run id |
|---|---|---|
| check-ui `--sample 150` | 150/150 | `fx48-check-ui` |
| mir `--sample 150` | 150/150 | `fx48-mir` |
| mir-o2 `--sample 150` | 150/150 | `fx48-mir-o2` |
| mono-ui `--sample 150` | 150/150 | `fx48-mono-ui` |
| rmeta-ui `--sample 150` | 150/150 | `fx48-rmeta-ui` |
| pm-ui `--sample 150` | 149/150: `expand-expr.rs` UNPORTED (cross-thread proc macro, not protected, as in the fixers-47 review) | `fx48-pm-ui` |

## Units, tsc, coverage

- `bunx tsc --noEmit -p .`: clean. `bun scripts/coverage.ts --check`: `markers ok (24893; vendor 5302; library 610)`.
- Coverage: `pat.rs` 70/70. `library/std/src/sys/paths/unix.rs` 7/35 (+`temp_dir`, `darwin_temp_dir`). `library/std/src/sys/pal/unix/conf.rs` 1/5
  (+`confstr`). `memmap.rs` 3/12 and `back/archive.rs` 12/22 are unchanged (memmap2 and tempfile are external, with no markers).
- Touched test files, each with `--isolate`: `pat_b` 10, `aarch64.oracle` 2, `rlib_macho` 7, `rlib_native.oracle` 9, `env` 6, `diagnostics_b` 18,
  `codegen_backend.oracle` 17, `encoder_contract` 8, `first_import` 1. All pass. `print.test.ts` 16 and `sty.test.ts` 13 (importers of print/mod.ts,
  not edited) pass too.
- Added unit time: about 0.5 s (`first_import`) plus milliseconds. `aarch64.oracle` is 1.75 to 1.87 s on both `main` and head, which is noise.

## `unported(...)` and `// PORT:`

- New `unported`: `memmap2 0.2.3 map of a non-regular file on this host` (not darwin or linux), `std::sys::paths::windows::temp_dir (GetTempPath2W)`,
  `std::env::temp_dir on <platform>` (not darwin, linux or win32). Removed: `rustc_data_structures::memmap::Mmap::map of a non-regular file`.
- New `// PORT:`: pat.ts (the two diagnostics' `bigint` arguments and `pluralize(Number(..))`); memmap.ts (only Node errors caught;
  `map_copy_read_only_ffi`'s constants and copy-then-unmap); env.ts (`confstr`'s capacity; `temp_dir`'s Windows); archive.ts (tempfile's random
  names, and the lossy `TMPDIR`).
- `src/std/env.ts`: `errno_reader` is exported (memmap.ts uses it).

## For root

- Item 5 touches 29 files outside any one crate. Each change is an import line plus a comment. Review should check that the evaluation-order table holds.
- The three cycles in "Other cycles found", if they are to be queued.
