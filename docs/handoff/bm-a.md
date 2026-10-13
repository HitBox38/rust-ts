# Handoff: bm-a (wave 9, M2: rustc_builtin_macros core)

Branch `lane/bm-a` (main 8704772 + `lane/expand-base` merged at 947a891). Includes a `tools/` change (codegen),
which needs its own review (see "Tools change").

## Priority 1: `cmdline_attrs::inject`
- Ported to `src/rustc_builtin_macros/cmdline_attrs.ts` and called from `passes::parse` (passes.ts, the one call site this lane owns;
  the local `cmdline_attrs_inject` stand-in is gone). Spot-checked against the oracle with a malformed `-Zcrate-attr=foo bar`:
  same diagnostic, byte for byte.
- `expanded-nocore --sample 200` (runs `20261013-083858-bm-a-q486`, and again at the end, `20261013-092324-bm-a-sqzd`):
  3 MATCH, 197 UNPORTED, 0 DIFF. **All 197 now stop at**
  `rustc_interface::passes::create_and_enter_global_ctxt (-Zunpretty needing the AST map)`, which is
  `src/rustc_driver_impl/lib.ts:236`. That is driver wiring, because tyctxt-min already ported `passes.create_and_enter_global_ctxt`.
  Once it is wired, the next stops are:
  1. passes.ts's stand-ins `pre_configure_attrs` and `expand_config_features`. With `-Zcrate-attr` the crate attrs are never empty.
     expand-base has now ported both in `src/rustc_expand/config.ts` (`pre_configure_attrs`, `features`), so the stand-ins can be
     swapped for the real ones.
  2. `resolver_for_lowering_raw` (driver-m2): `configure_and_expand` → `register_builtin_macros` / `standard_library_imports::inject`
     (both ported here) → `expand_crate` (expand-core).

## Files
- **Ported** (`src/rustc_builtin_macros/`):
  - lib.ts, util.ts, cmdline_attrs.ts, standard_library_imports.ts
  - cfg.ts, cfg_accessible.ts, cfg_eval.ts, cfg_select.ts
  - source_util.ts, concat.ts, concat_bytes.ts, env.ts, assert.ts, assert/context.ts
  - compile_error.ts, trace_macros.ts, log_syntax.ts, edition_panic.ts, iter.ts, pattern_type.ts
  - autodiff.ts (no `#[cfg]` at the pin, so fully ported), gca.ts, test_binder_constraints.ts, view_type.ts
  - define_opaque.ts, alloc_error_handler.ts, offload.ts
  - diagnostics.ts (hand impls), diagnostics.gen.ts (generated)
- **Stubs for other lanes.** Header `STUB … replace freely`, no markers, `unported` bodies, only the names lib.ts uses:
  - asm.ts, test.ts, eii.ts, global_allocator.ts, contracts.ts (bm-rest)
  - format.ts (bm-format)
  - derive.ts and deriving/mod.ts (`BuiltinDerive`) (bm-derive-a)
  - deriving/{clone,coerce_pointee,const_param_ty,copy,debug,default,eq,from,hash,ord,partial_eq,partial_ord,reborrow}.ts (bm-derive-b)
- **Tests:**
  - `builtins.test.ts`
  - `builtins_oracle/{gen.rs,run.ts,cases.txt,out.stdout,out.stderr}`
- **Outside the crate:**
  - `src/rustc_interface/passes.ts`: the `cmdline_attrs` call only.
  - tools/codegen (below).

## Coverage (`bun scripts/coverage.ts --missing compiler/rustc_builtin_macros/src/<f>.rs`)
Everything listed is complete:

