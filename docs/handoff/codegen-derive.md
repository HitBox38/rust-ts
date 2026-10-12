# Handoff: codegen-derive (wave 4b tools lane)

## Files touched
- Generator: `tools/codegen/types.ts`, `tools/codegen/typemap.json`, `tools/codegen/typemap.ast.json`,
  `tools/codegen/types.sets.json`. Probe unchanged: `tools/probes/typedefs` already records field attributes
  (all 27 `#[visitable(..)]` attrs of rustc_ast are in the JSON as `{path: "visitable", text}`).
- Tests: new `tools/codegen/derive.test.ts` (5), `tools/codegen/macros.test.ts` (golden file count 20 -> 22),
  new `src/rustc_ast/derive_clone.test.ts` (4), `src/rustc_ast/visit.test.ts` (closure test + 5 new derived
  walk tests), `src/rustc_ast/ast.test.ts` (`Expr::to_ty` of a path now clones instead of `Unported`).
- Regenerated (rustc_ast set): 14 changed `.gen.ts` + 2 new: `src/rustc_ast/walkable.gen.ts`,
  `src/rustc_ast/mut_walkable.gen.ts`. rustc_errors and rustc_lexer outputs are byte-identical to before.
- Wiring: `src/rustc_ast/visit.ts`, `mut_visit.ts` (stub tables -> generated), `ast.ts` (6 `derive_clone` sites,
  `Ty::clone`, `clone_Ty`), `expand/typetree.ts` (`Type::from_ty`), `util/parser.ts` (hand
  `ExprPrecedence_discriminant` deleted; uses the generated one).

## Generator changes
1. **derive(Walkable)** (port of `rustc_macros/src/visitable.rs`): for each crate with `#[derive(Walkable)]` types,
   `<crate>/walkable.gen.ts` exports `walkable_derived` and `<crate>/mut_walkable.gen.ts` exports
   `mut_walkable_derived`, one entry per type (147 each, upstream file/line order, `// rustc-derive:` comment).
   Per field in declaration order (enums: `switch (self.$)` per data variant), unless `#[visitable(ignore)]`:
   ref `if ((r = try_visit(__visitor.Result, IMPL(self.f, __visitor, EXTRA))) !== undefined) return r;` then
   `__visitor.Result.output()`; mut `MUTIMPL(self, "f", __visitor, EXTRA);`. EXTRA = `#[visitable(extra = X::Y)]`
   -> `X.Y` (value import of `X`), else `undefined`. IMPL: `Box`/`&` -> inner; `Option`/`Vec`/`Spanned`/`[T]` ->
   the generic impl with the element impl; 2..4-tuples -> `Visitable["(T1, T2)"]`; a type alias of an external
   type (`AttrVec`, `GenericBounds`, `BinOp`) is expanded; anything else -> `Visitable.<Name>` or
   `Visitable["<text with paths and lifetimes stripped>"]` (`ThinVec<Box<Ty>>`, `Cow<str>`). Composite element impls
   are closures (mut side annotated `<K extends PropertyKey>(o: Place<T, K>, k: K, v: MutVisitor, e: E)`: TS
   cannot infer them). Unknown shapes, generic or union derives are `ERROR:`s.
2. **derive(Clone)** (set option `derive_clone`, on for rustc_ast): `export function clone_<T>(v: T): T`
   (generic: `clone_<T><P>(v, clone_P: (v: P) => P)`) for every derive(Clone) struct/enum: classes are rebuilt
   with `new T(..)` (prototype kept), interfaces/variants as object literals, unit variants returned (frozen
   singletons). Field clone: typemap `clone` rule per external type: `copy` (numbers, strings, Span, Symbol,
   Ident, NodeId, ...), `share` (`Rc`/`Arc`/`Lrc`: same pointee), `transparent` (`Box`, `Cow`, `Cell`,
   `RefCell`), `option`, or a template (`Vec`/`ThinVec` `$v.map($c0)`, maps, `Range`, `Spanned`, `Result`,
   `GrowableBitSet`); identity element clones are elided (`.slice()`). Manual `impl Clone` -> `clone_<T>` imported
   from the hand module (report `manual_clone`; only `Ty`). Missing rules -> `unported_clone` + report
   `missing_clone` (0 now).
3. **Pu128**: own typemap entry, Debug `debug_tuple($f, "Pu128", [debug_int($v, $f)])` (TS value stays `bigint`).
   Oracle-checked (`-Zunpretty=hir-tree`, `let _ = 1u8;`) in derive.test.ts.
4. **`<Enum>_discriminant`** also for fieldless enums deriving `PartialOrd`/`Ord`: exactly the 8 expected
   (ParamKindOrd, ExprPrecedence, IntTy, UintTy, FloatTy, Movability, Mutability, Pinnedness).
