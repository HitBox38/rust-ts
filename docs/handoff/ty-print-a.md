# Handoff: ty-print-a (wave 15, M3): rustc_middle ty/print/mod.rs + pretty.rs:1..1704

Branch `lane/ty-print-a` (from main a62a248, no merges).

## Files touched
- `src/rustc_middle/ty/print/mod.ts` (new): mod.rs 28/28. `Printer` abstract class, `Print<T, P>` descriptor type,
  `PrintError` / `PrintResult` / `PRINT_OK`, `characteristic_def_id_of_type(_cached)`, the `Print` impls
  (`print_Region`, `print_Ty`, `print_Instance`, `print_ShimKind`, `print_List_PolyExistentialPredicate`,
  `print_Const`), `IrPrint_print` / `IrPrint_print_debug`.
- `src/rustc_middle/ty/print/pretty.ts` (was ty-contract's stub): my region `// ==== lane ty-print-a: pretty.rs:1..1704 ====`
  (47/47 fns of 1..1704) and the region `// ==== lane ty-print-b: pretty.rs:1705..end ====`, which holds only its own
  import and ty-contract's `unported_methods(TyCtxt.prototype, ..)` stub for `def_path_str_with_args` /
  `value_path_str_with_args` (unchanged content, moved under the b marker).
  - thread-locals + `define_helper!` (`with_reduced_queries`, `with_forced_impl_filename_line`,
    `with_resolve_crate_name`, `with_crate_prefix`, `with_no_trimmed_paths`, `with_forced_trimmed_paths`,
    `with_no_visible_paths`, `with_no_visible_paths_if_doc_hidden`), `RtnMode`, `RtnModeHelper`,
    `with_types_for_suggestion` / `with_types_for_signature` / `with_no_queries` (macros, as fns), `WrapBinderMode`,
    `RegionHighlightMode`;
  - `PrettyPrinter` abstract class: every provided/required method of pretty.rs:263..1703 (value paths, binders,
    `comma_sep`, `typed_value`, `(maybe_)parenthesized`, `generic_delimiters`, trimmed / forced-trimmed / visible
    def paths, `pretty_print_path_with_qualified` / `_with_impl`, `pretty_print_closure_inner`, `pretty_print_type`,
    opaque impl types + `insert_trait_and_projection`, inherent projections, RPITIT, `pretty_print_dyn_existential`,
    `pretty_print_fn_sig`, `pretty_print_const`, `pretty_print_const_expr`).
- Tests (new): `src/rustc_middle/ty/print/print.test.ts` (16 unit tests), `print.oracle.test.ts` (2 tests) and
  `print_oracle/` (`probe.rs` rustc-dev oracle source, `paths.rs` test crate, `paths.lib.stdout` oracle fixture,
  `run.ts` subject side on the ported driver, `test_printer.ts`).
- No other file edited (no lib.ts change: lib.ts already imports `ty/print/pretty.ts`, which imports mod.ts).

## Coverage (`bun scripts/coverage.ts --missing <file>`)
| file | ported |
|---|---|
| ty/print/mod.rs | 28/28 |
| ty/print/pretty.rs 1..1704 | 47/47 (0 missing in range; whole file 47/125, the rest is ty-print-b's) |

`bun scripts/coverage.ts --check`: markers ok.

## Tests
- **Oracle** (`print.oracle.test.ts`): `print_oracle/probe.rs` (a throwaway rustc-dev program; lanes may not edit
  tools/, root may adopt it as a tools/probes probe) runs the pinned rustc on `paths.rs` (`--edition=2021
  --crate-type lib`, host target, with std) and prints after expansion:
  - `format!("{}", ty)` for 37 interned types: all primitive ints/floats, `str`, `!`, `()`, 1-/2-/nested tuples,
    `&i32` (erased), `&'static str`, `&'static mut u8`, `&mut (u8, u16)`, `*const u8`, `*mut ()`, slices, fn pointers
    (`fn()`, `fn(i32) -> bool`, `unsafe extern "C" fn(u8, ...) -> !`, `extern "system-unwind" fn()`, fn returning fn),
    `_`, `{integer}`, `{float}`, `FreshTy(1)`, `FreshIntTy(2)`, `FreshFloatTy(0)`, `{type error}`;
  - for each of the 28 local `DefIndex`es and 8 std lang items (`Box`, `Option`, `Some`, `String`, `Sized`,
    `Iterator`, `FnOnce`, `FnOnce::Output`): `def_path_str` (untrimmed; std items resolve through
    `visible_parent_map` re-exports, e.g. `std::prelude::v1::Some`, `std::boxed::Box`), `with_crate_prefix!`
    (`crate::m::n::E`), `with_forced_trimmed_paths!` (`Tr::f`, `E`, `Box`, `FnOnce::Output`; raw idents `r#async`).
  `run.ts` prints the same with the ported printer on the ported driver: **byte-identical** (76 lines). `REGEN=1`
  rebuilds the probe and rewrites the fixture (verified unchanged).
- **Unit** (`print.test.ts`): guards (set/restore/nesting/restore-on-panic/independence, `with_no_queries!`),
  `WrapBinderMode::start_str`, `RegionHighlightMode` (slot order, bug when full, bound-region assert, copy),
  `characteristic_def_id_of_type`, `comma_sep` / `typed_value` / `(maybe_)parenthesized`, `pretty_print_fn_sig`
  with a splatted index and C-variadic, `fmt::Error` propagation, and the trimmed-path decisions of
  `try_print_trimmed_def_path` (trimmed name printed as an `Ident`, raw for keywords; off under
  `with_no_trimmed_paths!` / `with_crate_prefix!` / either option off), `with_no_visible_paths!`.
- **Not covered by the oracle yet** (needs ty-print-b): trimmed paths through the `trimmed_def_paths` query (the probe
  keeps `opts.trimmed_def_paths = false`; forced-trimmed rows of variants and items under them print `-`), generic
  args, regions other than `'static`/erased, ADT types (`AdtDef` is pending: the paths are the `print_def_path` the
  `Adt` arm calls).
- Test printer: `print_oracle/test_printer.ts` is a reduced `FmtPrinter` (its `Printer`/`PrettyPrinter` overrides
  for what the tests print, upstream bodies, `unported` otherwise). **Root: switch the tests to ty-print-b's
  `FmtPrinter` at merge and delete test_printer.ts.**
- `run.ts` passes `debug_SplattedArgIndexError` to `unwrap_result` (the repo lint forbids the one-argument form outside tests).
- Scaffolding: `run.ts` `install_scaffolding()` installs upstream bodies for 6 stubs of other lanes
  (`Region::type_flags`/`flags`/`outer_exclusive_binder`, `&List<Ty>`'s `inputs`/`output`, `Ty::is_unit`) and returns
  a restore function; print.test.ts restores them in `afterAll`. Drop it when those lanes land.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 4125 pass, 1 skip (pre-existing linux-only), 0 fail.
- `bun scripts/coverage.ts --check`: `markers ok (9514; vendor 3888)`.
- Sample difftest: `RUST_TS_AGENT=ty-print-a` parse `--sample 100`: 100/100 MATCH (run `20261014-051839-ty-print-a-lof4`); resdump-nocore `--sample 50`: 50/50 MATCH (`20261014-051845-ty-print-a-newz`). Nothing on a driver path prints types yet, so no suite exercises the printer.
- Load: `import("src/rustc_middle/lib.ts")` then `ty/print/mod.ts` works (see "Init order").

## PORT decisions (please record)
1. **Print trait shape.** `Print<T, P extends Printer = PrettyPrinter>` is `(self: T, p: P) => PrintResult`; the impl
   for `X` is `print_X` (like `debug_X`); generic impls take their parameters' descriptors last
   (`print_Binder(value, p, print_T, d_T)`). This replaces ty/decls.ts's `Print<T>` (`Pending1`): root can re-export
   it from ty/print/mod.ts (the default `P` keeps `string_with_limit`'s `d_T: Print<T>` meaningful).
2. **Traits as abstract classes.** `Printer` (mod.ts) and `PrettyPrinter extends Printer` (pretty.ts) are abstract
   classes (precedent rustc_ast_pretty `PrintState`): provided methods are methods, required ones `abstract`;
   `fmt::Write` is `PrettyPrinter.write_str`. Closures `impl FnOnce(&mut Self)` are `(p: this) => PrintResult`.
   Lane ty-print-b adds pretty.rs:1705..2056's provided methods with `declare module "./pretty.ts" { interface
   PrettyPrinter {..} }` + `PrettyPrinter.prototype.x = function ..` in its region (FmtPrinter overrides them by
   subclassing).
3. **PrintError / PrintResult.** `PrintError` = `std::fmt::Error` = `{ $: "Error" }`; `Result<(), PrintError>` is
   `PrintResult` (`Result<undefined, PrintError>`), `?` is `if ((r = ..).$ === "Err") return r;`. `write!(p, "..")`
   is one `write_str` of the formatted text (same bytes as `FmtPrinter`'s per-piece appends).
4. **Thread-locals.** Module-level `TlCell`s (Cell API: `get`/`set`/`replace`). Each `define_helper!` name is one
   overloaded function: `with_x()` reads the flag (`pub fn`), `with_x(() => e)` is the macro (guard
   `DefineHelperGuard` set/`finally` drop). Markers: `new` :63 and `drop` :77 on `DefineHelperGuard`, each name on
   its invocation line. `with_types_for_*` / `with_no_queries` macros are plain functions (no marker: not fns).
5. **mod.ts ↔ pretty.ts cycle.** mod.ts `export * from "./pretty.ts"` (`pub use self::pretty::*`) and imports
   `with_no_trimmed_paths`; pretty.ts imports `Printer` from mod.ts. Load order must start at pretty.ts (rustc_middle
   lib.ts does): importing mod.ts first as an entry point is a TDZ error (precedent: ty_kind.gen.ts).
6. **`IrPrint`** is `IrPrint_print(t, fmt, print_T)` / `IrPrint_print_debug` returning the text (std/fmt.ts Display
   convention); `tcx.lift` is the identity (Lift skipped); a `fmt::Error` panics like `to_string`.
7. **Structural maps.** `pretty_print_opaque_impl_type`'s `FxIndexMap`s keyed by `PolyTraitClause` /
   `(Binder<(List<Ty>, Ty)>, bool)` are `KeyedMap`s on `intern_key` (insertion order = IndexMap order; `insert` on an
   existing key keeps its position); inner maps keyed by `DefId` use `DefId_key`. `proj == super_proj` compares
   `intern_key`s.
8. **`sort_by_cached_key` with `String` keys** sorts by code point (= UTF-8 byte order of `Ord for str`), stably.
9. **`DefPathData` is `Copy`**: `try_print_visible_def_path_recur` rebuilds `{ $: "TypeNs", _0: new_name }` instead
   of mutating the def key's object.
10. **`pretty_print_fn_sig`**'s by-ref iterator (`take(index)` then the rest) is two slices.
11. **`pretty_print_rpitit`**'s let-chain is nested `if`s; `pretty_print_const_expr`'s tuple match is an if-chain in
    arm order.
12. **Query values typed `unknown`** in queries.gen.ts (`type_of`, `generics_of`, `fn_sig`, `coroutine_kind`,
    `extern_crate`, `codegen_fn_attrs`, `explicit_item_bounds`, `associated_item`) are cast at the call, with a
    PORT note; `CodegenFnAttrs`, `ImplTraitInTraitData`, `Instance`/`InstanceKind`/`ShimKind`, `mir::UnOp`,
    `CastKind` are local view types in their PORTING §5 shape.
13. **`AliasTerm.trait_ref(.., tcx as unknown as Interner)`**: `TyCtxt` lacks 14 `Interner` methods until ty-ctxt.
14. **`print_Instance` / `print_ShimKind`** take `PrinterWrite` (`Printer & { write_str }`, i.e. `P: Printer +
    fmt::Write`).

## `unported(...)` left (all in stand-in fns at the end of each file, named `<Owner>_<method>`)
- rustc_type_ir binder.rs (tyir-binder): `Binder::no_bound_vars`, `EarlyBinder::instantiate`,
  `instantiate_identity`, `iter_instantiated_copied`.
- rustc_type_ir predicate.rs: `TraitRef::new`, `ExistentialTraitRef::with_self_ty`,
  `Binder<ExistentialTraitRef>::with_self_ty`, `Binder<ProjectionClause>::item_def_id`,
  `ExistentialProjection::erase_self_ty`; lib.rs `ClosureKind::extends`; elaborate.rs `elaborate`,
  `Elaborator::filter_only_self`; rustc_middle ty/predicate.rs `UpcastFrom<PolyTraitRef> for Clause`.
- rustc_middle: `Generics::own_args_no_defaults` (generics.rs), `AssocItem::name` (assoc.rs), `AdtDef::did`,
  `AdtDef::field_representing_type_info` (adt.rs), `Debug for Pattern` (pattern.rs), `Expr::{binop,unop,call,cast}_args`
  (consts/kind.rs), `mir::BinOp::to_hir_binop`, `Instance::def_id` (instance.rs).
- lane ty-print-b's items: `FmtPrinter::new` (mod.ts `FmtPrinter_new`, typed `FmtPrinterT`),
  `PrettyPrinter::pretty_print_const_valtree` (`unported_methods`), `Display for Ty` (`display_Ty`, in both files),
  `define_print!` for `AliasTy`, `ExistentialProjection`, `PlaceholderType`.
- Stand-ins with **upstream bodies** (field reads / one-liners): `Binder::rebind`, `EarlyBinder::skip_binder`,
  `Unnormalized::skip_norm_wip`, `TraitRef::self_ty`, `TraitClause::def_id`, `Binder<ProjectionClause>::term`.

## For root (merge with ty-print-b)
- In pretty.ts, the block `// -- lane ty-print-b's items (pretty.rs:1705..end) this region calls: DELETE AT MERGE` (end
  of my region) holds stand-ins for b's items: the `declare module` for `pretty_print_const_valtree` /
  `should_print_verbose`, the `unported_methods` for `pretty_print_const_valtree`, the
  `PrettyPrinter.prototype.should_print_verbose` assignment (upstream body), `OpaqueFnEntry`, `display_Ty`,
  `print_Binder`, `print_FnSig`, `print_TypeAndMut`, `print_AliasTy`, `print_ExistentialProjection`,
  `print_PlaceholderType`, `print_ParamTy`, `print_Term`, `print_GenericArg`, `TraitRefPrintOnlyTraitPath`/`Name`,
  `TraitRef_print_only_trait_path`/`_name`, `print_TraitRefPrintOnlyTraitPath`/`Name`. Delete it and point the calls
  at b's names (tsc duplicate-identifier errors find most); in mod.ts replace `FmtPrinterT` / `FmtPrinter_new` /
  `display_Ty` with b's `FmtPrinter` / `FmtPrinter.new` / Display.
- `trimmed_def_paths` (pretty.rs:3528), `for_each_def` (:3448), `provide` (:3594) and `TyCtxt::def_path_str*` are in
  b's line range (the brief listed `trimmed_def_paths` under this lane, but the line split puts it in b's region).
- Replace ty/decls.ts's pending `Print<T>` with a re-export of mod.ts's `Print` (decision 1).
- D4 descriptors this file builds locally (`fold_Ty_`, `fold_Term_`, `fold_FnSig_`, `fold_TraitClause_`,
  `fold_ExistentialTraitRef_`, `fold_PolyExistentialProjection_`, `fold_ListTy_Ty_`) from the generated free fns:
  replace with shared descriptors when tyir-binder / codegen provide them.
- Consider adopting `print_oracle/probe.rs` as a tools/probes probe (with a `trimmed_def_paths = true` column once
  ty-print-b lands).
