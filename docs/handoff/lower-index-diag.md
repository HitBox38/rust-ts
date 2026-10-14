# Handoff: lower-index-diag (wave 14, M3a): rustc_ast_lowering index.rs, stability.rs, diagnostics.rs + codegen set

Branch `lane/lower-index-diag` (from main 935a15a, no merges).

## Files touched
Hand-written (stubs filled, upstream order, markers on every fn):
- `src/rustc_ast_lowering/index.ts`: `index_hir` and the `NodeCollector` class (extends rustc_hir's intravisit
  `Visitor`): `insert`, `with_parent`, `insert_nested` and its 37 `Visitor` methods.
- `src/rustc_ast_lowering/stability.ts`: `enabled_names`, `extern_abi_enabled`, `gate_unstable_abi`,
  `display_UnstableAbi` (`impl Display`, :54) and `extern_abi_stability`. The types come from `stability.gen.ts`.
- `src/rustc_ast_lowering/diagnostics.ts`: `export * from "./diagnostics.gen.ts"` plus
  `ResolvingRestrictionKind_into_diag_arg` (:600).

Codegen config:
- `tools/codegen/types.sets.json`: new set **`rustc_ast_lowering`**.
  - Files: the crate's 17 files, lib.rs first.
  - `hand`: `LoweringContext` and `index::NodeCollector`.
  - `skip`: `DelegationResolver` (see PORT 9).
  - Settings: `auto_class`, `bitflags_debug`, and `typemap_extra: ["ast_lowering.typemap.json"]`.
- `tools/codegen/ast_lowering.typemap.json` (new, set-local). It maps the rustc_hir / rustc_hir_id types the
  crate's types reach, via `src/rustc_hir/lib.ts` and `src/rustc_hir_id/lib.ts`. It also covers
  `rustc_ast::{AngleBracketedArgs, DelegationSource, FormatTrait}`, `ty::GenericParamDef` and
  `DiagArgFromDisplay`.
- `tools/codegen/diag_args.json`:
  - `char` gained `display` (`String.fromCodePoint($v)`), needed by `DiagSymbolList<char>`;
  - new entry for `DiagArgFromDisplay` (-> `DiagArgFromDisplay_into_diag_arg`).

Generated (`bun tools/codegen/types.ts rustc_ast_lowering`; 10 files, 106 types, 24 Debug fns, 61 diagnostic
derives):
- `src/rustc_ast_lowering/{lib,diagnostics,expr,format,index,stability}.gen.ts`;
- `src/rustc_ast_lowering/delegation/{mod,attributes,generics,resolution}.gen.ts`.

asm.rs, block.rs, contract.rs, closure.rs, item.rs, pat.rs and path.rs have no types.

Tests:
- `src/rustc_ast_lowering/index.test.ts` (6 tests), with fixture `index_oracle/{index_case.rs,
  index_case.hir-tree.stdout}`;
- `src/rustc_ast_lowering/diagnostics.test.ts` (6 tests).

## Coverage
- `bun scripts/coverage.ts --missing`:
  - compiler/rustc_ast_lowering/src/index.rs: 48/48;
  - stability.rs: 5/5;
  - diagnostics.rs: 1/1.
- `bun scripts/coverage.ts --check`: `markers ok (8698; vendor 3888)`.

## Tests / evidence
**index.test.ts (oracle).** `index_case.rs` is a `#![no_core]` lib crate. It has:
- a braced struct, a tuple struct (Ctor) and an enum with unit and tuple variants (Variant + Ctor);
- `fn f<'a, U>(r: &'a U, (a, _): (u8, u8)) -> [u8; 2] where U: 'a`. Its body holds:
  - a nested `fn inner`;
  - a `let` with a struct pattern and a struct expression;
  - `let _w: _ = a` (the `visit_infer` path);
  - a `match` with a literal pattern (PatExpr) and a wildcard pattern.

How the test works:
- The fixture is the pinned rustc's `-Zunpretty=hir-tree` output, with the same arguments and path remap as
  hir.oracle.test.ts. `OwnerNodes` Debug prints `parents: [(id, parent)]`, which is exactly the column that
  `index_hir` computes.
