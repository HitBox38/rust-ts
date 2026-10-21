ACCEPT-WITH-NOTES

# Review: harness-w21 (`lane/harness-w21`, `970d2365..4d32f3bf`)

Reviewer: review-harness-w21 (independent, read-only on `.data/lanes/harness-w21`, HEAD `4d32f3bf`, clean tree; one
commit).

All scratch work is under `.data/scratch/review-hw21/`:
- `base/`, `head/` are `git archive` copies of the two trees.
- `data/` is a private data dir with its own empty oracle cache. `rust`, `aux` and `probes` are symlinks to the shared
  dirs. `target/probes/release/mirdump` points to **my own build** of the probe (`target/`, built from `head/`'s
  source with probes.ts's flags). Nothing was written to the shared probes, the shared oracle cache or the shared
  `phase-diff` dir.
- The tools are in `tools/` (`hash.ts`, `cmp.ts`, `verify.ts`, `unp.ts`, `twice.ts`, `peek.ts`, `runrustc.ts`).

**Scope:**
- `tools/probes/mirdump/{main.rs,Cargo.toml.in}`, `src/rust_ts/mirdump.ts`;
- `harness/suites.ts` (M4a block, `m3UiCorpus(dirs, dumpTests)`);
- `scripts/lib/mir-dump.ts` (+ test), `scripts/phase-diff.ts`, `scripts/unstable.test.ts`;
- `docs/state` (3 decisions; `current.json` timestamp/coverage only), the handoff.

No baseline, oracle-output or existing-probe change: `git diff --stat` on `harness/baseline` and `tools/probes` shows
only the new `mirdump/` files.

## 1. Existing suites unchanged: verified
- **Method:** `tools/hash.ts` imports `<tree>/harness/suites.ts`, once for base and once for head, each in its own bun
  process, with the shared `RUST_TS_DATA`. It records:
  - per case: `{case (id, file, args, env), oracle([c]), subject([c]), subset membership, blessed(c)}`;
  - per suite: metadata (milestone, description, mode, timeouts, cwd, probes, `readsOnlyCaseFile`, subset names, and
    the batch commands), `skipped()` and `unstable()`.

  The tree root is normalised.
- **Result:**
  - all 26 existing suites are IDENTICAL, case by case and in metadata, skips and unstable lists;
  - the only additions are `mirdump-minicore` (46) and `mirdump-ui` (1347);
  - the `m3UiCorpus` memo key is unchanged for the default `dumpTests = true`.
- **Shared probes:** every binary in `.data/target/probes/release` keeps its Oct 15 mtime except the new `mirdump`
  (Oct 21 20:19). No other probe was rebuilt.

## 2. The mirdump probe against D2 and upstream: faithful (design deviation endorsed)
**Loop.** `mir_borrow_checking` is passes.rs:1163–1199 statement for statement, without:
- `mir_borrowck` and `check_transmutes`;
- the `mir_drops_elaborated_and_const_checked` arm;
- the coroutine `layout_of`.

`check_unsafety`, `is_trivial_const`'s early return, `check_offloads`, `has_ffi_unwind_calls` and `check_liveness`
are kept, in upstream's order.

**Printing after the loop from copies (deviation from D2's wording): correct and necessary.**
- `mir_promoted` (rustc_mir_transform lib.rs:434) does `tcx.mir_built(def).steal()`.
- `check_liveness` reaches `mir_promoted`, and so do typeck-time CTFE and `mir_borrowck` upstream.
- So `mir_built(def).borrow()` "at the `mir_borrowck` position" would already be stolen: D2 as written cannot be
  implemented.
- The `override_queries` wrappers clone the value right as the provider returns it. After that, a `Steal` value is
  only reachable through `&` until `steal()`, so the copy is exactly the observable value of the query.
- Printing in `mir_keys` order (an `FxIndexSet`) after the loop makes the layout independent of evaluation order. The
  `HashMap` in `RECORDED` is only used for lookups.

**`unstable_opts.unpretty = Some("mir")`.** I grepped `compiler/` for `unpretty`:
- the session field is read only at session.rs:679 (`record_trimmed_def_paths`) and config.rs:3127 (option
  parsing, already done before `config`);
- `opts.pretty` is untouched.

The claim holds.

**Printed bodies are what `-Zdump-mir` shows.**
- **Method:** I built my own copy of the probe. Plain oracle rustc ran with the case argv (out dir redirected) plus
  `-Zdump-mir=all -Zdump-mir-exclude-pass-number -Zdump-mir-dir=<tmp>`.
- **What was compared:** for every
  - `<item>.SimplifyCfg-initial.after.mir` (= `mir_built`'s value: the last pass of `mir_built` is
    `Lint(SanityCheck)`, which does not dump or mutate),
  - `<item>.analysis.after.mir` (= `mir_promoted`'s phase-change dump),
  - and the earliest-written dump of each `<item>-promoted[N]`,

  the body (after the header and the `| User Type Annotations` block, which `write_mir_fn` does not print) had to
  occur verbatim in the probe's stdout, and was then removed.
- **Normalisation:** AllocIds only (D13).
- **Leftovers:** I inspected what remained of the probe's stdout by hand.

| set | cases | dump bodies found | missing |
|---|---|---|---|
| mirdump-minicore #0 mini_core.rs | 1 | 166/166 | 0 |
| mirdump-minicore #1 mini_core_hello_world.rs | 1 | 82/86 | 4 (see below) |
| mirdump-ui, every 54th case (ids 3, 57, …, 1299; all 7 dirs) | 25 | 240/240 | 0 |
| hand-written: non-trivial const in an array length, static, promoted, ctors, async fn, async closure (fed by-move `{synthetic#0}` body) | 1 | all built/analysis bodies + `{synthetic#0}.built.after` (the fed body) + `main-promoted[0]` | 0 |

- **hello_world's 4 misses:**
  - 2 are `{global_asm#0}`, which `mir_keys` excludes.
  - The other 2 are `main`. For both, the fn text is identical after normalisation; the allocation blocks are the
    same set in a different order (`write_allocations` sorts by AllocId; numbering follows query order, D13).
  - This confirms the handoff. Real rustc exits 1 on this file only from `missing optimized MIR` at codegen.
- **Promoteds:** an `--emit=metadata` compile never runs `promoted_mir`, so those cases have no promoted dumps. I
  re-ran 4 ui cases and mini_core.rs with `--emit=mir` added. nll/constant.rs's 2 promoted fragments, and the hand
  file's, match the first dump of each fragment.
- **Leftovers** were only section markers, trivial-const one-liners and constructor `// mir_for_ctfe` sections. I
  checked those against `-Zunpretty=mir` (with D14's `-o` dropped) in 6 cases:
  - mini_core.rs: 5/5;
  - nll/constant.rs: 1/1;
  - mir/enum/with_niche_int_ok.rs: 2/2;
  - mir_dynamic_drops_1: 1/1;
  - issue-54556-niconii#edition2024: 1/1;
  - borrowck-closures-slice-patterns-ok: 7/7.

  The other 2 cases have no `-Zunpretty=mir` output (a borrowck error; an ICE by design).

**Errors.** The probe prints regardless of errors, like tydump. That includes `construct_error` bodies, which the port
must reproduce. The whole stdout is written at the end, so a fatal error or an ICE gives empty stdout. That is
consistent with the other probe suites; the gate compares what the probe prints.

**Determinism.** I ran the probe twice on each of:
- the 4 listed unstable cases: all 4 differ only in `thread 'rustc' (<tid>) panicked`, so they are truly
  nondeterministic;
- the other 7 ICE/validation-by-design tests of the corpus (`mir/lint/{assignment,call}-overlap`,
  `mir/validate/{critical-edge,noncleanup-*,project-into-simd}`) and nll/constant.rs: all identical. The 7 exit 0
  under the probe, because their lint/validation fires in later phases.

**Can the copy hide a port bug?** Not in a way that matters:
- If the port's `clone_Body` were shallow, the later in-place promotion would leak into the `// mir_built` copy and
  show up as a DIFF.
- A wrong in-place mutation of the `Steal` contents before the steal would still show up in `// mir_promoted`.
- Evaluation-order differences stay visible through AllocIds and the stderr diagnostic order.

## 3. Port-side driver `src/rust_ts/mirdump.ts`: verified
- **Structure:** `override_queries`, the callbacks, `mir_borrow_checking` and `dump` mirror the probe statement by
  statement:
  - the same `trivial_const` → `is_constructor` → built/promoted order;
  - the fed-body fallback (lazily evaluated);
  - the `mir_promoted is provided, never fed` panic.
- **Keys:** `LocalDefId` is a branded number, so the `Map` keys are sound.
- **Seams:** the 4 seams (`write_mir_fn`, `clone_body`, `clone_promoted`, `display_const_val`) are in one place
  (`load_seams`), each an explicit `unported("… mirdump seam")`; `Body` is `unknown` with a comment.
- **Shim:** `--impl shim` with `--sample 40` gives 40/40 MATCH on both suites.

## 4. Suites: verified
- **mirdump-ui corpus = plan-m4 §4 exactly.** The dirs are borrowck 521, nll 439, mir 212, mir-dataflow 6,
  liveness 25, unsafe 37 and pattern/usefulness 107: 1347 cases, 182 of them revision cases. That matches §4's
  "~1,350". The brief's "(the tydump-ui corpus)" contradicts §4, so following §4 (decision recorded) is right.
- **Subsets:** the per-dir subsets use `d + "/"`, so `mir` does not swallow `mir-dataflow`.
- **D14 argv:** compiletest argv, `-Znext-solver=coherence`, revisions, env and 18 aux cases, via `m3UiCorpus`.
  `-o` stays in the argv, which is correct for a probe that stops after expansion; the probe writes nothing into the
  checkout.
- **Skips (16):** 9 needs-unwind, 2 needs-rustc-debug-assertions, 1 needs-asm-support, 1 proc-macro aux,
  1 add-minicore, 2 ignored on x86_64-linux. These are the existing compiletest.ts reasons.
- **mirdump-minicore:** case ids, args and env are equal to tydump-minicore's, and so are the 589 skips.

**Samples** (private data dir, fresh oracle cache, `RUST_TS_AGENT=review-harness-w21`):

| suite | total | MATCH | DIFF | UNPORTED | CRASH/TIMEOUT | UNSTABLE | ERROR lines |
|---|---|---|---|---|---|---|---|
| mirdump-minicore `--sample 40` | 40 | 9 | 0 | 31 | 0 | 0 | 0 |
| mirdump-ui `--sample 40` | 40 | 0 | 0 | 40 | 0 | 0 | 0 |

- minicore stops: 25 check_unsafety, 5 mir_keys, 1 const_eval_poly.
- ui stops: 37 check_unsafety, 2 mir_borrowck, 1 const_eval_resolve_for_typeck.
- Both are consistent with the handoff.

## 5. phase-diff `mir-dump` stage (D11): verified, with notes L1/L3
- **Flags:** `-Zunpretty=mir -Zdump-mir=all -Zdump-mir-exclude-pass-number`, plus a per-side `-Zdump-mir-dir` under
  `$RUST_TS_DATA/phase-diff/mir-dump/{oracle,subject}`, emptied first. cwd and `--out-dir` are as the other stages.
- **Shim run:** `--impl shim` on tests/ui/nll/constant.rs (private data dir) gives all phases ok,
  `mir-dump (170 files)`. The port run stops at `expand`, as before.
- **Ordering:**
  - 929 files of the hand file had 929 distinct mtimes (ns) on this Mac.
  - Within each body, mtime order agrees with the pass numbers that a run without `-exclude-pass-number` writes.
  - `firstDumpDifference`'s missing/extra logic is covered by 5 unit tests.
- **Upstream checkout:** clean after the stage.

## 6. Checks
- `bunx tsc --noEmit -p .` (lane tree): exit 0, no output.
- `bun test scripts harness`: 39 pass, 0 fail. `bun test tools`: 50 pass, 0 fail. Tree still clean afterwards.

## Findings (ranked; none blocks)
- **L1 (phase-diff, D11): `-Zdump-mir-exclude-pass-number` makes same-named dumps overwrite each other.**
  - On the hand file, 34 of 963 dump names collide: `AddCallGuards`, `RemoveNoopLandingPads` and
    `AbortUnwindingCalls` run twice per body. That leaves 929 files.
  - The first instance is lost, and the surviving file's mtime is the second write. So the stage can report a later
    position than the true first divergence, or miss a divergence confined to the first instance.
  - The flag is D11's own prescription. Suggest either noting this in mir-dump.ts's header, or dropping the flag and
    stripping the `N-N-NNN.` component when matching names (the pass number then also gives the order, without
    mtimes).
- **L2 (phase-diff): the stage `rmSync`s shared dirs.** It deletes `$RUST_TS_DATA/phase-diff/mir-dump/{oracle,subject}`
  at start. Two agents running phase-diff concurrently clobber each other's dumps. (The `.txt` outputs were already
  shared; deleting whole directories makes it worse.) Suggest a per-`RUST_TS_AGENT` subdir in a later scripts batch.
- **L3 (ordering portability):** mtime ordering relies on distinct ns mtimes. That holds on APFS. On the Windows host
  (NTFS, 100 ns), ties fall back to name order. Worth a one-off check there; with L1's alternative this goes away.
- **L4 (verification depth, informational):** the lane's promoted-fragment evidence needs a compile that runs
  `promoted_mir`. ui cases with `--emit=metadata` have no promoted dumps. Promoteds were checked here only on
  `--emit=mir` re-runs (nll/constant.rs, the hand file). The match was exact, but the sample is small.
- **L5 (by design, for root):**
  - The probe's stderr has neither borrowck nor misc_checking_3 diagnostics (e.g. dead-code
    `constant N is never used` from real rustc is absent). So the blessed report is mostly FAIL/NOT_COVERED, as the
    handoff says.
  - Without `mir_borrowck`, typeck children's `mir_promoted` (and their MIR-lint diagnostics) are computed at the
    child's own loop iteration, not with the parent. stderr order can therefore differ from real rustc. The port must
    mirror the probe, not rustc, here.
  - Seven ICE/validation-by-design tests exit 0 under the probe (§2).
- **Reviewer housekeeping:** while cross-checking I ran plain rustc with the case argv on cwd = the upstream checkout.
  The minicore cases have no `--out-dir`, and one direct run lacked `RUSTC_ICE=0`. This left `libmini_core.rlib`,
  `mini_core.mir` and one `rustc-ice-*.txt` (all mine, 21:02–21:04) in the checkout. difftest's upstream check caught
  them; I removed them. `git status --ignored` (excluding `build/`) is now empty, and the sample runs above were
  repeated on the clean checkout.
