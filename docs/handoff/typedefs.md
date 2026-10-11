# Handoff: typedefs (infrastructure, no compiler porting)

## Files
- `tools/probes/typedefs/{Cargo.toml.in,main.rs}`: probe built by `bun scripts/probes.ts build typedefs`.
  syn =2.0.117, proc-macro2 =1.0.106 (span-locations), quote =1.0.45, serde_json =1.0.145, plus transitive
  deps, all pinned to upstream's Cargo.lock. `typedefs [--out f.json] <file.rs>...` emits JSON per file:
  struct/enum/union/type/trait items (generics with bounds/defaults, fields with name/index/vis/type as
  token text + structured path/args, variants with style and explicit discriminants, all non-doc attrs
  with parsed `derive`/`cfg`/`cfg_attr`/`repr`, doc lines, source lines, inline module path), flattened
  `use`s, `mod`s, every `impl` (trait path, self type, fn names+lines), and item macros (macro_rules defs
  and invocations, with the `struct/enum/union/type/impl X` names and `debug_format` literals found inside).
- `tools/codegen/types.ts`: generator. `bun tools/codegen/types.ts <set> [--out dir] [--src-root dir]
  [--json probe.json] [--save-json f] [--report f] [--stubs]`. Exits 1 with `ERROR:` lines on generation errors.
- `tools/codegen/typemap.json`: Rust path -> TS type template + Debug template (+ import module), cfg
  truth table (`feature = "nightly"` true; `debug_assertions`, `test`, `bootstrap`, ... false), fmt helpers.
- `tools/codegen/types.sets.json`: generation sets (`rustc_lexer`, `rustc_ast`) with per-type `class` /
  `hand` / `discriminant` / `skip` lists.
- Tests: `tools/codegen/rustc_lexer.test.ts`, `tools/codegen/oracle.test.ts`; fixtures in
  `tools/codegen/fixtures/` (`rustc_lexer.typedefs.json` probe output, generated
  `src/rustc_lexer/lib.gen.ts`, `mini.rs` for the oracle test).

## File naming (proposal, implemented)
`compiler/<crate>/src/<path>.rs` -> `src/<crate>/<path>.gen.ts` (lib.rs -> lib.gen.ts, mod.rs -> mod.gen.ts).
The hand port `src/<crate>/<path>.ts` does `export * from "./<path>.gen.ts"` and adds:
- methods on generated classes: `declare module "./x.gen.ts" { interface T { m(): R } }` + `T.prototype.m = ...`;
  statics: `declare module "./x.gen.ts" { namespace T { function new_(..): T; export { new_ as new } } }` +
  `(T as { new: ... }).new = ...` (verified with tsc).
- `debug_<T>` for types with manual `impl Debug` (the generated files import them from the hand module;
  only used inside function bodies, so the ESM cycle is harmless).
Generated types carry `// rustc-type: <path>:<line> <Name>` (does not match the coverage marker regex).

## Generation rules (PORTING.md §5)
Fieldless enums -> string union + `as const` companion (+ `<E>_discriminant: Record<E, number>` when any
explicit discriminant or listed in `discriminant`; literals with `_`/radix/suffix/`-` evaluated, implicit = prev+1).
Data enums -> `{ readonly $: "V"; field...; _0... }` unions, unit variants as `Object.freeze` singletons on the
companion const. Structs -> `interface` (tuple structs use `_0, _1`), or `class` with constructor taking all
fields in declaration order when listed in `class`. `cfg`/`cfg_attr` evaluated per typemap (dropped fields
and variants vanish from both type and Debug). Raw identifiers lose `r#` (oracle confirms Debug prints `type`).
Option<undefined-able T> -> `{ readonly $: "Some"; _0: T } | undefined`. `&[T]` -> `readonly T[]`, `()` -> `null`,
tuples -> TS tuples, type aliases -> `export type` (Debug goes through the alias with substitution),
default type params kept (`Item<K = ItemKind>`) and filled in for Debug.
Debug: non-generic `export const debug_T: Debug<T> = (v, f) => ...`; generic
`export function debug_T<A>(v: T<A>, f: Fmt, debug_A: Debug<A>): string` (same convention as `debug_option`).
Unknown types are emitted as the bare Rust name (they fail tsc on purpose) and reported; types without a TS
Debug call a local `unported_debug` (exits 70 via `unported`) and are reported.