- The test builds each of the 6 owners' HIR by hand, using the oracle's HirIds (lowering's output), and runs
  `index_hir`. It checks three things:
  - the parent column equals the oracle's, for all 6 owners and 66 slots of `f`;
  - the `Node` kind of every slot;
  - the `parenting` map: `{f::inner -> 8}`, the `Stmt` holding the item.
- When the toolchain is present, the fixture is re-checked against the live oracle; `REGEN=1` rewrites it.
- Unit checks cover:
  - the owner node in slot 0 has the INVALID parent, and nodes are the HIR objects themselves;
  - unvisited slots raise `span_delayed_bug` with upstream's message, in id order;
  - a missing body panics with `no entry found for key`;
  - an index beyond `num_nodes` panics with the bounds-check message;
  - a `Synthetic` owner panics.
- **Negative control:** dropping `with_parent` in `visit_pat` fails the oracle test.

**diagnostics.test.ts.** It builds 5 diagnostics through the generated `<T>_into_diag` and a recording emitter.
Message, code, spans, labels, children, suggestions and args equal `rustc +nightly --error-format=json` at the
pin, for inputs quoted per case:
- `GenericTypeWithParentheses` (E0214, multipart suggestion);
- `InvalidAbi` (E0703, note with a String arg);
- `MisplacedImplTrait` (E0562, `DiagArgFromDisplay`);
- `InvalidAsmTemplateModifierRegClass` (two labels, `DiagSymbolList<char>`: "`w` and `x`");
- `RestrictionAncestorOnly` (a Fluent select over `ResolvingRestrictionKind`, both arms).

Plus a direct check of `ResolvingRestrictionKind_into_diag_arg`.

**Codegen byte-identity.** Every other set in types.sets.json (all 27, except `/` keys and `rustc_lexer`)
regenerates byte-identically: `git status` is clean after regenerating all of them.

Other checks:
- `bunx tsc --noEmit -p .`: clean.
- `bun test src/rustc_ast_lowering`: 20 pass.
- Fresh-process loads: index.ts, stability.ts, diagnostics.ts and lib.ts.
- `RUST_TS_AGENT=lower-index-diag bun scripts/difftest.ts --suite parse --sample 200`: 200/200 MATCH (run
  `20261014-024103-lower-index-diag-qqj0`). Nothing in the pipeline reaches the crate yet.
- Full `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 3997 pass, 1 skip, 0 fail.

## `unported(...)` left
- **Hand code:** none.
- **Generated:**
  - `unported_debug` for `ReloweringChecker.node_id_to_local_id` (lib.gen.ts; `NodeMap` Debug is in hash
    order). It is `#[cfg(debug_assertions)]`-only and never used.
  - `delegation/attributes.gen.ts`: `AdditionInfo.equals` and `AdditionKind::{Default, Inherit}.factory` are
    `unknown /* fn (..) -> .. */`. The type generator has no fn-pointer types (`tsType` default arm). They type-check
    as `unknown`; lane lower-delegation casts them, or root adds fn-pointer support to tools/codegen/types.ts (not
    this lane's file).

## `// PORT:` decisions (please record)
1. **`NodeCollector` is a hand class** extending intravisit's `Visitor` (Result `()`). It is a `hand` entry in the
   set, as rustc_resolve's visitors are; index.gen.ts only re-exports it.
2. **`cfg!(debug_assertions)` in `NodeCollector::insert`** is false in the oracle, which is a release build. The
   block (two `span_bug!` consistency checks) is kept as a comment, like `debug_assert!`. The `debug_assert*!`
   lines are comments too.
3. **IndexVec writes** (`nodes[id] = ..`) go through a local `index_set`, which panics with Rust's
   `index out of bounds: the len is N but the index is I`. `IndexVec::from_elem_n(err_node, n)` fills every slot
   with the same `Copy` object; HIR values are never edited in place (hir-visit decision).
4. **`self.bodies[&local_id]`** (`impl Index for SortedMap`, sorted_map.rs:324) is
   `unwrap(bodies.get(k), "no entry found for key")`. sorted_map.ts has no `index`; it is not this lane's file.
5. **`#[instrument]` / `debug!`** (tracing) are dropped.
6. **`Display for UnstableAbi`** is `display_UnstableAbi(self)`; its `{abi}` uses `display_ExternAbi`. The
   `or_else` closure of `extern_abi_enabled` is inlined.
7. **`ResolvingRestrictionKind_into_diag_arg`:** `DiagArgValue::Str(Cow::Borrowed(s))` is `{ $: "Str", _0: s }`.
8. **The set-local type map** (`typemap_extra`) is used instead of a global `typemap.*.json`, so no other set can
   change. It deliberately overrides global placeholders for this set only:
   - `rustc_hir::HirId` points at the real `rustc_hir_id` HirId (decls.ts uses it), not typemap.lint_defs.json's
     rustc_lint_defs stand-in;
   - `rustc_hir::{Ty, WherePredicate, TraitCandidate}` point at the generated HIR (globally `unknown`, "pending
     hir.rs").

   Root may fold these into the global maps once the other sets can take the change.
9. **`DelegationResolver` is `skip`, not `hand`.** A hand type inside an inline module (`resolution::resolver`) is
   imported by name from the mirrored hand module, and resolution.ts (lane lower-delegation) does not export it.
   tsc failed with TS2459. The class lives in decls.ts and has no derives, so nothing is lost.
10. **diag_args.json `char.display`** is `String.fromCodePoint($v)` (`impl Display for char`).

## For root / other lanes
- **Wave-14 lowering lanes:** your `.gen.ts` files now exist. Replace the `unknown` aliases in lib.ts, expr.ts,
  format.ts and delegation/{mod,attributes,generics,resolution}.ts with `export * from "./<file>.gen.ts"` (contract
  "How to fill a stub" 4).
  - `auto_class` emitted the Visitor impls `expr::MoveExprInitializerFinder` and `delegation::SelfResolver` as plain
    classes. `expr::WillCreateDefIdsVisitor` (a unit struct) became an empty interface.
  - If they must extend rustc_ast's `Visitor`, add them to the set's `hand` list (with `hand_notes`), as done here
    for `NodeCollector`, and regenerate.
  - `DirectConstArgContext` (bitflags) now has its Debug (`bitflags_debug`).
- **lowering-contract "For root" 3 is done** (codegen set `rustc_ast_lowering`).
- **Possible follow-ups:**
  - fn-pointer types in tools/codegen/types.ts;
  - `SortedMap` `Index` (`index`) in sorted_map.ts;
  - repointing the global `rustc_hir::HirId` typemap entry from the rustc_lint_defs stand-in to rustc_hir_id.

## Full test run
`RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: 3997 pass, 1 skip (the pre-existing linux-only one), 0 fail
(228 files).
