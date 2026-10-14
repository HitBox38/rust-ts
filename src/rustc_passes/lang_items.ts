// Port of compiler/rustc_passes/src/lang_items.rs
//! Detecting lang items.
//!
//! Language items are items that represent concepts intrinsic to the language
//! itself. Examples are:
//!
//! * Traits that specify "kinds"; e.g., `Sync`, `Send`.
//! * Traits that represent operators; e.g., `Add`, `Sub`, `Index`.
//! * Functions called by the compiler itself.
import type { Attribute, Crate, ForeignItem, Generics, Item, Variant } from "../rustc_ast/lib.ts";
import { AssocItem, visit } from "../rustc_ast/lib.ts";
import type { AssocCtxt } from "../rustc_ast/visit.ts";
import { type GenericRequirement, LangItem, LanguageItems } from "../rustc_attr_ir/lang_items.ts";
import { display_Target, Target } from "../rustc_attr_ir/target.ts";
import type { ExternCrate } from "../rustc_crate_store/cstore.ts";
import type { ResolverAstLowering } from "../rustc_middle/middle/resolve.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { type DefId, DefId_eq, LocalDefId } from "../rustc_span/def_id.ts";
import type { Span } from "../rustc_span/lib.ts";
import { Symbol, sym } from "../rustc_span/symbol.ts";
import { debug_LocalDefId } from "../rustc_span/def_id.ts";
import { PLAIN } from "../std/fmt.ts";
import { unwrap } from "../std/panic.ts";
import { DuplicateLangItem_diagnostic, IncorrectCrateType_diagnostic, IncorrectTarget_diagnostic } from "./diagnostics.ts";
import * as weak_lang_items from "./weak_lang_items.ts";

// rustc-type: compiler/rustc_passes/src/lang_items.rs:24 Duplicate
export type Duplicate = "Plain" | "Crate" | "CrateDepends";
export const Duplicate = { Plain: "Plain", Crate: "Crate", CrateDepends: "CrateDepends" } as const;

// PORT: `#[derive(PartialEq)]` of `rustc_attr_ir::target::Target` (with `MethodKind` / `AssocCtxt`), which
// rustc_attr_ir does not export (same as rustc_attr_parsing/target_checking.ts `Target_eq`).
function Target_eq(a: Target, b: Target): boolean {
  if (a.$ !== b.$) return false;
  switch (a.$) {
    case "Impl":
      return a.of_trait === (b as typeof a).of_trait;
    case "Method": {
      const x = a._0;
      const y = (b as typeof a)._0;
      return x.$ === y.$ && (x.$ !== "Trait" || x.body === (y as typeof x).body);
    }
    case "AssocConst":
    case "AssocTy": {
      const x = a._0;
      const y = (b as typeof a)._0;
      return x.$ === y.$ && (x.$ !== "Impl" || x.of_trait === (y as typeof x).of_trait);
    }
    case "Delegation":
      return a.mac === (b as typeof a).mac;
    default:
      return true;
  }
}

// rustc-type: compiler/rustc_passes/src/lang_items.rs:30 LanguageItemCollector
// PORT: `impl visit::Visitor` -> extends the rustc_ast `Visitor` base class.
class LanguageItemCollector extends visit.Visitor {
  constructor(
    public items: LanguageItems,
    public tcx: TyCtxt,
    public resolver: ResolverAstLowering,
    public parent_item: Item | undefined,
  ) {
    super();
  }

  // rustc: compiler/rustc_passes/src/lang_items.rs:38 new
  static new(tcx: TyCtxt, resolver: ResolverAstLowering): LanguageItemCollector {
    return new LanguageItemCollector(LanguageItems.new(), tcx, resolver, undefined);
  }

  // rustc: compiler/rustc_passes/src/lang_items.rs:45 check_for_lang
  check_for_lang(actual_target: Target, def_id: LocalDefId, attrs: readonly Attribute[], item_span: Span, generics: Generics | undefined): void {
    const found = extract_ast(attrs);
    if (found !== undefined) {
      const [name, attr_span] = found;
      const lang_item = LangItem.from_name(name);
      if (lang_item !== undefined) {
        // Known lang item
        if (!Target_eq(actual_target, LangItem.target(lang_item))) {
          // `#[panic_handler]` is turned into `#[lang = "panic_impl"]`, but in contrast
          // to the actual lang item attr, is applied to `Fn` instead of `ForeignFn`.
          if (
            !(
              LangItem.is_weak(lang_item) &&
              actual_target.$ === "Fn" &&
              LangItem.target(lang_item).$ === "ForeignFn" &&
              lang_item === "PanicImpl"
            )
          ) {
            this.tcx
              .dcx()
              .delayed_bug(
                `lang item target is checked in attribute parser: ${debug_LocalDefId(def_id, PLAIN)} has ${display_Target(actual_target)} but expected ${display_Target(LangItem.target(lang_item))}`,
              );
            return;
          }
        }
        // Weak lang items are handled separately
        if (LangItem.is_weak(lang_item) && actual_target.$ === "ForeignFn") {
          this.items.missing.push(lang_item);
        } else {
          // Weak only lang items are always handled here
          this.collect_item_extended(lang_item, def_id, item_span, attr_span, generics, actual_target);
        }
      } else {
        // Unknown lang item.
        this.tcx.dcx().delayed_bug("unknown lang item");
      }
    }
  }

