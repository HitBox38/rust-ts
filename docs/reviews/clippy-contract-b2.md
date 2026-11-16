# Review: clippy-contract-b2 (porting lane, M8 wave 41 step 4)

Reviewer: independent, read-only. Subject: branch `t3/port-clippy-utils-contract` at `9c8b544b` (`git diff main...9c8b544b`:
14 files, all new, all under `src/clippy_utils/` plus the handoff), handoff `docs/handoff/clippy-contract-b2.md`, against upstream
`src/tools/clippy/clippy_utils/src/{diagnostics.rs, sym.rs, msrvs.rs}` at the pin (`6f5da406`), `docs/plan-m8.md` §2c, D4, D5,
D13, D14, and PORTING.

Method: a detached scratch worktree of `9c8b544b` at `$RUST_TS_DATA/tmp/review-clippy-contract-b2/wt` (`.env.local` copied,
`node_modules` linked). Mutations went into that worktree only and were reverted with `git checkout`. Oracle runs were short (about
1–2 s each). Nothing was built. The scratch directory and worktree were removed afterwards.

## Verdict: PASS WITH NOTES

The port is faithful. I read all three upstream files beside it: function order, logic, names, error texts and markers all match,
and nothing is guessed. The `validate_diag` skip is right, and the oracle binary confirms it is compiled out (P3). Re-captured fixtures
are byte-identical, both from the lane's script and from my own hand run of the pinned `clippy-driver`. There is one `unported` stub,
and it stops correctly. `tsc`, `coverage --check`, `clippy.ts --check` and the tests (0.83 s) pass.

The notes are about test coverage. Two of the brief's focus points are correct in the code but **not checked by any test**. My
mutations survive there: the applicability in `span_lint_and_sugg` (N1) and `span_lint_hir*`'s use of the HIR id (N2). Neither blocks
merging, because the code is right by reading. Close both before the first lint lane depends on them.

## Checks that pass (evidence)

**P1. Fidelity of `diagnostics.ts`** (upstream 405 lines, read in full):
- **Order and markers.** The order is `docs_link` (:19), the `validate_diag` skip (:46), `span_lint` (:106), `span_lint_and_help`
  (:145), `span_lint_and_note` (:200), `span_lint_and_then` (:236) with `into_diag` (:246), `span_lint_hir` (:298),
  `span_lint_hir_and_then` (:327), `span_lint_and_sugg` (:388). Every marker is on the `fn` line; `coverage --missing` gives 10/10.
- **Docs link.** `docs_link` checks `env::var("CLIPPY_DISABLE_DOCS_LINKS").is_err()` (`var_(..).$ === "Err"`, which also covers
  `NotUnicode` as upstream does) before `strip_prefix("clippy::")`. The text
  `for further information visit https://rust-lang.github.io/rust-clippy/{channel}/index.html#{lint}` is verbatim. The channel
  match is `stable` → `rust-1.{PATCH}.0`, then `beta`, else `main`. `CFG_RELEASE_CHANNEL = "nightly"` follows the
  rustc_driver_impl / feature_gate precedent. `CARGO_PKG_VERSION_PATCH = "101"` matches `clippy_utils/Cargo.toml`
  `version = "0.1.101"`.
- **`span_lint_and_then`.** The steps run in upstream order: `sp.into()`, `DiagLocation::caller()`, then `emit_span_lint(lint,
  sp.clone(), ClippyDiag(..))`. Inside the closure: `primary_message`, `emitted_at`, `span(sp)`, `f`, then `docs_link`. So the docs
  link comes after the lint's own help and notes, as the oracle prints it.
- **`span_lint_hir_and_then`.** It calls `cx.tcx.emit_node_span_lint(lint, hir_id, sp, DiagDecorator(..))` with the given `hir_id`.
  As upstream, it has no `diag.span(sp)`. The ported `emit_node_span_lint` takes the level from `lint_level_spec_at_node(lint,
  hir_id)`.
