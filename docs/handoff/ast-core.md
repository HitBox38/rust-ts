# Handoff: ast-core (rustc_ast ast.rs fns, node_id, entry, format, attr/{data_structures,version}, expand/*)

## Files touched (hand modules + tests only; no `.gen.ts`, generator, std, scripts or harness edits)
- `src/rustc_ast/ast.ts`, `node_id.ts`, `entry.ts`, `format.ts`
- `src/rustc_ast/attr/data_structures.ts`, `attr/version.ts`
- `src/rustc_ast/expand/allocator.ts`, `expand/autodiff_attrs.ts`, `expand/typetree.ts`
- `src/rustc_ast/ast.test.ts` (appended an ast-core section; the ast-types tests are unchanged)

## Coverage (`bun scripts/coverage.ts --missing <file>`)
ast 160/160 (1 `rustc-skip`: `Path` StableHash), node_id 4/4 (1 `rustc-skip`: StableHash), entry 1/1,
format 10/10, attr/data_structures 5/5, attr/version 4/4, expand/allocator 2/2, expand/autodiff_attrs 12/12,
expand/typetree 7/7. `coverage --check`: markers ok (1396). Upstream has no `#[cfg(test)]` tests for these files.

## Checks
- `bunx tsc --noEmit -p .` clean (also clean under `--noUnusedLocals` for the touched files).
- `bun test src`: 141 pass, 0 fail, 0 skip in ast.test.ts (13 new ast-core tests, each assertion cites its upstream line).
- `RUST_TS_AGENT=ast-core bun scripts/difftest.ts --suite lex --sample 200`: 200/200 MATCH
  (run 20261012-201024-ast-core-b4vd).
- Entry points: `bun -e 'await import("./src/rustc_ast/<m>.ts")'` in a fresh process is OK for ast, node_id, entry,
  format, attr/{data_structures,version,mod}, expand/{mod,allocator,autodiff_attrs,typetree}, lib, token, tokenstream,
  util/{parser,classify,literal}. Importing a `.gen.ts` directly as the entry is a TDZ error (`ast.gen.ts`: `Path`), as
  it already is on main for `token.gen.ts`/`tokenstream.gen.ts`: by convention a `.gen.ts` is only entered through its
  hand module.

## `unported(...)` left (all at the exact call site, so unaffected paths still work)
- `derive(Clone) for rustc_ast::ast::{Param, QSelf, Path, MacCall, AnonConst, TyKind}`: derived `Clone` of AST nodes
  (`derive_clone(..)` in ast.ts). Hit by `ParenthesizedArgs::as_angle_bracketed_args` (non-empty inputs),
  `Pat::to_ty` / `Expr::to_ty` (Path, MacCall, Repeat arms), `Expr::to_bound`, `Ty::clone` (and so `Param::to_self`'s
  `Explicit` arm, `Fn::is_pin_drop_sugar` on an explicit `self: T`).
- `derive(Clone) for rustc_ast::expand::typetree::TypeTree` (`Type::from_ty`).
- `rustc_ast::attr::Attribute::has_name` (attr/mod.rs, later lane): `FnDecl::splatted`, only when a param has attributes.
- `rustc_ast_ir::{Mutability::prefix_str, Mutability::ref_prefix_str, Mutability::ptr_str, Pinnedness::prefix_str}`
  (rustc_ast_ir/lib.ts ports only `name_str`): `SelfKind::to_ref_suggestion`, `Pat::descr` (`Ref` arm).

## PORT decisions
- Method placement follows token.ts (PORTING §8): enum fns on companion consts (`{ ...gen.X, fns }` where the
  generated companion exists, a fresh const otherwise); class statics/associated consts assigned onto the generated
  class (`export const X = gen.X as typeof gen.X & {...}` + `export type X = gen.X`); `&self` fns on the prototype,
  declared in `declare module "./ast.gen.ts"`. A local `export type X` hides the star-exported value, so every such
  alias has a matching `export const` (e.g. `export const Item = gen.Item`).
- Associated consts of data-only (interface) structs: companion consts `TraitBoundModifiers.NONE`,
  `ConstBlockItem.IDENT`. `BindingMode::{NONE, REF, ...}` and `FnDecl::{NO_SPLATTED_ARG_INDEX,
  MAX_VALID_SPLATTED_ARG_INDEX}` are statics. These are shared values: never mutate them.
- Trait impls: `From<A> for B` -> `B.from_A`, `TryFrom<A> for B` -> `B.try_from_A` (Result), `PartialEq<A> for B` ->
  `b.eq_A` (`Path.eq_Symbol`, `Path.eq_slice`, `PathSegment.eq_Symbol`), `Display for X` -> `display_X(v)`,
  `FromStr` -> `X.from_str(s): Result<X, undefined>`, `Default for FnHeader` -> `FnHeader.default()`,
  `Tag for TraitObjectSyntax` -> `TraitObjectSyntax.{BITS, into_usize, from_usize}` + `TraitObjectSyntax_discriminant`.
