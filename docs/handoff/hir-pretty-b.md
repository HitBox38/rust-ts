# Handoff: hir-pretty-b (M3, wave 14): rustc_hir_pretty lib.rs:1306..end

Branch `lane/hir-pretty-b`. Upstream `compiler/rustc_hir_pretty/src/lib.rs` lines 1306..2751: from `print_inline_const`
through `print_impl_restriction` (the rest of `impl State`), then the free fns `expr_requires_semi_to_be_stmt`,
`stmt_ends_with_semi`, `contains_exterior_struct_lit`.

## Files touched
- new `src/rustc_hir_pretty/lib.ts`, with the two region markers. `// ==== lane hir-pretty-a: lib.rs:1..1305 ====` holds
  only a placeholder comment. `// ==== lane hir-pretty-b: lib.rs:1306..end ====` has its own import block and the code.
- new `src/rustc_hir_pretty/lib_b.test.ts` (unit tests). It is named `_b` so it cannot collide with a `lib.test.ts`
  from lane a.

## Coverage
- `bun scripts/coverage.ts --missing compiler/rustc_hir_pretty/src/lib.rs`: 51/119 ported. All 51 fns at lines
  1306..end are ported. The 68 still missing are all at lines ≤ 1298 (lane a).
- `bun scripts/coverage.ts --check`: markers ok.

## How the region is built (for the merge)
- My methods are attached with `State.prototype.<name> = function (this: State, ..)`, in upstream order, one marker on
  each. They are declared by an `export interface State { .. }` that merges with the class. This is the same-file form
  of PORTING §5 "Methods defined in another file".
- **Stand-in block (root deletes it at merge).** It sits between `// ---- stand-ins (PORT: pending hir-pretty-a) ...`
  and `// ---- end of stand-ins ... ----`. It contains:
  - stand-in `AnnNode`, `Nested`, `PpAnn`, `INDENT_UNIT`;
  - a stand-in `class State extends pprust.PrintState` with the constructor `(s, comments_, attrs_, ann)` and the four
    trait methods (`comments`, `comments_mut`, `ann_post`, `print_generic_args` panicking);
  - an interface that declares the lane-a methods this region calls: `attrs`, `precedence`, `print_attrs`,
    `bclose_maybe_open_`, `bclose_`, `commasep_cmnt`, `commasep_exprs`, `print_type`, `print_trait_ref`,
    `print_formal_generic_params`, `print_poly_trait_ref`, `print_local`, `print_block`, `print_block_unclosed`,
    `print_if`, `print_const_arg`, `print_call_post`, `print_expr_as_cond`, `print_expr_cond_paren`, `print_let`,
    `print_expr_vec`, `print_generic_arg`.

  Lane a's real definitions replace all of these. Keep my second `export interface State { .. }` block, which declares
  this region's methods.
- **The two import blocks overlap.** Both import `hir`, `pp`, `pprust`, `ast`, and so on. Root must deduplicate them
  at merge. My block also defines local `Breaks` / `BoxMarker` aliases; I use `Breaks.Consistent` /
  `Breaks.Inconsistent` instead of upstream's `use ..::Breaks::{Consistent, Inconsistent}` consts.

## Tests / evidence
- `src/rustc_hir_pretty/lib_b.test.ts` has 7 tests and 43 expects, all passing. The HIR is built by hand. The expected
  strings come from the pinned rustc's `-Zunpretty=hir` output for the same source (run on the oracle `rustc
  +nightly`; the source is quoted in each test). Covered:
  - tuples, arrays, struct literals with a shorthand field and `..base`;
  - binary and unary precedence parens, including `(x as i32) < y` and `a = b = c`;
  - method call with turbofish, field, index, `<u8 as Tr>::C`, call, `return`;
  - `match` with arms printed as `match x { 1 => 2, _ => 3, }`;
  - `move |a| a` through `PpAnn::nested` Body/BodyParamPat;
  - patterns: `T(a, ..,c)`, `(p, ..)`, `S {  a: ref mut q, .. }`, `&mut z`, `1...5`;
  - fn header `const unsafe extern "C" fn` and `#[target_feature] fn`;
  - generic params with an elided lifetime skipped;
  - where clause printed as ` where T: 'a, 'a:'b`;
  - the three free fns.
