# Handoff: hir-pretty-a (wave 14, M3): rustc_hir_pretty lib.rs lines 1–1305

Branch `lane/hir-pretty-a`, from main `a62a248`. Nothing merged.

## Files
- **New: `src/rustc_hir_pretty/lib.ts`.** It has two regions with the agreed marker lines:
  - `// ==== lane hir-pretty-a: lib.rs:1..1305 ====` is mine, with its own import block.
  - `// ==== lane hir-pretty-b: lib.rs:1306..end ====` is left empty for lane b.
- **Call-site edit: `src/rustc_driver_impl/pretty.ts`.** The `Hir(s)` arm of `print` (pretty.rs:271) is ported:
  - `PpHirMode::Normal` prints with `HirTyCtxt_as_PpAnn(hir.map.TyCtxt_as_HirTyCtxt(tcx))`.
  - `Identified` and `Typed` still stop as `unported` (`HirIdentifiedAnn` pretty.rs:88, `HirTypedAnn` pretty.rs:149).
  - I also changed the header comment and added 2 imports.
- No other file was touched.

## Coverage
- `bun scripts/coverage.ts --missing compiler/rustc_hir_pretty/src/lib.rs`: 68/119. Every missing fn is at line
  1306 or later (lane b's region). Nothing is missing in 1..1305.
- `bun scripts/coverage.ts --check`: `markers ok (9507; vendor 3888)`.

## Merge with hir-pretty-b (please read)
- **My region owns the types and the class:**
  - `AnnNode`, `Nested`, `PpAnn`, `HirTyCtxt_as_PpAnn`;
  - the `State` class: fields, the first `impl State` block, `Deref`/`DerefMut`, `impl PrintState`;
  - `INDENT_UNIT`, `print_crate`, `to_string` and the `*_to_string` fns.
- **The later `impl State` blocks** are declared on `export interface State { .. }` (class/interface merging in the
  same module) and assigned to `State.prototype.<fn> = function (this: State, ..)` in upstream order. Lane b should
  attach its methods the same way. If b also defined a `State` class or stand-in, keep mine and drop b's.
- **Renamed inherent methods.** These `State` methods have the same names as `PrintState` methods, so they get a
  trailing `_`:

  | lane | method | marker |
  |---|---|---|
  | a | `print_attr_item_` | :132 |
  | a | `bclose_maybe_open_` | :339 |
  | a | `bclose_` | :348 |
  | b | `print_path_` | :1825 |
  | b | `print_path_segment_` | :1839 |
  | b | the inherent `print_generic_args_` | :1890 |

  This is required, not cosmetic. `PrintState`'s provided methods (`print_mac_common`, `print_mac_def`,
  `print_attribute_inline`, ...) call `this.print_path(path, false, 0)` / `this.bclose(span, no_space, cb)`. If the
  HIR versions had the same names, they would override the trait's methods on the prototype chain, and those trait
  methods would dispatch to them. My region calls `print_path_` / `print_path_segment_`. If b chose other names,
  rename the call sites at merge.
- **Merge stand-ins.** At the end of my region there is a block
  `// ---- merge stand-ins for lane hir-pretty-b (DELETE THIS BLOCK AT MERGE) ----`. It contains:
  - an `interface State` declaring the 30 b methods my region calls;
  - `unported_methods(State.prototype, "rustc_hir_pretty::State", [...])` placeholders;
  - stand-in `stmt_ends_with_semi` / `contains_exterior_struct_lit` fns that call `unported`.

  At merge, **delete the whole block**. The two free fns would otherwise be duplicate declarations. The interface
  members and placeholders are harmless, because b's prototype assignments run later and overwrite them. If a
  signature I declared differs from b's (for example `print_bounds` taking `Iterable<GenericBound>`), tsc will show
  it once the block is gone.
- **Import blocks overlap.** Both regions import from the same modules (`hir`, `ast`, `pp`/`pprust`, ...). After the
  merge, deduplicate them into one block.