## Test evidence
- `bunx tsc --noEmit -p .`: clean. `bun test tools`: 6 pass. `bun test src`: 17 pass.
- rustc_lexer: the generated module type-checks and is mutually assignable with `src/rustc_lexer/lib.ts`
  for Token, TokenKind, DocStyle, LiteralKind, GuardedStr, RawStrError, Base, FrontmatterAllowed, the companion
  consts, `Base_discriminant` and the debug fn types (Cursor: hand class's data fields vs generated class).
  A negative check (dropping a variant / field) makes tsc fail. Golden test: regenerating from the committed
  probe JSON reproduces the committed `lib.gen.ts` byte for byte.
- Runtime: generated `debug_Token` === hand `debug_Token`, plain and `{:#?}`, on all 1,118,580 tokens of the
  292 `.rs` files under `library/core` in the (sparse) checkout; plus synthetic RawStrError/LiteralKind/GuardedStr.
- Oracle: `fixtures/mini.rs` (unit/tuple/empty structs, generic with default param, generic enum with
  struct/tuple/empty/unit/boxed-recursive variants, `Option<Option<u32>>`, fieldless with discriminants,
  generic alias of tuples, Range, `()`, 1-tuple, nested generics, cfg + cfg_attr, raw field name, manual Debug)
  compiled with `rustc +nightly -C debug-assertions=off`: generated Debug output identical (110 lines).
- No difftest run (infrastructure lane; no compiler code changed). Coverage unchanged (no fns ported).

## Dry run: rustc_ast (scratch only, not committed)
`bun tools/codegen/types.ts rustc_ast --out D:/rust-ts-data/tmp/typedefs/ast/src --src-root D:/rust-ts-data/tmp/typedefs/ast/src --stubs`
(set = all of `compiler/rustc_ast/src/**` except tests, plus `rustc_ast_ir/src/{lib,visit}.rs`).
- 25 files, 252 types, 223 debug fns (ast.rs: 171 types / 159 debug). No unknown cfgs, no errors.
- Type-check (scratch tsconfig, stubs for not-yet-ported modules): only 2 errors, both the unknown types below.
- Unknown types (2): `rustc_index::bit_set::GrowableBitSet` (attr/mod.rs:29),
  `std::slice::Iter` (tokenstream.rs:876, an iterator struct; should probably be `hand`).
- Missing Debug (1): `FxHashMap` in format.rs:77 (`FormatArguments.names`; HashMap Debug order is hash order,
  so the porter must decide; derive(Debug) on that struct is real).
- Manual `impl Debug` (9, porter writes `debug_<T>` in the hand module): rustc_ast_ir `IntTy` (lib.rs:92),
  `UintTy` (168), `FloatTy` (213); ast.rs `Label` (60), `Lifetime` (74), `InlineAsmOptions` (2767),
  `ImplPolarity` (3157); ast_traits.rs `AstNodeWrapper` (364); tokenstream.rs `LazyAttrTokenStream` (142).
- Macro-generated types: `NodeId` (node_id.rs:6, `newtype_index!`, `debug_format = "NodeId({})"`; typemap
  imports it from `src/rustc_ast/node_id.ts`), `InlineAsmOptions` impl via `bitflags!` (ast.rs:2712; the struct
  itself is visible). Also `AttrId` (rustc_span `newtype_index!`, `AttrId({})`) is a typemap import.

## Needed from other lanes / root (not done here)
- rustc_span lanes: the typemap expects `debug_Span` (span_encoding.ts), `debug_Symbol`, `debug_ByteSymbol`,
  `debug_Ident`, `ByteSymbol` (symbol.ts), `BytePos`+`debug_BytePos`, `AttrId`+`debug_AttrId`,
  `ErrorGuaranteed`+`debug_ErrorGuaranteed`, `Spanned<T>`+`debug_Spanned(v, f, debug_T)` (lib.ts),
  `debug_LocalExpnId` (hygiene.ts), `debug_Edition` (edition.ts). Adjust `typemap.json` if they land elsewhere.
- `src/std/fmt.ts` (root): a float Debug helper (`f32`/`f64` are mapped with `debug: null` until then);
  optionally a `debug_option_some` helper (the `Option<Option<T>>` Debug is inlined today).
- Not generated yet (PORTING "planned"): `newtype_index!` types, other derives (Clone, PartialEq, ...).

## unported / PORT decisions
- No `unported(...)` in committed code. Generated files may contain `unported_debug` (types with no TS Debug)
  and `unported_discriminant`; both call `unported` and are listed in the report.
- PORT: struct/enum fields are mutable (rustc_ast is mutated in place); only the `$` tag is `readonly`.
- PORT: `u64`/`i64` map to `number` by default (per-field bigint overrides not implemented yet).
- PORT: unit structs become empty interfaces; unions become interfaces of all fields (reported).
- PORT: items in inline `mod`s are flattened into the file's `.gen.ts` (reported as a note).
