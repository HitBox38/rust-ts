# Wave 1 review (independent reviewer, lane review-w1)

Reviewed at main `9a2aa7a` (all wave-1 lanes merged). Method: `coverage.ts --check` (599 markers ok),
`--missing` per file (all 0 missing), a marker-order scan, `bun test src` (56 pass, 2 skip, 0 fail),
and a line-by-line comparison against upstream at the pin for the functions listed under each batch.
Cross-lane stand-ins and placeholders (span-wire is replacing them) were not reviewed, as root asked.

## Batch 1: vendor rustc-literal-escaper 0.0.8, escapes probe, escapedump, `escape` suite: **ACCEPT**

Checked line by line: `check_raw`, the three `char2raw_unit`s, `char2byte`, `unescape_single`, `unescape_1`
(including the `or_else` + `?` short-circuit), `unescape`, `simple_escape`, `hex_escape`, `unicode_escape`,
`skip_ascii_whitespace`, all `Unescape` impls (str/[u8]/CStr), the MixedUnit From/TryFrom impls,
`check_for_errors`, `Mode` methods, `to_digit` and `char_is_whitespace` (all 25 White_Space code points).
The logic matches upstream. Tests: all 9 tests and 167 `check` calls are ported, and none is weakened.

How strong the probe is: it calls every public entry point (`unescape_{char,byte,str,byte_str,c_str}`,
`check_raw_{str,byte_str,c_str}`, `check_for_errors`, `is_fatal`, `Mode::{prefix_noraw,in_double_quotes}`).
That covers every use in the pinned compiler (rustc_parse lexer `check_for_errors`, rustc_ast `util/literal.rs`,
parser `unescape_char`, rustc_parse_format `unescape_str`). Both sides use the same rustc_lexer token slicing,
and the Debug of every per-unit result is diffed, so a wrong port will almost always show up as a MISMATCH.