  // rustc: compiler/rustc_passes/src/lang_items.rs:94 collect_item
  collect_item(lang_item: LangItem, item_def_id: DefId, item_span: Span | undefined): void {
    // Check for duplicates.
    const original_def_id = this.items.get(lang_item);
    if (original_def_id !== undefined && !DefId_eq(original_def_id, item_def_id)) {
      const lang_item_name = LangItem.name(lang_item);
      const crate_name = this.tcx.crate_name(item_def_id.krate);
      let dependency_of: Symbol | undefined = undefined;
      const is_local = item_def_id.is_local();
      // PORT: `p.display().to_string()` of the `&Path`s is the path string itself.
      const path = is_local ? "" : this.tcx.crate_extern_paths(item_def_id.krate).map((p) => p).join(", ");

      let orig_crate_name: Symbol | undefined = undefined;
      let orig_dependency_of: Symbol | undefined = undefined;
      const orig_is_local = original_def_id.is_local();
      const orig_path = orig_is_local ? "" : this.tcx.crate_extern_paths(original_def_id.krate).map((p) => p).join(", ");

      if (!original_def_id.is_local()) {
        orig_crate_name = this.tcx.crate_name(original_def_id.krate);
        const extern_crate = this.tcx.extern_crate(original_def_id.krate) as ExternCrate | undefined;
        if (extern_crate !== undefined) {
          const inner_dependency_of = extern_crate.dependency_of;
          orig_dependency_of = this.tcx.crate_name(inner_dependency_of);
        }
      }

      let duplicate: Duplicate;
      if (item_span !== undefined) {
        duplicate = "Plain";
      } else {
        const extern_crate = this.tcx.extern_crate(item_def_id.krate) as ExternCrate | undefined;
        if (extern_crate !== undefined) {
          const inner_dependency_of = extern_crate.dependency_of;
          dependency_of = this.tcx.crate_name(inner_dependency_of);
          duplicate = "CrateDepends";
        } else {
          duplicate = "Crate";
        }
      }

      // When there's a duplicate lang item, something went very wrong and there's no value
      // in recovering or doing anything. Give the user the one message to let them debug the
      // mess they created and then wish them farewell.
      const orig_local = original_def_id.as_local();
      this.tcx.dcx().emit_fatal(
        DuplicateLangItem_diagnostic({
          local_span: item_span,
          lang_item_name,
          crate_name,
          dependency_of,
          is_local,
          path,
          first_defined_span: orig_local === undefined ? undefined : this.tcx.source_span(orig_local),
          orig_crate_name,
          orig_dependency_of,
          orig_is_local,
          orig_path,
          duplicate,
        }),
      );
    } else {
      // Matched.
      this.items.set(lang_item, item_def_id);
    }
  }

  // Like collect_item() above, but also checks whether the lang item is declared
  // with the right number of generic arguments.
  // rustc: compiler/rustc_passes/src/lang_items.rs:174 collect_item_extended
  collect_item_extended(
    lang_item: LangItem,
    item_def_id: LocalDefId,
    item_span: Span,
    attr_span: Span,
    generics: Generics | undefined,
    target: Target,
  ): void {
    const name = LangItem.name(lang_item);

    if (generics !== undefined) {
      // Now check whether the lang_item has the expected number of generic
      // arguments. Generally speaking, binary and indexing operations have
      // one (for the RHS/index), unary operations have none, the closure
      // traits have one for the argument list, coroutines have one for the
      // resume argument, and ordering/equality relations have one for the RHS
      // Some other types like Box and various unsizing-related traits
      // have minimum requirements.

      // FIXME: This still doesn't count, e.g., elided lifetimes and APITs.
      let actual_num = generics.params.length;
      if (Target.is_associated_item(target)) {
        actual_num += unwrap(this.parent_item).opt_generics()?.params.length ?? 0;
      }

      let at_least = false;
      const req: GenericRequirement = LangItem.required_generics(lang_item);
      let required: number | undefined;
      if (req.$ === "Exact" && req._0 !== actual_num) {
        required = req._0;
      } else if (req.$ === "Minimum" && actual_num < req._0) {
        at_least = true;
        required = req._0;
      } else {
        // If the number matches, or there is no requirement, handle it normally
        required = undefined;
      }

      if (required !== undefined) {
        const num = required;
        // We are issuing E0718 "incorrect target" here, because while the
        // item kind of the target is correct, the target is still wrong
        // because of the wrong number of generic arguments.
        this.tcx.dcx().emit_err(
          IncorrectTarget_diagnostic({
            span: attr_span,
            generics_span: generics.span,
            name: Symbol.as_str(name),
            kind: Target.name(target),
            num,
            actual_num,
            at_least,
          }),
        );

        // return early to not collect the lang item
        return;
      }
    }

    if (this.tcx.crate_types().includes("Sdylib")) {
      this.tcx.dcx().emit_err(IncorrectCrateType_diagnostic({ span: attr_span }));
    }

    this.collect_item(lang_item, LocalDefId.to_def_id(item_def_id), item_span);
  }
}

