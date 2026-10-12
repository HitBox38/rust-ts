# Handoff: ast-visit (rustc_ast visit.rs, mut_visit.rs, ast_traits.rs)

## Files touched
- `src/rustc_ast/visit.ts`: the `Visitable`/`Walkable` traits and generic impls, the expansion of
  `common_visitor_and_walkers!(Visitor<'a>)`, `generate_list_visit_fns!`, `walk_stmt`, `BoundKind.descr`.
- `src/rustc_ast/mut_visit.ts`: the `MutVisitable`/`MutWalkable` traits and generic impls, the expansion of
  `common_visitor_and_walkers!((mut) MutVisitor)`, `generate_flat_map_visitor_fns!`,
  `generate_walk_flat_map_fns!`, the `walk_flat_map_*` / `walk_filter_map_expr` fns.
- `src/rustc_ast/ast_traits.ts`: `HasNodeId`, `HasTokens`, `HasAttrs` (all macro-generated and generic impls) and the
  `AstNodeWrapper` statics and impls.
- `src/rustc_ast_ir/visit.ts` (**outside my assignment**; see For root): `VisitorResult` and its 3 impls,
  `try_visit`, plus a `ControlFlow` type.
- New test file `src/rustc_ast/visit.test.ts` (22 tests).

## Coverage (`bun scripts/coverage.ts --missing <file>`)
visit.rs 50/50, mut_visit.rs 18/18, ast_traits.rs 48/48, rustc_ast_ir/src/visit.rs 16/16. `coverage --check`: markers ok (1750).

## Checks
- `bunx tsc --noEmit -p .` clean. `bun test src`: 150 pass, 0 fail (16 files).
- `RUST_TS_AGENT=ast-visit bun scripts/difftest.ts --suite lex --sample 200`: 200/200 MATCH (run 20261012-201654-ast-visit-evz3).
- Each module loads as an entry point in a fresh process: rustc_ast_ir/visit, rustc_ast/{visit,mut_visit,ast_traits,lib}.

## `unported(...)` left
- **All `#[derive(Walkable)]` impls** (147 types from ast.rs, format.rs and tokenstream.rs; the list matches the
  typedefs JSON exactly): `rustc_macros::Walkable derive (Walkable::walk_ref) for X` and `(MutWalkable::walk_mut) for X`.
  Derives are generated code (PORTING §5), so I did not hand-write them. **The visitors cannot walk anything except
  `Expr`/`Impl`/`MethodCall`/items/fns/stmts until they are generated.** Any `walk_block`, `walk_ty`,
  `walk_pat`, `walk_path`, ... call, or any walk that reaches such a node, ends in `Unported`. Spec below.
- `debug_AstNodeWrapper`'s `tag` field (pre-existing from ast-types: `core::any::type_name`).

## For root
1. **Codegen item `derive(Walkable)` (blocks every later visitor lane).** For each of the 147 types, emit two entries
   with the same key as in `walkable_derived` (visit.ts) and `mut_walkable_derived` (mut_visit.ts), and replace those
   stub tables. This follows `rustc_macros/src/visitable.rs`:
   - immutable: `X: <R>(self: X, __visitor: Visitor<R>): R => { let r; <per field>; return __visitor.Result.output(); }`,
     per field: `if ((r = try_visit(__visitor.Result, IMPL(self.f, __visitor, EXTRA))) !== undefined) return r;`
   - mutable: `X: (self: X, __visitor: MutVisitor): void => { <per field> }`, per field
     `MUTIMPL(self, "f", __visitor, EXTRA);`
   - Fields go in declaration order. For enums, use `switch (self.$)` with one case per data variant, fields `_0.._n`
     or named. String-literal enums and unit variants visit nothing. Skip `#[visitable(ignore)]`. Use the TS field
     name (`super_`).
   - EXTRA is `#[visitable(extra = BoundKind::Bound)]` → `BoundKind.Bound` (likewise `LifetimeCtxt.*`,
     `AssocCtxt.Trait`), else `undefined`.
   - IMPL(type): `Box<T>` → IMPL(T). `Option<T>` → `Visitable.Option(x, v, e, IMPL(T))`. `Spanned<T>` (also the
     aliases `BinOp`, `AssignOp`, `ExplicitSelf`) → `Visitable.Spanned(.., IMPL(T))`. `Vec<T>` → `Visitable.Vec`.
     Tuples → `Visitable["(T1, T2)"]`. `ThinVec<..>` (also `AttrVec`, `GenericBounds`) → `Visitable["ThinVec<T>"]`
     with the element text kept, paths stripped (`ThinVec<Box<Ty>>`); this key must exist, as upstream would fail
     to compile otherwise. Any other type → `Visitable.<last path segment>` (`token::Lit` → `Lit`).
     The mutable side is the same with `MutVisitable` and the slot form `(o, k, ...)`.
   - No derived type is generic. A generated module can import `Visitable`/`try_visit` from visit.ts, since it only
     touches them inside fn bodies, so the ESM cycle is safe.