- **`span_lint_and_sugg`.** It passes `msg.into()` and calls `diag.span_suggestion(sp, help.into(), sugg, applicability)` with the
  caller's applicability unchanged. The `black_box(())` is a comment.
- **"On by default" note.** It is not in diagnostics.rs. rustc_middle's lint-level machinery adds it, and it shows correctly in all
  seven rendered diagnostics, `#[warn(..)]` and `#[deny(..)]` alike (P4).

**P2. Fidelity of `msrvs.ts`** (upstream 293 lines, read in full):
- **Coverage.** All 17 fns are present in upstream order, with correct markers (17/17). `msrv_aliases!` stays in `msrvs.gen.ts` and
  is re-exported.
- **`Msrv`.**
  - `for_attrs` scans the node itself, then `hir_parent_id_iter`, takes the first `parse_attrs` hit, and falls back to `self.0`.
  - `meets`/`meets_at` are `is_none_or(msrv >= required)`, via `RustcVersion_cmp`, the derived lexicographic order of
    major/minor/patch.
  - `is_const_stable` keeps the `DefKind::Impl { of_trait: true }` → `impl_trait_header(..).constness` branch. `matches!(Const {..})`
    is `$ === "Const"`, and `Constness` is a tagged union, so that works. Upstream's `&&` short-circuit is kept, so const stability
    is not looked up for non-const items.
  - `stability_met` maps `Version`/`Current`/`Err` → version, `CURRENT`, `false`. Unstable is `false`.
- **`MsrvStack`.** `from` builds an empty or one-element stack, `current` is `last`, and `check_attributes` sets `SEEN_MSRV_ATTR`
  before it pushes.
- **`parse_attrs`.** It takes the first `clippy::msrv` attribute, then `value_str()?`, then `parse_version`.
- **`check_attrs`.** It takes the first attribute, then `next_back()`, meaning the last of the rest. The error texts are verbatim:
  ``"`clippy::msrv` is defined multiple times"`` with ``"first definition found here"``, ``"bad clippy attribute"``, and
  ``"`{msrv}` is not a valid Rust version"``. The duplicate error comes before the value checks. Filtering the list eagerly instead of
  lazily changes nothing, since `path_matches` is pure.
- **`CARGO_PKG_RUST_VERSION`.** It is not read in msrvs.rs: it is `clippy_config/src/conf.rs:961`, which is not this lane's file.
  The lane correctly does not port it. The tests reproduce conf.rs's `parse_version(Symbol::intern(&v))` inline and compare against
  the oracle's behaviour under the env var.
- **Debug forms.** The `Msrv` and `MsrvStack` Debug forms match the derives. `RustcVersion` derives `Debug` (rustc_ast
  attr/version.rs:6).

**P3. `validate_diag` as `rustc-skip:` is right.**
- Upstream compiles it under `#[cfg(debug_assertions)]` only, and both call sites are also cfg'd.
- The recorded precedent is the decision of 2026-10-14 (lowering-contract: `#[cfg(debug_assertions)]` fns are `rustc-skip:`, since
  the oracle is a release build). Later ports follow it: rustc_attr_parsing `check_args_used`/`are_args_checked`, and
  rustc_serialize's `Drop for FileEncoder`. The skip text gives the reason.
- The binary agrees. In the oracle `clippy-driver`, `grep -c` finds 0 hits for both of `validate_diag`'s assertion messages:
  `span must not be empty and have no suggestion` and `suggestion must not have overlapping parts`. Strings from the same crate are
  present: `for further information visit https://rust-lang.github.io/rust-clippy/` (1 hit) and `is defined multiple times`
  (2 hits). So the function is compiled out of the oracle.

**P4. The oracle fixtures are genuine.**
- The binary is `$RUST_TS_DATA/tools/08d0af9f…/clippy-nightly-aarch64-apple-darwin/clippy-preview/bin/clippy-driver`:
  - the tarball's `shasum -a 256` is `08d0af9f…5e25`, as in `UPSTREAM.json` `tools.clippy`;
  - `git-commit-hash` is `6f5da406…`, the pin;
  - `--version` prints `clippy 0.1.101 (6f5da406b5 2026-10-10)`.
