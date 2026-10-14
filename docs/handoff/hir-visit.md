# Handoff: hir-visit (wave 13, M3): rustc_hir intravisit.rs, pat_util.rs, hir.rs fns

## Files touched
- `src/rustc_hir/intravisit.ts` (new): `FnKind` (+ `debug_FnKind`, `header`/`constness`/`asyncness`), `HirTyCtxt`
  (interface) + `HirTyCtxt_never` (the `impl for !`), `NestedFilter` + `IgnoreNested`, the `Visitor<R>` base class
  with every default method, `InferKind`, every `walk_*` fn. Upstream order, markers on all 150 fns.
- `src/rustc_hir/pat_util.ts` (new): `EnumerateAndAdjust` (+ a local `Enumerate` shim), `enumerate_and_adjust`,
  `Pat.prototype.{each_binding, each_binding_or_first, simple_ident, necessary_variants, contains_explicit_ref_binding}`.
- `src/rustc_hir/hir.ts` (new): the 219 hir.rs fns (all but the 3 manual `impl fmt::Debug`, which are hir-types').
  Written in three parallel parts by helpers and merged; sections are marked `// ---- hir.rs lines a-b ----`.
- `src/rustc_hir/intravisit.test.ts` (new, 13 tests): visit order over a hand-built `fn f<T>(x: T) -> T { let y = x; y }`
  with nested bodies, IgnoreNested, nested items via `maybe_tcx`, the `maybe_tcx` panic, ControlFlow early exit,
  walk_local/ExprKind::Let order, Assign rhs-before-lhs, infer types -> `visit_infer`, Slice/Tup; pat_util
  (`enumerate_and_adjust`, `each_binding`, `simple_ident`, `contains_explicit_ref_binding`, `necessary_variants`).
  Expected orders are written from the upstream walk fns (line numbers in comments).
- `src/rustc_hir/lib.ts`: `export * as intravisit`, `export * as pat_util`, `export * from "./hir.ts"` (`pub use hir::*`).
- **STAND-IN** `src/rustc_hir/hir_standin.ts` (see "For root" 1).

## Coverage (`bun scripts/coverage.ts --missing <file>`)
- intravisit.rs 150/150, pat_util.rs 9/9, hir.rs 219/222 (missing: :1357 OwnerNodes, :1723 DotDotPos, :3765
  FnDeclFlags `fmt` = the manual Debug impls, lane hir-types). `coverage --check`: markers ok.

## Checks
- `bunx tsc --noEmit -p .` clean. `bun test src/rustc_hir`: 25 pass. Full `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 3903 pass, 1 skip, 1 fail = the timing test
  `format_debug of a deep chain is linear in the output size` (src/std/fmt.test.ts), which passes when rerun alone (load flake).
- `RUST_TS_AGENT=hir-visit bun scripts/difftest.ts --suite parse --sample 200`: 200/200 MATCH (run 20261014-011532-hir-visit-7hy0).
- Each of rustc_hir/{lib,hir,intravisit,pat_util,hir_standin}.ts loads as an entry point.
- Nothing outside rustc_hir imports rustc_hir/lib.ts, so the difftest pipeline does not load the new code.

## `unported(...)` left
- `hir.ts` `Expr.equivalent_for_indexing`, the `(Lit, Lit)` arm: needs `<rustc_ast::ast::LitKind as PartialEq>::eq`
  (the existing `LitKind_eq` is for the token `LitKind`). Fix: an `ast::LitKind` eq helper (generated derive or rustc_ast).

## For root
1. **Stand-in for the hir.rs types.** hir-types had not landed, so `src/rustc_hir/hir_standin.ts` is the output of
   `bun tools/codegen/types.ts rustc_hir` at the pin with `compiler/rustc_hir/src/hir.rs` added to the set and a scratch
   typemap (rustc_ast `LitKind/BoundConstness/BoundPolarity/CaptureBy/Recovered/Label/InlineAsmTemplatePiece/MacroDef/
   ImplPolarity/UnOp/BorrowKind/UnsafeBinderCastKind/AsmMacro/IsAuto/BinOp/AssignOp`, rustc_ast_ir `Pinnedness/
   Movability`, rustc_target `InlineAsmReg/InlineAsmRegClass`, `Fingerprint`), plus hand edits marked `STAND-IN:`
   (unported stubs for the 3 manual Debugs, type-only `TaggedRef<P, T>` / `ItemLocalMap<T>` / `DelayedLints`).
   **At merge**: delete it, and in `hir.ts` and `pat_util.ts` replace `./hir_standin.ts` by `./hir.gen.ts` (imports,
   `import * as gen`, `export *`, the 3 `declare module` blocks in hir.ts and the one in pat_util.ts). hir-types'
   hir.ts content (re-export of hir.gen.ts, the 3 manual Debugs, PrimTy/Safety moved from def.ts) merges into my
   hir.ts: keep one `export * from "./hir.gen.ts"`; my companions (`PrimTy`, `Safety`, `Constness`, ...) spread `gen.X`.
2. Expected friction with the real hir.gen.ts:
   - `TaggedRef`: intravisit `walk_ty` calls `lifetime.pointer()` on `TyKind::TraitObject`'s `_1` (`&TaggedRef` derefs
     to `&Lifetime`). Whatever TS shape hir-types/rustc_data_structures gives `TaggedRef`, it needs that accessor.
   - Field-name clashes renamed with `_`: `PathSegment.args_()`, `GenericArgs.span_ext_()`, `FnDeclFlags.splatted_()`,
     `FnHeader.safety_()`. hir-types' `debug_FnDeclFlags` (hir.rs:3765) must call `splatted_()`.
   - `hir.ts` imports `SortedMap` from `rustc_hir_id/definitions.ts` (where the codegen typemap points); if hir-types
     repoints it to `rustc_data_structures/sorted_map.ts`, `AttributeMap.EMPTY`/`OwnerNodes.synthetic` follow.
   - The derived `Default` of `Safety`/`Defaultness` is not written (codegen's).
3. `Enumerate` in pat_util.ts is a local shim of `std::iter::Enumerate` over a slice; move to src/std if one appears.
4. `necessary_variants` dedups with a local `Set<number>` keyed `krate * 2^32 + index` (plan D5); switch to
   `DefIdSet` when ty-contract lands it.
5. Comment conventions: `// rustc-trait:` on trait representations (HirTyCtxt, NestedFilter, Visitor,
   EnumerateAndAdjustIterator), `// rustc-macro:` on the hand-expanded `expect_methods_self_kind!`/`expect_methods_self!`
   fns (TraitItem/ImplItem/Item/OwnerNode/Node `expect_*`), which coverage.ts does not count.