2. `src/rustc_ast_ir/visit.ts` was an unowned stub. Its port is the base of the Visitor contract, so I ported it here
   rather than shim it. Please confirm or reassign. Its `ControlFlow` (`{$:"Continue",_0}|{$:"Break",_0}`,
   `ControlFlow.CONTINUE` / `.Break(b)`) belongs in `src/std/ops.ts`; move it and re-export it from there.
3. `flat_map_in_place` is a local shim in mut_visit.ts: the same algorithm as
   `rustc_data_structures/src/flat_map_in_place.rs`, with no marker. Move it to
   `src/rustc_data_structures/flat_map_in_place.ts` once that crate is ported.
4. `rustc_ast/lib.ts`: `pub use self::ast_traits::{AstNodeWrapper, HasAttrs, HasNodeId, HasTokens}` can now be
   complete: add `HasAttrs, HasNodeId, HasTokens` (value and type) to the `./ast_traits.ts` re-export.
5. `TokenStream.from_ast(node, {tokens, attrs, debug})` (tokenstream.ts, ast-token PORT) can now take
   `HasAttrs<T>` and `HasTokens<T>` impl objects.
6. Comment conventions I introduced (coverage.ts does not parse them): `// rustc-trait: <path>:<line> <Trait>` on
   trait representations. `// rustc-macro: <path>:<line> <macro>!` on expansions of fns whose name is a macro
   metavariable (`fn $visit`, `fn $walk`, `pub fn $fn_name`), which coverage.ts does not count as upstream fns.
7. `MutRef` lives in `rustc_span/hygiene.ts`; it is now used crate-wide (mut_visit, ast_traits) and might belong in std.
8. No ast-core (ast.rs fn) dependencies were needed; I only import types and generated Debug fns from `./ast.ts`.

## PORT decisions
- **Macro layout**: each `common_visitor_and_walkers!` invocation is written out in its own file in expansion order,
  using that file's helper macros. Markers sit on the line of the `fn` keyword inside the macro, which is what
  coverage.ts counts, so both expansions share visit.rs's markers. The `impl_visitable!`/`impl_walkable!` impls
  carry the marker of the helper macro's `fn` line in their own file (visit.rs:213/225/236/262,
  mut_visit.rs:165/177/188/213).
