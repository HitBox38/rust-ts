# Handoff: clippy-contract-b2 (M8 wave 41, step 4; the second chained lane of `clippy-contract-b`)

Plan: `docs/plan-m8.md` §2c, D4, D5, D13, D14. Base: main at `6dad6108` (checked with `git merge-base --is-ancestor`).

The hand-written parts of three `clippy_utils` modules are ported line by line from
`src/tools/clippy/clippy_utils/src/`. They sit around the generated `sym.gen.ts` and `msrvs.gen.ts` from
codegen-clippy-macros.

## Files touched

All files are new. No other file was edited.

| File | What |
|---|---|
| `src/clippy_utils/diagnostics.ts` | diagnostics.rs: `docs_link`, `span_lint`, `span_lint_and_help`, `span_lint_and_note`, `span_lint_and_then` (with `ClippyDiag`'s `into_diag`), `span_lint_hir`, `span_lint_hir_and_then`, `span_lint_and_sugg` |
| `src/clippy_utils/sym.ts` | sym.rs's hand part: `export * from "./sym.gen.ts"`, with the macros and the `pub use rustc_span::sym::*` kept as comments. Clippy code imports `sym` and `EXTRA_SYMBOLS` from here |
| `src/clippy_utils/msrvs.ts` | msrvs.rs: `SEEN_MSRV_ATTR`, `Msrv` (with `From`, `current`, `at`, `for_attrs`, `meets`, `meets_at`, `is_stable`, `is_const_stable`, `is_stable_or_const_stable`, `stability_met`, Default and Debug), `MsrvStack` (with `From`, `current`, `meets`, `check_attributes`, `check_attributes_post`, Debug), `parse_attrs`, `check_attrs`. It re-exports `msrvs.gen.ts`, so `msrvs.LET_CHAINS` works |
| `src/clippy_utils/diagnostics.test.ts`, `src/clippy_utils/msrvs.test.ts` | Unit tests: 10 tests in about 0.9 s (D13: ≤ 10 s) |
| `src/clippy_utils/diagnostics_oracle/` | Fixtures and test glue: `case.rs`, `hir_case.rs`, `msrv_attrs.rs`, `msrv_stability.rs`; the oracle outputs `case.stderr`, `case.nodocs.stderr`, `case.json`, `hir_case.stderr`, `msrv_attrs.stderr`, `msrv_stability.stderr` and `msrv.json`; `capture.ts`, which writes them from the pinned clippy-preview (run by hand, about 2 s); and `harness.ts`, the in-process compile the tests share (human or, with `--error-format=json`, JSON emitter into a buffer) |

## Coverage (`bun scripts/coverage.ts --missing <file>`)

| File | Ported |
|---|---|
| `clippy_utils/src/diagnostics.rs` | 10/10 (`validate_diag` is `rustc-skip:`: it is `#[cfg(debug_assertions)]`-only, and so are its callers, as in `rustc_ast_lowering`'s precedent) |
| `clippy_utils/src/sym.rs` | 0/0 (macros only) |
| `clippy_utils/src/msrvs.rs` | 17/17 |

- `bun scripts/coverage.ts --check`: markers ok.
- `bunx tsc --noEmit -p .`: clean.
- `bun tools/codegen/clippy.ts --check`: up to date. `lib.gen.ts` is still pending; it needs none of these files.

## Proof

**`diagnostics` against the oracle `clippy-driver`, byte for byte.**

`case.rs` triggers one on-by-default lint per wrapper:
- `span_lint`: temporary_assignment;
- `span_lint_and_help`, without and with a help span: approx_constant (deny) and redundant_locals;
- `span_lint_and_note`, without and with a note span: suspicious_assignment_formatting and field_reassign_with_default;
- `span_lint_and_sugg`: redundant_field_names;
- `span_lint_hir`: partialeq_ne_impl.

The test compiles `case.rs` to HIR with the ported front end. It then calls each wrapper with the arguments the upstream
lint passes (quoted in the test), through a `LateContext`, in the oracle's order.

The rendered stderr equals the oracle's exactly. That covers:
- the messages, spans and children;
- the docs link, `for further information visit https://rust-lang.github.io/rust-clippy/main/index.html#<lint>`;
- the `` `#[warn(clippy::…)]` `` / `` `#[deny(clippy::…)]` `` "on by default" notes;
- the final `error: aborting due to 1 previous error; 6 warnings emitted`.

A second test sets `CLIPPY_DISABLE_DOCS_LINKS=1` and matches `case.nodocs.stderr`.

**`msrvs` against the oracle.**
- `msrv.json` covers 25 version strings, among them `1.16`, `1.17.0`, `1.17-nightly`, `+1.16`, `01.016`, `1.65536` and
  `""`. For each, it records:
  - whether redundant_field_names fires with `#![clippy::msrv = "<v>"]`. That lint is gated on `FIELD_INIT_SHORTHAND`
    (1.17.0) through `MsrvStack`;
  - whether it fires with `CARGO_PKG_RUST_VERSION=<v>`, which is how Cargo.toml's `rust-version` arrives;
  - the `check_attrs` error each version gives.

  Through the ported code (`MsrvStack::from`/`check_attributes`/`meets`, `parse_version`, `check_attrs`, and the late
  `Msrv::from`/`meets`), all 25 rows agree.
- `msrv_attrs.stderr` holds `check_attrs`'s three errors, rendered: not a valid version, `bad clippy attribute`, and
  `defined multiple times` with its note. They match exactly.
- `Msrv::at`/`meets_at` (`for_attrs`) are checked on real HIR attributes once an attribute was seen: the item's own
  attribute, then the parents' (the crate's `#![clippy::msrv]`).
- `MsrvStack` push and pop are checked, with the first attribute winning, along with the `Debug` forms.

**Mutation checks.** Each mutation was made alone, the tests run, then the file restored. Each one failed a test:
- `MsrvStack::meets` `>=` → `>`;
- `check_attrs` reporting the second attribute instead of `next_back`;
- `parse_attrs` taking the last attribute;
- `for_attrs` skipping the node itself;
- the docs channel `main` → `master`;
- `docs_link` before `f`;
- `span_help` → `help`.

**Sample difftest:** none run. No suite reaches clippy yet: the driver belongs to clippy-contract-a.

## Review notes N1–N4 (`docs/reviews/clippy-contract-b2.md`, PASS WITH NOTES): the tests added

- **N1, applicability.** `case.json` is the oracle's `--error-format=json` output on `case.rs`. Its one suggestion has
  `"suggestion_applicability":"MachineApplicable"`. The same replay through the ported JSON emitter must equal it byte for
  byte.
- **N2, the HirId.** `hir_case.rs` has three `impl PartialEq` whose `fn ne` carries `#[allow(clippy::partialeq_ne_impl)]`,
  `#[deny(..)]` or nothing. The test registers the lint in the session's `LintStore` (what clippy's `register_lints` does),
  keeps `cx` at the crate root (standing for the `impl` the lint pass runs on) and passes each impl item's own HirId and
  `def_span`, as partialeq_ne_impl.rs does. The output must equal `hir_case.stderr`: nothing for `P`, an error with "the
  lint level is defined here" for `Q`, the default warning for `R`.
