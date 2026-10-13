// Port of compiler/rustc_resolve/src/check_unused.rs
//
// Unused import checking
//
// Although this is mostly a lint pass, it lives in here because it depends on
// resolve data structures and because it finalises the privacy information for
// `use` items.
//
// Unused trait imports can't be checked until the method resolution. We save
// candidates here, and do the actual check in rustc_hir_analysis/check_unused.rs.
//
// Checking for unused imports is split into three steps:
//
//  - `UnusedImportCheckVisitor` visits the `use` items collected during late
//    resolution to find all the unused imports inside of `UseTree`s, recording
//    their `NodeId`s and grouping them by the parent `use` item
//
//  - `calc_unused_spans` then walks over all the `use` items marked in the
//    previous step to collect the spans associated with the `NodeId`s and to
//    calculate the spans that can be removed by rustfix; This is done in a
//    separate step to be able to collapse the adjacent spans that rustfix
//    will remove
//
//  - `check_unused` finally emits the diagnostics based on the data generated
//    in the last step
//
// Types of this file are generated into check_unused.gen.ts; the methods are declared in ./decls.ts
// (the contract, docs/handoff/res-lib.md) and assigned below.
// Init order: top-level code here touches only `./decls.ts`, this file's `.gen.ts` and other crates;
// every other rustc_resolve module's exports are read inside function bodies only.
//
// PORT (iteration order): `unused_imports` (`FxIndexMap`), `check_redundant_imports` (`FxIndexSet`),
// `potentially_unused_imports` / `extern_crate_items` / `use_items` (`Vec`) are insertion-ordered, as
// JS `Map`/`Set`/arrays. `maybe_unused_extern_crates` (`FxHashMap`) and the `UnordSet`s are only queried;
// `externally_implementable_items(..).values().all(..)` does not depend on the order.
import { type Attribute, clone_UseTree, type Item, type NodeId, type UseTree, type UseTreeAndId, visit } from "../rustc_ast/lib.ts";
import { MultiSpan } from "../rustc_error_messages/lib.ts";
import { MACRO_USE_EXTERN_CRATE, UNUSED_EXTERN_CRATES, UNUSED_IMPORTS, UNUSED_QUALIFICATIONS } from "../rustc_lint_defs/builtin.ts";
import { Visibility } from "../rustc_middle/ty/mod.ts";
import { Session } from "../rustc_session/session.ts";
import { LocalDefId } from "../rustc_span/def_id.ts";
import { DUMMY_SP, Span } from "../rustc_span/lib.ts";
import { kw, Symbol } from "../rustc_span/symbol.ts";
import { panic, unwrap } from "../std/panic.ts";
import { Resolver } from "./decls.ts";
import * as diagnostics from "./diagnostics/mod.ts";
import { type ExternCrateToLint, UnusedImport, type UnusedSpanResult } from "./check_unused.gen.ts";
import type { Import } from "./imports.ts";
// PORT (init order): the bindings below are read inside function bodies only (ESM live bindings).
import { IdentKey, module_to_string, with_owner } from "./lib.ts";
import { index_set_swap_remove } from "./imports.ts";

export * from "./check_unused.gen.ts";

// impl UnusedImport

// rustc: compiler/rustc_resolve/src/check_unused.rs:52 add
UnusedImport.prototype.add = function (this: UnusedImport, id: NodeId): void {
  this.unused.add(id);
};

// rustc-type: compiler/rustc_resolve/src/check_unused.rs:57 UnusedImportCheckVisitor
// PORT: `impl Visitor` -> extends the rustc_ast `Visitor` base class (hand type, types.sets.json).
export class UnusedImportCheckVisitor extends visit.Visitor {
  constructor(
    public r: Resolver,
    /// All the (so far) unused imports, grouped path list
    public unused_imports: Map<NodeId, UnusedImport>,
    public extern_crate_items: ExternCrateToLint[],
    public base_use_tree: UseTree | undefined,
    public item_span: Span,
  ) {
    super();
  }
}

// impl<'a, 'ra, 'tcx> UnusedImportCheckVisitor<'a, 'ra, 'tcx>

