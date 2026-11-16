# Handoff: clippy-contract-a (M8 wave 41, step 4; contract-first porting lane)

Plan: `docs/plan-m8.md` §2 (§2b–§2d), D4, D12, D13, D14, §8 wave 41; root decisions "codegen-clippy-macros N4", "N5" and
"codegen-clippy-macros (D5)". Base: `6dad6108` (checked with `git merge-base --is-ancestor`).

## Review fixes (`docs/reviews/clippy-contract-a.md`, FAIL: F1, F2; notes N1–N7)

- **F1** (`display_ConfMetadata` not exported by b1's `clippy_config/lib.ts`): fixed on clippy-contract-b1's side (it re-exports
  it beside `ConfMetadata`); `contract.d.ts`'s comment says so. Nothing else changed here.
- **F2** (`driver.test.ts` read `CLIPPY_CONF_DIR` by name, refused by `scripts/lib/unit-steps.test.ts`): the test now sets and
  restores variables only through a `with_env(env, f)` helper whose names come from its parameter; `run()` and the `track_state`
  check both use it. `bun test scripts/lib/unit-steps.test.ts`: 10 pass.
- **N1** (contract test pinned 747 markers / 603 methods and called every prototype method): `contract.test.ts` is now
  marker-driven. It scans the pinned sources for the contract's upstream fns (every fn of the sub-pass types' `EarlyLintPass` /
  `LateLintPass` impls, and each `new` lib.rs calls: 747 at the pin) and requires each to carry a `// stub:` **or** a `// rustc:`
  marker, never both; only a method or constructor under a `// stub:` marker (and a `#[derive(Default)]` stub, whose body is the
  `unported` call) must stop `Unported`. Checked by simulating a fill (one stub turned into a `// rustc:`-marked body: passes;
  the marker dropped: fails, naming the fn).