- `impl Item<AssocItemKind> { fn opt_generics }` -> `AssocItem.opt_generics(item)` (companion): the generic `Item`
  prototype holds the `impl Item` (ItemKind) `opt_generics`.
- `impl From<Box<T>> for T` (Pat, Expr, Ty) returns its argument (`Box<T>` is `T`).
- Derived `PartialEq` helpers added: `ByRef_eq`, `BindingMode_eq` (ast.ts), `RustcVersion_eq`, `RustcVersion_cmp`
  (version.ts). `cmp::min` on `Mutability` uses its declaration order (local `Mutability_min`).
- `Stmt::add_trailing_semicolon(mut self)` updates `this` in place and returns it (ownership moved upstream).
- `ByRef::cap_ref_mutability(mut self)` returns a new value (the argument is a copy upstream).
- `YieldKind::expr_mut` returns a `MutRef<Expr>` view onto the variant field (rustc_span hygiene.ts `MutRef`).
- `FnSig::as_borrowed`/`FnPtrTy::as_borrowed_fn_sig`: `BorrowedFnSig` shares the `FnHeader` (Copy) and `FnDecl`.
- `AttrArgs::inner_tokens`: `TokenStream::clone` is `new TokenStream(ts._0)` (tokenstream.ts convention);
  `TokenStream::from_ast(expr)` gets an inline `HasTokens`/`HasAttrs` table reading `Expr.tokens`/`Expr.attrs` (those
  trait impls live in ast_traits.rs, lane ast-visit).
- `Expr::precedence`: `ExprPrecedence` variants are written as string literals (see "For root" 1).
  The `Yield(Postfix)` arm returns early inside the `Break | Ret | Yield | Yeet` case; same result as upstream's
  separate arm.
- `RustcVersion::CURRENT` (`current_rustc_version!()`) = `parse_str("1.101.0-nightly")`, the `CFG_RELEASE` of the pin
  (UPSTREAM.json `rust.release`; same value as `sym::env_CFG_RELEASE`). `std::env::var` -> `process.env` (as
  rustc_errors does). `str::parse::<u16>` and `str::splitn` are local helpers with Rust semantics.
- `format.rs` `assert_eq!(.., "captured arguments must be added last")` -> `assert` with Rust's
  `assertion \`left == right\` failed: <msg>\n  left: ..\n right: ..` message.
- `node_id.rs` `define_id_collections!` -> `type NodeMap<T> = Map<NodeId, T>`, `type NodeSet = Set<NodeId>`.
  `DUMMY_NODE_ID` lives in node_id.ts (it was not generated).
- ast.rs `pub use` re-exports are mirrored in ast.ts: rustc_ast_ir `{FloatTy, IntTy, Movability, Mutability,
  Pinnedness, UintTy}`, `AttrId`, `crate::format::*`, `{CRATE_NODE_ID, DUMMY_NODE_ID, NodeId}`.
- `typetree.rs` `Display for Type` forwards the caller's formatter: `display_Type(v, f = PLAIN)`.
- `mod size_asserts` (`static_assert_size!`) has no TS equivalent (comment only).

