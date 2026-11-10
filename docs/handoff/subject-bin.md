# Handoff: subject-bin (wave 40g; harness batch, needs an independent review)

Branch `t3/2ba7f49e`. No baseline, suite definition, oracle output or runner semantics changed; no ported code. One
`src/` glue file is touched (`src/rust_ts/track_caller.ts`, section 4.1). It is outside the lane's harness/scripts scope,
so it needs root's explicit OK (or a revert, which leaves binary mode unusable for `main.ts`). No `unported(...)` added.

**Bottom line.** Binary mode works and is wired into the gate, difftest and phase-diff, but stays **off by default**
(`DEFAULT_SUBJECT_MODE = "source"`). One difference cannot be removed from the harness side: the build's JS frames are
slightly larger, so it overflows the stack about 0.9% sooner on very deep nesting (section 4.3). Everything else
measured in the audit and the evidence is byte-identical. Root decides whether to switch it on (section 6).

## 1. Files

| file | what |
|---|---|
| `scripts/lib/subject-bin.ts` (new) | builder, cache key, plugin (source rewrites), mode, `subjectCmd`, record |
| `scripts/subject-bin.ts` (new) | CLI: `build [--entry E] [--json]`, `list`, `prune` |
| `scripts/subject-bin.test.ts` (new) | 16 tests: mode, refusal, fallback, rewrites, key, builder on a fixture tree (incl. two processes building one key), prune, raw compare |
| `scripts/subject-bin-compare.ts` (new) | compares two `difftest --raw-subject` dirs process by process |
| `scripts/subject-bin-order.ts` (new) | module evaluation order from source vs from a build, on one command |
| `scripts/oracle-keys.ts` (new) | dumps the oracle key of every registered case |
| `harness/suites.ts` | `bunCmd` → `subjectCmd`; `miriSubjectOf` for miri.ts → `subjectCmd(…, { preload })` |
| `scripts/difftest.ts` | `prepareSubject()` before any case; `subject` in `<suite>.summary.json`; `--raw-subject DIR` |
| `scripts/gate.ts` | `prepareSubject()` before the static steps; `subject` in both gate.json writes |
| `scripts/phase-diff.ts` | subject via `subjectCmd`; prints the build hash in binary mode |
| `src/rust_ts/track_caller.ts` | `frame_file`: a repo-relative frame path is resolved against the repo (section 4.1) |

In source mode every subject command is exactly what it was before: `[bun, <repo>/<entry>, …]`, and for Miri
`[bun, --preload, <repo>/src/rust_ts/miri_stack_first.ts, <repo>/src/miri/bin/miri.ts, …]` (unit-tested).

## 2. Design

- **Mode.** `RUST_TS_SUBJECT=binary|source`; unset → `DEFAULT_SUBJECT_MODE` (`source`). Any other value is an `ERROR:`.
  Binary mode refuses any `BUN_JSC_*` variable in the environment: the bytecode is generated at build time, so e.g.
  `BUN_JSC_useTailCalls=0` (track_caller_check.ts uses it) would be ignored by the binary but not by source, and the key
  does not cover the environment. Measured: with tail calls off, source resolves `-Ztrack-diagnostics` locations and the
  build does not.
- **Entries with a build.** `BINARY_ENTRIES = [src/rust_ts/main.ts, src/miri/bin/miri.ts]`. Every other subject script
  (lexdump, tydump, resdump, mirdump, thirdump, ckdump, escapedump, fluentdump, emitdump, tokdump, symdump, mono-run.ts)
  runs from source in both modes. `scripts/rg-check.ts` (the check-rg suites), `ir-diff.ts`, `ctfe-sample.ts` and
  `miri_program.ts` build their own `bun main.ts` commands and stay on source (not switched; a follow-up could use
  `subjectCmd`).
- **Build.** `Bun.build` with `compile`, `bytecode: true`, `optimize: { bytecode: false }` (section 4.3), `format: esm`,
  `target: bun`, inline sourcemap, `autoloadDotenv/Bunfig: true` (as `bun <entry>`), `autoloadTsconfig/PackageJson: false`,
  the define, banner and plugin of section 4, run with the repo as cwd (so frames read `src/...`). ~3.5 s for main.ts,
  ~160 MB per binary.
