# Handoff: lane span-core (rustc_span part 1)

## Files touched
- `src/rustc_span/lib.ts` (replaced stub), `src/rustc_span/span_encoding.ts` (replaced placeholder),
  `src/rustc_span/edition.ts` (replaced stub)
- new: `src/rustc_span/analyze_source_file.ts`, `fatal_error.ts`, `macros.ts`, `profiling.ts` (skip markers only)
- new tests: `src/rustc_span/tests.test.ts`, `src/rustc_span/analyze_source_file/tests.test.ts`
- Not touched: `symbol.ts`, `hygiene.ts`, `def_id.ts` (sibling stubs).

## Coverage (`bun scripts/coverage.ts --crate rustc_span`)
lib.rs 242/242, span_encoding.rs 30/30, analyze_source_file.rs 7/7, edition.rs 10/10,
fatal_error.rs 3/3, macros.rs 2/2, profiling.rs 2/2, tests.rs 5/5. Crate total 301/658.
`coverage.ts --check`: markers ok (362).

## Tests
`bunx tsc --noEmit -p .` clean. `bun test src`: 34 pass, 0 fail (rustc_span: 17 = 4 upstream tests.rs,
12 analyze_source_file cases, 1 rust-ts span-representation test).

## Design decision: Span representation (span_encoding.ts PORT block)
- `Span` = branded number = index into `SessionGlobals.span_interner.spans` (deduplicated
  `SpanData`). Only upstream's "fully interned" format exists. Equality stays `===` because upstream
  encodings are canonical and the interner dedups. Interner = open-addressing index over `SpanData[]`.