- **N5** (`lines` stripped a final bare `\r`): `driver.ts` uses `str_lines` (src/std/str.ts), as `str::lines`; the local helper is
  gone, and `driver.test.ts` has the `@argfile` case whose last line is `--sysroot\r` (SYSROOT's `--sysroot` is then appended).
- **`extra_symbols`** (clippy-contract-b2's report): already ported. `RustcCallbacks::config` (driver.rs:130) and
  `ClippyCallbacks::config` (:171) both set `config.extra_symbols = [...sym.EXTRA_SYMBOLS]`, imported from the generated
  `src/clippy_utils/sym.gen.ts` on main; `driver.test.ts` checks both.
- **N4** (no test ran `register_lint_passes` / `explain`; M2, M3, M4, M9 uncaught):
  - M2 (group order): `src/declare_clippy_lint/lib.test.ts` checks `LintListBuilder::register`'s store calls in order, now.
  - M3, M4, M9: `src/clippy_lints/lib.test.ts` (new). **Its tests SKIP while `src/clippy_lints/lib.gen.ts` or
    `src/clippy_config/lib.ts` is absent** (the test names say so); root checks at integration that they run. They cover:
    `register_lint_passes` into a capturing store (the renamed then removed calls against `deprecated_lints`, in order; the two
    pre-expansion factories in order, each given `conf`; the early factory's storages; the late factory's
    `skippable_lints(null)`, the same storages, and `is_active` per late sub-pass for a chosen skippable set; and the generated
    selection: with every clippy lint skippable only `DumpHir` and `Author` are built); `explain` against the pinned
    `cargo-clippy clippy --explain` for `double_parens`, `needless_return`, `NEEDLESS_RETURN` and an unknown name (with
    `Conf::get_metadata` replaced by `[]`; those lints have no configuration); and the `### Configuration` section's filter.
    A fourth test, `explain` of configured lints against the oracle, skips until `Conf::get_metadata` is ported
    (codegen-clippy-conf).
  - Simulated integration, then removed: b1's `src/clippy_config/` from `4ea919ec` with the F1 export added, and
    `bun tools/codegen/clippy.ts` writing `lib.gen.ts`. lib.test.ts: 3 pass, 1 skip (the `get_metadata` one); mutations M3
    (renamed → removed), M4 (pre-expansion passes swapped) and M9 (lowercase lookup) each fail it, and M2 fails the
    declare_clippy_lint test.
- N2, N3 (interface.ts `Some` arms; `describe_lints` padding): outside this lane, unchanged in "Changes needed outside this lane".
  N3's caveat stands: `clippy-driver -W help` end to end also waits on `Conf.load` → `Conf::default` (codegen-clippy-conf).
- N6, N7: no change needed.

## What is ported

| Upstream (`src/tools/clippy/…`) | TS | Coverage |
|---|---|---|
| `src/driver.rs` (335) | `src/clippy/driver.ts` (+ `driver.test.ts` for the two `#[test]`s) | **12/12** |
| `declare_clippy_lint/src/lib.rs` (279; the macros are generated) | `src/declare_clippy_lint/lib.ts` | **4/4** |
| `clippy_lints/src/lib.rs` (874; the two `*_lint_methods!` invocations are in the pending `lib.gen.ts`) | `src/clippy_lints/lib.ts` | **2/2** |
| `clippy_lints/src/declared_lints.rs` (841) | `src/clippy_lints/declared_lints.ts` (`LINTS`, 835 entries in order) | 0/0 (no fns) |
| `clippy_lints/src/deprecated_lints.rs` (206) | `src/clippy_lints/deprecated_lints.ts` (`DEPRECATED`, `DEPRECATED_VERSION`, `RENAMED`, `RENAMED_VERSION`) | 0/0 (no fns) |
| `clippy_lints/src/combined_{early,late}_pass.rs` (92 + 91; macros only) | `src/clippy_lints/combined_{early,late}_pass.ts` (header only; expansion in `lib.gen.ts`) | 0/3 each: `new`, `name`, `get_lints` carry markers in `lib.gen.ts` and count once root writes it |
| `clippy_lints/src/utils/mod.rs` | `src/clippy_lints/utils/mod.ts` (the four `pub mod`s) | 0/0 |

`bunx tsc --noEmit -p .` clean; `bun scripts/coverage.ts --check`: markers ok; `coverage.ts --order`: no clippy rows.

## Skeletons (root decision N5)

**359 hand modules created** at D4's paths (all `src/clippy_lints/**` modules `lib.gen.ts` imports, 358, plus
`src/clippy_utils/macros.ts`; not `src/clippy_config/lib.ts`), and one more, `src/clippy_lints/manual_let_else.ts` (it has a
`.lints.gen.ts` that `declared_lints.ts` names, but no pass of its own). Each:
- re-exports its `<m>.lints.gen.ts`;
- declares each of the **365 pass types** `lib.gen.ts` / `register_lint_passes` name: a `declare_lint_pass!` class is augmented
  (`declare module "./<m>.lints.gen.ts" { interface T extends LateLintPass {} }`, as rustc_lint's builtin.ts); an
  `impl_lint_pass!` type is a hand class (`name`/`get_lints`/`lint_vec` through `<T>_impl_lint_pass`), with no fields yet;
- declares **every `check_*` of every `EarlyLintPass`/`LateLintPass` impl** (368 impls, 604 fns, found by token scan of the
  pinned sources: no impl is left out) and every constructor `lib.rs` uses (143 `new`, 28 `#[derive(Default)]` `default`) as a
  **stub**: body `unported("clippy_lints::<path>::<T>::<fn>")`, so no sub-pass silently does nothing.

**Markers: `// stub: <upstream path>:<line> <name> (lane <group>)`, not `// rustc:`** (PORT decision, following the
borrowck-contract and mir-build precedent): a `// rustc:` marker counts the fn as ported, which would inflate coverage and break
§2d point 4, where a sub-pass is eligible when `coverage.ts --missing` shows its files fully ported. 747 markers (604 + 143; the
derive stubs have no upstream fn). `<group>` is a label for root's lane split, not a lane name: `always-running` (108: the early
sub-passes, both pre-expansion passes, `CognitiveComplexity`, `DumpHir`, `Author`), `dispatch` (68: a directory's `mod.rs`),
`dispatch-methods` (5: `methods/mod.rs`), `lint-files` (566). A fill lane replaces each stub in place with the port and its
`// rustc:` marker, adds the struct's fields, and ports the rest of the file.

**Dual passes (PORT decision).** `Documentation`, `LargeIncludeFile` and `UnusedUnit` implement both traits; `LargeIncludeFile`
and `UnusedUnit` with method names the other trait also has (`check_expr`, `check_fn`, …). A TS class has one method per name,
and `{Early,Late}LintPass_provided.check_x(self)` calls `self.check_x` whichever trait the caller means, so the early combined
pass would run the late body. Each such class gets one method per name that dispatches on `cx instanceof LateContext`, running
the other trait's provided default (nothing) where only one trait implements the name. Fill lanes keep that shape.

Two structs are ported now (not stubs), because `register_lint_passes` builds them: `AttrStorage`
(`utils/attr_collector.ts`) and `FormatArgsStorage` (`clippy_utils/macros.ts`): `#[derive(Clone, Default)]` newtypes over
`Arc<OnceLock<..>>`, a shared `{ value }` cell (`clone` shares it, as the `Arc` does).

## `lib.gen.ts`: what it still waits on

`bun tools/codegen/clippy.ts` (re-run, nothing changed in `tools/`): `pending: src/clippy_lints/lib.gen.ts (1 hand modules
missing, first: src/clippy_config/lib.ts)`. **Only `src/clippy_config/lib.ts`** (clippy-contract-b) is missing. I wrote the pending
output into the tree temporarily and ran `bunx tsc`: **it type-checks against these skeletons with no errors** (then removed it;
`--check` is up to date). At integration, once clippy-contract-b has landed: run `bun tools/codegen/clippy.ts`, commit
`lib.gen.ts`, delete `src/clippy_lints/contract.d.ts`'s blocks for the landed modules (the file once both are gone), and drop the
`BLOCKS` entries of `src/clippy_lints/contract.test.ts` (that test fails while a block names an existing module, as a reminder).

## Cross-lane imports (from clippy-contract-b) and the contract declarations

`src/clippy_lints/contract.d.ts` (the codegen-fmt-serde pattern: ambient blocks named by the exact specifier plus `*`, exact
paths only; `contract.test.ts` checks every import of a declared specifier resolves to that module from the importing file):
- **`src/clippy_config/lib.ts`** must export: `Conf` (class) with `static load(sess: Session): Conf` (conf.rs:935) and
  `static get_metadata(): ConfMetadata[]` (define_Conf!, conf.rs:130: the codegen-clippy-conf follow-up); `sanitize_explanation
  (raw_docs: string): string` (conf.rs:836); `ConfMetadata` (metadata.rs:4, `lints: readonly string[]`) and its `Display` as
  `display_ConfMetadata(v): string`. Users: `driver.ts` (`Conf.load`, lazily), `clippy_lints/lib.ts` (`explain`), and 131
  skeletons (`import type { Conf }`, for `static new(conf: Conf)`).
- **`src/clippy_lints/lib.gen.ts`**: `CombinedEarlyLintPass.new(conf, format_args, attrs)` and
  `CombinedLateLintPass.new(tcx, conf, format_args, attrs, is_active)`, as generated.
- `clippy_utils::sym`: imported from the generated `src/clippy_utils/sym.gen.ts` directly (`sym.rs` is macro-only, 0 fns);
  if clippy-contract-b adds a `sym.ts` hand module, `driver.ts` and `driver.test.ts` can switch to it.
- `clippy_utils::diagnostics`, `msrvs`: not used by this lane.

## Changes needed outside this lane (for root)

1. **`src/rustc_interface/interface.ts`: port the `Some` arms of `track_state` and `register_lints`** (interface.rs:480, :488),
   and type the two `Config` fields. Until then `run_compiler` never calls clippy's `register_lints`, and clippy-driver
   **silently runs as plain rustc** (no suite runs it yet; harness-m8d adds them). `driver.ts` assigns both through a local
   `ConfigCallbacks` view (PORT note); with the types fixed that cast can go. Suggested change:
   ```ts
   // interface Config
   track_state: ((sess: Session) => void) | undefined;
   register_lints: ((sess: Session, lint_store: LintStore) => void) | undefined;
   // run_compiler, after `sess.check_config = ..`
   // `if let Some(psess_created) = config.psess_created` (still always `None`)
   if (config.track_state !== undefined) config.track_state(sess);
   const lint_store = rustc_lint.new_lint_store(sess.enable_internal_lints());
   if (config.register_lints !== undefined) config.register_lints(sess, lint_store);
   ```
2. **`src/rustc_driver_impl/lib.ts` `describe_lints` (lib.rs:974) has a bug** that shows once a tool registers lints (`-W help`
   under clippy-driver): upstream's second `let padded = ..` is a new binding, so `print_lints` keeps the first one (lint-name
   width); the port reassigns one `let padded`, so `print_lints(loaded)` pads to the group-name width and throws `RangeError`
   (`" ".repeat(-n)`). Fix: make the second `max_name_len`/`padded` new `const`s used only by `print_lint_groups`. With that fix
   applied locally (then reverted), the port's whole `-W help` with clippy's lints registered was **byte-identical to the pinned
   `clippy-driver -W help`**. The committed test compares the parsed sections instead (below), so it passes without the fix.
3. **Harness (D12, harness batch):** add `src/clippy/driver.ts` to `BINARY_ENTRIES`. It uses `import.meta.main` only, and
   `require("../clippy_lints/lib.ts")` / `require("../clippy_config/lib.ts")` with literal paths (bundleable) inside
   `register_lints`. `RUST_TS_IMPL=shim` runs the pinned clippy-driver (`toolBinary`, `toolOracleEnv`), as Miri's entry does.
4. **`deprecated_lints.rs`'s local `macro_rules! declare_with_version`** (a data-only macro, no logic) is expanded by hand
   (PORT in the file; the test checks every entry against the pinned source). If root prefers PORTING §5's letter (macros via
   `tools/codegen`), move it into `tools/codegen/clippy.ts`.