- Re-running `capture.ts` in the scratch worktree left `git status` clean, so all four fixtures are byte-identical.
- Independently of the script, I ran the driver by hand under `env -i` with an empty `CLIPPY_CONF_DIR`, on `case.rs` and
  `msrv_attrs.rs`. Both outputs are `cmp`-identical to `case.stderr` and `msrv_attrs.stderr`.
- `msrv.json` records the pin commit, and its 25 rows are plausible. `+1.16`, `1.+16` and `01.016` parse, because `u16::from_str`
  accepts `+` and leading zeros. `1.65536` overflows. Suffixes and whitespace are rejected.

**P5. The tests are a meaningful check of output, within limits.**
- No lint is ported, so the test compiles `case.rs` with the ported front end and calls each wrapper with the arguments the upstream
  lint passes, quoted per call. Then it compares the full rendered stderr byte for byte with the oracle's.
- That checks what the wrappers themselves contribute:
  - the primary message and span;
  - help, note, span_help and span_note children, and their order relative to the docs link;
  - the inline suggestion rendering;
  - the docs link text and the `CLIPPY_DISABLE_DOCS_LINKS` switch;
  - that clippy lint statics flow through the ported lint-level machinery: the warn/deny notes and the final error count.
- It does not check:
  - whether a lint fires, which is the lint lanes' job;
  - the order of diagnostics in a real run, since the replay order is typed by hand;
  - applicability (N1);
  - HIR-id routing (N2);
  - `-Ztrack-diagnostics`, which the handoff states.
- The msrv tests feed the same 25 inputs through `MsrvStack`/`parse_attrs`/`check_attrs`/`Msrv` on real parsed attributes. They
  also render `check_attrs`' errors against `msrv_attrs.stderr`, and run `for_attrs` on real HIR. That is a sound check.

**P6. My mutations.** Each was applied alone, the two test files run, then reverted:

| # | Mutation | Result |
|---|---|---|
| M3 | `docs_link` before `f(diag)` in `span_lint_and_then` | caught (1 fail) |
| M4 | `is not a valid Rust version` → `is not a valid version` | caught (2 fail) |
| M5 | drop `diag.span(sp_)` | survives: an **equivalent** mutant. rustc_middle lint.rs (about :498) pushes the lint's primary spans when the diag has none, so for a plain span the output cannot change. Not a gap. |
| M1, M2 | see N1, N2 | survive |

**P7. One `unported` stub, and it is correct.**
- msrvs.ts's local `is_in_const_context` returns `unported("clippy_utils::is_in_const_context (clippy_utils/src/lib.rs, lane
  clippy-utils-e)")`. It is reached only from `is_stable_or_const_stable`. It has a `// PORT:` note and a handoff row.
- `git diff main...9c8b544b` has no other `unported(`. The other `as never` / `as unknown as` casts are all in test code: the
  `LateContext` built at the crate root, `NO_CX`, and the mock `Session` in the msrv test. No ported fn returns a made-up value.

**P8. The basics pass.**
- `bunx tsc --noEmit -p .` exits 0.
- `bun scripts/coverage.ts --check`: markers ok.
- `bun tools/codegen/clippy.ts --check`: up to date (`lib.gen.ts` still pending, as expected).
- `bun test src/clippy_utils/`: 6 pass in 0.83 s, against the D13 budget of 10 s.
- `scripts/lib/unit-steps.test.ts` passes on the lane's tree, 10/10. The new test files read no environment variable by name: the
  only env use is `set_var`/`remove_var` of `CLIPPY_DISABLE_DOCS_LINKS`, and its read is in `diagnostics.ts` through `var_`.
  `CARGO_PKG_RUST_VERSION` is never set: the tests emulate conf.rs.
- Only assigned files were touched.

