# Handoff: ast-types (rustc_ast + rustc_ast_ir type definitions and Debug)

## Generated (`bun tools/codegen/types.ts rustc_ast`, 20 files, 252 types, 224 debug fns)
types/debug fns per `.gen.ts`: rustc_ast_ir/lib 6/3, ast 171/159, ast_traits 1/0, attr/mod 2/0,
attr/data_structures 1/1, attr/version 1/1, entry 1/1, expand/allocator 5/2, expand/autodiff_attrs 2/2,
expand/typetree 4/4, format 14/14, node_id 1/1, token 13/13, tokenstream 18/14, util/case 1/1,
util/classify 1/0, util/comments 2/1, util/literal 1/1, util/parser 3/2, visit 4/4.
Files with no types get no `.gen.ts` (rustc_ast_ir/visit, rustc_ast/lib, expand/mod, mut_visit, util/unicode).
Report: 0 unknown types, 0 missing Debug, 0 unknown cfg, 0 errors.

## Hand-port modules (all 25 files of the set, mirror rule)
Each `src/<crate>/<path>.ts` re-exports its `.gen.ts`. `rustc_ast/lib.ts`: `pub mod x` -> `export * as x`,
`pub use self::ast::*`, `AstNodeWrapper` re-export (traits not ported; inline `mod util` -> import
`util/<name>.ts` directly). `expand/mod.ts` re-exports its 3 submodules. rustc_ast functions are not ported.

## Manual Debug (markers on `fn fmt`)
- rustc_ast_ir/lib.ts: `debug_IntTy/UintTy/FloatTy` = `name_str`, which is ported on the companion consts
  (`IntTy.name_str(t)`, PORTING §8). The hand module redefines `IntTy` = `{ ...gen.IntTy, name_str }`.
- ast.ts: `debug_Label` (`label(..)`), `debug_Lifetime` (+ `display_Lifetime`), `debug_InlineAsmOptions`
  (bitflags `to_writer`), `debug_ImplPolarity` (`"positive"` / `"negative"`, the str Debug, per the oracle).
- ast_traits.ts: `debug_AstNodeWrapper` (generic: takes `debug_Wrapped`, `debug_Tag` after `(v, f)`;
  the `tag: PhantomData<Tag>` field is `unported` because it prints `core::any::type_name`).
- tokenstream.ts: `debug_LazyAttrTokenStream`; its `to_attr_token_stream` call is `unported` until the
  tokenstream port.
- `write!(f, "..{:?}..")` formats with a fresh Formatter, so inner Debug uses `PLAIN`. The oracle agrees:
  `label('outer#0)` and `LazyAttrTokenStream(AttrTokenStream([...]))` stay on one line under `{:#?}`.

## Generator changes (tools/codegen/types.ts, macros.ts, types.sets.json, typemap.ast.json)
- Unknown cfg is now an `ERROR:` and exit 1 (review finding). No cfgs had to be added for this set.
- `typemap.<name>.json` files are merged after `typemap.json` (types appended, so a later entry wins;
  helpers and cfg are merged). This lane's additions are in `typemap.ast.json`; root may fold them in.
- `newtype_index!`: the body is read from upstream (`opts.upstream`) and parsed in `macros.ts`. It emits a
  branded number, `X = newtype_index<X>((n) => \`FMT\`[, max])` (helper in rustc_span/def_id.ts),
  `debug_X = X.debug`, and the module-level consts (`CRATE_NODE_ID`). The type registers as an item, so
  other files resolve `NodeId` without a typemap entry.
- `bitflags!` (2.x, `impl X: T` and `struct X: T` forms, u8/u16/u32): emits a branded number and
  `X = flags_companion(bits, {NAME: v}, [[name, v]..])` with the Flags API (`contains`, `union`, `all`,
  `bits`, ...). Flag expressions are evaluated (`<<`, `|`, `&`, `^`, `!`, `Self::A.bits()`). A
  `derive(Debug)` inside the `struct` form is not generated yet (it is reported).