## Unit tests (D13: about 2 s for the lane's 24 running tests; 4 skip until integration / codegen-clippy-conf, above)

- `src/clippy/driver.test.ts` (8): upstream `test_arg_value`, `test_has_arg` (`// rustc:` markers); `file_stem`/`str_lines`; `help_message`
  equals the `color_print::cstr!` literal inside the pinned clippy-driver binary; **argument handling** in-process with
  `compiler_entrypoint` spied (restored after each case): `--rustc`, `SYSROOT` with/without `--sysroot` and `@file`, wrapper mode,
  `CLIPPY_ARGS` (`__CLIPPY_HACKERY__`, `--no-deps` with/without `CARGO_PRIMARY_PACKAGE`), `--cap-lints allow` with/without
  `--force-warn clippy::…`, info queries (`-vV`, `--print`, `--print=crate-root-lint-levels`), `--version` → unported; and both
  callbacks' `config` (mir options, `extra_symbols`, `track_state`'s env/file depinfo, `register_lints` set only by clippy's).
- `src/declare_clippy_lint/lib.test.ts` (3): `register`'s store calls in order (N4 M2); `LintCategory::name`, `LintInfo::name_lower` over all 835; **the registration
  listing against the pinned `clippy-driver -W help`**: `insert(LINTS)` + `register` on `new_lint_store(false)`, every loaded lint
  (name, default level, description) in `-W help`'s order and every clippy group with its members in order, equal.
