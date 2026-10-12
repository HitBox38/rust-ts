# Contract: rustc_span (after wave-1 integration, lane span-wire)

The three wave-1 lanes are integrated; this records the public TS shape other crates use.
If you need something not listed, `unported("...")` it and note it in your handoff.

| Export | Defined in | Shape |
|---|---|---|
| `Span`, `DUMMY_SP`, `OrdSpan` | `src/rustc_span/span_encoding.ts` (re-exported by `lib.ts`) | branded number; `DUMMY_SP` = 0. Methods on the hoisted `Span` companion: `Span.lo(sp)`, `Span.ctxt(sp)`, `Span.new(..)`; lib.rs/hygiene.rs `impl Span` methods are attached via `declare module "./span_encoding.ts" { namespace Span { export let m: .. } }` |
| `debug_Span`, `SpanData`, `SpanData_eq`, `Spanned`/`debug_Spanned`, `respan`, `dummy_spanned` | `src/rustc_span/lib.ts` | Span Debug through the source map is `unported` (source_map.rs); the no-source-map fallback `Span { lo: BytePos(0), hi: BytePos(0), ctxt: #0 }` works |
| `BytePos`, `CharPos`, `RelativeBytePos` (+ `debug_BytePos`), `AttrId`/`debug_AttrId`, `ErrorGuaranteed`/`debug_ErrorGuaranteed` | `src/rustc_span/lib.ts` | branded numbers + companions; `AttrId` via `newtype_index` |
| `SessionGlobals`, `with_session_globals`, `create_session_globals_then`, `create_default_session_globals_then`, `set_session_globals_then`, `create_session_if_not_set_then` | `src/rustc_span/lib.ts` | `create_*` work end-to-end (no source map). `SessionGlobals.source_map: SourceMap \| undefined` |
| `SourceMap`, `SourceMapInputs` | `src/rustc_span/lib.ts` (placeholder) | opaque until source_map.rs lands; move to `source_map.ts` then |
| `Edition`, `Edition_discriminant`, `debug_Edition`, `DEFAULT_EDITION` | `src/rustc_span/edition.ts` | string union; methods on the companion (`Edition.at_least_rust_2018(e)`); `Edition_discriminant: Record<Edition, number>` for `PartialOrd` |
| `Symbol`, `ByteSymbol`, `Ident`, `Interner`, `kw`, `sym` (+ `debug_Symbol`, `debug_ByteSymbol`, `debug_Ident`, `display_*`) | `src/rustc_span/symbol.ts` | `Symbol` branded number, methods on the companion (`Symbol.intern(s)`, `Symbol.as_str(s)`); `Interner.with_extra_symbols(extra)`, `.intern_str`/`.get_str`/`.intern_byte_str`/`.get_byte_str`; `kw`/`sym` generated into `symbol.gen.ts` |
| `SyntaxContext`, `ExpnId`, `LocalExpnId`, `ExpnData`, `ExpnKind`, `MacroKind`, `DesugaringKind`, `Transparency`, `HygieneData`, `MutRef` | `src/rustc_span/hygiene.ts` | `SyntaxContext` branded number, methods on the companion const (`SyntaxContext.root()`); `debug_SyntaxContext` = `#n`; `debug_LocalExpnId` = `expnN` |
| `DefId`, `LocalDefId`, `CrateNum`, `DefIndex`, `LOCAL_CRATE`, `CRATE_DEF_INDEX`, `StableCrateId` | `src/rustc_span/def_id.ts` | PORTING §5 handles; `DefId` an immutable class (`DefId_eq`) |
| `Hash64`, `Hash128` | `src/rustc_hashes/lib.ts` | branded bigints |
| `Fingerprint`, `AtomicRef`, `FreezeLock` | `src/rustc_data_structures/{fingerprint,atomic_ref,sync/freeze}.ts` | partial ports |
| `newtype_index(debug_format, max?)` | `src/rustc_index/newtype_index.ts` | stand-in for the `newtype_index!` expansion (until codegen) |

Conventions (PORTING §8): `&mut` handle out-params take `MutRef<T>` = `{ value }` (e.g.
`Span.remove_mark(sp: MutRef<Span>): ExpnId`); enum methods live on the companion const; Debug
functions are `debug_<Type>` taking `(v, f)`; data equality is `<Type>_eq`.

Debug formats that the `parse` suite will check (match them exactly):
- `Span`: `file.rs:1:1: 1:33 (#0)` via the source map when present; `no-location (#0)` for dummy spans (source_map.rs, wave 2).
- `Ident`: `main#0` (name + `#` + syntax context).
- `NodeId(4294967040)` (DUMMY_NODE_ID) — rustc_ast.