// We have information about whether `use` (import) items are actually
// used now. If an import is not used at all, we signal a lint error.
// rustc: compiler/rustc_resolve/src/check_unused.rs:85 check_import
UnusedImportCheckVisitor.prototype.check_import = function (this: UnusedImportCheckVisitor, id: NodeId, def_id: LocalDefId): void {
  const used = this.r.used_imports.has(id);
  if (!used) {
    if (this.r.maybe_unused_trait_imports.has(def_id)) {
      // Check later.
      return;
    }
    this.unused_import().add(id);
  } else {
    // This trait import is definitely used, in a way other than
    // method resolution.
    // FIXME(#120456) - is `swap_remove` correct?
    index_set_swap_remove(this.r.maybe_unused_trait_imports, def_id);
    const i = this.unused_imports.get(this.r.current_owner.id);
    if (i !== undefined) {
      i.unused.delete(id);
    }
  }
};

// rustc: compiler/rustc_resolve/src/check_unused.rs:104 check_use_tree
UnusedImportCheckVisitor.prototype.check_use_tree = function (
  this: UnusedImportCheckVisitor,
  use_tree: UseTree,
  id: NodeId,
  def_id: LocalDefId,
): void {
  if (this.r.effective_visibilities.is_exported(def_id)) {
    this.check_import_as_underscore(use_tree, id);
    index_set_swap_remove(this.r.maybe_unused_trait_imports, def_id);
    return;
  }

  if (use_tree.kind.$ === "Nested") {
    const items = use_tree.kind.items;
    if (items.length === 0) {
      this.unused_import().add(id);
    }
  } else {
    this.check_import(id, def_id);
  }
};

// rustc: compiler/rustc_resolve/src/check_unused.rs:120 unused_import
UnusedImportCheckVisitor.prototype.unused_import = function (this: UnusedImportCheckVisitor): UnusedImport {
  const use_tree_id = this.r.current_owner.id;
  const use_tree = clone_UseTree(unwrap(this.base_use_tree));
  const item_span = this.item_span;

  // `self.unused_imports.entry(use_tree_id).or_insert_with(|| ..)`
  let entry = this.unused_imports.get(use_tree_id);
  if (entry === undefined) {
    entry = new UnusedImport(use_tree, use_tree_id, item_span, new Set(), this.r.current_owner.def_id);
    this.unused_imports.set(use_tree_id, entry);
  }
  return entry;
};

// rustc: compiler/rustc_resolve/src/check_unused.rs:134 check_import_as_underscore
UnusedImportCheckVisitor.prototype.check_import_as_underscore = function (this: UnusedImportCheckVisitor, item: UseTree, id: NodeId): void {
  switch (item.kind.$) {
    case "Simple": {
      const ident = item.kind._0;
      if (ident !== undefined) {
        const res = this.r.current_owner.import_res.get(id)?.type_ns;
        if (
          ident.name === kw.Underscore &&
          !(res !== undefined && res.$ === "Def" && (res._0.$ === "Trait" || res._0.$ === "TraitAlias"))
        ) {
          this.unused_import().add(id);
        }
      }
      break;
    }
    case "Nested":
      this.check_imports_as_underscore(item.kind.items);
      break;
    default:
      break;
  }
};

// rustc: compiler/rustc_resolve/src/check_unused.rs:151 check_imports_as_underscore
UnusedImportCheckVisitor.prototype.check_imports_as_underscore = function (this: UnusedImportCheckVisitor, items: readonly UseTreeAndId[]): void {
  for (const use_tree of items) {
    this.check_import_as_underscore(use_tree.inner, use_tree.id);
  }
};