- `src/clippy_lints/deprecated_lints.test.ts` (1): every entry/version/order against the pinned source.
- `src/clippy_lints/contract.test.ts` (4, marker-driven, N1): the contract's 747 upstream fns each carry a `// stub:` or a
  `// rustc:` marker; every stub marker names an upstream fn; all 369 `SUB_PASSES` rows' types are exported with the generated
  `lint_vec`; every stub-marked method or constructor throws `Unported` (a dual pass's on the marker's side); the contract blocks.
- `src/clippy_lints/lib.test.ts` (4, skipping until integration; N4 above).

The combined passes' per-sub-pass selection is covered by `src/clippy_lints/lib.test.ts` once `lib.gen.ts` exists (N4 above).

No difftest was run (no clippy suite exists; harness-m8d adds them). Manual check: `bun src/clippy/driver.ts --help` prints the
oracle's text (exit 0); `--rustc --version` prints the rustc version; `--version` exits 70 (unported); a lib crate compiles
(as plain rustc, item 1).

## `unported(...)` left

- `rustc_tools_util::get_version_info!` (driver.ts `get_version_info`): `--version`/`-V`, and the ICE hook's "Clippy version" note.
  A macro of crate `rustc_tools_util` (`env!`/`option_env!` of its build script); not in this lane.
