# Handoff: harness-w21 (M4a suites `mirdump-minicore`, `mirdump-ui`; mirdump probe; phase-diff MIR stage; harness batch, needs an independent review)

Branch `lane/harness-w21`, base `970d2365`. No ported upstream code: no coverage numbers, no `// rustc:` markers, no
`// PORT:`. `src/rust_ts/mirdump.ts` (new, our own driver code) has 4 `unported(...)` seams (below). Baselines, oracle
outputs, existing probes and the existing suites are unchanged (proof in §5). The two new suites start unprotected.
mir-contract had committed nothing (its worktree is at the base), so the MIR printing is a seam for root.

## Files touched
- `tools/probes/mirdump/{Cargo.toml.in,main.rs}` (new probe; rustc-dev; reuses `../tydump/prefix.rs` via `#[path]`).
- `src/rust_ts/mirdump.ts` (new): the port-side driver, step by step as the probe.
- `harness/suites.ts`: `m3UiCorpus(dirs, dumpTests = true)` (the new flag leaves out the `#[rustc_dump_*]` tests; memo
  key unchanged for the default); new block "M4a" with `mirdump-minicore`, `mirdump-ui`, `M4A_UI_DIRS`,
  `M4A_UI_UNSTABLE`.
- `scripts/lib/mir-dump.ts` (new) + `scripts/lib/mir-dump.test.ts` (new, 5 tests): dump dirs in pass order, first difference.
- `scripts/phase-diff.ts`: new `mir-dump` stage (D11).
- `scripts/unstable.test.ts`: expects `mirdump-ui` among the suites with an unstable list (4 entries with reasons).
- `docs/state/{current.json,history.jsonl}`: 3 decisions (corpus, probe design, phase-diff stage). Expect the usual merge conflict.

## 1. The probe (`tools/probes/mirdump`, plan-m4 D2)
Its header documents everything; in short:
- Driver setup as tydump (logger, ICE hook, `catch_with_exit_code(compiler_entrypoint)`), stop in `after_expansion`.
- `config`: `trimmed_def_paths = true` (as `TimePassesCallbacks`); `unstable_opts.unpretty = Some("mir")`;
  `override_queries` wrapping `mir_built` and `mir_promoted`.
  - **unpretty:** `MirWriter` prints with trimmed paths (as `-Zunpretty=mir` does). The `trimmed_def_paths` query then
    calls `Session::record_trimmed_def_paths`. On a crate with no diagnostic, that arms the "`trimmed_def_paths` called,
    diagnostics were expected but none were emitted" ICE, unless `unstable_opts.unpretty` is set. At the pin that field
    is `[UNTRACKED]` and read only there (grep of `compiler/`: `session.rs:679` and the option parser `config.rs:3127`,
    which has already run before `config`). `opts.pretty` stays `None`, so the driver path is unchanged.
  - **Recording:** each wrapper calls rustc_mir_transform's provider and stores a `Clone` of the value. No query runs
    and no value changes. A fed `mir_built` (coroutine-closure by-move bodies) is read from the query itself.
- Steps: (1) the tydump prefix; (2) the `MIR_borrow_checking` loop (passes.rs:1163) verbatim, minus `mir_borrowck`,
  `check_transmutes`, `mir_drops_elaborated_and_const_checked` and the coroutine `layout_of`. `check_unsafety`,
  `is_trivial_const`, `check_offloads`, `has_ffi_unwind_calls` and `check_liveness` run as upstream; (3) the dump.
- **The dump.** It runs after the loop. For every `mir_keys` item, in order, items are separated by a blank line:
  - a trivial const: `write_mir_pretty`'s one-liner;
  - a constructor: `// mir_for_ctfe` + `write_mir_fn(mir_for_ctfe)`;
  - otherwise: `// mir_built` + `write_mir_fn`, a blank line, `// mir_promoted` + `write_mir_fn`, then each promoted
    fragment after a blank line.

  It prints even when there were errors, as tydump does.