/// Traverses and collects all the lang items in all crates.
// rustc: compiler/rustc_passes/src/lang_items.rs:243 get_lang_items
function get_lang_items(tcx: TyCtxt, _: null): LanguageItems {
  const [resolver_, krate_] = tcx.resolver_for_lowering();
  const resolver = resolver_.borrow();
  const krate: Crate = krate_.borrow();

  // Initialize the collector.
  const collector = LanguageItemCollector.new(tcx, resolver);

  // Collect lang items in other crates.
  for (const cnum of tcx.used_crates(null)) {
    for (const [def_id, lang_item] of tcx.defined_lang_items(cnum)) {
      collector.collect_item(lang_item, def_id, undefined);
    }
  }

  // Collect lang items local to this crate.
  collector.visit_crate(krate);

  // Find all required but not-yet-defined lang items.
  weak_lang_items.check_crate(tcx, collector.items);

  // Return all the lang items that were found.
  return collector.items;
}

// impl<'ast, 'tcx> visit::Visitor<'ast> for LanguageItemCollector<'ast, 'tcx>
// PORT: the trait methods are assigned to the prototype after `get_lang_items`, in upstream order.
const LIC = LanguageItemCollector.prototype;

// rustc: compiler/rustc_passes/src/lang_items.rs:269 visit_item
LIC.visit_item = function (this: LanguageItemCollector, i: Item): undefined {
  const target = Target.from_ast_item(i);

  this.check_for_lang(target, unwrap(this.resolver.owners.get(i.id)).def_id, i.attrs, i.span, i.opt_generics());

  const parent_item = this.parent_item;
  this.parent_item = i;
  visit.walk_item(this, i, visit.WalkItemKind.ItemKind);
  this.parent_item = parent_item;
};

// rustc: compiler/rustc_passes/src/lang_items.rs:285 visit_foreign_item
LIC.visit_foreign_item = function (this: LanguageItemCollector, i: ForeignItem): undefined {
  this.check_for_lang(Target.from_foreign_item_kind(i.kind), unwrap(this.resolver.owners.get(i.id)).def_id, i.attrs, i.span, undefined);
};

// rustc: compiler/rustc_passes/src/lang_items.rs:295 visit_variant
LIC.visit_variant = function (this: LanguageItemCollector, variant: Variant): undefined {
  this.check_for_lang(
    Target.Variant,
    unwrap(unwrap(this.resolver.owners.get(unwrap(this.parent_item).id)).node_id_to_def_id.get(variant.id)),
    variant.attrs,
    variant.span,
    undefined,
  );
};

// rustc: compiler/rustc_passes/src/lang_items.rs:305 visit_assoc_item
LIC.visit_assoc_item = function (this: LanguageItemCollector, i: AssocItem, ctxt: AssocCtxt): undefined {
  const target = Target.from_assoc_item_kind(i.kind, ctxt);
  const generics = AssocItem.opt_generics(i);

  this.check_for_lang(target, unwrap(this.resolver.owners.get(i.id)).def_id, i.attrs, i.span, generics);

  visit.walk_assoc_item(this, i, ctxt, visit.WalkItemKind.AssocItemKind);
};

/// Extracts the first `lang = "$name"` out of a list of attributes.
/// The `#[panic_handler]` attribute is also extracted out when found.
///
/// This function is used for `ast::Attribute`, for `rustc_attr_ir::Attribute`
/// use `find_attr!(attrs, Lang(lang_item))`.
// rustc: compiler/rustc_passes/src/lang_items.rs:320 extract_ast
export function extract_ast(attrs: readonly Attribute[]): [Symbol, Span] | undefined {
  for (const attr of attrs) {
    let r: [Symbol, Span] | undefined;
    if (attr.has_name(sym.lang)) {
      const v = attr.value_str();
      r = v === undefined ? undefined : [v, attr.span_()];
    } else if (attr.has_name(sym.panic_handler)) {
      r = [sym.panic_impl, attr.span_()];
    } else {
      r = undefined;
    }
    if (r !== undefined) return r;
  }
  return undefined;
}

// rustc: compiler/rustc_passes/src/lang_items.rs:330 provide
export function provide(providers: Providers): void {
  providers.get_lang_items = get_lang_items;
}