- **Key** (`subjectBinKeyOf`): sha1 of `{spec, bun: {version, revision}, builder: sha1(subject-bin.ts), inputs}`. `spec`
  holds every option, the entry, the repo path and the bun path (both are baked in). `inputs` is the bundler's own list
  (metafile, 2,097 files for main.ts, 2,285 for miri.ts) with each file's sha1. The metafile pass costs ~150 ms, so every
  run re-keys from the tree as it is. After the build, its own metafile must list exactly the keyed files, and each file
  must still hash the same; otherwise the build fails.
- **Cache.** `$RUST_TS_DATA/subject-bin/<hash>/{rts,meta.json}`. Built in `.tmp-<hash>-<pid>-<rand>/`, then `rename`d.
  A process that loses the race finds the winner's build and drops its own (tested with two processes). Before a build
  is cached it must answer `--version` exactly as `bun <entry> --version` does (stdout, stderr, exit). Each resolve
  touches `meta.json`. `prune` (and every new build) removes builds unused for 3 days, so a running gate never loses its
  binary.
- **Failure.** A failed build, check, or refusal prints one `ERROR:` line and exits 1, before any case or static step
  runs. There is no fallback to source.
- **Who uses it.** `subjectBin(entry)` runs the CLI synchronously once per process (suites build commands synchronously).
  `prepareSubject()` resolves both entries up front: in `gateRun` (before the static steps, so the frozen-lists step's
  subjects use it too), in `difftest()` and in phase-diff. A difftest called in-process by the gate re-uses the memo.
- **Record.** gate.json `subject: {mode, bins: {entry: hash}}`; difftest `<suite>.summary.json` `subject` likewise;
  difftest and phase-diff print `subject: binary (<entry> <hash12>, …)` in binary mode.

## 3. Oracle keys

No `oracleKey` reads a subject command or a subject-side script. `oracleCacheKey` uses `s.oracle(...)[0]` (for wrappers,
that is bun), `oracleKey()` (rmeta: `rmeta-run.ts`, unchanged; miri, rg, IR, sysroot: oracle side), the file hash,
deps, inputDirs, the split key and the sysroot. `scripts/oracle-keys.ts` dumped all **372,181** keys of every registered
suite (none failed to list):