- `auto_class` (set option, on for rustc_ast): a struct that has an inherent impl with fns becomes a `class`
  (31 in ast.rs, plus Token, TokenStream, LazyAttrTokenStream, ...).
- Class fields named like reserved words (`FormatArguments.arguments`) become declared fields plus
  `<name>_` constructor params.
- **Cross-file imports now always go through the hand module** (`./token.ts`, never another `.gen.ts`).
  So a `.gen.ts` is only entered from its own hand module, and hand modules can extend generated
  companions at init time without an ESM TDZ cycle.
- Set `rustc_ast.skip`: `TokenStreamIter` (wraps `std::slice::Iter`), which the tokenstream port writes
  as a class in tokenstream.ts.
- Probe items are now emitted sorted by line, so macro types interleave correctly (the rustc_lexer golden
  is unchanged).
- `FxHashMap`/`HashMap` -> `Map`, with Debug `debug_HashMap` (src/rust_ts/hash_map.ts). Output is exact
  for 1 entry or fewer and `unported` for 2 or more: rustc prints hashbrown order, and the oracle prints
  `names: {"b": 1, "a": 0}`.
- `GrowableBitSet<I>` -> `Set<I>` (no Debug; `MarkedAttrs` is not Debug).

## New vendor code: src/vendor/bitflags/{traits,iter,parser}.ts (bitflags =2.10.0, `// crate:` markers)
`Flag`, the Flags default methods, `IterNames`, `to_writer`, `write_hex`, plus the `flags_companion` PORT
helper. Numbers only (u64/u128 flags would need bigint). **Root: add `"bitflags": "=2.10.0"` to
harness/scope.json `vendor`.**

## Needed from span-wire / root (the only tsc errors: 6)
- `debug_Span` exported from `src/rustc_span/span_encoding.ts` (it lives in lib.ts today; typemap.json
  points at span_encoding.ts). Either re-export it there or fix the typemap entry: 5 errors.
- `debug_AttrId` in `src/rustc_span/lib.ts` (`AttrId({})`, newtype_index): 1 error.
- Until these exist, Bun cannot link the generated modules at runtime, so ast.test.ts skips them.
- The rustc_span lib.ts `Interner_with_extra_symbols` stub calls `unported`, while symbol.ts has the real
  `Interner.with_extra_symbols`. `Span_ctxt` is unported too, which blocks Ident Debug.
- Optional: move the `newtype_index` helper from rustc_span/def_id.ts to src/rustc_index once that crate is
  ported (typemap.ast.json `helpers` points at def_id.ts).

## Test evidence
- `bunx tsc --noEmit -p .`: 6 errors, all of them the missing span exports above.
- `bun test tools`: 9 pass. That includes macros.test.ts (parsers, flag expressions) and a golden that
  regenerates all 20 files from the committed `fixtures/rustc_ast.typedefs.json` and requires them to be
  byte-identical.
- `bun test src`: 57 pass, 13 skip, 0 fail. `coverage --check`: markers ok.
- src/rustc_ast/ast.test.ts compares against strings from the oracle's `-Zunpretty=ast-tree[,expanded]`:
  FnHeader, BindingMode(No, Not), VisibilityKind, lifetime(4294967040: 'a), label('outer#0),
  "positive"/"negative", `NOMEM | NOSTACK` and the empty options, NodeId(4294967040), token Lit
  (pretty and plain), TokenKind Ident/Literal, DelimSpacing, and FormatArguments with a 1-entry names map
  (2 entries -> Unported). In this lane worktree, 1 test passes and 11 skip (the missing exports). In a
  scratch copy with a 3-line shim (`debug_Span` re-export, `debug_AttrId`, real interner), 11 pass and
  1 skips (label: `Span::ctxt` is unported).

## Decisions (PORT)
- bitflags and newtype_index types are branded numbers, not `{ _0 }` interfaces.
- Generic manual Debug fns take the type parameters' Debug fns after `(v, f)` (the generator convention).
  PORTING §8's `Debug<Type>` rule can only apply to non-generic types.