## For root
1. `src/rustc_ast/util/parser.ts:167` `export type ExprPrecedence = ExprPrecedenceT;` hides the generated
   `ExprPrecedence` companion const (a local type export shadows the star export's value). Add
   `export const ExprPrecedence = gen.ExprPrecedence;` there. ast.ts then may use `ExprPrecedence.X` (optional).
2. Replace the ast.rs stubs in other lanes' files with the real fns now ported here:
   - util/parser.ts `BinOpKind_precedence/_fixity/_is_comparison` -> `BinOpKind.precedence/fixity/is_comparison(op)`
     (`import { BinOpKind } from "../ast.ts"`; uses are in function bodies, so no init-order issue).
   - util/classify.ts `YieldKind::expr` stub -> `YieldKind.expr(kind)`.
3. tools/codegen: derived `Clone` (`clone_<Type>`), so the `derive_clone(..)` sites in ast.ts and typetree.ts can call
   it. Needs the `Box` (deep copy) vs `Lrc`/`Arc` (`LazyAttrTokenStream`, `TokenStream`: share) distinction.
4. rustc_ast_ir/lib.ts: port `Mutability::{invert, prefix_str, ref_prefix_str, ptr_str, mutably_str, is_mut, is_not}`,
   `Pinnedness::{is_pinned, prefix_str}` and a `Mutability` Ord helper; then replace the 4 local stubs and
   `Mutability_min` in ast.ts.
5. `ast::LitKind` now has a companion in ast.ts (`str`, `is_str`, ..., `is_suffixed`); util/literal.ts still exports its
   own `LitKind` (`from_token_lit`). Consider folding `from_token_lit` into the ast.ts companion (e.g. literal.ts
   assigning onto it) so one `LitKind` value carries all methods.
6. `ast-visit` lane: `TokenStream::from_ast` callers can switch the inline table in `AttrArgs.inner_tokens` to the
   ported `HasTokens`/`HasAttrs` impls once they exist.

## Contract (public TS API)
| Upstream | TS |
|---|---|
| `Path::from_ident`, `path.is_global()`, `path == sym` | `Path.from_ident(id)`, `p.is_global()`, `p.eq_Symbol(s)`, `p.eq_slice([..])` |
| `PathSegment::from_ident/path_root`, `seg.span()` | `PathSegment.from_ident(id)`, `PathSegment.path_root(sp)`, `seg.span()` |
| `join_path_syms`, `join_path_idents` | same names (take any `Iterable`) |
| `GenericArgs/GenericArg/AngleBracketedArg/GenericBound::span` etc. | `GenericArgs.span(a)`, `GenericArg.is_maybe_parenthesised_infer(a)`, ... |
| `Pat::{to_ty, walk, peel_refs, is_rest, could_be_never_pattern, contains_never_pattern, descr}` | prototype methods |
| `BindingMode::NONE..`, `bm.prefix_str()`, `ByRef::cap_ref_mutability` | `BindingMode.NONE`, `bm.prefix_str()`, `ByRef.cap_ref_mutability(b, m)`, `BindingMode_eq` |
| `BinOpKind::{as_str, is_lazy, precedence, fixity, is_comparison, is_by_value}`, `BinOpKind::from(AssignOpKind)` | `BinOpKind.as_str(k)`, ..., `BinOpKind.from_AssignOpKind(k)` |
| `Stmt::{has_trailing_semicolon, add_trailing_semicolon, is_item, is_expr}`, `StmtKind::descr`, `LocalKind::{init, init_else_opt}` | prototype / companion |
| `Expr::{is_potential_trivial_const_arg, maybe_unwrap_block, optionally_braced_mac_call, to_bound, peel_parens, peel_parens_and_refs, to_ty, precedence, is_approximately_pattern}`, `Expr::dummy` | prototype methods, `Expr.dummy()` |
| `MacCall::span`, `AttrArgs::{span, inner_tokens}`, `DelimArgs::need_semicolon`, `YieldKind::{expr, expr_mut, same_kind}`, `StrLit::as_token_lit` | prototype / companion |
| `LitKind::{str, is_str, is_bytestr, is_numeric, is_unsuffixed, is_suffixed}` | `LitKind.*(k)` (ast.ts) |
| `FnSig::{header_span, safety_span, extern_span, as_borrowed}`, `FnPtrTy::{header, as_borrowed_fn_sig}`, `FnHeader::{has_qualifiers, span, default}` | prototype, `FnHeader.default()` |
| `Ty::{clone, peel_refs, is_maybe_parenthesised_infer}`, `TyKind::{is_implicit_self, is_unit, is_simple_path, maybe_scalar}` | prototype / companion |
| `InlineAsmOptions::{COUNT, GLOBAL_OPTIONS, NAKED_OPTIONS, human_readable_names}`, `InlineAsmTemplatePiece::to_string`, `display_InlineAsmTemplatePiece`, `InlineAsmOperand::reg`, `AsmMacro::*` | companion consts |
| `Param::{to_self, is_self, from_self}`, `FnDecl::{has_self, c_variadic, splatted}`, `SelfKind::to_ref_suggestion` | prototype, `Param.from_self(..)` |
| `CoroutineMarker::new`, `PolyTraitRef::new`, `NormalAttr::from_ident`, `Extern::{from_abi, span}` | statics / companion |
| `UseTree::{ident, span, hi_span}`, `AttrItem::is_valid_for_outer_style`, `FieldDef::{mut_restriction, default_value, safety}`, `VariantData::{fields, ctor_node_id}` | prototype / companion |
| `Item::{span_with_attributes, opt_generics}`, `Item<AssocItemKind>::opt_generics` | prototype, `AssocItem.opt_generics(item)` |
| `ItemKind::{ident, article, descr, generics}`, `AssocItemKind::{ident, defaultness}`, `ForeignItemKind::ident`, From/TryFrom | `ItemKind.*`, `ItemKind.from_AssocItemKind`, `AssocItemKind.try_from_ItemKind`, ... |
| node_id: `DUMMY_NODE_ID`, `NodeId::placeholder_{from,to}_expn_id`, Display | `DUMMY_NODE_ID`, `NodeId.placeholder_from_expn_id(e)`, `display_NodeId` |
| entry: `entry_point_type` | same |
| format: `FormatArguments::new`, `add`, `by_name`, ..., `FormatArgumentKind::ident` | `FormatArguments.new()`, prototype, `FormatArgumentKind.ident(k)` |
| attr: `CfgEntry::{lower_spans, span, is_equivalent_to}`, Display; `RustcVersion::{CURRENT, current_overridable, parse_str, parse_str_strict}`, Display | `CfgEntry.*`, `display_CfgEntry`; `RustcVersion.*`, `display_RustcVersion` |
| expand: `global_fn_name`, `default_fn_name`, `ALLOCATOR_METHODS`, `DiffMode/DiffActivity` fns, `valid_*`, `TypeTree::{new, all_ints, int, add_indirection}`, `Type::{from_ty, add_offset}` | same names / companions / statics |