1. harness/suites.ts:88, **med**. The corpus is real .rs files only, and it reaches 17 of the 23 EscapeError
   variants (per the handoff). A wrong port in the paths for the other 6 variants could still MATCH; only the unit
   tests cover them. Fix: add a synthetic corpus directory (generated literals for every escape form and every error
   variant, including lone `\` at end, `\u{` overlong, surrogate and out-of-range cases, `\x80` in str/c-str, NUL
   in c-str, and backslash-newline followed by U+00A0 or a second newline) to the suite's case list. This is a harness
   change, so it needs its own batch.
2. tools/probes/escapes/main.rs:46, **low**. The probe lexes raw file text. rustc removes the BOM and normalizes
   CRLF first (`normalize_src`). Both sides do the same thing, so the comparison is still valid, but the `\r`
   cases it exercises are not the ones rustc sees. Note this in the suite description.
3. src/vendor/rustc_literal_escaper/lib.ts:816,829, **low**. `to_digit` and `char_is_whitespace` are core helpers
   private to the vendor file. Move them to `src/std/char.ts` (requested in the handoff). Their behaviour is correct.
4. lib.ts (whole file), **low**. Methods on fieldless enums are free functions (`EscapeError_is_fatal`,
   `Mode_prefix_noraw`). The span lanes put them on the companion const instead (see the cross-lane section).

## Batch 2: rustc_span symbol.ts, symbol.gen.ts, edit_distance.ts, tools/codegen/symbols.ts: **ACCEPT-WITH-FIXES**

Checked line by line: `Ident::{without_first_quote, is_reserved_lifetime, is_raw_lifetime_guess,
guess_print_mode, is_numeric, eq, hash}`, `IdentPrinter` Display (the `$crate`/r#/k#/'r# arms), `Symbol::{to_ident_string,
find_similar, stable_cmp}`, all keyword-range predicates, `Interner::{prefill, intern_inner, get_*}`,
`sym::{integer, ascii_letter_digit, character}`, `used_keywords`, and all of edit_distance.rs (`edit_distance`,
`_with_substrings`, `find_best_match_for_names` (first minimum wins, as `min_by` does), `_impl`, sorted words).
The logic matches upstream. The generator follows rustc_macros/src/symbols.rs: same prefill order, `env!` values
reuse an existing index, and the BASE constants and PREDEFINED_SYMBOLS_COUNT come out the same.

1. src/rustc_span/symbol/tests.test.ts:9, edit_distance/tests.test.ts:11, **med**. Two upstream tests are still
   `test.skipIf(globals_unported)` on the integrated main, because `Interner_with_extra_symbols` (lib.ts:115) is still
   a stand-in. A skip that depends on a runtime condition will hide these tests for good if anything else throws
   Unported. Fix: wire `Interner.with_extra_symbols`, then make both plain `test(...)`.
2. tools/codegen/symbols.ts, **med**. The full check of all 2434 strings against upstream's interner was done with
   a scratch probe (`D:/rust-ts-data/tmp/span-symbol/symprobe`) that is not committed, so regeneration is not
   checked against the oracle. Promote it to `tools/probes/symdump` and add a gate check. Also explain the "first
   fresh symbol = 2435" in the handoff: PREDEFINED_SYMBOLS_COUNT is 2434, so the probe presumably interned `main` first.
3. src/rustc_span/symbol.ts:198-288 and 523-600, **low**. The `impl Ident` predicates (upstream 3116-3181) and
   the `impl Symbol` predicates (3052-3108) were moved into the earlier class/companion, and the Debug impls come
   after them. The marker-order scan flags symbol.ts 2587/2806/2864. This is acceptable for class grouping, but it
   should be a recorded convention.
4. symbol.ts:492, **low**. `to_lowercase`/`to_uppercase` map to JS `toLowerCase`/`toUpperCase`, so the Unicode
   version is the engine's. The PORT note covers this; add it to the list of known Unicode-version dependencies
   (as with the unicode tables).

## Batch 3: tools/probes/typedefs, tools/codegen/types.ts, typemap.json: **ACCEPT-WITH-FIXES**

Checked: the rules for the cfg truth table, derive detection, fieldless and data enums, discriminant evaluation
(failure is an ERROR), unit-variant singletons, the Option<Option> rule, how unknown types and missing Debug
are reported, and exit codes.

1. tools/codegen/typemap.json:32, **med**. `Cell`/`RefCell`/`std::cell::*` are mapped with `"debug": "transparent"`.
   That is wrong: core prints `Cell { value: .. }` and `RefCell { value: .. }` (or `<borrowed>`), see
   library/core/src/fmt/mod.rs:3147-3162. It is not hit by rustc_lexer or rustc_ast today, but it is exactly the
   kind of silently wrong Debug the generator must not produce. Fix: give them their own Debug templates.
   `Cow`/`Box`/`Rc`/`Arc` are correctly transparent.
2. tools/codegen/types.ts:294-295, **med**. An unknown cfg predicate is reported but evaluated as `false`, and the
   run exits 0. That is a fallback which changes type shapes. Fix: make an unknown cfg an `ERROR:` with exit 1, like
   discriminants.
3. typemap.json:23,28, **low**. `u64`/`i64` → `number` and `str`/`String` → `string` apply globally. PORTING §5
   requires `bigint` when values may reach 2^53, and `Str` for source text. The generator cannot know either, so it
   should list every field it mapped this way in the report so a porter decides each one. Today it does not.
4. typedefs handoff, **low**. `FxHashMap` Debug is null (reported). That is correct. Note for root: `FormatArguments.names`
   needs a decision before rustc_ast Debug can be diffed.

## Batch 4: rustc_span hygiene.ts, def_id.ts (span-hygiene): **ACCEPT-WITH-FIXES**

Checked line by line: `HygieneData::{new, expn_hash, expn_data, is_descendant_of, remove_mark, marks, walk_chain,
walk_chain_collapsed, adjust, apply_mark, alloc_ctxt}`, `update_dollar_crate_names`, `debug_hygiene_data` (non-verbose),
`SyntaxContext::{glob_adjust, reverse_glob_adjust, hygienic_eq, normalize_*, in_external_macro}`, the Debug impls
for SyntaxContext/ExpnId/LocalExpnId/ExpnIndex, `mark_with_reason`, all `descr`/`article`/`matches` functions,
`DefId::{hash, as_local, expect_local, to/from_raw_def_id}`, `default_def_id_debug` and the DEF_ID_DEBUG hook,
`StableCrateId` LowerHex, and the CrateNum/DefIndex debug formats. The logic matches upstream. `unported(...)`
is used only for real gaps (StableHasher, ToStableHashKey, verbose `{:#?}` in hash order). No guessed values.

1. hygiene.ts:327/359 + the ExpnData PORT note, **med**. `expn_data()` returns the shared stored instance where
   upstream returns a clone, but `update_disambiguator` mutates `expn_data.disambiguator` on whatever object
   `fresh`/`set_expn_data` receive. If any caller ever passes an ExpnData it got from `outer_expn_data()`, the
   stored entry is changed. This is unreachable today (update_disambiguator is unported), so it is latent. Fix:
   copy in `fresh`/`set_expn_data` before mutating, or make `outer_expn_data` copy.
2. hygiene.ts:1537-1631, def_id.ts:406-416, **low**. The skips are within the allowed kinds (Encodable, Decodable,
   StableHash, ToStableHashKey), except `HygieneEncodeContext` ×5 and `decode_expn_id`/`decode_syntax_context`.
   Those are metadata functions but not trait impls, so they need a recorded root decision (see batch 5, finding 1).
3. def_id.ts:20-60, **low**. The `newtype_index` stand-in is a local helper here. symbol.ts inlines `SymbolIndex`,
   and hygiene.ts and span_encoding.ts each have their own SyntaxContext ops. This should be one helper in
   `src/rustc_index` (or generated by codegen), as PORTING §5 implies.

## Batch 5: rustc_span lib.ts, span_encoding.ts, analyze_source_file.ts, edition.ts, fatal_error.ts (span-core): **ACCEPT-WITH-FIXES**

Checked line by line: `Span::{macro_backtrace (lazy generator, recursion skip), split_at, try_metavars,
prepare_to_combine, with_neighbor, to, between, until, within_macro}`, the Span Debug fallback, `SourceFile::{new,
convert_diffs_to_lines_frozen (LE decoding of 1/2/4-byte diffs), lines, lookup_line (partition_point),
line_bounds, original_relative_byte_pos, normalized_byte_pos, bytepos_to_file_charpos, lookup_file_pos,
lookup_file_pos_with_col_display}`, `char_width`, `str_width`, `normalize_src`/`remove_bom`/`normalize_newlines`/`find_crlf`,
all of analyze_source_file (generic arm), span_encoding `new`/`data`/`from_expansion`/`is_dummy`/`ctxt`/`eq_ctxt`/
`with_parent`/`parent`/`OrdSpan`, all of edition.rs, and all of fatal_error.rs. The logic matches upstream.
`char_width` is not guessed: anything outside printable ASCII calls `unported`.

1. Several files, **med (process)**. Skips outside PORTING §3's allowed kinds, with no decision recorded in
   history.jsonl: span_encoding.rs inline/partial formats ×9 and `to_raw_span`/`from_raw_span`; analyze_source_file
   SIMD ×4; SpanEncoder/SpanDecoder/BlobDecoder trait methods (~40, lib.ts:1610-1664); `impl Hash for RealFileName`
   (lib.ts:492); profiling.rs ×2; plus the hygiene ones in batch 4, finding 2. I agree with them on substance: the
   SIMD arms give the same output as the generic arm, and the span formats cannot be observed because equality stays
   canonical through the deduplicating interner. Root must ratify them with `state.ts record decision` (the handoff asks for this).
2. span_encoding.ts (Span representation), **low**. Every non-dummy span now needs session globals, where upstream
   does not need them for inline spans. So `debug_Span` of a non-dummy span outside a session panics where upstream
   prints the raw fallback. This cannot happen in compiler runs; note it for test writers.
3. lib.ts:961 vs hygiene.ts (MutRef), **low**. `&mut self` uses two conventions: Span methods return
   `[updated, result]`, while hygiene's SyntaxContext methods take `MutRef<{value}>`. Pick one (see the cross-lane section).
4. edition.ts, **low**. Methods exist both as `Edition_*` free functions and on the companion, and
   `Edition_discriminant` is a function where codegen emits `<E>_discriminant: Record<E, number>`. `debug_Edition`
   has no `f` parameter and is not typed `Debug<Edition>`.

## Cross-lane items for root to normalise

- Methods on fieldless enums: escaper uses free `<Enum>_<m>(self)`, hygiene and symbol use companion methods
  (`MacroKind.descr(k)`), and edition uses both. Pick one, either companion methods (matches span-core's handle
  pattern) or free functions, and add it to PORTING §5.
- Discriminants: a `<E>_discriminant` function (edition.ts) vs a `Record` (codegen). Use the codegen form.
- Debug for fieldless enums: `debug_X: Debug<X> = (v) => v` (escaper) vs an untyped `debug_Edition(e)`. Type every one as `Debug<T>`.
- `&mut` handle params: tuple return (lib.ts Span) vs `MutRef` (hygiene.ts). Pick one.
- Duplicated stand-ins to consolidate: `Hash64` (lib.ts:133 and def_id.ts), `newtype_index` helpers (def_id.ts,
  symbol.ts, span_encoding.ts), `FreezeLock`/`FatalErrorMarker`/`AtomicRef`/`Fingerprint` (→ rustc_data_structures,
  rustc_hashes), `to_digit`/`char_is_whitespace` (→ src/std/char.ts), and a `KeyedMap` (hygiene) for composite keys
  (→ src/std).
- Method order: classes that gather an `impl` from later in the file (symbol.ts, lib.ts 1734/1767/2116 Debug/Display
  impls) break the "upstream order" rule. The marker scan shows 6 inversions. Either allow this explicitly for
  class/companion grouping, or move them.

## High-severity findings

None. No batch has a fidelity bug in the ported functions that were checked. The most important fixes are batch 3
findings 1 and 2 (the generator's silent Debug and cfg fallbacks), batch 1 finding 1 (6 EscapeError variants
uncovered in the corpus), batch 2 finding 1 (tests still skipped), and the skip ratification in batch 5, finding 1.