- **Trait dispatch**: `Visitable`/`Walkable`/`MutVisitable`/`MutWalkable`/`HasNodeId`/`HasTokens`/`HasAttrs`/
  `WalkItemKind` are each a type (one impl's signature) plus a same-named const table of impls, keyed by the
  implementing type as written upstream (`Visitable.Expr`, `Visitable["ThinVec<Box<Ty>>"]`). Generic impls take the
  type parameter's impl as an extra argument (`Visitable.Option(x, v, e, Visitable.Label)`) or, in ast_traits, are
  functions returning an impl object. `Box<T>` is the identity, so call sites use T's impl directly. Tables are
  assembled at the bottom of each file from per-macro groups that are kept in upstream order.
- **`Visitor::Result`**: carried by the visitor in its `Result` property (a `VisitorResult` impl object; `()` =
  `undefined` is the prototype default). `try_visit!` → `if ((r = try_visit(v.Result, e)) !== undefined) return r;`.
  `MutVisitor` has `Result = ()` (sealed), so its expansion drops `try_visit!` and `output()`.
- **`&mut` in MutVisitor**: `MutVisitable` impls take the *slot* `(o, k)` of the value. Hooks and `MutWalkable` get
  node objects and mutate them in place. Copy handles get a `MutRef` view: `visit_id(MutRef<NodeId>)`,
  `visit_span(MutRef<Span>)`, `visit_ident(MutRef<Ident>)`, and `FnKind::Closure._1: MutRef<Option<CoroutineMarker>>`.
  The default `visit_ident` copies on write: a span write stores a new `Ident` into the slot, so a shared `Ident` is
  never mutated.
- `FnKind` (defined inside the macro, so not generated): hand-written type plus `debug_FnKind` (the derive(Debug)
  shape), methods on the companion (`FnKind.header/ident/decl/ctxt`). The mutable `FnKind.ident` returns
  `MutRef<Ident>`.
- `WalkItemKind` generic fns take the impl as their last argument: `walk_item(v, item, WalkItemKind.ItemKind)`,
  `walk_assoc_item(v, item, ctxt, WalkItemKind.AssocItemKind)`.
- `SmallVec<[T; 1]>` → `T[]`; `Option<T>: IntoIterator` → `option_into_iter`.
- `HasAttrs::visit_attrs(f)` passes the `AttrVec` array; `f` edits it in place (upstream callers only
  `insert`/`flat_map_in_place`). `node_id_mut`/`tokens_mut` return `MutRef` views. `Stmt`'s
  `SUPPORTS_CUSTOM_INNER_ATTRS` is a getter onto `StmtKind`'s. `AstNodeWrapper.from_mut` returns a wrapper sharing
  the node object: a node replaced via `.wrapped = x` does not reach the caller, so replace it in place.
- `AstNodeWrapper.new/from_mut/from` are statics assigned onto the generated class (ast-token pattern).
- `Visitor`/`MutVisitor` are base classes; the `fn_visit!` hook methods carry `// rustc-macro:` (no upstream fn).

## Contract for later lanes (parser, AST validation, resolve, expansion)
```ts
import { Visitor, walk_expr, walk_item, WalkItemKind, VisitorResult, try_visit } from "../rustc_ast/visit.ts";
class MyVisitor extends Visitor {                 // `type Result = ()`; methods return `undefined`
  override visit_expr(e: Expr): undefined { /* ... */ return walk_expr(this, e); }
  override visit_item(i: Item): undefined { return walk_item(this, i, WalkItemKind.ItemKind); }
}
class Finder extends Visitor<ControlFlow<Span>> { // `type Result = ControlFlow<Span>`
  override Result = VisitorResult.ControlFlow<Span>();
  override visit_ty(t: Ty): ControlFlow<Span> {
    let r; if ((r = try_visit(this.Result, walk_ty(this, t))) !== undefined) return r;   // try_visit!(..)
    return this.Result.output();
  }
}
```
- Hook names, extras and `walk_*` names are upstream's: `visit_lifetime(lt, LifetimeCtxt)`,
  `visit_param_bound(b, BoundKind)`, `visit_assoc_item(item, AssocCtxt)`, `visit_fn(fk, attrs, span, id)`,
  `visit_id(id)` (by value), `visit_stmt` (immutable only), `walk_mac` for `visit_mac_call`.
- To visit a field generically, as `visit_visitable!` does, use `Visitable.<Type>(value, visitor, extra)`
  (immutable) or `MutVisitable.<Type>(owner, "field", visitor, extra)` (mutable).
- `MutVisitor`: `visit_*(node)` mutates in place; `visit_id(id: MutRef<NodeId>)` (`id.value = fresh`),
  `visit_span(MutRef<Span>)`, `visit_ident(MutRef<Ident>)`; `flat_map_*(node): T[]`, `filter_map_expr(e): Expr | undefined`;
  the `walk_flat_map_*` fns, `walk_filter_map_expr`, `walk_flat_map_stmt`. `field_ref(obj, "key")` (mut_visit.ts) makes a
  `MutRef` onto a field.
- Traits: `HasAttrs.Item.attrs(i)`, `HasAttrs.Item.SUPPORTS_CUSTOM_INNER_ATTRS`, `HasTokens.Expr.tokens_mut(e)`,
  `HasNodeId.Stmt.node_id(s)`; generic: `HasAttrs.Box(HasAttrs.Expr)`, `HasTokens.Option(..)`,
  `HasAttrs.WithTokens(HasAttrs.Item)`, `HasNodeId.AstNodeWrapper(HasNodeId.Expr)`. Code bounded by
  `T: HasAttrs + HasTokens` takes both impl objects.