5. **Skip entries** that match no probed item now need a `skip_notes` reason (else `ERROR:`); the note names the
   `macro_rules!` that mentions the type. `rustc_ast::visit::FnKind` added to skip with its note. I checked the
   hand-written `FnKind` in visit.ts against visit.rs:385-399: variants, field shapes and Debug match.
6. Import lines drop a `type X` when the value `X` is imported under the same name; report has
   `clone_fns`/`walkable` per file; CLI summary prints them.

## Counts
rustc_ast set: 22 files, 252 types, 224 Debug fns, **231 clone fns** (233 derive(Clone) types minus
`InlineAsmOptions` (bitflags, a branded number) and `TokenStreamIter` (skipped)), **294 walkable impls** (147x2),
missing clone 0, unknown types 0, errors 0. rustc_errors / rustc_lexer: derive_clone off (unchanged output).

## Evidence
- `bunx tsc --noEmit -p .`: clean. `bun test src tools`: 292 pass, 0 fail.
- `bun scripts/coverage.ts --check`: markers ok (1950). visit.rs 50/50, mut_visit.rs 18/18, ast.rs 160/160,
  util/parser.rs 8/8, expand/typetree.rs 7/7.
- `RUST_TS_AGENT=codegen-derive bun scripts/difftest.ts --suite lex --sample 200`: 200/200 MATCH
  (run 20261012-203908-codegen-derive-0j2u).
- Fresh-process entry loads OK: rustc_ast/{visit,mut_visit,ast,tokenstream,format,lib,util/parser,expand/typetree},
  rustc_ast_ir/lib.
- Regenerating all three sets into scratch reproduces the committed `src/**/*.gen.ts` byte for byte; versus the
  pre-lane outputs, the only changes are: added `clone_*` fns and their imports, the 8 discriminant tables, the
  Pu128 Debug in `debug_LitKind`, and the 2 new walkable files.

## `unported(...)` left / removed
- Removed: all 147x2 `rustc_macros::Walkable derive` stubs, all 6 `derive_clone(..)` sites in ast.ts, the
  typetree `derive(Clone)` unported. Visitors now walk everything; no `unported` remains in visit.ts/mut_visit.ts.
- None added. (Generated files would only contain `unported_clone` for a missing typemap rule; there are none.)

## PORT decisions (please record)
- Copy *objects* (`Lifetime`, `FnHeader`, `DelimSpan`, `Token`, ...) are cloned structurally, not shared: the
  generated `MutWalkable` impls write their fields in place (`Lifetime.id`, spans in `Safety`/`Const`), so an
  identity clone would leak a MutVisitor edit into the copy. Identity only for value-like TS representations
  (branded numbers, string-literal enums, `Ident`/`Span`/`Symbol` handles) and for `Rc`/`Arc`/`Lrc` (shared).
- derive(Walkable) output lives in `<crate>/walkable.gen.ts` / `mut_walkable.gen.ts` (not in ast.gen.ts): visit.ts
  spreads the table at init, and only visit.ts imports it, so the ESM cycle (gen file -> visit.ts) is safe.
- `derive_clone` is per set (on for rustc_ast only): rustc_errors has hand types and `Box<dyn ..>` fields; enable
  it there when a lane needs it (typemap.errors.json then needs `clone` rules).
- visit.ts/mut_visit.ts noop impl for `Result<(), ErrorGuaranteed>` now typed `Result<null, ..>` (the generator
  maps `()` to `null`); wiring fix needed for the generated tables to type-check.

## For root
1. Record the decisions above (`bun scripts/state.ts record decision ...`); delete `docs/claims/codegen-derive.md`.
2. `src/rustc_ast/tokenstream.ts:357` has a hand `clone_TokenCursor` (local, shadows the generated export); the
   generated `clone_TokenCursor` is equivalent (new cursors, shared `Arc` streams). The tokenstream owner can
   delete the local one. Same for any other hand `clone_*` of a derive(Clone) type.
3. Pre-existing semantic risk (ast-visit design, not changed here): hand code that shares a Copy AST object
   (implicit Rust copy -> TS alias) and then runs a MutVisitor over both positions will see one edit twice.
   Lanes porting MutVisitor users (expansion, placeholders) should copy with `clone_<T>` where rustc copies.
4. `bitflags!`/`newtype_index!` types get no `clone_<T>` (branded numbers; clone = the value). Say if a lane
   wants a named identity fn.
5. Comment convention added: `// rustc-derive: <path>:<line> Walkable for <T>` in the walkable files
   (coverage.ts does not parse it).