// rustc: compiler/rustc_resolve/src/check_unused.rs:157 report_unused_extern_crate_items
UnusedImportCheckVisitor.prototype.report_unused_extern_crate_items = function (
  this: UnusedImportCheckVisitor,
  maybe_unused_extern_crates: Map<NodeId, Span>,
): void {
  const tcx = this.r.tcx();
  for (const extern_crate of this.extern_crate_items) {
    const warn_if_unused = !Symbol.as_str(extern_crate.ident.name).startsWith("_");

    // If the crate is fully unused, we suggest removing it altogether.
    // We do this in any edition.
    if (warn_if_unused) {
      const span = maybe_unused_extern_crates.get(extern_crate.id);
      if (span !== undefined) {
        this.r.lint_buffer_.buffer_lint(
          UNUSED_EXTERN_CRATES,
          extern_crate.id,
          span,
          diagnostics.UnusedExternCrate_diagnostic({
            span: extern_crate.span,
            removal_span: extern_crate.span_with_attributes,
          }),
        );
        continue;
      }
    }

    // If we are not in Rust 2018 edition, then we don't make any further
    // suggestions.
    if (!tcx.sess.at_least_rust_2018()) {
      continue;
    }

    // If the extern crate has any attributes, they may have funky
    // semantics we can't faithfully represent using `use` (most
    // notably `#[macro_use]`). Ignore it.
    if (extern_crate.has_attrs) {
      continue;
    }

    // If the extern crate is renamed, then we cannot suggest replacing it with a use as this
    // would not insert the new name into the prelude, where other imports in the crate may be
    // expecting it.
    if (extern_crate.renames) {
      continue;
    }

    // If the extern crate isn't in the extern prelude,
    // there is no way it can be written as a `use`.
    const entry = this.r.extern_prelude.get(IdentKey.new(extern_crate.ident));
    if (entry === undefined || entry.introduced_by_item()) {
      continue;
    }

    const module = this.r.get_nearest_non_block_module(LocalDefId.to_def_id(this.r.owner_def_id(extern_crate.id)));
    if (module.no_implicit_prelude) {
      // If the module has `no_implicit_prelude`, then we don't suggest
      // replacing the extern crate with a use, as it would not be
      // inserted into the prelude. User writes `extern` style deliberately.
      continue;
    }

    const vis_span = Span.find_ancestor_inside(extern_crate.vis_span, extern_crate.span) ?? extern_crate.vis_span;
    const ident_span = Span.find_ancestor_inside(extern_crate.ident.span, extern_crate.span) ?? extern_crate.ident.span;

    this.r.lint_buffer_.buffer_lint(
      UNUSED_EXTERN_CRATES,
      extern_crate.id,
      extern_crate.span,
      diagnostics.ExternCrateNotIdiomatic_diagnostic({
        span: Span.between(vis_span, ident_span),
        code: Span.is_empty(vis_span) ? "use " : " use ",
      }),
    );
  }
};

// impl<'a, 'ra, 'tcx> AsMut<Resolver<'ra, 'tcx>> for UnusedImportCheckVisitor<'a, 'ra, 'tcx>
// rustc: compiler/rustc_resolve/src/check_unused.rs:247 as_mut
UnusedImportCheckVisitor.prototype.as_mut = function (this: UnusedImportCheckVisitor): Resolver {
  return this.r;
};

// impl<'a, 'ra, 'tcx> Visitor<'a> for UnusedImportCheckVisitor<'a, 'ra, 'tcx>

// Don't walk into attributes because imports can appear
// inside (e.g #[doc = {use std::{io,fmt};}]). They have
// a different owner, so they will cause an ICE if we visit
// them. Note that this doc attribute is not valid and will
// be rejected during AST lowering.
// rustc: compiler/rustc_resolve/src/check_unused.rs:258 visit_attribute
UnusedImportCheckVisitor.prototype.visit_attribute = function (this: UnusedImportCheckVisitor, _: Attribute): undefined {
  return undefined;
};

// rustc: compiler/rustc_resolve/src/check_unused.rs:260 visit_item
UnusedImportCheckVisitor.prototype.visit_item = function (this: UnusedImportCheckVisitor, item: Item): undefined {
  this.item_span = item.span_with_attributes();
  const kind = item.kind;
  switch (kind.$) {
    // Ignore imports with a dummy span because this means that they
    // were generated in some fashion by the compiler and we don't need
    // to consider them.
    case "Use": {
      if (Span.is_dummy(item.span)) return undefined;
      // Use the base UseTree's NodeId as the item id
      // This allows the grouping of all the lints in the same item
      const use_tree = kind._0;
      this.base_use_tree = use_tree;
      this.check_use_tree(use_tree, item.id, this.r.current_owner.def_id);
      break;
    }
    case "ExternCrate": {
      const orig_name = kind._0;
      const ident = kind._1;
      this.extern_crate_items.push({
        id: item.id,
        span: item.span,
        vis_span: item.vis.span,
        span_with_attributes: item.span_with_attributes(),
        has_attrs: item.attrs.length !== 0,
        ident,
        renames: orig_name !== undefined,
      });
      break;
    }
    default:
      break;
  }

  visit.walk_item(this, item, visit.WalkItemKind.ItemKind);
  return undefined;
};