- The 775 skeleton stubs (above), each naming its fn.

## `// PORT:` decisions

- driver.ts: `catch_with_exit_code_` is `catch_with_exit_code::<ExitCode>` over the port's `()`-only version; `ConfigCallbacks`
  (item 1); `cfg!(debug_assertions)` block and `#[cfg(feature = "internal")]` left as comments (false in the oracle's build);
  `env_depinfo` entries as JSON text pairs (the port's convention); `help_message` mirrors `cstr!`'s tags with SGR helpers;
  `file_stem` is Unix-only; lazy `require`s (D12).
- declare_clippy_lint: `LintInfo::name_lower` on a companion const (the `_INFO` statics are frozen objects).
- clippy_lints/lib.ts: module declarations load through `lib.gen.ts` / `declared_lints.ts` imports; storages' `.clone()` is the
  same object.
- Skeletons: `// stub:` markers; dual-pass dispatch; `AttrStorage`/`FormatArgsStorage` cells.
- deprecated_lints.ts: hand expansion of `declare_with_version!` (item 4).

## Files touched

`src/clippy/{driver,driver.test}.ts`; `src/declare_clippy_lint/{lib,lib.test}.ts`; `src/clippy_lints/{lib,lib.test,declared_lints,
deprecated_lints,deprecated_lints.test,combined_early_pass,combined_late_pass,contract.test}.ts`, `src/clippy_lints/contract.d.ts`,
`src/clippy_lints/utils/mod.ts`, the 359 skeleton modules (`src/clippy_lints/**/*.ts` beside each `.lints.gen.ts`, and
`src/clippy_utils/macros.ts`); this file. Nothing under `tools/`, `harness/`, `scripts/` or `scope.json`; no generated file edited.
The skeletons were written by a scratch generator from a token scan of the pinned sources and lib.gen.ts's pending output (not
committed: the files are hand modules from here on).

## After integ-w66 (branch `t3/clippy-contract-a-w66`, from `integ-w66`)

- **No test under `src/clippy*` skips** (the gate refuses unlisted skips). `src/clippy_lints/lib.test.ts`'s tests are plain `test`s
  now that lib.gen.ts and clippy_config/lib.ts exist. The `get_metadata` case ("explain: a configured lint against the oracle
  (while Conf::get_metadata is codegen-clippy-conf's stub: it stops unported)") asserts, while `Conf.get_metadata` is the stub,
  that it stops `Unported` naming codegen-clippy-conf and that `explain("cognitive_complexity")` does too; once codegen-clippy-conf
  ports it, the same test compares `cognitive_complexity` and `too_many_lines` with the pinned `cargo-clippy clippy --explain`.
  No edit is needed then. `RUST_TS_REQUIRE_PROBES=1 bun test src/clippy src/clippy_lints src/clippy_config src/clippy_utils
  src/declare_clippy_lint`: 44 pass, 0 skip, 0 fail.
- root-w66-check N1: `contract.test.ts`'s unused `dirname` import removed; `lib.test.ts`'s header no longer says its tests skip.
- root-w66-check N2: clippy-fix-a typed `Config.track_state` / `register_lints` and ported their `Some` arms, so `driver.ts`
  assigns them directly; the `ConfigCallbacks` cast, its PORT comments and the unused `LintStore` import are gone, and
  `driver.test.ts` reads the fields without casts. Items 1 and 2 of "Changes needed outside this lane" above are done
  (clippy-fix-a); the `ConfigCallbacks` mentions above are historical.