- **Deviation from D2's wording (recorded decision).** D2 prints where `mir_borrowck` was. The probe prints after the
  loop, from the recorded copies, so the output is in `mir_keys` order. Printing in the loop cannot work: by then
  `mir_built` is often stolen, by `check_liveness` → `mir_promoted`, and for consts used in types by CTFE during typeck
  (`mir_drops_elaborated…` steals even `mir_promoted`). The copies are exactly what `mir_built(def).borrow()` and
  `mir_promoted(def)` gave before they were stolen.
- **Verified to be the real MirWriter text.**
  - **Method:** for each sample case, the plain oracle rustc ran with the same argv plus
    `-Zdump-mir=all -Zdump-mir-exclude-pass-number` (out dir redirected). For every item, the body of these dump files
    must appear verbatim in the probe's stdout:
    - `<item>.SimplifyCfg-initial.after.mir` (= `mir_built`'s value);
    - `<item>.analysis.after.mir` (= `mir_promoted`);
    - `<item>-promoted[N].ImpossibleClauses.before.mir` (the promoted fragments).

    AllocIds were normalized for this check only (their numbers follow query order, D13). The tools are
    `.data/scratch/hw21/{verify.py,tools/verify-cases.ts}`, with results in `verify-cases.txt`.
  - **Result:** every dump body was found in 43 of 44 cases. The cases were mini_core.rs (166 bodies) and 40 mirdump-ui
    cases spread over all its directories, plus two hand-written files: one with a non-trivial const used in an array
    length, a static, promoteds, a closure and constructors; one with an async closure, where the by-move body takes the
    fed path. The hand-written files' constructor sections and trivial-const one-liners also appear verbatim in
    `-Zunpretty=mir`'s output.
  - **The 44th case, mini_core_hello_world.rs.** 73 of 77 dump bodies were found. Of the other 4:
    - 2 are `{global_asm#0}`. `mir_keys` excludes it by design, so the probe correctly does not print it.
    - 2 are `main` (`mir_built` and `mir_promoted`). Their text is identical. Their allocation blocks are the same set,
      but sorted differently: `write_allocations` sorts by AllocId, and the ids are numbered in a different order. That
      is the expected D13 effect. The port must match the probe's numbering.

## 2. Port side (`src/rust_ts/mirdump.ts`)
- **Structure:** thirdump.ts's (shim/stub/port, `ensure_stack`, exit codes), with `make_callbacks`,
  `override_queries`, `mir_borrow_checking` and `dump` mirroring the probe statement by statement. The prefix is
  tydump_dump.ts's. `RUST_TS_IMPL=shim` output is byte-identical to the probe's (checked).
- **Seams (`MirSeams`, `load_seams()`; each is `unported` now). Root wires them when mir-contract lands:**
  - `write_mir_fn(tcx, body)` → `MirWriter::new(tcx).write_mir_fn` (mir/pretty.rs:393), into a string;
    `unported("rustc_middle::mir::pretty::MirWriter::write_mir_fn (lane mir-contract; mirdump seam)")`.
  - `clone_body` / `clone_promoted` → codegen `clone_Body` (D3); `unported("Clone for rustc_middle::mir::Body …")`,
    `unported("Clone for IndexVec<Promoted, mir::Body> …")`.
  - `display_const_val(val, ty)` → `{}` of `mir::Const::Val` (`pretty_print_const_value`);
    `unported("Display for mir::Const::Val …")`.
  - The `Body` type is `unknown` until mir-contract declares it (`mir_built`'s generated value type is `Steal<unknown>`
    today).
- **Where the port stops today:** the first not-ported query, almost always `check_unsafety provider (not ported)`
  (§4). The seams are not reached yet.

## 3. Suites
| suite | cases | skipped | oracle | subject | timeouts (subject/oracle) |
|---|---|---|---|---|---|
| `mirdump-minicore` | 46 (`minicoreCorpus`, as tydump-minicore) | 589 (same list) | probe mirdump | src/rust_ts/mirdump.ts | 60 s / 300 s |
| `mirdump-ui` | 1347 | 16 | probe mirdump | src/rust_ts/mirdump.ts | 60 s / 300 s (M3 ui's) |

- **mirdump-ui corpus.** It is plan-m4 §4's: tests/ui/{borrowck 521, nll 439, mir 212, mir-dataflow 6, liveness 25,
  unsafe 37, pattern/usefulness 107} (cases with revisions; 182 revision cases).
  - Everything else is tydump-ui's: compiletest argv (human, `-Znext-solver=coherence`, revisions, env), aux crates
    built by the oracle as rmeta (18 cases), skips. It goes through `m3UiCorpus(M4A_UI_DIRS, false)`, without the
    rustc_dump tests.
  - **Root:** the brief said "(the tydump-ui corpus)", but the accepted §4 table defines these directories. I followed
    §4 (recorded decision). Switching is one line.
- **Subsets:** one per directory (difftest prints them). **Blessed:** `--report blessed`, report only.
- **Skips (16).** All are compiletest.ts's existing reasons:
  - 9 `needs-unwind`;
  - 2 `needs-rustc-debug-assertions`;
  - 1 `needs-asm-support`;
  - 1 proc-macro aux;
  - 1 `add-minicore`;
  - 2 ignored on x86_64-linux.
- **Unstable.**
  - **Method:** the oracle ran twice on every case of both suites (same binary, argv, env, cwd;
    `.data/scratch/hw21/tools/oracle2.ts`).
  - **mirdump-minicore:** 0.
  - **mirdump-ui:** 4, all `thread 'rustc' (<tid>) panicked` in tests that ICE by design (`failure-status: 101`):
    - `tests/ui/mir/lint/{no-storage,storage-live,storage-return}.rs` (`-Zlint-mir`);
    - `tests/ui/mir/validate/call-move-arg.rs` (`-Zvalidate-mir`).

    They are listed in `M4A_UI_UNSTABLE` with that reason. difftest's pattern detection would have caught them too.
- **Upstream checkout:** clean after every run (`git status --ignored`, `build/` excluded: 0 paths). difftest's own
  check printed no `ERROR:`.

## 4. Numbers
**Oracle side** (oracle2 scan; wall time per run on this 12-core Mac, 10 jobs):

| suite | exit 0 | exit 1 | exit 101 | stdout non-empty | oracle timeouts | unstable | max time |
|---|---|---|---|---|---|---|---|
| mirdump-minicore | 14 | 32 | 0 | 34 | 0 | 0 | 0.08 s |
| mirdump-ui | 1138 | 205 | 4 | 1337 | 0 | 4 | 1.37 s |

- mini_core.rs prints 85,696 bytes of MIR, and mini_core_hello_world.rs prints 219,000 (exit 0 for both).

**difftest, full runs.**

| suite | MATCH | DIFF | UNPORTED | UNSTABLE | CRASH/TIMEOUT | run |
|---|---|---|---|---|---|---|
| mirdump-minicore | 10 | 0 | 36 | 0 | 0 | `20261021-172844-harness-w21-l26r` |
| mirdump-ui | 2 | 0 | 1341 | 4 | 0 | `20261021-172902-harness-w21-0jor` |

- The 10 minicore MATCHes are fatal early errors with empty stdout. The 2 ui MATCHes are
  `mir/enable_passes_validation.rs#{empty,unprefixed}` (option errors).
- mirdump-ui subsets: every subset is 0% except mir (2/212).
- Blessed (report only): PASS 2, FAIL 652, NOT_COVERED 683, N/A 10.
- mirdump-ui took 7.5 min wall for the full run with a cold oracle cache.

**Top UNPORTED stops.**
- mirdump-ui:

  | count | stop |
  |---|---|
  | 1217 | `check_unsafety provider (not ported)` |
  | 86 | `mir_borrowck provider (not ported)` (reached from typeck, opaque types) |
  | 26 | `TyCtxt::const_eval_resolve_for_typeck` |
  | 10 | `const_eval_poly` |
  | 1 | `rustc_interface::passes::analysis (M3+)` (`-Zunpretty=mir-cfg` test) |
  | 1 | `DeprecationEntry::external` |
- mirdump-minicore:

  | count | stop |
  |---|---|
  | 29 | `check_unsafety provider` |
  | 6 | `mir_keys provider` |
  | 1 | `const_eval_poly` |

## 5. Existing suites unchanged (proof)
- **Method:** `.data/scratch/hw21/tools/hash.ts` loads `harness/suites.ts` from the base tree (`git archive 970d2365`,
  `.data/scratch/hw21/base`) and from the lane, each in its own process, with the shared data dir.
- **What it records per case:** `{file, args, env, oracle([c]), subject([c]), subset membership, blessed(c)}`.
- **What it records per suite:**
  - metadata: milestone, description, mode, cwd, timeouts, probes, `readsOnlyCaseFile`, key set, subset names, and
    the batch commands;
  - `skipped()` and `unstable()`.
- **Comparison:** `tools/cmp.ts`. The tree root is normalized.
- **Result:** all 26 existing suites are IDENTICAL, case by case, including metadata, skips and unstable lists. The
  only additions are `mirdump-minicore` (46) and `mirdump-ui` (1347).
- No oracle cache key of an existing suite changes, since their inputs are identical. No existing probe was rebuilt.

## 6. phase-diff MIR stage (D11)
- **New stage `mir-dump`** (before `mir`). Both sides run `-Zunpretty=mir -Zdump-mir=all
  -Zdump-mir-exclude-pass-number -Zdump-mir-dir=$RUST_TS_DATA/phase-diff/mir-dump/{oracle,subject}`. Both dirs are
  emptied first; the cwd and out dir are as the other stages, so nothing is written into the checkout.
- **Report:** `scripts/lib/mir-dump.ts` `firstDumpDifference` gives the first file, in pass order, that differs
  (with its first differing line), that the subject did not write, or that only the subject wrote (if written earlier).
  - Pass order is the files' mtime order, in ns. rustc creates, writes and closes each dump before the next pass;
    ties are broken by name.
  - The stage prints `ok mir-dump (N files)` or one `DIVERGES at phase 'mir-dump' … file <f> (<kind>; k of the
    oracle's N files matched before it), line L` with the two lines. For an unported subject it also prints the
    unported line.
  - The stdout/stderr comparison stays in `mir`.
- **Checked:**
  - `--impl shim` on a test file: all phases ok, `mir-dump (524 files)`.
  - Two oracle dump dirs of a file and a one-constant variant: reported `a.f.built.after.mir`, differs, line 49
    (`const 1_usize` | `const 2_usize`), after 163 matching files.
  - `--impl port` stops at `thir` today, as before.
  - The upstream checkout stayed clean.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `bun test scripts harness`: 39 pass, 0 fail (34 + 5 new). `bun test tools`: 50 pass, 0 fail.
- `bun scripts/probes.ts build mirdump` built the new probe in the shared data dir (it is new and not used by any
  existing suite). No other probe was touched.

## Notes for root
- After merging, the probe is already built in the shared `.data` (`target/probes/release/mirdump`). On another
  machine: `bun scripts/probes.ts build mirdump`.
- **The seams in §2** are the mir-contract integration points. Once they are wired, MIR text differences show up as DIFF.
  `phase-diff`'s `mir-dump` then needs the port's `-Zdump-mir` (D11, waves 21–22).
- **Printing despite errors** (as tydump) makes error bodies (`construct_error`) part of the comparison. If root prefers
  thirdump's `abort_if_errors()` before the dump, it is one line in both the probe and mirdump.ts. It would change only
  the 205 exit-1 ui cases' stdout.
- **The probe's stderr** has the diagnostics of MIR building, unsafety, MIR lints and liveness, but not borrowck's.
  So the blessed report is mostly FAIL or NOT_COVERED by construction (the ckdump suites cover borrowck, M4b).