- The tests call a few lane-a methods. For those they install **test doubles copied from upstream, only when
  `State.prototype` lacks the method**. After the merge the real methods are used and the doubles become dead code.
  They can be deleted then, but they are harmless. The doubles cover `attrs`, `precedence`, `print_attrs` (empty case),
  `bclose*`, `commasep_cmnt`, `commasep_exprs`, `print_type` (Path/Infer), `print_generic_arg`,
  `print_formal_generic_params`, `print_call_post`, `print_expr_as_cond`, `print_expr_cond_paren`, `print_expr_vec`.
  The State constructor is called through a cast, because lane a owns the real one.
- `bunx tsc --noEmit -p .`: clean. `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=300000 src tools`: see the final line
  below.
- **No difftest sample.** No suite reaches this code yet: `rustc_driver_impl/pretty.ts` still calls `unported` for
  `-Zunpretty=hir`. End-to-end needs both halves plus the driver wiring.

## `unported(...)` left
- None in lib.ts.

## `// PORT:` decisions (please record)
1. **Inherent methods whose names clash with a `PrintState` method get a `_` suffix.** PrintState's own provided
   methods call `this.print_path` / `print_path_segment` / `print_generic_args`, and those must reach the trait
   versions, as in Rust. The hir signatures are also incompatible with them. The precedent is hir-types decision 2
   (`args_()`). This gives:
   - in this region: `print_path_` (lib.rs:1825), `print_path_segment_` (:1839), `print_generic_args_` (:1890);
   - **for lane a**, which this region calls by these names: `bclose_maybe_open_` (:339), `bclose_` (:348);
   - also lane a's: `print_attr_item_` (:132), the third clash. Upstream's explicit `PrintState::print_path(self, ..)`
     becomes the inherited `this.print_path(..)`.

   The trait impl `print_generic_args(_: &ast::GenericArgs, _)` (:266) keeps its name and panics.
2. Stand-in field names: `comments_` (the AST `State` precedent) and `attrs_`. The field `attrs` clashes with the
   method `attrs(id)`.
3. `ExprPrecedence` `<` / `<=` use the local `lt` / `le` helpers, which compare by `ExprPrecedence_discriminant` (the
   same helper as in ast_pretty `state/expr.ts`).
4. `print_generic_args_`: the `Iterator::all` closure has a side effect on `nonelided_generic_args`. It is a loop that
   stops at the first `false`, like `all`. The `Cell<bool>` `empty` is a captured `let`.
5. `print_fn`: `arg_idents.get(i)` (`Option<&Option<Ident>>`) is a bounds check first, then the inner `Option`.
   `arg_idents` is `readonly (Ident | undefined)[]`.
6. `print_bounds` takes `Iterable<GenericBound>` (`impl IntoIterator`). `print_restriction`'s `S: Into<Cow<str>>`
   prefix is a `string`.
7. `format!("{reg}")` is `hir.display_InlineAsmRegOrRegClass(reg)`. `lit.node.to_string()` is `display_LitKind`.
   `header.abi != ExternAbi::Rust` is `!ExternAbi.eq(..)`.

## For root
- At merge: delete the stand-in block, deduplicate the two import blocks, and check that lane a defines
  `bclose_maybe_open_` / `bclose_` with these names (decision 1). Then lane a's calls to this region's
  `print_path_` / `print_path_segment_` / `print_generic_args_` must use the suffixed names. That covers
  `print_use_tree`, `print_trait_ref`, and `print_node`'s `Node::PathSegment`.
