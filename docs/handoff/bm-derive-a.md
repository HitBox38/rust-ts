# Handoff: bm-derive-a (wave 9, M2: derive infrastructure)

Branch `lane/bm-derive-a` (from main d2db7fd). No merges, no files outside `src/rustc_builtin_macros/` touched.

## Pin facts that differ from the brief
At the pin, `deriving/generic/ty.rs`, `deriving/bounds.rs` and `deriving/cmp/` **do not exist**. `MethodDef`
takes ready-made `ast::Ty`s / `ast::Generics` (no `ty::Ty`/`Path`/`Bounds` DSL), and the `cs_*` helpers live
in the individual derive files (partial_eq.rs, partial_ord.rs, ...), not in generic/mod.rs. So this lane is
derive.rs (153 lines), deriving/mod.rs (127) and deriving/generic/mod.rs (1297).

## Files
- **Ported** (replacing bm-a's stubs), every fn in upstream order with markers:
  - `src/rustc_builtin_macros/derive.ts`: 5/5
  - `src/rustc_builtin_macros/deriving/mod.ts`: 6/6 (keeps the `export * as <derive>` lines for the stubs)
  - `src/rustc_builtin_macros/deriving/generic/mod.ts` (new): 26/26
- **Tests:** `src/rustc_builtin_macros/derive.test.ts` + `derive_oracle/{probe.rs,cases.txt,out.stdout,out.stderr,run.ts,fixtures.ts}`.
- The individual derives (`deriving/{clone,copy,debug,...}.ts`) are still bm-a's stubs, untouched.

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 2708 pass, 1 skip (pre-existing linux-only), 0 fail.
- `bun scripts/coverage.ts --check`: markers ok (5818; vendor 2403). `--missing`: derive.rs 5/5, deriving/mod.rs 6/6,
  deriving/generic/mod.rs 26/26.
- `RUST_TS_AGENT=bm-derive-a bun scripts/difftest.ts --suite parse --sample 200`: 200/200 MATCH (`20261013-095015-bm-derive-a-qviy`).
- `--suite expanded-nocore --sample 200`: 3 MATCH, 197 UNPORTED, 0 DIFF (`20261013-095020-bm-derive-a-y7fj`); all stop at the
  known `validate_crate_name`, before expansion, so derives are not reached by that suite yet.

## Oracle test (`derive.test.ts`, 83 tests)
- **Probe** `derive_oracle/probe.rs` (rustc-dev, build/run commands in its header; scratch in `$RUST_TS_DATA/tmp/bm-derive-a/`):
  real `Session` from `run_compiler`, `register_builtin_macros` into a recorder, then per case: parse one item, take its first
  attribute off, fresh `LocalExpnId` (`ExpnKind::Macro(Attr|Derive, name)`), then
  - `attr` / `attr_stmt`: the registered `LegacyAttr` for `derive` / `derive_const` (`derive::Expander`) on `Annotatable::Item`
    (or `Stmt(StmtKind::Item)`); the mock `resolve_derives` calls the `derive_paths` closure and prints every
    `DeriveResolution` (path, is_const, exts, `{:#?}` of the cfg-eval'd item); a path named `later` gives `Indeterminate` → `Retry`.
  - `builtin` / `builtin_stmt`: the registered `LegacyDerive` (`BuiltinDerive`) with the derive path's span and `is_derive_const`.
  - stdout: `{:#?}` of every resulting `Annotatable` (all NodeIds, AttrIds, spans with ctxt); stderr: the session's diagnostics.
- **Port side** `run.ts` does the same calls. `builtin` cases for **Copy, Hash and Eq** run through `fixtures.ts`: test-only
  transcriptions of copy.rs / hash.rs / eq.rs on top of the ported `TraitDef` (no markers; brief: "a trivial custom TraitDef"),
  wrapped in the ported `BuiltinDerive`. A probe cannot build its own `TraitDef` (it is `pub(crate)`), so these fixtures are what
  exercises generic/mod.rs today.
- **Result:** 73/73 non-pending cases match byte for byte (stdout 26,516 lines, stderr 297).
  Coverage: derive on fn/trait/mod/static/impl (E0774), `#[derive]`, `#[derive = ".."]` (malformed), `derive(Foo = "x")`,
  `derive(Debug(abc))`, both mixed, literals (E0777, with the `StrLit` help for ident-like cooked strings and `Other` otherwise),
  `unsafe(derive(..))`, empty list, trailing comma, multi-segment/global paths, cfg_eval of the cloned item (struct fields,
  enum variants/fields, nested cfg_attr), Retry, derive_const, statements (good and bad); Copy/Hash/Eq on unit/tuple/named
  structs, unions (+ `DeriveUnion` for Hash), enums (empty, one fieldless, all fieldless → `EnumDiscr(None)`, one with fields,
  mixed, `A {}`/`B()`), packed structs (field blocks, `Copy` bounds), packed enums (no impl), lifetimes/type/const params with
  defaults and attrs, where clauses (with attrs, `for<>`), `find_type_parameters` (assoc types, QSelf, `for<>` fn pointers and
  trait objects, nested generics), type macros (`DeriveMacroCall`, also with no type params), kept lint/stability attrs,
  `#[rustc_const_unstable]` with `staged_api` + derive_const, `assert_fields_are_eq` dropped for an empty body, `assert_ty_bounds`.
- **PENDING (10 cases, bm-derive-b):** clone_struct, clone_enum, partial_eq_struct, partial_eq_enum, partial_eq_packed,
  debug_fieldless, debug_enum, ord_enum, partial_ord_struct, default_struct. The probe recorded their real output (two self-like
  args, `call_unreachable`, `Default` / `SpecializeIfAllVariantsFieldless`, `has_derive_copy`/`has_derive_ord`); the test requires
  the port to stop at `unported` for them. **bm-derive-b:** clear their pending column in cases.txt; they must then match.
  Also delete `fixtures.ts` and the `FIXTURES` map in run.ts once copy/hash/eq are ported (expected outputs stay the same).
- **Negative control:** dropping `sym.stable` from the kept-attr list, `is_const: false` in `DeriveResolution`, and two
  generic/mod.ts perturbations fail the affected cases (attr_const, copy_lint_attrs, copy_enum, copy_generics, ...).
- **CLI cross-check:** `rustc +nightly-2026-10-11 -Zunpretty=expanded` on a file with derive on fn, `#[derive]`,
  `derive(Foo = "x")`, `derive(Debug(abc))` and `derive("Debug")` gives the same messages and spans as the probe's cases.

## TraitDef API contract (for bm-derive-b)
Import from `./generic/mod.ts` (generic) and `../mod.ts` (deriving/mod.ts). `ast` is re-exported by generic/mod.ts
(`pub(crate) use rustc_ast as ast`). `SmallVec`/`ThinVec` → arrays; `Box<T>` → `T`; `Option` → `| undefined`.

- **`new TraitDef(span, path, skip_path_as_bound, needs_copy_as_bound_if_packed, additional_bounds: ast.Path[],
  supports_unions, methods: MethodDef[], is_const, safety: ast.Safety, document)`**: positional, struct field order.
  `trait_def.expand(cx, item, push)` / `trait_def.expand_ext(cx, item, push, from_scratch)`.
- **`new MethodDef(name: Symbol, generics: ast.Generics, explicit_self, nonself_args: [ast.Ty, Symbol][],
  has_other_selflike_arg, ret_ty: ast.Ty, attributes: ast.AttrVec, fieldless_variants_strategy, combine_substructure)`**.
- **`FieldlessVariantsStrategy`**: `"Unify" | "Default" | "SpecializeIfAllVariantsFieldless"` (+ companion const).
- **`combine_substructure(f)`** returns `f`; `CombineSubstructureFunc = (cx, span, substr: Substructure) => BlockOrExpr`.
  Closures capturing locals (ord.rs's `discr_then_data`) are plain arrow functions.
- **`Substructure`** = `{ fields: SubstructureFields; type_ident: Ident }`.
- **`SubstructureFields`** (`use SubstructureFields::*` → object literals): `{ $: "Struct", _0: VariantData, _1: FieldInfo[] }`,
  `{ $: "AllFieldlessEnum", _0: EnumDef }`, `{ $: "EnumMatching", _0: Variant, _1: FieldInfo[] }`,
  `{ $: "EnumDiscr", _0: Expr | undefined }`, `{ $: "StaticStruct", _0: VariantData }`, `{ $: "StaticEnum", _0: EnumDef }`.
  `_0` for `&'a VariantData`/`EnumDef`/`Variant` is the item's own node (a borrow: do not mutate it).
  `match substr.fields { Struct(_, fields) | EnumMatching(.., fields) => .. }` → `case "Struct": case "EnumMatching": f._1`.
- **`FieldInfo`** = `{ span, name: Ident | undefined, self_expr: Expr, other_selflike_expr: Expr | undefined, maybe_scalar }`.
  The exprs are owned (moved out in Rust): use them directly.
- **`BlockOrExpr`**: class with `_0: Stmt[]`, `_1: Expr | undefined`; `new BlockOrExpr(stmts, expr)` for the tuple constructor,
  `BlockOrExpr.new_stmts/new_expr/new_mixed`; `into_block`/`into_expr` are module-private in Rust but are methods here.
- **generic/mod.ts free fns:** `generic_param_to_arg(cx, p, span)`, `generics_without_defaults(g)` (exported).
- **deriving/mod.ts:** `path_std(cx, span, [sym.marker, sym.Copy])` for `path_std!(cx, span, marker::Copy)`;
  `new_path`, `call_discriminant_value`, `call_unreachable`, `assert_ty_bounds(cx, stmts, ty, span, [sym.cmp, sym.AssertParamIsEq])`
  (`&mut ThinVec` → the array, pushed in place) are exported; `BuiltinDeriveFn = (cx, span, item, push, is_const) => void`.
- **Spans:** `Span.with_ctxt(s, c)`, `Span.ctxt(s)` etc. are functions on the `Span` namespace (rustc_span/lib.ts).
- **Clones:** `field.ty.clone()` → `clone_Ty(field.ty)` (`ast.clone_Ty`); other derive(Clone)s are `clone_<T>` in
  rustc_ast/ast.gen.ts. Idents are shared by reference (as the generated clones do).
- Look at `derive_oracle/fixtures.ts` for three complete examples (copy/hash/eq) written against this API.

## `unported(...)` left
- None in the ported files. The individual derive stubs (bm-derive-b) still `unported`.

## `// PORT:` decisions (please record)
1. `pathvec!` / `path_std!` decl macros → `path_std(cx, span, syms)` helper in deriving/mod.ts (no marker: not a fn upstream).
2. `&mut dyn FnMut(Box<ast::Item>)` push callbacks → `(item) => void`.
3. `TraitDef` / `MethodDef` are classes whose methods (`impl` blocks at lines 452 / 790) are attached to the prototype at their
   upstream position (interface merging), so the file keeps upstream fn order.
4. The lazy `self.methods.iter().filter_map(..)` in `expand_ext` is a generator: method bodies are built when
   `create_derived_impl` collects them (after the generics, where clause and impl attributes), as upstream; this fixes the
   `AttrId`/symbol creation order. The `fields` iterators are eager arrays (no side effects).
5. `create_struct_patterns`' lazy `pieces_iter` is a generator consumed inside the `Struct`/`Tuple` arms.
6. `ast::Path { span, ..p.clone() }` → `clone_Path(p)` then `.span = span`.
7. `ast::WhereClause::default()` and `AttributeTemplate { list, ..Default::default() }` are written out.
8. `Vec::remove(0)` in `create_fields` panics with std's message when empty (unreachable: prefixes are never empty).
9. The fn-local `struct Visitor` of `find_type_parameters` is a local subclass of `visit.Visitor`.
10. `if let [first, others @ ..] = &mut resolutions` (derive.rs) → a length check and destructuring of the array.

## For root
1. `docs/claims/bm-derive-a.md` can be removed on integration.
2. Hand bm-derive-b the "TraitDef API contract" above and the pending list; it also owns removing `fixtures.ts`.
3. The `expanded-nocore` suite will only reach derives once the resolver (wave 10) runs `resolve_derives` /
   `take_derive_resolutions`; until then derive.test.ts is the evidence.