// rustc: compiler/rustc_resolve/src/check_unused.rs:290 visit_use_tree_and_id
UnusedImportCheckVisitor.prototype.visit_use_tree_and_id = function (this: UnusedImportCheckVisitor, tree: UseTreeAndId): undefined {
  this.check_use_tree(tree.inner, tree.id, this.r.local_def_id(tree.id));
  visit.walk_use_tree_and_id(this, tree);
  return undefined;
};

// rustc: compiler/rustc_resolve/src/check_unused.rs:302 calc_unused_spans
export function calc_unused_spans(unused_import: UnusedImport, use_tree: UseTree, use_tree_id: NodeId): UnusedSpanResult {
  // The full span is the whole item's span if this current tree is not nested inside another
  // This tells rustfix to remove the whole item if all the imports are unused
  const full_span = unused_import.use_tree.span() === use_tree.span() ? unused_import.item_span : use_tree.span();
  switch (use_tree.kind.$) {
    case "Simple":
    case "Glob": {
      if (unused_import.unused.has(use_tree_id)) {
        return { $: "Unused", spans: [use_tree.span()], remove: full_span };
      } else {
        return { $: "Used" };
      }
    }
    case "Nested": {
      const { items: nested, span: tree_span } = use_tree.kind;
      if (nested.length === 0) {
        return { $: "Unused", spans: [use_tree.span()], remove: full_span };
      }

      const unused_spans: Span[] = [];
      const to_remove: Span[] = [];
      let used_children = 0;
      let contains_self = false;
      let previous_unused = false;
      for (let pos = 0; pos < nested.length; pos++) {
        const use_tree = nested[pos]!;
        let remove: Span | undefined;
        const r = calc_unused_spans(unused_import, use_tree.inner, use_tree.id);
        switch (r.$) {
          case "Used":
            used_children += 1;
            remove = undefined;
            break;
          case "Unused":
            unused_spans.push(...r.spans);
            remove = r.remove;
            break;
          case "PartialUnused":
            used_children += 1;
            unused_spans.push(...r.spans);
            to_remove.push(...r.remove);
            remove = undefined;
            break;
        }
        if (remove !== undefined) {
          let remove_span: Span;
          if (nested.length === 1) {
            remove_span = remove;
          } else if (pos === nested.length - 1 || used_children > 0) {
            // Delete everything from the end of the last import, to delete the
            // previous comma
            remove_span = Span.to(Span.shrink_to_hi(nested[pos - 1]!.inner.hi_span()), use_tree.inner.hi_span());
          } else {
            // Delete everything until the next import, to delete the trailing commas
            const inner = nested[pos + 1]!.inner;
            remove_span = Span.to(use_tree.inner.prefix.span, Span.shrink_to_lo(inner.prefix.span));
          }

          // Try to collapse adjacent spans into a single one. This prevents all cases of
          // overlapping removals, which are not supported by rustfix
          if (previous_unused && to_remove.length !== 0) {
            const previous = to_remove.pop()!;
            to_remove.push(Span.to(previous, remove_span));
          } else {
            to_remove.push(remove_span);
          }
        }
        contains_self ||=
          use_tree.inner.prefix.eq_Symbol(kw.SelfLower) && use_tree.inner.kind.$ === "Simple" && !unused_import.unused.has(use_tree.id);
        previous_unused = remove !== undefined;
      }
      if (unused_spans.length === 0) {
        return { $: "Used" };
      } else if (used_children === 0) {
        return { $: "Unused", spans: unused_spans, remove: full_span };
      } else {
        // If there is only one remaining child that is used, the braces around the use
        // tree are not needed anymore. In that case, we determine the span of the left
        // brace and the right brace, and tell rustfix to remove them as well.
        //
        // This means that `use a::{B, C};` will be turned into `use a::B;` rather than
        // `use a::{B};`, removing a rustfmt roundtrip.
        //
        // Note that we cannot remove the braces if the only item inside the use tree is
        // `self`: `use foo::{self};` is valid Rust syntax, while `use foo::self;` errors
        // out. We also cannot turn `use foo::{self}` into `use foo`, as the former doesn't
        // import types with the same name as the module.
        if (used_children === 1 && !contains_self) {
          // Left brace, from the start of the nested group to the first item.
          to_remove.push(Span.to(Span.shrink_to_lo(tree_span), Span.shrink_to_lo(unwrap(nested[0]).inner.prefix.span)));
          // Right brace, from the end of the last item to the end of the nested group.
          to_remove.push(Span.to(Span.shrink_to_hi(unwrap(nested[nested.length - 1]).inner.hi_span()), Span.shrink_to_hi(tree_span)));
        }

        return { $: "PartialUnused", spans: unused_spans, remove: to_remove };
      }
    }
  }
}