| dump | sha1 |
|---|---|
| before (HEAD 9015f665's harness) | `5d0766429cc8b685d9c12369a5ae59dd2a5049db` |
| after, `RUST_TS_SUBJECT=source` | `5d0766429cc8b685d9c12369a5ae59dd2a5049db` |
| after, `RUST_TS_SUBJECT=binary` | `5d0766429cc8b685d9c12369a5ae59dd2a5049db` |

`cmp` on the dumps: identical.

## 4. Behaviour audit

How each launch-dependent behaviour was found: a grep of every bundle input (the metafile list, both entries) for
`import.meta`, `Bun.main`, `process.argv`, `execPath`, `execArgv`, `__dirname`, `NODE_ENV`, `.stack`,
`prepareStackTrace`; plus experiments on small fixtures and the real entries.

| behaviour | source (`bun <entry>`) | plain build | what the binary does | evidence |
|---|---|---|---|---|
| `import.meta.dir/path/url/file/dirname/filename` | the file's real path | `/$bunfs/root[/rts]` | plugin replaces each with a same-length call to a hoisted function returning the source's value; columns unchanged. Uses in the bundle: track_caller.ts:106, rustc_session/config.ts:1635 (`.env.local` → host triple), proc_macro_host.ts:70 (TinyCC source), miri_stack_first.ts:10, scripts/lib/common.ts:8 | unit test; `--version` check (host triple); pm-ui (proc macros) identical |
| other `import.meta` uses | — | — | `.main`: the bundler gives it per module (entry true, others false: tested); `.env`: left alone; anything else (`import.meta` as a value, `.resolve`, inside a string) stops the build | unit test |
| `process.argv` | `[bun, <repo>/<entry>, …]` | `["bun", "/$bunfs/root/rts", …]` | banner sets argv[0] and argv[1] to the source values (argv[1] is `args_os()[0]`) | fixture test |
| raw argv (`_NSGetArgv`) | `[bun, entry, args]` (Miri: `bun --preload X entry args`) | `[rts, args]` | unchanged. env.ts reads only the tail (`process.argv.length - 2` entries); stack.ts re-execs `process.execPath` with `argv.slice(1)`, which is right for each | traces, evidence |
| `process.execPath` | bun | the binary | unchanged: stack.ts must re-exec the binary. `LC_MAIN` stacksize of both: 18,874,368 (otool), so `macho_main_stacksize` gives the same | otool |
| `process.execArgv` | `[]` (Miri: preload flag) | `[]` | not read by any bundled module | grep |
| `Bun.main` | `<repo>/<entry>` | `/$bunfs/root/rts` | defined as the entry's real path, so miri_stack_first.ts's check holds and `ensure_stack` runs first, as under `--preload` | order traces (Miri) |
| `process.env.NODE_ENV` | run-time value | inlined `"development"` (`--compile` defines it) | defined to a non-enumerable global getter reading `process.env["NODE_ENV"]` (rustc_middle/ty/list.ts `FREEZE_LISTS`) | fixture test with `NODE_ENV=test` |
| dotenv autoload | `.env`, `.env.local`, `.env.<NODE_ENV>` from the cwd | same | `autoloadDotenv: true`; stack.ts's `settle_environment` removes them as before | experiment: same files loaded with NODE_ENV unset/test/production |
| bunfig / tsconfig / package.json at run time | bunfig from the cwd; TS transpiled with the repo tsconfig | — | bunfig autoload on (as bun); code transpiled at build time with the same tsconfig | — |
| `/bin/sh` + `env -i` re-exec (stack.ts) | re-execs bun with raw argv | — | re-execs the binary; `BUN_JSC_maxPerThreadStackUsage` is a VM option, honoured | deep-nesting runs: same behaviour except the 0.9% (4.3) |
| `bun --preload` re-exec (Miri) | preload module evaluates first | no preload | the bundle's first import is that module, and `Bun.main` is defined (above), so the same modules evaluate first in the same order | `subject-bin-order.ts`: same order, miri-hello and dynamic-drop.rs |
| `bun:ffi` (dlopen, `cc` of proc_macro_host.c, `_NSGetArgv`, `getpwuid`) | — | works in the binary | `cc` gets the real source path (above) | pm-ui sample identical |
| dynamic `import()` | loads at call time | bundled, lazily initialised | main.ts's driver import, `on_stack_overflow`, the shim's common.ts: bundled (the shim's `REPO` comes from the rewritten import.meta.dir) | traces |
| lazy `require()` (~100 sites, trait error reporting, error codes text) | sync load at first call | `__esm` lazy init at first call | same order and values | traces include lazily required modules (dynamic-drop: 2,266 modules) |
| workers | none | — | — | grep |
| files read relative to the source | read live | `/$bunfs` paths | read live from the real paths (the binary is keyed on the tree, the files are the tree's) | — |
| **module evaluation order** | ESM order | **Bun's bundler moves `export * from` after the module's other requests** (src/rustc_abi/lib.ts: `canon_abi.ts`, line 27, evaluated after `callconv.ts`, line 31; 42 trace lines differed) | plugin puts `import "x"; ` before each `export * from "x";` on its line (932 such lines, all in that one-line form; any other form stops the build) | `subject-bin-order.ts`: identical sequences on `--version` (2,080 modules), pm-ui ICE, track.rs, mismatched_types/binops.rs, a mir-o2 case, dynamic-drop.rs and miri-hello (2,265–2,266), each with identical output |
| first-import cycles (`Os`, `MacroKinds`, `InlineAttr`) | ESM: a read before init throws TDZ | top-level `const`/`let` become `var` (undefined, not TDZ) | same order, so a read sees the same binding state; only a read that throws in source would read `undefined` in the build. That is a crash either way, never a MATCH; none showed in the evidence | traces + evidence |
| `Function.name`, frame names | the declared name | the bundler renames colliding top-level names (`foo` → `foo2`; 1,751 in 768 files); `--keep-names` has no effect with `--compile` | not undone. No bundled module reads a function's or class's `.name` for output (grep). track_caller reads frame names only for the panic machinery's frames (std/panic.ts, panicking.ts, result.ts, rustc_span/macros.ts, track_caller.ts): none renamed there except `indent` in track_caller.ts, whose frames are skipped | rename listing; pm-ui ICE identical |
| stack frame paths | absolute | relative to the build's cwd (the repo), via the sourcemap; an absolute form is not possible (tried: `root`, cwd `/`, `//` paths, namespaces, external maps; Bun embeds the map and always prints the relative name) | **4.1** | — |
| `Error.stack` line:col | source TS positions | sourcemap: same positions | plugin rewrites keep every column | identical ICE locations |
| bytecode-time JSC options | read at run time | fixed at build time | `BUN_JSC_*` refused (section 2) | tail-call experiment |
| stack depth | — | — | **4.3** | bisection |
| ICE report file (`rustc-ice-*.txt`) | JS stack with absolute paths | relative `src/...` paths | never compared: every suite sets `RUSTC_ICE=0` and `env.ts` scrubs the caller's (a stray file would fail the run's upstream check anyway) | grep of harness/ and scripts/ |

### 4.1 `track_caller` (the one `src/` change)

`resolve()`/`resolve_panic_stack()` map stack frames to files under `SRC_ROOT` (`import.meta.dir/..`). In the binary,
frames read `src/rustc_errors/diagnostic.ts:…`, so every location was refused ("frame outside src"). That changes
protected output: pm-ui's `tests/ui/resolve/proc_macro_generated_packed.rs` (an ICE MATCH) printed
`rust-ts: the ICE report stopped: location refused` instead of `panicked at /rustc-dev/…/check_packed_ref.rs:51:17`.
`frame_file` now resolves a frame path starting `src/` or `scripts/` against `SRC_ROOT/..`. A source run's frames are
always absolute, so source mode is unchanged (track_caller.test.ts: 22 pass). With it, the pm-ui ICE is identical but
for the thread id that difftest masks, and the `-Ztrack-diagnostics` cases print the same with tail calls on (the
harness's setting).

### 4.2 Known raw differences that cannot reach a MATCH

JS stack *text* printed by a port failure still differs: the `rust-ts: internal compiler error: … <stack>` banner of an
uncaught JS exception, `the ICE report stopped … <stack>`, and the JS backtrace of a double panic or
`RUST_BACKTRACE=1` (which every suite scrubs or sets to 0). The binary prints `src/...` frame paths instead of
absolute ones, and sometimes a renamed function (`dup2`). Only src/std/panicking.ts prints these; making them identical
would mean editing a std port file, which this lane must not do. They appear only when the port crashes (exit 101 with
a JS error), or in reports the harness never compares. So no MATCH can contain them, and their statuses are the same in
both modes. Example (depth-9,000 paren nesting, OOM in `print`): same exit and message, frames
`at print (src/rustc_driver_impl/pretty.ts:336:24)` against `at print (/Users/…/src/rustc_driver_impl/pretty.ts:336:24)`.
In the samples: 2 processes of 7,600 (part A), both DIFF in both modes, neither protected: `mir-o2`
`tests/ui/simd/shuffle.rs#opt` and `thir-tree` `tests/ui/traits/next-solver/cycles/use-impl-to-normalize-own-self-ty-ice.rs#old`.
Each is an ICE whose report prints the JS backtrace (`stack backtrace:` / `note: rust-ts prints the JS stack, not a Rust
backtrace`). Every line is identical but the frames, e.g. `at bug_impl (/Users/…/src/rustc_span/macros.ts:61:11)`
against `at bug_impl (src/rustc_span/macros.ts:61:11)`. The oracle prints Rust frames there, so these cases can never
MATCH. `shuffle.rs` is in no `mir-o2` baseline, and `thir-tree` protects only that test's `#next` revision.

### 4.3 Stack depth (not identical)

The JS stack limit is the same (stack.ts: `BUN_JSC_maxPerThreadStackUsage` = 17 MiB on macOS, capped by `LC_MAIN`), but
the bundle's frames are larger. Deepest `fn main() { let _x = ((…1…)); }` that compiles at `-Zunpretty=normal`
(bisected to ±30–80):

| build | last depth that compiles | vs source |
|---|---|---|
| source | ~10,150–10,170 | — |
| `--compile --bytecode` (Bun's default bytecode optimizer) | ~9,720 | −4.4% |
| `--compile` without bytecode | ~10,060 | −0.9% (and 0.61 s startup: no gain) |
| `--compile --bytecode --no-optimize-bytecode` / `optimize: { bytecode: false }` (**used**) | ~10,060–10,080 | **−0.9%** |

Between those depths, source compiles and the binary dies by SIGBUS (exit 138). The rest (bundled code shape: direct
bindings, `var` for `const`) cannot be removed from the harness. Note `optimize: { bytecode: false }` is undocumented
`Bun.build` API (found from the CLI flag; checked by its effect on depth). A Bun upgrade changes the key, but should
be re-measured.

Protected cases near that edge: a static scan of every protected `.rs` input (26,594 files) for nesting ≥ 200,
≥ 200 `else if`, long operator chains or > 300 KB flagged six `tests/ui` files (`issue-93775.rs`, `expr-stack-overflow.rs`,
`survive-peano-lesson-queue.rs`, `super-fast-paren-parsing.rs`, `slowparse-{string,bstring}.rs`), plus library files
(the heavy library suites run in full in the evidence). Each was run in both modes in every main.ts/Miri suite that
protects it, both modes (difftest `--filter` on the file): **55 suite/file pairs, every one MATCH in both modes and
byte-identical** (expr-stack-overflow.rs in `mir`: 6–7 s, no overflow either way). The 0.9% gap is therefore not
reached by any protected case today, but a future case (or a port change that makes the source use more stack) within
~1% of the limit could flip from MATCH to a binary-only SIGBUS. A gate in binary mode would show that as a lost case,
and `RUST_TS_SUBJECT=source` tells the two apart.

## 5. Evidence

All runs on AC power, one difftest at a time, `--sample 200 --jobs 12`, seed `RUST_TS_AGENT=subject-bin`, run ids
`subject-bin-{source,binary}-<suite>`; raw records compared with `scripts/subject-bin-compare.ts`. "same" = byte-identical
command (normalised), exit, stdout and stderr; "pid" = identical but for a panic's thread id.

Part A: every protected suite but `run-pass-miri-heavy` (59 suites, 7,600 processes per mode), on the build with
hash `94aecb0b99cf` (main.ts) and its miri.ts sibling (commit bb3c6948). Raw records:
`/private/tmp/claude-501/-Users-tomernorman--t3-worktrees-rust-ts-t3-2ba7f49e/b89dc889-756d-4428-a287-a42ceaee703d/scratchpad/evidence/`
(`raw/{source,binary}/<suite>/`, `cmp-<suite>.txt`, `times.tsv`). MATCH counts are identical in every suite.

"wall s" is the difftest wall time (oracle mostly cached); "subject-s" is the summed wall time of the subject processes,
the part a binary changes. Suites marked "source (unchanged)" run the same command in both modes; their rows measure noise.

| suite | subject | MATCH src/bin | wall s src/bin | subject-s src/bin | processes | same | pid-masked | differs |
|---|---|---|---|---|---|---|---|---|
| borrowck-ui | source (unchanged) | 200/200 of 200 | 29/29 | 334.9/328.6 | 200/200 | 200 | 0 | 0 |
| borrowck-ui-report | source (unchanged) | 200/200 of 200 | 31/36 | 355.2/365.8 | 200/200 | 200 | 0 | 0 |
| check-alloc | main.ts | 1/1 of 1 | 16/18 | 15.5/17.0 | 1/1 | 1 | 0 | 0 |
| check-core | main.ts | 1/1 of 1 | 82/85 | 81.4/83.2 | 1/1 | 1 | 0 | 0 |
| check-rg | source (unchanged) | 36/36 of 36 | 57/58 | 56.2/56.9 | 1/1 | 1 | 0 | 0 |
| check-rg-encode-mir | source (unchanged) | 36/36 of 36 | 77/78 | 75.9/77.3 | 1/1 | 1 | 0 | 0 |
| check-rg-host | source (unchanged) | 36/36 of 36 | 58/58 | 56.4/56.6 | 1/1 | 1 | 0 | 0 |
| check-std | main.ts | 1/1 of 1 | 18/19 | 17.1/18.1 | 1/1 | 1 | 0 | 0 |
| check-ui | main.ts | 200/200 of 200 | 25/8 | 297.2/79.2 | 200/200 | 200 | 0 | 0 |
| check-ui-encode-mir | main.ts | 146/146 of 146 | 19/6 | 206.6/58.1 | 146/146 | 146 | 0 | 0 |
| emit | source (unchanged) | 200/200 of 200 | 1/1 | 0.2/0.2 | 2/2 | 2 | 0 | 0 |
| escape | source (unchanged) | 200/200 of 200 | 1/1 | 0.1/0.0 | 2/2 | 2 | 0 | 0 |
| escape-synthetic | source (unchanged) | 11/11 of 11 | 0/1 | 0.0/0.0 | 1/1 | 1 | 0 | 0 |
| expanded | main.ts | 200/200 of 200 | 23/7 | 252.1/60.0 | 200/200 | 200 | 0 | 0 |
| expanded-nocore | main.ts | 200/200 of 200 | 22/5 | 227.4/35.0 | 200/200 | 200 | 0 | 0 |
| fluent-format | source (unchanged) | 200/200 of 200 | 0/1 | 0.1/0.1 | 2/2 | 2 | 0 | 0 |
| fluent-parse | source (unchanged) | 200/200 of 200 | 1/1 | 0.1/0.1 | 2/2 | 2 | 0 | 0 |
| hir-tree | main.ts | 200/200 of 200 | 22/8 | 252.7/62.5 | 200/200 | 200 | 0 | 0 |
| hir-tree-nocore | main.ts | 200/200 of 200 | 20/6 | 227.0/36.6 | 200/200 | 200 | 0 | 0 |
| lex | source (unchanged) | 200/200 of 200 | 0/1 | 0.1/0.1 | 2/2 | 2 | 0 | 0 |
| mir | main.ts | 200/200 of 200 | 29/12 | 316.5/122.0 | 200/200 | 200 | 0 | 0 |
| mir-alloc | main.ts | 200/200 of 200 | 18/20 | 17.0/18.7 | 1/1 | 1 | 0 | 0 |
| mir-core | main.ts | 200/200 of 200 | 79/86 | 78.8/84.3 | 1/1 | 1 | 0 | 0 |
| mir-minicore | main.ts | 46/46 of 46 | 7/3 | 60.7/14.8 | 46/46 | 46 | 0 | 0 |
| mir-o0 | main.ts | 46/46 of 46 | 6/3 | 59.4/14.6 | 46/46 | 46 | 0 | 0 |
| mir-o2 | main.ts | 199/199 of 200 | 37/23 | 422.4/212.6 | 200/200 | 199 | 0 | 1 |
| mir-opt-o4 | main.ts | 199/199 of 200 | 33/17 | 391.2/185.0 | 200/200 | 200 | 0 | 0 |
| mir-std | main.ts | 200/200 of 200 | 20/21 | 18.7/20.0 | 1/1 | 1 | 0 | 0 |
| mirdump-minicore | source (unchanged) | 46/46 of 46 | 6/7 | 60.7/61.4 | 46/46 | 46 | 0 | 0 |
| mirdump-ui | source (unchanged) | 200/200 of 200 | 29/30 | 337.5/339.5 | 200/200 | 200 | 0 | 0 |
| miri-hello | miri.ts | 1/1 of 1 | 2/2 | 1.0/0.6 | 1/1 | 1 | 0 | 0 |
| miri-pass | miri.ts | 196/196 of 200 | 85/76 | 894.4/741.9 | 200/200 | 199 | 1 | 0 |
| miri-pass-heavy | miri.ts | 5/5 of 8 | 120/128 | 119.2/126.8 | 8/8 | 8 | 0 | 0 |
| mono-ui | source (unchanged) | 200/200 of 200 | 41/41 | 456.7/461.8 | 200/200 | 200 | 0 | 0 |
| parse | main.ts | 200/200 of 200 | 19/4 | 215.1/26.7 | 200/200 | 200 | 0 | 0 |
| parse-ui | main.ts | 200/200 of 200 | 19/3 | 214.0/27.6 | 200/200 | 200 | 0 | 0 |
| pm-expanded | main.ts | 199/199 of 200 | 28/12 | 259.7/69.9 | 200/200 | 200 | 0 | 0 |
| pm-ui | main.ts | 199/199 of 200 | 31/15 | 300.8/95.4 | 200/200 | 199 | 1 | 0 |
| resdump | source (unchanged) | 200/200 of 200 | 23/23 | 248.3/248.4 | 200/200 | 200 | 0 | 0 |
| resdump-nocore | source (unchanged) | 200/200 of 200 | 20/21 | 222.9/228.5 | 200/200 | 200 | 0 | 0 |
| rmeta-alloc | main.ts | 200/200 of 200 | 16/18 | 15.5/17.3 | 1/1 | 1 | 0 | 0 |
| rmeta-core | main.ts | 200/200 of 200 | 82/87 | 80.8/84.8 | 1/1 | 1 | 0 | 0 |
| rmeta-std | main.ts | 200/200 of 200 | 18/19 | 16.9/18.5 | 1/1 | 1 | 0 | 0 |
| rmeta-ui | main.ts | 200/200 of 200 | 26/8 | 291.3/81.6 | 200/200 | 200 | 0 | 0 |
| run-fail-miri | miri.ts | 200/200 of 200 | 104/95 | 902.5/757.1 | 200/200 | 200 | 0 | 0 |
| run-pass-aux-miri | miri.ts | 200/200 of 200 | 58/41 | 652.0/467.2 | 200/200 | 200 | 0 | 0 |
| run-pass-miri | miri.ts | 200/200 of 200 | 63/46 | 720.7/506.6 | 200/200 | 200 | 0 | 0 |
| symbols | source (unchanged) | 10/10 of 10 | 1/1 | 0.3/0.3 | 10/10 | 10 | 0 | 0 |
| thir-tree | main.ts | 199/199 of 200 | 38/24 | 336.9/130.5 | 200/200 | 199 | 0 | 1 |
| thirdump-minicore | source (unchanged) | 46/46 of 46 | 5/7 | 56.8/57.7 | 46/46 | 46 | 0 | 0 |
| thirdump-ui | source (unchanged) | 199/199 of 200 | 34/35 | 318.0/315.3 | 200/200 | 199 | 1 | 0 |
| tokens | source (unchanged) | 200/200 of 200 | 1/2 | 0.4/0.4 | 2/2 | 2 | 0 | 0 |
| tokens-str | source (unchanged) | 39/39 of 39 | 1/1 | 0.1/0.1 | 1/1 | 1 | 0 | 0 |
| tydump-minicore | source (unchanged) | 46/46 of 46 | 6/7 | 58.3/58.7 | 46/46 | 46 | 0 | 0 |
| tydump-nocore | source (unchanged) | 200/200 of 200 | 21/22 | 237.2/232.9 | 200/200 | 200 | 0 | 0 |
| tydump-ui | source (unchanged) | 199/199 of 200 | 36/36 | 337.9/328.6 | 200/200 | 199 | 1 | 0 |
| unpretty-expanded | main.ts | 200/200 of 200 | 23/8 | 253.1/60.5 | 200/200 | 200 | 0 | 0 |
| unpretty-expanded-nocore | main.ts | 200/200 of 200 | 21/5 | 227.3/34.9 | 200/200 | 200 | 0 | 0 |
| unpretty-hir | main.ts | 200/200 of 200 | 23/7 | 252.5/63.0 | 200/200 | 200 | 0 | 0 |
| **total** | | | **1731/1443** | **11910/7652** | | | | |

Totals by subject: main.ts suites (29): subject-s 5,406 → 1,832 (−66%), wall 820 → 557 s. miri.ts suites (6, without
run-pass-miri-heavy): 3,290 → 2,600 (−21%; Miri cases are long). Unchanged suites: 3,214 → 3,219.

Differences: `mir-o2` 1 and `thir-tree` 1 (section 4.2, never-MATCH JS backtrace text); `pid-masked` 4 (thread id only,
which difftest masks). Nothing else.

Determinism: the first, mis-filtered run of the deep phase reran the same 200-case samples of 23 suites three more times
in both modes (a zsh quoting slip dropped `--filter`; that run was discarded and redone). The counts were the same each
time, with `shuffle.rs#opt` the only difference each time.

Part B (deep nesting): section 4.3. Part C: `run-pass-miri-heavy` (8 cases, heavy, one at a time; source and binary halves run as separate tasks):
MATCH 6/6 protected in both modes, the 6 byte-identical; the other 2 time out in both modes (not compared). Wall 4,033 s
source, 4,100 s binary (the cases are long interpretations; startup does not matter there). Raw records under
`…/scratchpad/evidence-heavy/`.

Every run left the upstream checkout clean (`git -C $RUST_TS_DATA/rust status --short` empty after each phase).
Before these, my ad-hoc runs (the `-Ztrack-diagnostics` checks and the first order-tool runs, with the upstream checkout
as cwd and no `RUSTC_ICE=0`) left four `rustc-ice-*.txt` files there (22:09–22:19). Root moved them to
`$RUST_TS_DATA/tmp/upstream-strays/`. `scripts/subject-bin-order.ts` now defaults to a temp cwd and sets `RUSTC_ICE=0`.

An earlier run on the optimized build (before bb3c6948) covered borrowck-ui-report, borrowck-ui and check-alloc, all
identical; it was stopped when 4.3 was found.

Projected gate effect (an estimate, not measured): the main.ts suites took about 23,000 s (6.4 h) of the last gate
(gate-20261109-084958-root-eit4 summaries), nearly all of it subject time at 12 jobs with the oracle cached. The samples
cut main.ts subject time by 66%, so about 3.5–4 h less. Sample wall times fall less (−32%) because 200-case runs are
dominated by fixed per-run costs. The Miri suites gain ~20% of their subject time.

## 6. How root switches it on

- For one gate: `RUST_TS_SUBJECT=binary bun scripts/gate.ts run …`. The gate prints `note: subject binary (…)`, and
  gate.json `subject` records the hashes. Unset any `BUN_JSC_*` first.
- For everything: set `DEFAULT_SUBJECT_MODE = "binary"` in scripts/lib/subject-bin.ts (a reviewed harness change).
- Back to source at any time: `RUST_TS_SUBJECT=source`.
- Before switching, decide on 4.3 (the 0.9% depth gap) and accept or revert 4.1. Disk: ~160 MB per build kept 3 days
  after last use (`bun scripts/subject-bin.ts list|prune`).

## 7. Decisions (`// PORT:`-like) and follow-ups

- The `src/rust_ts/track_caller.ts` edit (4.1) is outside this lane's harness/scripts scope; it is glue, not port logic,
  and changes nothing in source mode. Root: accept or revert.
- Follow-ups: switch `rg-check.ts`, `ir-diff.ts`, `ctfe-sample.ts` to `subjectCmd`; consider builds of the dump entries
  (tydump, resdump, … ~2,000 s per 21.5k-case suite); a fix in src/std/panicking.ts (absolute frame paths in crash
  text, 4.2) if those raw differences matter.
