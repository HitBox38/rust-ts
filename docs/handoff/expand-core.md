# Handoff: expand-core (wave 9, M2 expansion)

Branch `lane/expand-core`. `lane/expand-base` is merged in once (6e689eb + 947a891); its expand.ts stub was
replaced by this port (add/add conflict resolved with ours). No other merges.

## Files
- `src/rustc_expand/expand.ts`: the port of `compiler/rustc_expand/src/expand.rs`, every fn in upstream order.
- `src/rustc_expand/expand_oracle.test.ts`: oracle scenarios (below).
- `src/rustc_expand/expand_oracle/{probe.rs,cases.txt,out.json}`: the rustc-dev probe, its 45 cases and its
  output. The build and run commands are in probe.rs's header (scratch build in `$RUST_TS_DATA/tmp/expand-core/`).

## Checks
- `bunx tsc --noEmit -p .`: clean.
- `RUST_TS_REQUIRE_PROBES=1 bun test --timeout=120000 src tools`: 2321 pass, 1 skip (the pre-existing linux-only one), 0 fail.
- `bun scripts/coverage.ts --check`: markers ok (5424; vendor 2403).
- `bun scripts/coverage.ts --missing compiler/rustc_expand/src/expand.rs`: 262/262.
- `RUST_TS_AGENT=expand-core bun scripts/difftest.ts --suite parse --sample 200`: 200/200 MATCH
  (run `20261013-091311-expand-core-ciux`).
- Every rustc_expand module loads as a fresh-process entry point (lib, expand, base, placeholders, config).

## Tests: `expand_oracle.test.ts`
- **Probe.** `probe.rs` runs `rustc_interface::run_compiler` (default options, edition 2024, target
  x86_64-unknown-linux-gnu, -Zui-testing emitter into a buffer), parses the case as `t.rs`, and runs the real
  `ExtCtxt::new(.., &mut MockResolver, None).monotonic_expander().expand_crate(krate)`.
- **Mock resolver** (same on both sides). `next_node_id` counts from `CRATE_NODE_ID` like rustc_resolve. Macros
  resolve by name: `echo` (Bang, returns its input), `bad` (Bang, errors), `echo_attr` (Attr, returns the item),
  `keep` / `drop_it` (LegacyAttr), `inert` (NonMacroAttr), `later` (Indeterminate on the first attempt), anything
  else Indeterminate until `force`, then an error plus a failing Bang. Every call is logged.
- **What must match, byte for byte:** the resolver events, which include `{:?}` of every fragment passed to
  `visit_ast_fragment_with_placeholders` (so the placeholder `NodeId`s, i.e. the `LocalExpnId` allocation order),
  the `depth` / `lint_node_id` / `is_trailing_mac` / `force` of every resolution, `append_stripped_cfg_item` and
  `insert_impl_trait_name` calls, the buffered early lints, `{:#?}` of the expanded crate (all `NodeId`s), the
  stderr and any panic text.
- **Coverage of the cases:** bang macros in item / stmt / expr / trailing-expr / ty / pat / method-receiver /
  assoc-item / foreign-item / opt-expr positions, nesting and deep nesting, `cfg` / `cfg_attr` stripping on every
  node kind (incl. the crate, expressions and fields), attribute macros of all three kinds on items, statements and
  expressions (feature-gate errors, `RemoveExprNotSupported`), inert attributes on every flat-map node kind, the
  undetermined/retry/force loop, unresolved and failing macros (dummy fragments), `IncompleteParse` with its
  semicolon suggestion, `unsafe(..)` and `= ".."` on attribute macros, crate- and module-level inner attribute
  macros (fake token streams), list/glob delegation and its errors, inline modules, doc comments on macro calls
  (`UNUSED_DOC_COMMENTS`), `impl Trait` names, an `unreachable!()` reached through a mis-kinded mock extension.
- **Result: 43 MATCH, 2 PENDING** (each must throw exactly the listed `Unported`; root removes the entry when the
  owning lane lands, and the test fails until then):
  - `unused_attrs_on_mac`: `check_attributes` → `AttributeParser::is_parsed_attribute` → the attribute parser
    stubs (attr-parse-c).
  - `parse_error_in_expansion`: `annotate_err_with_kind` (mbe-b), see the shim below.
- **Negative control:** perturbing 4 expectations (an AST `NodeId`, an event's `LocalExpnId`, a stderr word, a
  stripped ident) fails exactly those 4 cases.
- **Not driven yet (PENDING list for later lanes):** derive invocations (`take_derive_resolutions` returning
  `Some`, needs the `derive` builtin and resolver), glob delegation expansion (`glob_delegation_suffixes`, resolver),
  `MacroRules` derive/attr/bang (mbe-b), out-of-line `mod foo;` (`parse_external_mod` + `pre_expansion_lint`),
  `-Zmacro-stats`, `-C incremental` (`invocation_parent`), the recursion limit (needs the resolver's
  `set_expn_data`).

