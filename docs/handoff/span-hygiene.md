# Handoff: span-hygiene (rustc_span, part 3)

## Files touched
- `src/rustc_span/hygiene.ts`: full port of `compiler/rustc_span/src/hygiene.rs` (replaces the root stub)
- `src/rustc_span/def_id.ts`: full port of `compiler/rustc_span/src/def_id.rs` (replaces the root stub)
- `src/rustc_span/hygiene.test.ts`: new focused tests (also cover def_id.ts)

## Coverage
- `hygiene.rs`: 98/98 (incl. 17 `rustc-skip`: HygieneEncodeContext ×5, decode_expn_id, decode_syntax_context, LocalExpnId Encodable/Decodable, StableHash ×3)
- `def_id.rs`: 52/52 (incl. 7 `rustc-skip`: LocalDefId encode/decode, StableHash ×3, ToStableHashKey ×2)
- `bun scripts/coverage.ts --check`: markers ok

## Test results
- **In this lane:** `bunx tsc` gives 5 errors, all `has no exported member` for contract names that root's stubs do not
  export yet: `DUMMY_SP` (span_encoding.ts), and `kw` and `sym` (symbol.ts). Because of this, `bun test src`
  reports 17 pass and 1 fail: hygiene.test.ts cannot load (`Export named 'DUMMY_SP' not found`).
- **Scratch check:** I copied the tree to `D:/rust-ts-data/tmp/span-hygiene/verify` and added only those
  three exports to the stubs. There tsc is clean for `src` and `bun test src/rustc_span` gives **7 pass, 0 fail, 83 expects**.
- These errors should clear once span-core and span-symbol land the contract exports.

## unported(...) left
Contract seams: things other lanes own that are not in docs/contracts/rustc_span.md. Each is one private
function near the top of hygiene.ts. Root should point each one at the real export after the merge:
- `Span::ctxt`, `Span::from_expansion`, `Span::is_dummy` (span_encoding.rs), `Span::apply_mark`, `<Span as Debug>` (lib.rs)
- `<Symbol as Display>`, `<Symbol as Debug>` (symbol.rs)
- `SourceMap::is_imported` (wave 2)

Real gaps:
- `StableCrateId::new` and `ExpnData::hash_expn` need StableHasher (rustc_data_structures).
- `update_disambiguator` needs the skipped `ToStableHashKey`. As a result `LocalExpnId::fresh`, `set_expn_data` and
  `mark_with_reason` end in unported.
- `debug_hygiene_data(verbose = true)` is unported because `{:#?}` of FxHashMaps depends on hashbrown iteration order.
  The non-verbose path is fully ported.

## PORT decisions (all marked `// PORT:` in code)
- **Handles as branded numbers** (PORTING §5): SyntaxContext, ExpnIndex, LocalExpnId, CrateNum, DefIndex, LocalDefId and LocalModId.
  - Their methods live on a companion const and take `self` first, for example `SyntaxContext.normalize_to_macros_2_0(c)`.
  - `newtype_index` in def_id.ts is a stand-in for the macro expansion: from_usize/from_u32/from_u16/new/index/as_u32/as_usize/MAX/MAX_AS_U32/ZERO, plus Debug from `debug_format`.
- **For span-symbol:** `debug_SyntaxContext` (`#n`), `SyntaxContext.dollar_crate_name`, `SyntaxContext.normalize_to_macros_2_0` and `SyntaxContext.normalize_to_macro_rules` are exported under the upstream names.
- **`&mut SyntaxContext`** becomes `MutRef<SyntaxContext>` = `{ value }`. This applies to remove_mark, adjust, normalize_to_macros_2_0_and_adjust, glob_adjust and reverse_glob_adjust.
- **`Option<Option<ExpnId>>`** (glob_adjust, reverse_glob_adjust) becomes `{ $: "Some", _0 } | undefined`.
- **Multi-field ids are immutable classes** with `_eq` functions: ExpnId (`ExpnId_eq`), DefId (`DefId_eq`), ModId (`ModId_eq`).
  - DefId fields and constructor follow upstream LE-64 declaration order: `new DefId(index, krate)`.
  - Maps keyed on ExpnId or SyntaxContextKey use a private `KeyedMap` (canonical string key). Root may want this in `src/std`.
- **Hash newtypes are branded bigints** with `.of(x)` / `._0(self)`: ExpnHash, DefPathHash, StableCrateId. This keeps them usable as Map keys and comparable with `===`.
- **Stand-ins for unported crates, exported from def_id.ts.** Root should move them when those crates are ported:
  - `Hash64` (bigint)
  - `Fingerprint` (u128 bigint packed as `(_0<<64)|_1`, Debug `Fingerprint(a, b)`)
  - `AtomicRef` (new/swap/deref)
  - `Hasher` (write_u64)
  - `RawDefId`
- **DEF_ID_DEBUG hook** ported as `AtomicRef<(DefId, Fmt) => string>`. `debug_DefId` and `debug_LocalDefId` go through it.
- **ExpnData `Clone`:** public fields are readonly (except `disambiguator`, which is private upstream), so `expn_data()` returns the shared instance instead of cloning. Struct-update syntax is spelled out field by field.
- `HygieneData.local_expn_data` (fn) is renamed `local_expn_data_` because the field has the same name.
- **Other `// PORT:` notes:**
  - `mark_with_reason` (`impl Span` in hygiene.rs) is a free function `mark_with_reason(span, ...)`.
  - `debug_Edition` is the variant string.
  - `CRATE_MOD_ID` is moved after LocalModId.
  - `LOCAL_CRATE` is inlined as `0`. Both are module init-order issues.
  - `lower_hex_StableCrateId` supports only the `#` flag.
  - `define_id_collections!` (DefIdMap and similar) is not ported: DefId needs a key strategy, which is a root decision.
- **Naming:** at this pin the upstream names are `ModId` / `LocalModId`, not `ModDefId` / `LocalModDefId` as the brief said.
- Tracing `debug!` calls are kept as comments. `debug_assert*` calls are kept as comments.