- `DUMMY_SP` = 0. `SpanInterner.default()` pre-seeds index 0; `Span.new` and `Interned.data` answer
  the dummy span without session globals (upstream's inline DUMMY_SP works outside a session).
  Every other span needs session globals (upstream: only large ones). Unobservable in rustc output.
- `InlineCtxt`/`InlineParent`/`PartiallyInterned` fns (9) are `rustc-skip`; `to_raw_span`/
  `from_raw_span` skipped (RawSpan only feeds StableHash). **Root: please ratify these skips.**
- `SpanData` fields are `readonly` (interned objects are shared).
- **Methods on handles**: `Span` has a companion that is a *hoisted function declaration* plus a
  `declare namespace Span` (`Span.lo(sp)` = `sp.lo()`). Being a function declaration, it exists
  before any module body runs, so lib.ts/hygiene.ts (import cycle with span_encoding.ts) can attach
  methods at top level in any evaluation order (a `const` companion hits TDZ errors in the cycle;
  verified). Pattern for span-hygiene's `impl Span` (hygiene.rs):
  `declare module "./span_encoding.ts" { namespace Span { export let fresh_expansion: (...) => Span; } }`
  then `Span.fresh_expansion = function (...) {...}`. Use `export let` (the namespace has an
  explicit `export { new_ as new }`, which turns off implicit exports). `Span.new`/`Span.default`
  are attached via a cast because `new`/`default` are reserved identifiers.
- Same pattern for `BytePos`/`RelativeBytePos`/`CharPos`: `BytePos(5)` constructs; `BytePos.from_u32`,
  `.add`, `.sub`, `.max`, `.min` on the companion. `Edition`/`FileName`/`SourceFileHashAlgorithm`
  methods live on their companion consts (`Edition.at_least_rust_2018(e)`).

## Root: integration work (stand-ins in lib.ts "Wave-1 stand-ins" section, span_encoding.ts)
- Sibling stubs have no runtime values (a value import from them fails at link time), so:
  `hygiene.HygieneData.new` is reached through `import * as hygiene` (works once hygiene lands).
- Replace with sibling exports: `SyntaxContext_root/from_u32/as_u32/is_root` (span_encoding.ts,
  exact newtype ops), `SyntaxContext_outer_expn_data/in_external_macro/edition/apply_mark/
  remove_mark/adjust/normalize_to_macros_2_0_and_adjust/normalize_to_macros_2_0/
  normalize_to_macro_rules`, `ExpnId_root`, `debug_SyntaxContext` (`#N`), `LOCAL_CRATE` (=CrateNum 0),
  local placeholder types `ExpnData`/`ExpnKind`/`MacroKind`/`DesugaringKind`/`Transparency`/`StableCrateId`.
- `Interner_with_extra_symbols` -> the generated `Interner::with_extra_symbols` (span-symbol /
  codegen). Until then `SessionGlobals.new` and all `create_*session_globals*` throw Unported.
  The test `test_trim` therefore builds `SessionGlobals` by hand via `set_session_globals_then`
  (PORT note in tests.test.ts); switch to `create_default_session_globals_then` after integration.
- `SourceMap`/`SourceMapInputs` are opaque local placeholders (wave 2).
- `FreezeLock` (subset) and `FatalErrorMarker` defined locally; move to rustc_data_structures later.
- `Hash64`/`Hash128` = bigint until rustc_hashes is ported.
- Needed vendor crate: **unicode-width 0.2.2** (`char_width`, used by
  `lookup_file_pos_with_col_display` -> SourceMap::lookup_char_pos -> Span Debug). Only printable
  ASCII is handled now.

## Every `unported(...)` left (lib.ts)
- hygiene: `SyntaxContext::{outer_expn_data, in_external_macro, edition, apply_mark, remove_mark,
  adjust, normalize_to_macros_2_0_and_adjust, normalize_to_macros_2_0, normalize_to_macro_rules}`,
  `ExpnId::root` (so `Span.edition`, `source_callsite` of non-root spans, etc. are unported until hygiene lands)
- symbol: `Interner::with_extra_symbols`
- source_map: `SourceMap::{with_inputs, is_span_accessible, is_imported, span_to_diagnostic_string}`.
  Note: Span Debug with a source map (`file.rs:1:1: 1:33 (#0)`, and `no-location (#0)` for dummy
  spans, which comes from `span_to_location_info`) is wave 2; without a source map the upstream
  fallback `Span { lo: BytePos(0), hi: BytePos(0), ctxt: #0 }` works.
- `rustc_data_structures::stable_hasher::StableHasher` (FileName::*_source_code except DocTest,
  `StableSourceFileId::hash`), `std::path::Path::file_name` (Short display), `blake3::hash`,
  `unicode_width::UnicodeWidthChar::width` (non-ASCII).

## `// PORT:` decisions
- Span representation and companions (above). `&mut self` Span methods (`remove_mark`, `adjust`,
  `normalize_to_macros_2_0_and_adjust`) return `[updated span, result]`.
- `StableSourceFileId` stores its hash inputs `(filename, stable_crate_id)` instead of the Hash128
  (never printed; only incremental/metadata). `SourceFile.new` works without StableHasher.
- `SourceFile.lines` field renamed `lines_` (JS cannot have field + method `lines()`).
- `normalize_src`/`remove_bom`/`normalize_newlines` return the new `Str` instead of mutating.
- `SourceFileHash`: Md5/Sha1/Sha256 via `Bun.CryptoHasher`; `io::Read` modeled as an interface.
- analyze_source_file: SSE2/LSX paths rustc-skipped as observably identical; generic arm ported.
- `SESSION_GLOBALS` scoped TLS = module slot with `is_set/set/with`.
- `bug!`/`span_bug!` -> `bug(msg)`/`span_bug(span, msg)`; `ExplicitBug` extends `Panic` (ICE);
  `Location` from `#[track_caller]` is passed as `undefined`.
- `RemapPathScopeComponents` = number + companion; Debug per bitflags 2.10 (`Name(A | B)`, `Name(0x0)`).
- Skips beyond Encodable/Decodable/HashStable needing ratification: SpanEncoder/SpanDecoder/
  BlobDecoder trait methods and impls (metadata), `impl Hash for RealFileName` (feeds StableHasher
  only), profiling.rs (self-profiler), the span_encoding format helpers above.
- `AttrId` (newtype_index!) is only a branded type; codegen should generate its helpers.