**P9. `extra_symbols` in clippy-contract-a's driver: done.** `t3/port-clippy-contract-a` at `962d03eb`, `src/clippy/driver.ts`,
sets `config.extra_symbols = [...sym.EXTRA_SYMBOLS]` in both `config` callbacks, at TS :130 and :177. Those mirror upstream
driver.rs:130 (`RustcCallbacks`) and :171 (`ClippyCallbacks`). See N5 for the import path.

## Findings

**N1. Test gap: `span_lint_and_sugg`'s applicability is not checked.** The code is correct by reading (P1). But in mutation M1 I
replaced the caller's `applicability` with `"MaybeIncorrect"`, and all 6 tests still pass. The human emitter does not print
applicability.

Recommendation: add an oracle capture of `case.rs` with `--error-format=json`, whose `suggestion_applicability` field shows it, and
compare the ported JSON emitter's output. Or, at least, assert the applicability on the `Diag`'s suggestions in the replay. Do this
before the lint lanes rely on rustfix-visible applicability (the `ui` suites' `.fixed` files).

**N2. Test gap: `span_lint_hir*`'s HIR id is not checked.** The replay passes `CRATE_HIR_ID` both as the `LateContext`'s
`last_node_with_lint_attrs` and as `span_lint_hir`'s `hir_id`. Its `// PORT:` note says "the crate root's HirId stands for the impl
item's (same levels here)". So in mutation M2 I made `span_lint_hir_and_then` pass `cx.last_node_with_lint_attrs` instead of
`hir_id`, and nothing failed. The routing the brief singles out is therefore untested.

Recommendation: in a small fixture, put `#[allow(clippy::partialeq_ne_impl)]` (or `#[deny]`) on the `fn ne` impl item. Then pass that
item's real `HirId` while `cx` stays at the crate root, and check the oracle's output for the level change.

**N3. Minor: the test does not restore the caller's `CLIPPY_DISABLE_DOCS_LINKS`.**
- The first docs test calls `remove_var` unconditionally. The second calls `set_var("1")`, then `remove_var` in `finally`.
- The results do not depend on the caller's environment, since each test forces the state it needs. That part of the brief is met.
- But a value the caller set is not put back. The brief asks for a child process or a restore.
- It is harmless today, because nothing else reads the variable.

Recommendation: save `process.env.CLIPPY_DISABLE_DOCS_LINKS` before the tests and restore it in `finally` / `afterAll`.

**N4. Minor: parts of `Msrv` have no test.** `is_stable`, `is_const_stable`, `stability_met`, and `current` with `SEEN_MSRV_ATTR`
set (the `cx.last_node_with_lint_attrs` walk) are not run by any test. `is_stable_or_const_stable` cannot be, because of its stub. I
found nothing wrong in them by reading (P2). The first MSRV-gated late lints (clippy-ui-lane) will exercise them through the oracle.
List them in the handoff as unchecked.

**N5. Note for clippy-contract-a (not this lane's file): import `EXTRA_SYMBOLS` through `sym.ts`.** `src/clippy/driver.ts` at
`962d03eb` imports from `../clippy_utils/sym.gen.ts` directly. b2's convention is that clippy code imports `sym` and `EXTRA_SYMBOLS`
from the hand module `src/clippy_utils/sym.ts`, as `use clippy_utils::sym` does. The values are the same, so this is only consistency.
Root can switch the import when both lanes have landed.

**N6. Nit: `Msrv.default()` is a hand-written `#[derive(Default)]`.** PORTING §5 says other derives are generated. This one is a
single trivial line (`Msrv(None)`) and is used by the tests, so it can stay until `tools/codegen` covers `Default` for clippy types.
No action is needed now.

## Summary for root

- Merge as is.
- Carry N1 and N2 into the brief of the first lane that adds a fixture through these wrappers: clippy-ui-lane, or a small follow-up
  test batch.
- N3 is a two-line test fix that can ride along with it.
- N5 goes to the clippy-contract-a integration.