- **N3, the caller's `CLIPPY_DISABLE_DOCS_LINKS`.** `with_docs_var` saves the caller's value (`var_os`, exact bytes),
  forces the state each test needs, and restores it in `finally`. A third test checks the restore, both from set and from
  unset.
- **N4, `is_stable`, `is_const_stable`, `stability_met`, and `current` after an attribute was seen.**
  - `msrv_stability.rs` sets `#![clippy::msrv = "1.20.0"]` and uses eight std items. The oracle's `incompatible_msrv`
    reports six of them, each with the `since` of its stability or const stability (1.21.0, 1.36.0, 1.83.0, 1.85.0).
  - Through the ported code, with the attribute seen and `cx` at the crate root, `current` gives 1.20.0. `is_stable` (or
    `is_const_stable` for the `const`-context uses) fails exactly for the six reported uses.
  - With no attribute seen, each reported version is met exactly from that version on.
  - `stability_met`'s unstable arm and `is_const_stable`'s constness check are covered too, with no MSRV:
    `mem::drop` is const-unstable, `HashMap::insert` is not a `const fn`, and `SyncUnsafeCell` is `#[unstable]`. These
    expectations come from the pinned library sources, not from the oracle.
  - In the HIR-walk test, `current(cx)` with `cx` at each fn must equal `at(tcx, hir_id)`.

**Mutations for the review notes.** Each was made alone, the tests run, then the file restored. Every one fails a test:

| Mutation | Result |
|---|---|
| N1: `span_lint_and_sugg` passes `"MaybeIncorrect"` (the reviewer's M1) | 1 fail |
| N2: `span_lint_hir_and_then` passes `cx.last_node_with_lint_attrs` (the reviewer's M2) | 1 fail |
| N3: `with_docs_var` drops the caller's value | 1 fail |
| N4: `stability_met` treats unstable as met | 1 fail |
| N4: `current` ignores `SEEN_MSRV_ATTR` | 2 fail |
| N4: `current` walks from the crate root instead of `cx.last_node_with_lint_attrs` | 1 fail |
| N4: `is_const_stable` ignores constness | 1 fail |
| N4: `is_stable` reads const stability | 1 fail |
| N4: `stability_met` maps `Version` to `CURRENT` | 1 fail |

**Still not checked by a test:**
- `is_const_stable`'s `DefKind::Impl { of_trait: true }` branch (a const trait impl's header);
- `stability_met`'s `StableSince::Current` and `Err` arms;
- `is_stable_or_const_stable`, which reaches the `is_in_const_context` stub;
- `-Ztrack-diagnostics` locations: `DiagLocation::caller()` is set as upstream sets it. It resolves through
`track_caller.ts` only from a ported lint's call site, and none exists yet.

The fixtures are not re-checked automatically. Run `capture.ts` after a pin change; it is a test of the oracle, not of the port.

## Every `unported(...)` left

| Where | Message | Unblocked by |
|---|---|---|
| `msrvs.ts` local `is_in_const_context` (called by `Msrv::is_stable_or_const_stable`) | `clippy_utils::is_in_const_context (clippy_utils/src/lib.rs, lane clippy-utils-e)` | clippy-utils-e: delete the local stub and `import { is_in_const_context } from "./lib.ts"` |

## Cross-lane imports

- **`clippy_utils/lib.rs`:** only `is_in_const_context` (the stub above). `lib.ts` does not exist yet.
- **`clippy_config`:** nothing (as b1 said).
- **Ported compiler crates:**
  - `rustc_errors`: `Diag`, `DiagDecorator`, `DiagLocation.caller_`, `Applicability`, `IntoMultiSpan`/`IntoDiagMessage`;
  - `rustc_lint`: `LintContext`, `LateContext`, `emit_span_lint`;
  - `rustc_middle`: `TyCtxt.emit_node_span_lint`, `hir_parent_id_iter`, `hir_attrs`, `lookup_stability`,
    `lookup_const_stability`, `def_kind`, `impl_trait_header`, `constness`;
  - `rustc_ast`: `AttributeExt.Attribute`, `RustcVersion`, `RustcVersion_cmp`;
  - `rustc_attr_ir`: `AttributeExt.Attribute` for HIR attributes, `StabilityLevel`;
  - `rustc_attr_parsing`: `parse_version`;
  - `std/env`: `var_`.
- **Tests only:** seven generated `src/clippy_lints/*.lints.gen.ts` lint statics.

## For clippy-contract-a and the lint lanes

- **The driver** must set `config.extra_symbols = [...EXTRA_SYMBOLS]` (from `src/clippy_utils/sym.ts`), as driver.rs:130
  and :171 do. Without it, clippy's own `sym` constants such as `sym.msrv` name the wrong symbols, and
  `#[clippy::msrv]` is never matched (the tests' harness does this).
- **`conf.msrv.into()`** is `Msrv.from(conf.msrv)` or `MsrvStack.from(conf.msrv)`.
- **`msrvs::check_attrs(cx.sess(), attrs)`** (attrs/mod.rs:637) is `check_attrs(cx.sess(), AttributeExt.Attribute, attrs)`,
  with `AttributeExt` from `rustc_ast/attr/mod.ts`.
- **`extract_msrv_attr!`** calls `this.msrv.check_attributes(attrs)` and `this.msrv.check_attributes_post(attrs)`.

## `// PORT:` decisions

1. **Generic parameters.** `T: LintContext` is `LintContext<unknown>`. `impl Into<MultiSpan>`/`impl Into<DiagMessage>` are
   `IntoMultiSpan`/`IntoDiagMessage`, and their `.into()` is `into_MultiSpan`/`into_DiagMessage`. `impl AttributeExt` takes
   the implementing type's `AttributeExt` table as an extra parameter before the attributes: `parse_attrs(ext, attrs)` and
   `check_attrs(sess, ext, attrs)`.
2. **`ClippyDiag(F)` and its `Diagnostic` impl** are a local function returning a `Diagnostic` object, as
   `rustc_errors`' `DiagDecorator` is. The `into_diag` marker is on its method.
3. **Compile-time constants.** `option_env!("CFG_RELEASE_CHANNEL")` is the constant `"nightly"`, as in
   `rustc_driver_impl` and `feature_gate.ts`, so the link says `/main/`; the oracle agrees. `env!("CARGO_PKG_VERSION_PATCH")`
   is `"101"` (clippy_utils `0.1.101`), read only on the stable channel.
4. **`#[track_caller]`** is a comment on each wrapper. Calls between the wrappers are statements, never `return f(..)`,
   so the stack walk in `track_caller.ts` keeps every frame. `std::hint::black_box(())` is a comment.
5. **`SEEN_MSRV_ATTR`** is a module `let`. Upstream it is a process-wide static, so `reset_seen_msrv_attr_for_tests()`
   exists for the unit tests, which share one process; nothing else calls it. `parse_attrs_for_tests` exposes the
   private `parse_attrs` to the tests.
6. **`Msrv`** is an immutable class (`Copy`). `MsrvStack.stack` is a `RustcVersion[]` (`SmallVec`). `MsrvStack`'s derived
   `Clone` is not hand-written (PORTING §5); nothing in this lane needs it.
7. **Loosely typed queries.** `lookup_stability`/`lookup_const_stability` are cast to `Stability | undefined` and
   `ConstStability | undefined`, because the generated query table types them as `unknown`. Other ported code does
   the same.
8. **`for_attrs`** builds `hir_parent_id_iter(node)` before scanning `node`, as `once(node).chain(..)` builds its chain
   before `find_map` runs.

## Environment

As in the earlier lanes, the worktree had no `.env.local` and no `node_modules`. I copied the first and symlinked the
second from the main checkout; both are gitignored. `capture.ts` deletes its scratch directory under
`$RUST_TS_DATA/tmp/` when it finishes.