## Tests and evidence
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: see "Final checks" below.
- **`RUST_TS_AGENT=hir-pretty-a bun scripts/difftest.ts --suite unpretty-hir --sample 100`** (run
  `20261014-044849-hir-pretty-a-kdsi`):
  - **10 MATCH, 0 DIFF, 90 UNPORTED, 0 CRASH.**
  - All 90 stops are `rustc_hir_pretty::State::print_path_`. That is lane b's method, reached through the injected
    `use std::prelude::rust_20xx::*;` that every std crate prints.
  - The 10 MATCH cases fail before printing.
  - No first-difference lines exist, because there were no DIFFs.
- **Scratch oracle check (not committed).** The script is at `$RUST_TS_DATA/tmp/hir-pretty-a/run.ts`.
  - **Setup:** it fills about 15 simple b methods transcribed from upstream (`print_name`, `print_path_` without
    generic args, `print_generic_params` for plain params, `print_where_clause` for empty clauses, `print_mutability`,
    `print_safety`, `print_constness`, `print_is_auto`, the restrictions, `print_qpath` for resolved paths), then
    runs the real driver.
  - **Item-only crate:** a 63-line crate with std injected and `--target x86_64-unknown-linux-gnu`. It has:
    - crate and inner attributes, `//!` and `///` docs, and comments (line, trailing, block);
    - `use` with nested and renamed trees, and `extern crate std`;
    - a struct with `&'a T`, `*mut`, a 1-tuple, `&'static [u16]` and `*const ()`;
    - a tuple struct, an enum (unit, tuple and struct variants) and a union;
    - nested mods, a type alias, a trait with an associated type, an `extern "C"` static, an impl with an associated
      type, `macro_rules!`;
    - parsed (`Inline`, `Doc`) and unparsed (`rustfmt::skip`) attributes.

    **Its stdout and stderr were byte-identical to the pinned rustc.**
  - **tests/ui sweep:** a deterministic 300-file sweep (every 97th file) compared the same harness with the oracle.
    Results are in "Final checks". Most files stop at b's `print_fn`/`print_expr` before printing.

## `unported(...)` left
- The merge stand-ins above: 30 `State` methods and 2 free fns, all in lane b's range.
- pretty.ts: `HirIdentifiedAnn` (`-Zunpretty=hir,identified`) and `HirTypedAnn` (`hir,typed`).

## PORT decisions (please record)
1. **`PpAnn`** (a trait whose methods are all provided) is a class, as rustc_ast_pretty's is.
   - `impl PpAnn for &dyn HirTyCtxt` is the private class `HirTyCtxtPpAnn`.
   - `HirTyCtxt_as_PpAnn(cx)` is the coercion `&cx as &dyn PpAnn`, like middle-hir's `TyCtxt_as_HirTyCtxt`.
   - `id_to_string(cx, ..)` passes `HirTyCtxt_as_PpAnn(cx)`.
2. **`State` follows the `PrintState` contract** (decision 2026-10-12):
   - it `extends PrintState`, and `s` is the `Deref` target;
   - fields `comments` → `comments_` and `attrs` → `attrs_`, because they clash with the methods of the same name.
3. **Inherent `State` methods that clash with `PrintState` method names get a trailing `_`** (table above). Upstream
   resolves them statically (trait vs inherent); in TS they share one prototype chain.
   - `print_attr_item_`'s calls `PrintState::print_path(self, &path, false, 0)` are `this.print_path(path, false, 0)`.
4. **The later `impl State` blocks are prototype assignments declared through `interface State`**, in file order.
   - `Self::cond_needs_par` (an associated fn, :1289) is a `static` in the class body (PORTING §8), because
     interface merging cannot add statics.
5. **`pa.print_attribute(self)`** (the `&mut Printer` reached by deref) is
   `print_attribute_AttributeKind.print_attribute(pa, this.s)`.
6. **`TyKind::TraitObject`'s `lifetime.is_elided()`** auto-derefs the `TaggedRef`, so it is written
   `lifetime.pointer().is_elided()`.

## Final checks
(filled in below after the runs)