| file | fns | file | fns |
|---|---|---|---|
| lib | 1/1 | util | 10/10 |
| cmdline_attrs | 1/1 | standard_library_imports | 1/1 |
| cfg | 2/2 | cfg_accessible | 2/2 |
| cfg_eval | 20/20 | cfg_select | 3/3 |
| source_util | 12/12 | concat | 1/1 |
| concat_bytes | 3/3 | env | 5/5 |
| assert | 4/4 | assert/context | 11/11 |
| compile_error | 1/1 | trace_macros | 1/1 |
| log_syntax | 1/1 | edition_panic | 4/4 |
| pattern_type | 4/4 | iter | 2/2 |
| autodiff | 16/16 | gca | 1/1 |
| test_binder_constraints | 1/1 | view_type | 2/2 |
| define_opaque | 1/1 | alloc_error_handler | 2/2 |
| offload | 4/4 | diagnostics | 3/3 (+113 generated derives) |

`bun scripts/coverage.ts --check`: markers ok (5295; vendor 2403).

## Tests and checks
- **Oracle test** `builtins.test.ts`, 81 tests:
  - Source: the rustc-dev probe `builtins_oracle/gen.rs` (regeneration steps in its header).
  - What the probe does:
    - It runs `register_builtin_macros` into a recording resolver.
    - It feeds each case of `cases.txt` to the registered `LegacyBang`/`LegacyAttr` expander, on a real `Session` with a mock resolver.
    - Each case gets a fresh `ExpnData::default(Macro(..))` expansion.
    - It prints `{:#?}` of the result, with the diagnostics on stderr.
  - `run.ts` makes the same calls on the port, and the test compares stdout and stderr per case.
  - **Coverage of the cases:** the registry (names and kinds, in order), stringify, line, column, file, module_path,
    cfg! (incl. errors), assert! (plain, message, 2015/2021, every parse error, and `generic_assert` through assert/context.rs),
    core_panic/std_panic/unreachable by edition, trace_macros, log_syntax, iter!, pattern_type!, view_type!,
    cfg_accessible (all paths and errors), cfg_eval (strip + cfg_attr), define_opaque, alloc_error_handler, autodiff
    (forward/reverse/width/errors/generics), offload_kernel.
  - **Result:** 73/73 non-pending cases (78 in cases.txt) match byte for byte (stdout 9,894 lines, stderr 341).
  - **PENDING, 5 cases.** The expander is not called on either side.
    - concat!, env!, option_env!, compile_error! need `MacroExpander::fully_expand_fragment` (expand-core).
    - cfg_select! needs `ParserAnyMacro` (expand-core/mbe).
    - include!, include_str!, include_bytes! and standard_library_imports::inject are not in the cases yet: they need
      `Session::resolve_path` / `ExpansionConfig::default` / a real `expansion_for_ast_pass`.
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=120000 src tools`: 2357 pass, 1 skip, 0 fail.
- `RUST_TS_AGENT=bm-a bun scripts/difftest.ts --suite parse --sample 200`: 200/200 MATCH (`20261013-092319-bm-a-surb`).
- The diagnostics generation is verified: `bun tools/codegen/diag-expand.ts rustc_builtin_macros` reports 113/113 derive impls identical
  to the real rustc_macros expansion.

## `unported(...)` left
- `rustc_session::Session::resolve_path (session.rs:934)`, in source_util.ts `session_resolve_path`. It is used by include!,
  include_str! and include_bytes!. session.ts has no `resolve_path` and is not my file.
- `rustc_expand::expand::DeclaredIdents for Box<Item> (not exported by expand.ts yet)`, in cfg_select.ts `Item_declared_idents`.
  expand-core ports it as the module-private `Item_declared_idents` of expand.ts. Once that is exported, replace the shim with
  the import.
- `rustc_expand::proc_macro::BangProcMacro::expand (quote!; proc-macro bridge, M6)`, in lib.ts. Registration still happens.
- All stub modules (listed above).

## Integration notes (root)
- **util.ts augments `MacroExpander`** with `fully_expand_fragment` (`declare module "../rustc_expand/expand.ts"`), because
  expand-base's stub class lacks it.
  - expand-core's real class has the same signature, so the augmentation is harmless after its merge.
  - Delete it then.
- **Other expand-core names used:** `AstFragment.make_expr` and `cx.expander()`. Both are present in expand-core's expand.ts.
- **expand-base API used:**
  - `MacResult_provided`
  - `MacroExpanderResult.from_tts`
  - `Annotatable.span` / `Annotatable.to_tokens`
  - `clone_Annotatable`
  - `ExpandResult` with an `undefined` Retry payload
  - `StripUnconfigured.configure(node, HasTokens, HasAttrs)`
  - `TTMacroExpander_from_fn`, `MultiItemModifier_from_fn`
  - `AttrProcMacro_provided`
- **Stub files will collide with the bm-derive/bm-rest/bm-format branches** (add/add). Take their versions. lib.ts imports
  only the names listed in each stub.

## Tools change (needs review; tools/ is outside porting ownership, the brief asked for the codegen set)
- `tools/codegen/types.sets.json`: new set `rustc_builtin_macros` (merged next to expand-base's `rustc_expand`).
- `tools/codegen/typemap.builtin_macros.json` (new): `rustc_errors::SingleLabelManySpans` with its manual
  `Subdiagnostic` fns.
- `tools/codegen/types.ts`, two generator fixes:
  1. **Glob of a local module.** A glob of a local module (`use super::*;` in diagnostics.rs's inline `mod autodiff`) now also
     resolves through that module's own `use`s of external paths, e.g. `Span`.
  2. **External `Subdiagnostic` impls.** A typemap entry may carry `subdiagnostic: { add_to_diag, subdiagnostic }` for
     `#[subdiagnostic]` fields whose type has a manual `impl Subdiagnostic` in another crate.
  - **Evidence of no side effects:** every other set was regenerated with the old and the new generator, and the outputs are
    identical.