## `unported(...)` left
- `rustc_expand::stats::update_{bang,attr,derive}_macro_stats` and the `Annotatable` clone for `-Zmacro-stats`:
  stats.rs is not assigned in wave 9 (expand-base published only `MacroStat`). Reached only with `-Zmacro-stats`.
- `rustc_expand::mbe::diagnostics::annotate_err_with_kind (lane mbe-b)`: a local shim, see "For root" 1.

## PORT decisions (please record)
1. **`ast_fragments!`** is written out as its expansion. Metavariable-named fns carry the marker of the invocation
   line that names them (`fn make_expr;` → `expand.rs:179 make_expr`); the `one fn visit_*;` and
   `many fn flat_map_*; fn visit_*();` invocation lines carry their markers on the `mut_visit_with` /
   `visit_with` arm they drive. coverage.ts keys fns by line, so a line with two fns (`flat_map_stmt` +
   `visit_stmt` on :193) takes only its last fn's marker; the `flat_map_*` arms carry a plain comment instead.
2. **`impl MacResult for ParserAnyMacro`** (inside the macro) is the exported table `ParserAnyMacro_MacResult`
   (`this: { make(kind) }`), which mbe-b's `ParserAnyMacro` already calls (`.make_expr.call(this)`).
3. **`trait InvocationCollectorNode`** is a table type per node (`IC_Item`, `IC_TraitItem`, ..., `IC_MethodReceiver`):
   supertraits `HasAttrs + HasNodeId + DeclaredIdents` are spread in from the ast_traits impls; the
   `flat_map_node` bound `OutputTy: Default` is the member `OutputTy_default()` and the `visit_node` bounds
   `OutputTy: Into<Node>` + `DummyAstNode` are `OutputTy_into()` + `dummy()`. Provided fns live in
   `InvocationCollectorNode_provided` / `DeclaredIdents_provided`; the tag structs are frozen singletons.
4. **`&mut Node`:** `*node = x` is `replace_in_place(node, x)`; `mem::replace(node, dummy)` is `mem_replace`, which
   moves the contents into a fresh object of the same class (for an `AstNodeWrapper` from `from_mut`, into a new
   wrapper around a moved copy of the wrapped node) and replaces the node in place. The `from_mut` wrapper of
   `visit_method_receiver_expr` is never rebound (fix-w456 rule); the method-receiver oracle case covers it.
5. **`assign_id!`** is a function taking a `MutRef<NodeId>` built by the caller (`node_id_mut()` has no side
   effects, so building it before `next_node_id()` is unobservable).
6. **Laziness kept where it is observable:** `build_single_delegations` emits `EmptyDelegationMac` at call time and
   returns a generator; `flatten_outputs` walks each delegation item while flattening.
7. **`post_flat_map_node_collect_bang(&mut OutputTy)`** takes the output value: every impl edits a `SmallVec` in place.
8. **`Invocation`** is a class (it has `span()` / `span_mut()`; `span_mut` returns a `MutRef<Span>` onto the field).
   `(Invocation, Option<Arc<SyntaxExtension>>)` is the tuple type `InvocationEntry`.
9. **`ExpansionData { id, ..current.clone() }`** is `current.clone()` with the fields assigned afterwards.
10. **`AstFragmentKind`** is a string union; its companion is assembled from the macro's `impl` (name, make_from) and
    the later `impl` (dummy, supports_macro_expansion, expect_from_annotatables), keeping marker order.
11. A copy of mut_visit.ts's private `flat_map_in_place` is used by `AstFragment::mut_visit_with` (no marker; the
    marker is on the mut_visit.ts copy).

## For root
1. **On integrating mbe-b:** in expand.ts delete the `annotate_err_with_kind` shim and the
   `declare module "./mbe/macro_rules.ts"` augmentation (`expand_derive`, pending mbe-b's port), and add
   `import { annotate_err_with_kind } from "./mbe/diagnostics.ts";`. Then drop `parse_error_in_expansion` from
   PENDING in expand_oracle.test.ts (it must match).
2. **On integrating attr-parse-c:** drop `unused_attrs_on_mac` from PENDING.
3. **expand-base / module.ts:** `ParsedExternalMod.had_parse_error` is `Result<undefined, ..>`, but a stored `()` is
   `null` (ast.ts `Inline::No`, codegen convention). expand.ts converts it (`PORT` at the call site); module.ts
   should return `Ok(null)` and the conversion can then go.
4. **Shared helpers:** export `flat_map_in_place` once (rustc_data_structures/flat_map_in_place.ts) and use it from
   mut_visit.ts and expand.ts. `mem_replace` (expand.ts) and `vec_remove` / `truncate` could move to `src/std`.
5. **coverage.ts:** keys upstream fns by `(path, line)`, so a second fn on the same line (the `ast_fragments!`
   invocation's `many` lines) is invisible to `--check`. Harmless today; noted for the reviewer.
6. `docs/claims/wave9-expand-core.md` can be removed on integration.
