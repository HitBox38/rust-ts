# Handoff: rustdoc (wave 10, M2): rustc_resolve rustdoc.rs + vendored pulldown-cmark 0.11.3 (+ unicase 2.8.1)

Branch `lane/rustdoc` (from main 00f8a7b, no merges). Every commit message ends with the Co-Authored-By line.

## Files
- **Ported:** `src/rustc_resolve/rustdoc.ts` fills the res-lib stub in place. Its signatures are unchanged and every fn
  carries a marker. The stub-era `Options` / `LinkType` / `Parser` stand-ins are now re-exports of the vendored crate, and
  `export * as pulldown_cmark` mirrors `pub use pulldown_cmark`.
- **Vendored pulldown-cmark 0.11.3** (`src/vendor/pulldown_cmark/`): the version in Cargo.lock, which
  rustc_resolve's Cargo.toml asks for as `0.11`, with `default-features = false` and `html`.
  - `lib.ts`: Event, Tag, TagEnd, LinkType, Options and the other public types.
  - `parse.ts`: the Parser (inline passes), Allocations, RefDefs, OffsetIter, and so on.
  - `firstpass.ts`: the block pass. A sub-agent ported it; I reviewed it.
  - `scanners.ts`: a sub-agent ported it; I reviewed it.
  - `tree.ts` and `linklabel.ts`.
  - `strings.ts`: `CowStr` is a JS `string`.
  - `entities.ts` and `puncttable.ts`: their tables were converted mechanically from the crate source.
  - Tests: `parse.test.ts` holds the tests of parse.rs, linklabel.rs and puncttable.rs. `scanners.test.ts` holds those
    of scanners.rs.
- **Vendored unicase 2.8.1** (`src/vendor/unicase/`): `lib.ts`, `ascii.ts`, `unicode/mod.ts` and `unicode/map.ts`, plus
  `lib.test.ts`. pulldown-cmark keys its reference and footnote maps with `UniCase`.
  - `map.ts` holds `lookup`. It was converted mechanically from map.rs: each `match` arm became an `if` in the same order.
- **Tests:**
  - `src/rustc_resolve/rustdoc/tests.test.ts` ports upstream `rustdoc/tests.rs` (2/2).
  - `src/rustc_resolve/rustdoc_oracle.test.ts` is the oracle test. Its helpers are in `rustdoc_oracle/corpus.ts`, with
    the committed `corpus.jsonl` and `expected.txt`.
- **New probe:** `tools/probes/rustdoc/{Cargo.toml.in,main.rs}`. Root should review it. It is a rustc-dev probe built
  with `bun scripts/probes.ts build rustdoc`.
- **Fetched sources:** `bun scripts/crate-src.ts` unpacked pulldown-cmark-0.11.3 and unicase-2.8.1 into
  `~/.cargo/registry/src`. That is the script's normal location, about 2 MB.

## Oracle test (rustdoc probe)
- **What the probe runs.** The probe runs the oracle's own code on a case list:
  - `attrs_to_doc_fragments` + `prepare_to_doc_link_resolution`, on real `ast::Attribute`s built with
    `mk_doc_comment` / `mk_attr_name_value_str`;
  - `strip_generics_from_path`;
  - the re-exported `pulldown_cmark`: the full `into_offset_iter` event stream with byte ranges, plus the reference
    definitions;
  - `parse_links`. `parse_links`, `preprocess_link` and `collect_link_data` are private upstream, so the probe holds a
    verbatim copy of them from the pin. Only `sorted_by_key` became `sort_by_key`, and `trim_suffix` became
    `strip_suffix().unwrap_or()`.
- **The cases.** There are 10625:
  - 37 handwritten doc-attribute cases: intra-doc links, code blocks, reference/collapsed/shortcut links, nested
    markdown, tables, footnotes, tasks, inner/outer, mixed sugared/raw indentation, all-blank docs, Unicode labels,
    Kelvin-sign folding;
  - 19 `strip_generics_from_path` inputs;
  - all 1082 inputs of pulldown-cmark's own test suite, each with options 0, `main_body_opts()` and all options
    (old-footnotes for `old_footnotes.rs`);
  - 3000 random token soups, with `main_body_opts()` and all options;
  - all 1360 `///` / `//!` blocks of compiler/rustc_resolve and compiler/rustc_ast.
  The soups and the doc blocks are regenerated deterministically at load time and are not committed.
- **Result:** 10625/10625 match.
  - A separate run of 9000 more soups (seeds 2–4, longer, some as doc attributes) also matched 9000/9000. It was not
    committed.
  - Negative control: one changed digest in `expected.txt` fails both tests.
- **Fixture.** The fixture check is always on. With the probe built, the live check also requires the fixture to be
  current; under `RUST_TS_REQUIRE_PROBES=1` a missing probe is a failure.