/** PORT: `String`'s `Ord` (byte-wise; code-point order equals UTF-8 byte order). */
function str_cmp(a: string, b: string): number {
  const ai = a[globalThis.Symbol.iterator]();
  const bi = b[globalThis.Symbol.iterator]();
  for (;;) {
    const x = ai.next();
    const y = bi.next();
    if (x.done) return y.done ? 0 : -1;
    if (y.done) return 1;
    const cx = x.value.codePointAt(0)!;
    const cy = y.value.codePointAt(0)!;
    if (cx !== cy) return cx < cy ? -1 : 1;
  }
}

// impl Resolver<'_, '_>

// rustc: compiler/rustc_resolve/src/check_unused.rs:425 check_unused
Resolver.prototype.check_unused = function (this: Resolver, use_items: Item[]): void {
  const tcx = this.tcx_;
  const maybe_unused_extern_crates = new Map<NodeId, Span>();

  for (const import_ of this.potentially_unused_imports) {
    if (Visibility.is_public(import_.vis) || Span.is_dummy(import_.span) || this.import_use_map.has(import_)) {
      if (import_.kind.$ === "MacroUse") {
        if (!Span.is_dummy(import_.span)) {
          this.lint_buffer_.buffer_lint(MACRO_USE_EXTERN_CRATE, import_.root_id, import_.span, diagnostics.MacroUseDeprecated_diagnostic({}));
        }
      }
    } else if (import_.kind.$ === "ExternCrate") {
      const { id, def_id } = import_.kind;
      const cnum = this.extern_crate_map.get(def_id);
      if (
        cnum === undefined ||
        (!tcx.is_compiler_builtins(cnum) &&
          !tcx.is_panic_runtime(cnum) &&
          !tcx.has_global_allocator(cnum) &&
          !tcx.has_panic_handler(cnum) &&
          [...tcx.externally_implementable_items(cnum).values()].every(([_, defs]) => defs.size === 0))
      ) {
        maybe_unused_extern_crates.set(id, import_.span);
      }
    } else if (import_.kind.$ === "MacroUse") {
      this.lint_buffer_.buffer_lint(UNUSED_IMPORTS, import_.root_id, import_.span, diagnostics.UnusedMacroUse_diagnostic({}));
    }
  }

  const visitor = new UnusedImportCheckVisitor(this, new Map(), [], undefined, DUMMY_SP);
  // `use_items` is in crate DFS order, so diagnostics and side effects are unchanged.
  for (const item of use_items) {
    with_owner(visitor, item.id, (visitor) => visitor.visit_item(item));
  }

  visitor.report_unused_extern_crate_items(maybe_unused_extern_crates);

  for (const unused of visitor.unused_imports.values()) {
    let spans: Span[];
    let remove_spans: Span[];
    const r = calc_unused_spans(unused, unused.use_tree, unused.use_tree_id);
    switch (r.$) {
      case "Used":
        continue;
      case "Unused":
        [spans, remove_spans] = [r.spans, [r.remove]];
        break;
      case "PartialUnused":
        [spans, remove_spans] = [r.spans, r.remove];
        break;
    }

    const ms = MultiSpan.from_spans(spans);

    const span_snippets: string[] = [];
    for (const span of ms.primary_spans_()) {
      const s = tcx.sess.source_map().span_to_snippet(span);
      if (s.$ === "Ok") span_snippets.push(`\`${s._0.toString()}\``);
    }
    span_snippets.sort(str_cmp);

    const remove_whole_use = remove_spans.length === 1 && remove_spans[0] === unused.item_span;
    const num_to_remove = ms.primary_spans_().length;
    // Only offer rustfix suggestions for spans that point at directly editable code.
    const can_suggest_removal = remove_spans.every((span) => Span.can_be_used_for_suggestions(span));

    // If we are in the `--test` mode, suppress a help that adds the `#[cfg(test)]`
    // attribute; however, if not, suggest adding the attribute. There is no way to
    // retrieve attributes here because we do not have a `TyCtxt` yet.
    let test_module_span: Span | undefined;
    if (tcx.sess.is_test_crate()) {
      test_module_span = undefined;
    } else {
      const parent_module = visitor.r.get_nearest_non_block_module(LocalDefId.to_def_id(unused.use_tree_def_id));
      const module = module_to_string(parent_module);
      if (
        module !== undefined &&
        (module === "test" ||
          module === "tests" ||
          module.startsWith("test_") ||
          module.startsWith("tests_") ||
          module.endsWith("_test") ||
          module.endsWith("_tests"))
      ) {
        test_module_span = parent_module.span;
      } else {
        test_module_span = undefined;
      }
    }

    visitor.r.lint_buffer_.dyn_buffer_lint_any(UNUSED_IMPORTS, unused.use_tree_id, ms, (dcx, level, sess) => {
      const sugg: diagnostics.UnusedImportsSugg | undefined = can_suggest_removal
        ? remove_whole_use
          ? { $: "RemoveWholeUse", span: remove_spans[0]! }
          : { $: "RemoveImports", remove_spans, num_to_remove }
        : undefined;
      const test_module_span_ =
        test_module_span === undefined
          ? undefined
          : (() => {
              if (!(sess instanceof Session)) return panic("expected a `Session`");
              return sess.source_map().guess_head_span(test_module_span);
            })();

      return diagnostics.UnusedImports_into_diag(
        {
          sugg,
          test_module_span: test_module_span_,
          num_snippets: span_snippets.length,
          span_snippets: { $: "StrListSepByAnd", _0: span_snippets },
        },
        dcx,
        level,
      );
    });
  }

  const unused_imports = visitor.unused_imports;
  const check_redundant_imports = new Set<Import>();
  for (const module of this.local_modules) {
    for (const [_key, resolution] of this.resolutions(module.to_module())) {
      const decl = resolution.borrow_checked(this).best_decl();
      if (decl !== undefined && decl.kind.$ === "Import" && decl.kind.import.kind.$ === "Single") {
        const import_ = decl.kind.import;
        const id = decl.kind.import.kind.id;
        const unused_import = unused_imports.get(import_.root_id);
        if (unused_import !== undefined && unused_import.unused.has(id)) {
          continue;
        }

        check_redundant_imports.add(import_);
      }
    }
  }

  const redundant_imports = new Set<NodeId>();
  for (const import_ of check_redundant_imports) {
    if (this.check_for_redundant_imports(import_)) {
      const id = import_.id();
      if (id !== undefined) {
        redundant_imports.add(id);
      }
    }
  }

  // The lint fixes for unused_import and unnecessary_qualification may conflict.
  // Deleting both unused imports and unnecessary segments of an item may result
  // in the item not being found.
  for (const unn_qua of this.potentially_unnecessary_qualifications) {
    if (
      unn_qua.decl.$ === "Decl" &&
      unn_qua.decl._0.kind.$ === "Import" &&
      (is_unused_import(unn_qua.decl._0.kind.import, unused_imports) || is_redundant_import(unn_qua.decl._0.kind.import, redundant_imports))
    ) {
      continue;
    }

    this.lint_buffer_.buffer_lint(
      UNUSED_QUALIFICATIONS,
      unn_qua.node_id,
      unn_qua.path_span,
      diagnostics.UnusedQualifications_diagnostic({ removal_span: unn_qua.removal_span }),
    );
  }

  // rustc: compiler/rustc_resolve/src/check_unused.rs:616 is_redundant_import
  function is_redundant_import(import_: Import, redundant_imports: Set<NodeId>): boolean {
    const id = import_.id();
    if (id !== undefined && redundant_imports.has(id)) {
      return true;
    }
    return false;
  }

  // rustc: compiler/rustc_resolve/src/check_unused.rs:628 is_unused_import
  function is_unused_import(import_: Import, unused_imports: Map<NodeId, UnusedImport>): boolean {
    const unused_import = unused_imports.get(import_.root_id);
    const id = import_.id();
    if (unused_import !== undefined && id !== undefined && unused_import.unused.has(id)) {
      return true;
    }
    return false;
  }
};