## `// PORT:` decisions
1. **Derive-only module flattened (autodiff).** autodiff.rs's inline `mod llvm_enzyme` is flattened. `debug!`/`trace!` are dropped.
2. **diagnostics.rs's `pub(crate) use autodiff::*`** becomes re-exports of the generated `autodiff` namespace in diagnostics.ts.
3. **`forward_to_parser_any_macro!` (cfg_select)** expands to one method per invocation, sharing a helper fn that holds the macro body.
4. **ExpandInclude hoisted.** source_util's fn-local `struct ExpandInclude` is a module-level class.
5. **`str::escape_debug`** is a local helper in env.ts and source_util.ts. It applies `escape_char(c, true, true)` to every char,
   as core does at the pin (same as rustc_ast_pretty's private helper). Root: move it to src/std.
6. **`Component` equality** is a local `component_eq` in source_util.ts, because src/std/path.ts keeps its own private.
7. **`find_path_suggestion`** builds its candidate lists eagerly. Equivalent, since there are no side effects before the `find`.
8. **`env!`:**
   - `std::env::var` reads `process.env`.
   - `VarError::NotUnicode` cannot arise, because the values are already strings.
   - A key that is empty or contains `=`/NUL is NotPresent.
   - **Type mismatch in session.ts:** `Session.env_depinfo` is typed `Set<string>`, whereas upstream is
     `FxIndexSet<(Symbol, Option<Symbol>)>`. Until session.ts carries the tuple, the pair is stored as its JSON text.
     Only dep-info output reads it.
9. **`Generics::default()`** in alloc_error_handler.ts is written out from `#[derive(Default)]`: empty params, a
   `WhereClause(false, [], DUMMY_SP)`, and `DUMMY_SP`. No `Default` codegen exists for rustc_ast.
10. **`assert/context.rs` `paths: FxHashSet<Ident>`** is a list compared with `Ident.eq`. Only contains/insert are used.
11. **`*expr = ..` through `&mut Box<Expr>`** (context.rs) uses `replace_in_place`. `*shadow_arg.ty/pat = ..` (autodiff)
    replaces the node's fields in place.
12. **Edition comparisons** go through `Edition_discriminant`.

## Decisions for root to record
- **Builtin-macro oracle test design:** a probe that calls the registered expanders directly, with a mock resolver and fresh
  expansions; a PENDING list for cases that need other lanes.