## Checks
- `bunx tsc --noEmit -p .` is clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools` gives 3428 pass, 1 skip (the old one), 0 fail.
- `bun scripts/coverage.ts --check`:
  - **With the scope entries below** (I used a temporary copy and did not commit it): `markers ok (6683; vendor 2910)`.
  - **Without them** it prints `ERROR: ... names no harness/scope.json vendor crate` for the new pulldown-cmark and
    unicase markers.
- Coverage:
  - `compiler/rustc_resolve/src/rustdoc.rs`: 16/16. `rustdoc/tests.rs`: 3/3.
  - pulldown-cmark-0.11.3 src:

    | file | ported |
    |---|---|
    | lib | 8/8 |
    | parse | 106/107 (missing `impl Debug for Parser`) |
    | firstpass | 55/55 (13 are `crate-skip`: the `mod simd` block, which is `cfg(x86_64 + feature "simd")` and not compiled) |
    | scanners | 66/66 |
    | tree | 23/23 |
    | linklabel | 3/3 |
    | entities | 1/1 |
    | puncttable | 4/4 |
    | strings | 0/39 (representation only, see below) |
    | html, main, utils | 0 (not reached) |

    Crate total: 264/1471. Most of the rest is the generated `tests/suite/*` html tests.
  - unicase-2.8.1: 43/76. The rest is the `From`/`Into`/`Display`/`FromStr` impls, the nightly benches and the
    `DefaultHasher` tests.
- `RUST_TS_AGENT=rustdoc bun scripts/difftest.ts --suite parse --sample 200` (run `20261013-133608-rustdoc-6lqt`): 199
  MATCH, 0 DIFF/UNPORTED/CRASH, 1 ORACLE_TIMEOUT. The timeout is `tests/ui/expr/if/expr-stack-overflow.rs`, the known
  case from the hashbrown-order handoff (not in the baseline). The rustdoc code is not reached by the parse suite yet,
  because resolve is not wired into the driver.

## Root: needed outside this lane
1. `harness/scope.json` `vendor`: add `"pulldown-cmark": "=0.11.3"` and `"unicase": "=2.8.1"`.
2. Gate hosts must build the new probe: `bun scripts/probes.ts build rustdoc`.
3. **Consumers (res-late-a/-b, `resolve_doc_links`).** Import from `src/rustc_resolve/rustdoc.ts` or via lib.ts.
   - `attrs_to_preprocessed_links(attrs)`, `prepare_to_doc_link_resolution`, `attrs_to_doc_fragments(iter, doc_only,
     AttributeExt.Attribute)` and `has_primitive_or_keyword_or_attribute_docs(attrs, impl)` are real now.
   - `prepare_to_doc_link_resolution` returns a plain insertion-ordered `Map` whose `DefId` keys are canonical: equal
     DefIds give the same key object, and `None` is `undefined`.

## `unported(...)` left
None in the ported code.

## PORT decisions (please record)
1. **pulldown-cmark representation.**
   - `CowStr` is a JS `string`, and `.len()` becomes `utf8_len`.
   - The input `&str` is a `Str`, with byte offsets as upstream. `&[u8]` is a `Uint8Array` subarray.
   - `Options` (a `bitflags!` type) is a plain number with `Options.contains` / `has_gfm_footnotes`.
   - `TreeIndex` is a branded number, and `tree[ix]` becomes `tree.at(ix)`.
   - `Item` is a mutable object owned by its node; copies use `clone_Item`. `ItemBody` values are immutable.
   - `BrokenLinkCallback` is a function type; the three `handle_broken_link` markers sit on it.
2. **`HashMap<UniCase<CowStr>, _>`** (RefDefs/FootnoteDefs) is a JS `Map` keyed by `UniCase_key(label)`. That key is
   UniCase's own `Hash` byte stream: the folded UTF-8 bytes + 0xFF, which is identical for the Ascii and Unicode
   encodings. The map stores `[label, value]`, so the first label is kept, as `HashMap::entry`/`insert` do.
   - `RefDefs::iter` yields insertion order. Upstream's order is unspecified, and every caller sorts.
3. **unicase `Fold::Three` iteration order.** It yields `three, one, two`, exactly as upstream's iterator does. Equality
   and hashing see the same order, so the result is consistent.
4. **Generated tables** (entities, puncttable, `unicase::lookup`) were converted mechanically from the crate sources.
   The one-off converters are not committed (`$RUST_TS_DATA/tmp/rustdoc/gen_*.ts`). Binary searches follow std's
   `binary_search_by`.
5. **rustdoc.rs:**
   - `usize::MAX` in `unindent_doc_fragments` is `Infinity`. It shows up as the `indent` of all-blank fragments. The
     probe prints `MAX` for `usize::MAX - 1..`, so `MAX` and `MAX - 1` are not told apart.
   - `attr.clone()` pushes the attribute itself.
   - `tracing` macros became comments.
   - `rustc_ast::util::comments` is imported directly, since lib.ts does not re-export `util`. lib.ts is also imported.
6. **`simd` feature parts** of firstpass.rs are `crate-skip`.
7. **Upstream unit test `parse.rs::ref_defs` panics on 0.11.3 itself.** A definition cannot interrupt a paragraph.
   Checked against the crate built from the registry and against the probe: both give `None`. The ported test asserts
   `None` and carries a PORT note.
8. **Size and html tests skipped.** `node_size` and `body_size` assert Rust memory layout, and the 5 `html`-module
   tests need `html`, which is not ported. All 7 are `crate-skip`.