6. The lane brief mentions `nested_visit_map` and `VisitorExt`: neither exists at the pin. The pin has
   `maybe_tcx()` + `type NestedFilter` (ported) and `final fn visit_ty_unambig` / `visit_const_arg_unambig` on the
   trait itself (ported as ordinary methods; TS has no `final`).

## PORT decisions
- **Visitor shape** mirrors rustc_ast/visit.ts: base class `Visitor<R = undefined>`; `Result` (VisitorResult impl
  object, default `unit`) and `NestedFilter` (`{INTER, INTRA}`, default `IgnoreNested`) are prototype properties;
  `type MaybeTyCtxt` is erased (`maybe_tcx(): HirTyCtxt`). `try_visit!` is the ast-visit expansion; `visit_opt!` /
  `walk_list!` expanded inline. `walk_use`'s unchecked `visitor.visit_id(hir_id)` stays unchecked like upstream.
- `Ty<'hir, AmbigArg>` = `Ty<AmbigArg>` with `AmbigArg = never`; the `Infer` arms that upstream cannot reach on
  `TyKind<AmbigArg>`/`ConstArgKind<AmbigArg>` are `unreachable()`. Pointer casts between ambig/unambig are identity.
  `impl X<'hir, AmbigArg>` fns live on companions `TyAmbig` (`as_unambig_ty`, `peel_refs`) and `ConstArgAmbig`
  (`as_unambig_ct`), since `peel_refs` exists on both impls (the ast.ts `AssocItem` precedent).
- hir.rs method placement follows ast.ts (header of hir.ts): enum fns on companions spreading `gen.X`, class fns on
  prototypes (`declare module`), statics/assoc consts assigned onto the class; `From` -> `X.from_A`, Display ->
  `display_X`, IntoDiagArg -> `X_into_diag_arg`. Assoc consts (`GenericArgs.NONE`, `TraitBoundModifiers.NONE`,
  `AttributeMap.EMPTY`, `Generics.empty`'s `NOPE`) are frozen shared values.
- Copies of `Copy` HIR values are identity (no HIR MutVisitor; arena data is never edited in place).
- `expect_failed<T: Debug>` takes `debug_T`; `display_CoroutineKind`/`CoroutineDesugaring` take `f: Fmt = PLAIN` for `{:#}`.
- `FnDeclFlags::set_*` (by-value `mut self`) work on `clone_FnDeclFlags(this)`; `!MASK` on u8 is `~MASK & 0xff`.
- `UseTree::resolutions` (`iter!` coroutine) is a generator; `bounds_for_param`/`outlives_for_param` return arrays.
- pat_util: `EnumerateAndAdjustIterator` (trait + blanket impl over `ExactSizeIterator`) is the free fn
  `enumerate_and_adjust(slice, expected_len, gap_pos)`; `BindingMode::REF`/`REF_MUT` patterns compare structurally.
- The remaining per-fn `// PORT:` notes are inline in hir.ts (34), intravisit.ts (13) and pat_util.ts (7).
