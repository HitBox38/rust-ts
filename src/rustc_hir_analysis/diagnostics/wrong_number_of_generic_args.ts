// Port of compiler/rustc_hir_analysis/src/diagnostics/wrong_number_of_generic_args.rs (lane wrong-num-args).
//
// PORT: upstream declares this module in diagnostics.rs (`pub(crate) mod wrong_number_of_generic_args;`); diagnostics.ts
// belongs to another lane, so the crate root (lib.ts) loads it instead.
//
// Init order: top-level code here touches only other crates; nothing of this crate is imported at runtime.
//
// PORT: `usize` arithmetic is plain `number` arithmetic. Upstream's subtractions do not underflow for the inputs its
// callers (`check_generic_arg_count`) build.
import { Applicability, Diag, type DiagCtxtHandle, type Diagnostic, E0107, type Level, pluralize } from "../../rustc_errors/lib.ts";
import { MultiSpan } from "../../rustc_error_messages/lib.ts";
import * as hir from "../../rustc_hir/lib.ts";
import { AssocItem, AssocItems } from "../../rustc_middle/ty/assoc.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Generics } from "../../rustc_middle/ty/generics.ts";
import type { TraitDef } from "../../rustc_middle/ty/trait_def.ts";
import { type DefId, DefId_eq, type LocalDefId } from "../../rustc_span/def_id.ts";
import { SyntaxContext } from "../../rustc_span/hygiene.ts";
import { Span } from "../../rustc_span/lib.ts";
import { display_Ident, display_Symbol, Symbol } from "../../rustc_span/symbol.ts";
import { debug_struct, type Debug } from "../../std/fmt.ts";
import { assert, unreachable, unwrap } from "../../std/panic.ts";

// use GenericArgsInfo::*;

/// Handles the `wrong number of type / lifetime / ... arguments` family of error messages.
export class WrongNumberOfGenericArgs implements Diagnostic {
  constructor(
    public tcx: TyCtxt,

    public angle_brackets: AngleBrackets,

    public gen_args_info: GenericArgsInfo,

    /// Offending path segment
    public path_segment: hir.PathSegment,

    /// Generic parameters as expected by type or trait
    public gen_params: Generics,

    /// Index offset into parameters. Depends on whether `Self` is included and on
    /// number of lifetime parameters in case we're processing missing or redundant
    /// type or constant arguments.
    public params_offset: number,

    /// Generic arguments as provided by user
    public gen_args: hir.GenericArgs,

    /// DefId of the generic type
    public def_id: DefId,

    /// DefId of the type that contains the generic
    public cx_def_id: LocalDefId,
  ) {}

  // rustc: compiler/rustc_hir_analysis/src/diagnostics/wrong_number_of_generic_args.rs:92 new
  static new(
    tcx: TyCtxt,
    gen_args_info: GenericArgsInfo,
    path_segment: hir.PathSegment,
    gen_params: Generics,
    params_offset: number,
    gen_args: hir.GenericArgs,
    def_id: DefId,
    cx_def_id: LocalDefId,
  ): WrongNumberOfGenericArgs {
    let angle_brackets: AngleBrackets;
    if (gen_args.span_ext_() === undefined) {
      angle_brackets = gen_args.is_empty() ? AngleBrackets.Missing : AngleBrackets.Implied;
    } else {
      angle_brackets = AngleBrackets.Available;
    }

    return new WrongNumberOfGenericArgs(tcx, angle_brackets, gen_args_info, path_segment, gen_params, params_offset, gen_args, def_id, cx_def_id);
  }

  // rustc: compiler/rustc_hir_analysis/src/diagnostics/wrong_number_of_generic_args.rs:121 missing_lifetimes
  missing_lifetimes(): boolean {
    switch (this.gen_args_info.$) {
      case "MissingLifetimes":
      case "ExcessLifetimes":
        return true;
      case "MissingTypesOrConsts":
      case "ExcessTypesOrConsts":
        return false;
    }
  }

  // rustc: compiler/rustc_hir_analysis/src/diagnostics/wrong_number_of_generic_args.rs:128 kind
  kind(): string {
    return this.missing_lifetimes() ? "lifetime" : "generic";
  }

  /// Returns true if the generic type is a trait
  /// and is being referred to from one of its trait impls
  // rustc: compiler/rustc_hir_analysis/src/diagnostics/wrong_number_of_generic_args.rs:134 is_in_trait_impl
  is_in_trait_impl(): boolean {
    if (this.tcx.is_trait(this.def_id)) {
      // Here we check if the reference to the generic type
      // is from the 'of_trait' field of the enclosing impl

      const parent = this.tcx.parent_hir_node(this.path_segment.hir_id);
      const parent_item = this.tcx.hir_node_by_def_id(this.tcx.hir_get_parent_item(this.path_segment.hir_id).def_id);

      // Get the HIR id of the trait ref
      if (parent.$ !== "TraitRef") {
        return false;
      }
      const trait_ref_id = parent._0.hir_ref_id;

      // Get the HIR id of the 'of_trait' field of the impl
      if (!(parent_item.$ === "Item" && parent_item._0.kind.$ === "Impl" && parent_item._0.kind._0.of_trait !== undefined)) {
        return false;
      }
      const id_in_of_trait = parent_item._0.kind._0.of_trait.trait_ref.hir_ref_id;

      // Check that trait is referred to from the of_trait field of impl
      return hir.HirId_eq(trait_ref_id, id_in_of_trait);
    } else {
      return false;
    }
  }

  // rustc: compiler/rustc_hir_analysis/src/diagnostics/wrong_number_of_generic_args.rs:173 num_provided_args
  num_provided_args(): number {
    if (this.missing_lifetimes()) {
      return this.num_provided_lifetime_args();
    } else {
      return this.num_provided_type_or_const_args();
    }
  }

  // rustc: compiler/rustc_hir_analysis/src/diagnostics/wrong_number_of_generic_args.rs:181 num_provided_lifetime_args
  num_provided_lifetime_args(): number {
    switch (this.angle_brackets) {
      case "Missing":
        return 0;
      // Only lifetime arguments can be implied
      case "Implied":
        return this.gen_args.args.length;
      case "Available":
        return this.gen_args.num_lifetime_args();
    }
  }

  // rustc: compiler/rustc_hir_analysis/src/diagnostics/wrong_number_of_generic_args.rs:190 num_provided_type_or_const_args
  num_provided_type_or_const_args(): number {
    switch (this.angle_brackets) {
      case "Missing":
        return 0;
      // Only lifetime arguments can be implied
      case "Implied":
        return 0;
      case "Available":
        return this.gen_args.num_generic_params();
    }
  }

  // rustc: compiler/rustc_hir_analysis/src/diagnostics/wrong_number_of_generic_args.rs:199 num_expected_lifetime_args
  num_expected_lifetime_args(): number {
    const num_provided_args = this.num_provided_lifetime_args();
    const info = this.gen_args_info;
    switch (info.$) {
      case "MissingLifetimes":
        return num_provided_args + info.num_missing_args;
      case "ExcessLifetimes":
        return num_provided_args - info.num_redundant_args;
      default:
        return 0;
    }
  }

  // rustc: compiler/rustc_hir_analysis/src/diagnostics/wrong_number_of_generic_args.rs:208 num_expected_type_or_const_args
  num_expected_type_or_const_args(): number {
    const num_provided_args = this.num_provided_type_or_const_args();
    const info = this.gen_args_info;
    switch (info.$) {
      case "MissingTypesOrConsts":
        return num_provided_args + info.num_missing_args;
      case "ExcessTypesOrConsts": {
        return num_provided_args - info.num_redundant_args;
      }
      default:
        return 0;
    }
  }

  // Gives the number of expected arguments taking into account default arguments
  // rustc: compiler/rustc_hir_analysis/src/diagnostics/wrong_number_of_generic_args.rs:220 num_expected_type_or_const_args_including_defaults
  num_expected_type_or_const_args_including_defaults(): number {
    const provided_args = this.num_provided_type_or_const_args();
    const info = this.gen_args_info;
    switch (info.$) {
      case "MissingTypesOrConsts": {
        return provided_args + info.num_missing_args - info.num_default_params;
      }
      case "ExcessTypesOrConsts": {
        return provided_args - info.num_redundant_args - info.num_default_params;
      }
      default:
        return 0;
    }
  }

  // rustc: compiler/rustc_hir_analysis/src/diagnostics/wrong_number_of_generic_args.rs:233 num_missing_lifetime_args
  num_missing_lifetime_args(): number {
    const missing_args = this.num_expected_lifetime_args() - this.num_provided_lifetime_args();
    assert(missing_args > 0, "assertion failed: missing_args > 0");
    return missing_args;
  }

  // rustc: compiler/rustc_hir_analysis/src/diagnostics/wrong_number_of_generic_args.rs:239 num_missing_type_or_const_args
  num_missing_type_or_const_args(): number {
    const missing_args = this.num_expected_type_or_const_args_including_defaults() - this.num_provided_type_or_const_args();
    assert(missing_args > 0, "assertion failed: missing_args > 0");
    return missing_args;
  }

  // rustc: compiler/rustc_hir_analysis/src/diagnostics/wrong_number_of_generic_args.rs:246 num_excess_lifetime_args
  num_excess_lifetime_args(): number {
    const info = this.gen_args_info;
    switch (info.$) {
      case "ExcessLifetimes":
        return info.num_redundant_args;
      default:
        return 0;
    }
  }

  // rustc: compiler/rustc_hir_analysis/src/diagnostics/wrong_number_of_generic_args.rs:253 num_excess_type_or_const_args
  num_excess_type_or_const_args(): number {
    const info = this.gen_args_info;
    switch (info.$) {
      case "ExcessTypesOrConsts":
        return info.num_redundant_args;
      default:
        return 0;
    }
  }

  // rustc: compiler/rustc_hir_analysis/src/diagnostics/wrong_number_of_generic_args.rs:260 too_many_args_provided
  too_many_args_provided(): boolean {
    const info = this.gen_args_info;
    switch (info.$) {
      case "MissingLifetimes":
      case "MissingTypesOrConsts":
        return false;
      case "ExcessLifetimes":
      case "ExcessTypesOrConsts": {
        const num_redundant_args = info.num_redundant_args;
        assert(num_redundant_args > 0, "assertion failed: num_redundant_args > 0");
        return true;
      }
    }
  }

  // rustc: compiler/rustc_hir_analysis/src/diagnostics/wrong_number_of_generic_args.rs:271 not_enough_args_provided
  not_enough_args_provided(): boolean {
    const info = this.gen_args_info;
    switch (info.$) {
      case "MissingLifetimes":
      case "MissingTypesOrConsts": {
        const num_missing_args = info.num_missing_args;
        assert(num_missing_args > 0, "assertion failed: num_missing_args > 0");
        return true;
      }
      case "ExcessLifetimes":
      case "ExcessTypesOrConsts":
        return false;
    }
  }

  // Helper method to get the index offset in angle brackets, at which type or const arguments
  // start appearing
  // rustc: compiler/rustc_hir_analysis/src/diagnostics/wrong_number_of_generic_args.rs:284 get_lifetime_args_offset
  get_lifetime_args_offset(): number {
    const info = this.gen_args_info;
    switch (info.$) {
      case "MissingLifetimes":
      case "ExcessLifetimes":
        return 0;
      case "MissingTypesOrConsts":
      case "ExcessTypesOrConsts": {
        return info.args_offset;
      }
    }
  }

  // rustc: compiler/rustc_hir_analysis/src/diagnostics/wrong_number_of_generic_args.rs:293 get_num_default_params
  get_num_default_params(): number {
    const info = this.gen_args_info;
    switch (info.$) {
      case "MissingTypesOrConsts":
      case "ExcessTypesOrConsts":
        return info.num_default_params;
      default:
        return 0;
    }
  }

  // rustc: compiler/rustc_hir_analysis/src/diagnostics/wrong_number_of_generic_args.rs:301 is_synth_provided
  is_synth_provided(): boolean {
    const info = this.gen_args_info;
    switch (info.$) {
      case "ExcessTypesOrConsts":
        return info.synth_provided;
      default:
        return false;
    }
  }

  // Helper function to choose a quantifier word for the number of expected arguments
  // and to give a bound for the number of expected arguments
  // rustc: compiler/rustc_hir_analysis/src/diagnostics/wrong_number_of_generic_args.rs:310 get_quantifier_and_bound
  get_quantifier_and_bound(): [string, number] {
    if (this.get_num_default_params() === 0) {
      switch (this.gen_args_info.$) {
        case "MissingLifetimes":
        case "ExcessLifetimes": {
          return ["", this.num_expected_lifetime_args()];
        }
        case "MissingTypesOrConsts":
        case "ExcessTypesOrConsts": {
          return ["", this.num_expected_type_or_const_args()];
        }
      }
    } else {
      switch (this.gen_args_info.$) {
        case "MissingLifetimes":
          return ["at least ", this.num_expected_lifetime_args()];
        case "MissingTypesOrConsts": {
          return ["at least ", this.num_expected_type_or_const_args_including_defaults()];
        }
        case "ExcessLifetimes":
          return ["at most ", this.num_expected_lifetime_args()];
        case "ExcessTypesOrConsts":
          return ["at most ", this.num_expected_type_or_const_args()];
      }
    }
  }

  // Creates lifetime name suggestions from the lifetime parameter names
  // rustc: compiler/rustc_hir_analysis/src/diagnostics/wrong_number_of_generic_args.rs:333 get_lifetime_args_suggestions_from_param_names
  get_lifetime_args_suggestions_from_param_names(path_hir_id: hir.HirId, num_params_to_take: number): string {
    // debug!(?path_hir_id);

    // If there was already a lifetime among the arguments, just replicate that one.
    let lt: hir.Lifetime | undefined;
    for (const arg of this.gen_args.args) {
      if (arg.$ === "Lifetime") {
        lt = arg._0;
        break;
      }
    }
    if (lt !== undefined) {
      return repeat_n(hir.display_Lifetime(lt), num_params_to_take).join(", ");
    }

    const ret: string[] = [];
    let ty_id: hir.HirId | undefined = undefined;
    for (const [id, node] of this.tcx.hir_parent_iter(path_hir_id)) {
      // debug!(?id);
      if (node.$ === "Ty") {
        ty_id = id;
      }

      // Suggest `'_` when in function parameter or elided function return.
      const fn_decl = hir.Node.fn_decl(node);
      if (fn_decl !== undefined && ty_id !== undefined) {
        const ty_id_ = ty_id;
        const in_arg = fn_decl.inputs.some((t) => hir.HirId_eq(t.hir_id, ty_id_));
        const in_ret = fn_decl.output.$ === "Return" && hir.HirId_eq(fn_decl.output._0.hir_id, ty_id_);

        if (in_arg || (in_ret && fn_decl.lifetime_elision_allowed())) {
          return repeat_n("'_", num_params_to_take).join(", ");
        }
      }

      // Suggest `'static` when in const/static item-like.
      if (
        (node.$ === "Item" && (node._0.kind.$ === "Static" || node._0.kind.$ === "Const")) ||
        (node.$ === "TraitItem" && node._0.kind.$ === "Const") ||
        (node.$ === "ImplItem" && node._0.kind.$ === "Const") ||
        (node.$ === "ForeignItem" && node._0.kind.$ === "Static") ||
        node.$ === "AnonConst"
      ) {
        return repeat_n("'static", Math.max(0, num_params_to_take - ret.length)).join(", ");
      }

      let params: readonly hir.GenericParam[];
      const generics = hir.Node.generics(node);
      if (generics !== undefined) {
        params = generics.params;
      } else if (node.$ === "Ty" && node._0.kind.$ === "FnPtr") {
        const fn_ptr = node._0.kind._0;
        params = fn_ptr.generic_params;
      } else {
        params = [];
      }
      for (const p of params) {
        if (!(p.kind.$ === "Lifetime" && p.kind.kind.$ === "Explicit")) {
          continue;
        }
        if (p.name.$ !== "Plain") continue;
        const name = p.name._0;
        ret.push(display_Ident(name));
      }

      if (ret.length >= num_params_to_take) {
        return ret.slice(0, num_params_to_take).join(", ");
      }
      // We cannot refer to lifetimes defined in an outer function.
      if (node.$ === "Item") {
        break;
      }
    }

    // We could not gather enough lifetime parameters in the scope.
    // We use the parameter names from the target type's definition instead.
    const skip = this.params_offset + this.num_provided_lifetime_args();
    return this.gen_params.own_params
      .slice(skip, skip + num_params_to_take)
      .map((param) => display_Symbol(param.name))
      .join(", ");
  }

  // Creates type or constant name suggestions from the provided parameter names
  // rustc: compiler/rustc_hir_analysis/src/diagnostics/wrong_number_of_generic_args.rs:441 get_type_or_const_args_suggestions_from_param_names
  get_type_or_const_args_suggestions_from_param_names(num_params_to_take: number): string {
    let first_expr: hir.Expr | undefined;
    let skipped = false;
    for (const [, node] of this.tcx.hir_parent_iter(this.path_segment.hir_id)) {
      if (!skipped) {
        skipped = true;
        continue;
      }
      if (node.$ === "Expr") {
        first_expr = node._0;
        break;
      }
    }
    const is_in_a_method_call = first_expr !== undefined && first_expr.kind.$ === "MethodCall" && first_expr.kind._0.args !== undefined;

    const node = this.tcx.hir_get_if_local(this.def_id);
    const fn_sig = node !== undefined ? hir.Node.fn_sig(node) : undefined;
    const is_used_in_input = (def_id: DefId): boolean => {
      return (
        fn_sig !== undefined &&
        fn_sig.decl.inputs.some((ty) => {
          const kind = ty.kind;
          if (kind.$ === "Path" && kind._0.$ === "Resolved" && kind._0._0 === undefined && kind._0._1.res.$ === "Def") {
            const id = kind._0._1.res._1;
            return DefId_eq(id, def_id);
          }
          return false;
        })
      );
    };
    const skip = this.params_offset + this.num_provided_type_or_const_args();
    return this.gen_params.own_params
      .slice(skip, skip + num_params_to_take)
      .map((param) => {
        // If it's in method call (turbofish), it might be inferred from the expression (e.g. `.collect::<Vec<_>>()`)
        // If it is being inferred from the item's inputs, no need to set it.
        if (param.kind.$ === "Type" && (is_in_a_method_call || is_used_in_input(param.def_id))) {
          return "_";
        }
        return Symbol.as_str(param.name);
      })
      .join(", ");
  }

  // rustc: compiler/rustc_hir_analysis/src/diagnostics/wrong_number_of_generic_args.rs:491 get_unbound_associated_item
  get_unbound_associated_item(): AssocItem[] {
    if (this.tcx.is_trait(this.def_id)) {
      // PORT: the `associated_items` query value is `unknown` in queries.gen.ts (`&AssocItems`).
      const items = this.tcx.associated_items(this.def_id) as AssocItems;
      return [...AssocItems.in_definition_order(items)].filter((item) => {
        return (
          AssocItem.can_have_equality_constraint(item, this.tcx) &&
          !AssocItem.is_impl_trait_in_trait(item) &&
          !this.gen_args.constraints.some((constraint) => constraint.ident.name === AssocItem.name(item))
        );
      });
    } else {
      return [];
    }
  }

  // rustc: compiler/rustc_hir_analysis/src/diagnostics/wrong_number_of_generic_args.rs:511 create_error_message
  create_error_message(): string {
    const def_path = this.tcx.def_path_str(this.def_id);
    const def_kind = this.tcx.def_descr(this.def_id);
    const [quantifier, bound] = this.get_quantifier_and_bound();
    const kind = this.kind();
    const provided_lt_args = this.num_provided_lifetime_args();
    const provided_type_or_const_args = this.num_provided_type_or_const_args();

    let provided_args_str: string;
    let verb: string;
    switch (this.gen_args_info.$) {
      case "MissingLifetimes":
      case "ExcessLifetimes":
        [provided_args_str, verb] = [`${provided_lt_args} lifetime argument${pluralize(provided_lt_args)}`, pluralize("was", provided_lt_args)];
        break;
      case "MissingTypesOrConsts":
      case "ExcessTypesOrConsts":
        [provided_args_str, verb] = [
          `${provided_type_or_const_args} generic argument${pluralize(provided_type_or_const_args)}`,
          pluralize("was", provided_type_or_const_args),
        ];
        break;
    }

    if (this.gen_args.span_ext_() !== undefined) {
      return `${def_kind} takes ${quantifier}${bound} ${kind} argument${pluralize(bound)} but ${provided_args_str} ${verb} supplied`;
    } else {
      return `missing generics for ${def_kind} \`${def_path}\``;
    }
  }

  /// Builds the `expected 1 type argument / supplied 2 type arguments` message.
  // rustc: compiler/rustc_hir_analysis/src/diagnostics/wrong_number_of_generic_args.rs:551 notify
  notify(err: Diag): void {
    const [quantifier, bound] = this.get_quantifier_and_bound();
    const provided_args = this.num_provided_args();

    err.span_label(this.path_segment.ident.span, `expected ${quantifier}${bound} ${this.kind()} argument${pluralize(bound)}`);

    // When too many arguments were provided, we don't highlight each of them, because it
    // would overlap with the suggestion to remove them:
    //
    // ```
    // type Foo = Bar<usize, usize>;
    //                -----  ----- supplied 2 type arguments
    //                     ^^^^^^^ remove this type argument
    // ```
    if (this.too_many_args_provided()) {
      return;
    }

    const offset = this.get_lifetime_args_offset();
    const args = this.gen_args.args.slice(offset, offset + provided_args);

    for (const [i, arg] of args.entries()) {
      err.span_label(
        hir.GenericArg.span(arg),
        i + 1 === provided_args ? `supplied ${provided_args} ${this.kind()} argument${pluralize(provided_args)}` : "",
      );
    }
  }

  // rustc: compiler/rustc_hir_analysis/src/diagnostics/wrong_number_of_generic_args.rs:603 suggest
  suggest(err: Diag): void {
    // debug!(
    //     "suggest(self.provided {:?}, self.gen_args.span(): {:?})",
    //     self.num_provided_args(),
    //     self.gen_args.span(),
    // );

    switch (this.angle_brackets) {
      case "Missing":
      case "Implied":
        this.suggest_adding_args(err);
        break;
      case "Available": {
        if (this.not_enough_args_provided()) {
          this.suggest_adding_args(err);
        } else if (this.too_many_args_provided()) {
          this.suggest_moving_args_from_assoc_fn_to_trait(err);
          this.suggest_removing_args_or_generics(err);
        } else {
          unreachable();
        }
        break;
      }
    }
  }

  /// Suggests to add missing argument(s) when current invocation site already contains some
  /// generics:
  ///
  /// ```text
  /// type Map = HashMap<String>;
  /// ```
  // rustc: compiler/rustc_hir_analysis/src/diagnostics/wrong_number_of_generic_args.rs:631 suggest_adding_args
  suggest_adding_args(err: Diag): void {
    if (this.gen_args.parenthesized !== hir.GenericArgsParentheses.No) {
      return;
    }

    // Do not suggest angle-bracketed arguments that require the unstable feature.
    // PORT: the `trait_def` query value is `unknown` in queries.gen.ts (`&TraitDef`).
    if (!this.tcx.features().unboxed_closures() && this.tcx.is_trait(this.def_id) && (this.tcx.trait_def(this.def_id) as TraitDef).paren_sugar) {
      return;
    }

    switch (this.gen_args_info.$) {
      case "MissingLifetimes": {
        this.suggest_adding_lifetime_args(err);
        break;
      }
      case "MissingTypesOrConsts": {
        this.suggest_adding_type_and_const_args(err);
        break;
      }
      case "ExcessTypesOrConsts": {
        // this can happen with `[const] T` where T isn't a `const trait`.
        break;
      }
      default:
        unreachable();
    }
  }

  // rustc: compiler/rustc_hir_analysis/src/diagnostics/wrong_number_of_generic_args.rs:658 suggest_adding_lifetime_args
  suggest_adding_lifetime_args(err: Diag): void {
    // debug!("suggest_adding_lifetime_args(path_segment: {:?})", self.path_segment);
    const num_missing_args = this.num_missing_lifetime_args();
    const num_params_to_take = num_missing_args;
    const msg = `add missing ${this.kind()} argument${pluralize(num_missing_args)}`;

    const suggested_args = this.get_lifetime_args_suggestions_from_param_names(this.path_segment.hir_id, num_params_to_take);
    // debug!("suggested_args: {suggested_args:?}");

    switch (this.angle_brackets) {
      case "Missing": {
        const span = this.path_segment.ident.span;

        // insert a suggestion of the form "Y<'a, 'b>"
        const sugg = `<${suggested_args}>`;
        // debug!("sugg: {:?}", sugg);

        err.span_suggestion_verbose(Span.shrink_to_hi(span), msg, sugg, Applicability.HasPlaceholders);
        break;
      }

      case "Available": {
        let sugg_span: Span;
        let is_first: boolean;
        if (this.num_provided_lifetime_args() === 0) {
          [sugg_span, is_first] = [Span.shrink_to_lo(unwrap(this.gen_args.span())), true];
        } else {
          const last_lt = this.gen_args.args[this.num_provided_lifetime_args() - 1]!;
          [sugg_span, is_first] = [Span.shrink_to_hi(hir.GenericArg.span(last_lt)), false];
        }
        const has_non_lt_args = this.num_provided_type_or_const_args() !== 0;
        const has_constraints = this.gen_args.constraints.length !== 0;

        const sugg_prefix = is_first ? "" : ", ";
        const sugg_suffix = is_first && (has_non_lt_args || has_constraints) ? ", " : "";

        const sugg = `${sugg_prefix}${suggested_args}${sugg_suffix}`;
        // debug!("sugg: {:?}", sugg);

        err.span_suggestion_verbose(sugg_span, msg, sugg, Applicability.HasPlaceholders);
        break;
      }
      case "Implied": {
        // We never encounter missing lifetimes in situations in which lifetimes are elided
        unreachable();
      }
    }
  }

  // rustc: compiler/rustc_hir_analysis/src/diagnostics/wrong_number_of_generic_args.rs:712 suggest_adding_type_and_const_args
  suggest_adding_type_and_const_args(err: Diag): void {
    const num_missing_args = this.num_missing_type_or_const_args();
    const msg = `add missing ${this.kind()} argument${pluralize(num_missing_args)}`;

    const suggested_args = this.get_type_or_const_args_suggestions_from_param_names(num_missing_args);
    // debug!("suggested_args: {:?}", suggested_args);

    switch (this.angle_brackets) {
      case "Missing":
      case "Implied": {
        const span = this.path_segment.ident.span;

        // insert a suggestion of the form "Y<T, U>"
        const sugg = `<${suggested_args}>`;
        // debug!("sugg: {:?}", sugg);

        err.span_suggestion_verbose(Span.shrink_to_hi(span), msg, sugg, Applicability.HasPlaceholders);
        break;
      }
      case "Available": {
        const gen_args_span = unwrap(this.gen_args.span());
        const sugg_offset = this.get_lifetime_args_offset() + this.num_provided_type_or_const_args();

        let sugg_span: Span;
        let is_first: boolean;
        if (sugg_offset === 0) {
          [sugg_span, is_first] = [Span.shrink_to_lo(gen_args_span), true];
        } else {
          const arg_span = hir.GenericArg.span(this.gen_args.args[sugg_offset - 1]!);
          // If we came here then inferred lifetime's spans can only point
          // to either the opening bracket or to the space right after.
          // Both of these spans have an `hi` lower than or equal to the span
          // of the generics excluding the brackets.
          // This allows us to check if `arg_span` is the artificial span of
          // an inferred lifetime, in which case the generic we're suggesting to
          // add will be the first visible, even if it isn't the actual first generic.
          [sugg_span, is_first] = [Span.shrink_to_hi(arg_span), Span.hi(arg_span) <= Span.lo(gen_args_span)];
        }

        const sugg_prefix = is_first ? "" : ", ";
        const sugg_suffix = is_first && this.gen_args.constraints.length !== 0 ? ", " : "";

        const sugg = `${sugg_prefix}${suggested_args}${sugg_suffix}`;
        // debug!("sugg: {:?}", sugg);

        err.span_suggestion_verbose(sugg_span, msg, sugg, Applicability.HasPlaceholders);
        break;
      }
    }
  }

  /// Suggests moving redundant argument(s) of an associate function to the
  /// trait it belongs to.
  ///
  /// ```compile_fail
  /// Into::into::<Option<_>>(42) // suggests considering `Into::<Option<_>>::into(42)`
  /// ```
  // rustc: compiler/rustc_hir_analysis/src/diagnostics/wrong_number_of_generic_args.rs:772 suggest_moving_args_from_assoc_fn_to_trait
  suggest_moving_args_from_assoc_fn_to_trait(err: Diag): void {
    const trait_ = this.tcx.trait_of_assoc(this.def_id);
    if (trait_ === undefined) {
      return;
    }

    // Skip suggestion when the associated function is itself generic, it is unclear
    // how to split the provided parameters between those to suggest to the trait and
    // those to remain on the associated type.
    const num_assoc_fn_expected_args = this.num_expected_type_or_const_args() + this.num_expected_lifetime_args();
    if (num_assoc_fn_expected_args > 0) {
      return;
    }

    const num_assoc_fn_excess_args = this.num_excess_type_or_const_args() + this.num_excess_lifetime_args();

    // PORT: the `generics_of` query value is `unknown` in queries.gen.ts (`&Generics`).
    const trait_generics = this.tcx.generics_of(trait_) as Generics;
    const num_trait_generics_except_self = trait_generics.count() - (trait_generics.has_self ? 1 : 0);

    const these = pluralize("this", num_assoc_fn_excess_args);
    const s = pluralize(num_assoc_fn_excess_args);
    const name = display_Symbol(this.tcx.item_name(trait_));
    const num = num_trait_generics_except_self;
    const msg = `consider moving ${these} generic argument${s} to the \`${name}\` trait, which takes up to ${num} argument${s}`;

    const parent = this.tcx.parent_hir_node(this.path_segment.hir_id);
    if (parent.$ === "Expr") {
      const expr = parent._0;
      switch (expr.kind.$) {
        case "Path":
          this.suggest_moving_args_from_assoc_fn_to_trait_for_qualified_path(err, expr.kind._0, msg, num_assoc_fn_excess_args, num_trait_generics_except_self);
          break;
        case "MethodCall":
          this.suggest_moving_args_from_assoc_fn_to_trait_for_method_call(err, trait_, expr, msg, num_assoc_fn_excess_args, num_trait_generics_except_self);
          break;
        default:
          return;
      }
    }
  }

  // rustc: compiler/rustc_hir_analysis/src/diagnostics/wrong_number_of_generic_args.rs:825 suggest_moving_args_from_assoc_fn_to_trait_for_qualified_path
  suggest_moving_args_from_assoc_fn_to_trait_for_qualified_path(
    err: Diag,
    qpath: hir.QPath,
    msg: string,
    num_assoc_fn_excess_args: number,
    num_trait_generics_except_self: number,
  ): void {
    if (qpath.$ === "Resolved") {
      const path = qpath._1;
      const trait_path_segment = path.segments[0];
      if (trait_path_segment !== undefined) {
        const num_generic_args_supplied_to_trait = trait_path_segment.args_().num_generic_params();

        if (num_generic_args_supplied_to_trait + num_assoc_fn_excess_args === num_trait_generics_except_self) {
          const span = this.gen_args.span_ext_();
          if (span !== undefined) {
            const snippet = this.tcx.sess.source_map().span_to_snippet(span);
            if (snippet.$ === "Ok") {
              const sugg: [Span, string][] = [
                [this.path_segment.ident.span, `${snippet._0.toString()}::${display_Ident(this.path_segment.ident)}`],
                [Span.with_lo(span, Span.hi(this.path_segment.ident.span)), ""],
              ];

              err.multipart_suggestion(msg, sugg, Applicability.MaybeIncorrect);
            }
          }
        }
      }
    }
  }

  // rustc: compiler/rustc_hir_analysis/src/diagnostics/wrong_number_of_generic_args.rs:856 suggest_moving_args_from_assoc_fn_to_trait_for_method_call
  suggest_moving_args_from_assoc_fn_to_trait_for_method_call(
    err: Diag,
    trait_def_id: DefId,
    expr: hir.Expr,
    msg: string,
    num_assoc_fn_excess_args: number,
    num_trait_generics_except_self: number,
  ): void {
    const sm = this.tcx.sess.source_map();
    if (expr.kind.$ !== "MethodCall") {
      return;
    }
    const rcvr_ = expr.kind._1;
    const args = expr.kind._2;
    if (num_assoc_fn_excess_args !== num_trait_generics_except_self) {
      return;
    }
    const gen_args = this.gen_args.span_ext_();
    if (gen_args === undefined) {
      return;
    }
    const generics_r = sm.span_to_snippet(gen_args);
    if (generics_r.$ !== "Ok") {
      return;
    }
    const generics = generics_r._0.toString();
    const rcvr_r = sm.span_to_snippet(Span.find_ancestor_inside(rcvr_.span, expr.span) ?? rcvr_.span);
    if (rcvr_r.$ !== "Ok") {
      return;
    }
    const rcvr = rcvr_r._0.toString();
    let rest: string;
    if (args.length === 0) {
      rest = "";
    } else if (args.length === 1) {
      const arg = args[0]!;
      const r = sm.span_to_snippet(Span.find_ancestor_inside(arg.span, expr.span) ?? arg.span);
      if (r.$ !== "Ok") {
        return;
      }
      rest = r._0.toString();
    } else {
      const first = args[0]!;
      const last = args[args.length - 1]!;
      const first_span = Span.find_ancestor_inside(first.span, expr.span) ?? first.span;
      const last_span = Span.find_ancestor_inside(last.span, expr.span) ?? last.span;
      const r = sm.span_to_snippet(Span.to(first_span, last_span));
      if (r.$ !== "Ok") {
        return;
      }
      rest = r._0.toString();
    }
    const comma = args.length > 0 ? ", " : "";
    const trait_path = this.tcx.def_path_str(trait_def_id);
    const method_name = display_Symbol(this.tcx.item_name(this.def_id));
    err.span_suggestion_verbose(expr.span, msg, `${trait_path}::${generics}::${method_name}(${rcvr}${comma}${rest})`, Applicability.MaybeIncorrect);
  }

  /// Suggests to remove redundant argument(s):
  ///
  /// ```text
  /// type Map = HashMap<String, String, String, String>;
  /// ```
  // rustc: compiler/rustc_hir_analysis/src/diagnostics/wrong_number_of_generic_args.rs:912 suggest_removing_args_or_generics
  suggest_removing_args_or_generics(err: Diag): void {
    const num_provided_lt_args = this.num_provided_lifetime_args();
    const num_provided_type_const_args = this.num_provided_type_or_const_args();
    const unbound_assoc_items = this.get_unbound_associated_item();
    const num_provided_args = num_provided_lt_args + num_provided_type_const_args;
    assert(num_provided_args > 0, "assertion failed: num_provided_args > 0");

    const num_redundant_lt_args = this.num_excess_lifetime_args();
    const num_redundant_type_or_const_args = this.num_excess_type_or_const_args();
    const num_redundant_args = num_redundant_lt_args + num_redundant_type_or_const_args;

    const redundant_lifetime_args = num_redundant_lt_args > 0;
    const redundant_type_or_const_args = num_redundant_type_or_const_args > 0;

    const remove_entire_generics = num_redundant_args >= this.gen_args.args.length;

    const remove_lifetime_args = (err: Diag): void => {
      const lt_arg_spans: Span[] = [];
      let found_redundant = false;
      for (const arg of this.gen_args.args) {
        if (arg.$ === "Lifetime") {
          lt_arg_spans.push(hir.GenericArg.span(arg));
          if (lt_arg_spans.length > this.num_expected_lifetime_args()) {
            found_redundant = true;
          }
        } else if (found_redundant) {
          // Argument which is redundant and separated like this `'c`
          // is not included to avoid including `Bar` in span.
          // ```
          // type Foo<'a, T> = &'a T;
          // let _: Foo<'a, 'b, Bar, 'c>;
          // ```
          break;
        }
      }

      const span_lo_redundant_lt_args = this.num_expected_lifetime_args() === 0 ? lt_arg_spans[0]! : lt_arg_spans[this.num_expected_lifetime_args() - 1]!;
      const span_hi_redundant_lt_args = lt_arg_spans[lt_arg_spans.length - 1]!;

      const span_redundant_lt_args = Span.to(Span.shrink_to_hi(span_lo_redundant_lt_args), span_hi_redundant_lt_args);
      // debug!("span_redundant_lt_args: {:?}", span_redundant_lt_args);

      const num_redundant_lt_args = lt_arg_spans.length - this.num_expected_lifetime_args();
      const msg_lifetimes = `remove the lifetime argument${pluralize(num_redundant_lt_args)}`;

      err.span_suggestion_short(span_redundant_lt_args, msg_lifetimes, "", Applicability.MaybeIncorrect);
    };

    const remove_type_or_const_args = (err: Diag): void => {
      const gen_arg_spans: Span[] = [];
      let found_redundant = false;
      for (const arg of this.gen_args.args) {
        if (arg.$ === "Type" || arg.$ === "Const" || arg.$ === "Infer") {
          gen_arg_spans.push(hir.GenericArg.span(arg));
          if (gen_arg_spans.length > this.num_expected_type_or_const_args()) {
            found_redundant = true;
          }
        } else if (found_redundant) {
          break;
        } else {
        }
      }

      const span_lo_redundant_type_or_const_args =
        this.num_expected_type_or_const_args() === 0 ? gen_arg_spans[0]! : gen_arg_spans[this.num_expected_type_or_const_args() - 1]!;
      const span_hi_redundant_type_or_const_args = gen_arg_spans[gen_arg_spans.length - 1]!;
      if (!Span.eq_ctxt(span_lo_redundant_type_or_const_args, span_hi_redundant_type_or_const_args)) {
        return;
      }
      const span_redundant_type_or_const_args = Span.to(Span.shrink_to_hi(span_lo_redundant_type_or_const_args), span_hi_redundant_type_or_const_args);

      // debug!("span_redundant_type_or_const_args: {:?}", span_redundant_type_or_const_args);

      const num_redundant_gen_args = gen_arg_spans.length - this.num_expected_type_or_const_args();
      const msg_types_or_consts = `remove the unnecessary generic argument${pluralize(num_redundant_gen_args)}`;

      err.span_suggestion_short(span_redundant_type_or_const_args, msg_types_or_consts, "", Applicability.MaybeIncorrect);
    };

    // If there is an identical amount of unbound associated items and excess generic args
    // suggest turning the generic args into associated item bindings
    if (unbound_assoc_items.length === num_redundant_type_or_const_args && unbound_assoc_items.length !== 0) {
      // Don't suggest if we're in a trait impl as
      // that would result in invalid syntax (fixes #116464)
      if (!this.is_in_trait_impl()) {
        const unused_generics = this.gen_args.args.slice(this.num_expected_type_or_const_args());
        // PORT: the two lazy `filter` iterators are the filtered arrays plus a cursor each (`next()` is `xs[i++]`).
        const unbound_assoc_consts = unbound_assoc_items.filter((item) => item.kind.$ === "Const");
        let consts_i = 0;
        const unbound_assoc_types = unbound_assoc_items.filter((item) => AssocItem.is_type(item));
        let types_i = 0;
        const suggestions: [Span, string][] = [];
        for (const potential of unused_generics) {
          let item: AssocItem | undefined;
          switch (potential.$) {
            case "Const":
              item = unbound_assoc_consts[consts_i++];
              break;
            case "Type":
              item = unbound_assoc_types[types_i++];
              break;
            default:
              item = undefined;
          }
          if (item === undefined) continue;
          suggestions.push([
            Span.shrink_to_lo(hir.GenericArg.span(potential)),
            // FIXME: This doesn't account for generic associated items
            `${display_Ident(this.tcx.item_ident(item.def_id))} = `,
          ]);
        }

        if (suggestions.length !== 0) {
          const s = pluralize(suggestions.length);
          const article = suggestions.length === 1 ? "an " : "";
          err.multipart_suggestion(`turn the generic argument${s} into ${article}associated item binding${s}`, suggestions, Applicability.MaybeIncorrect);
        }
      }
    } else if (remove_entire_generics) {
      const span = Span.with_lo(unwrap(unwrap(this.path_segment.args).span_ext_()), Span.hi(this.path_segment.ident.span));

      const msg = `remove the unnecessary ${this.gen_args.parenthesized === hir.GenericArgsParentheses.ParenSugar ? "parenthetical " : ""}generics`;

      if (Span.is_empty(span)) {
        // HACK: Avoid ICE when types with the same name with `derive`s are in the same scope:
        //     struct NotSM;
        //     #[derive(PartialEq, Eq)]
        //     struct NotSM<T>(T);
        // With the above code, the suggestion would be to remove the generics of the first
        // `NotSM`, which doesn't *have* generics, so we would suggest to remove no code with
        // no code, which would trigger an `assert!` later. Ideally, we would do something a
        // bit more principled. See closed PR #109082.
      } else {
        err.span_suggestion_short(span, msg, "", Applicability.MaybeIncorrect);
      }
    } else if (redundant_lifetime_args && redundant_type_or_const_args) {
      remove_lifetime_args(err);
      remove_type_or_const_args(err);
    } else if (redundant_lifetime_args) {
      remove_lifetime_args(err);
    } else {
      assert(redundant_type_or_const_args, "assertion failed: redundant_type_or_const_args");
      remove_type_or_const_args(err);
    }
  }

  /// Builds the `type defined here` message.
  // rustc: compiler/rustc_hir_analysis/src/diagnostics/wrong_number_of_generic_args.rs:1104 show_definition
  show_definition(err: Diag): void {
    const def_span = this.tcx.def_ident_span(this.def_id);
    if (def_span === undefined) return;
    if (!this.tcx.sess.source_map().is_span_accessible(def_span)) {
      return;
    }
    const spans: MultiSpan = MultiSpan.from_Span(def_span);

    let msg: string;
    {
      const def_kind = this.tcx.def_descr(this.def_id);
      const [quantifier, bound] = this.get_quantifier_and_bound();

      let params: string;
      if (bound === 0) {
        params = "";
      } else {
        const params_ = this.gen_params.own_params
          .slice(this.params_offset, this.params_offset + bound)
          .map((param) => {
            const span = this.tcx.def_span(param.def_id);
            spans.push_span_label(span, "");
            return param;
          })
          .map((param) => `\`${display_Symbol(param.name)}\``)
          .join(", ");

        params = `: ${params_}`;
      }

      msg = `${def_kind} defined here, with ${quantifier}${bound} ${this.kind()} parameter${pluralize(bound)}${params}`;
    }

    err.span_note(spans, msg);
  }

  /// Add note if `impl Trait` is explicitly specified.
  // rustc: compiler/rustc_hir_analysis/src/diagnostics/wrong_number_of_generic_args.rs:1151 note_synth_provided
  note_synth_provided(err: Diag): void {
    if (!this.is_synth_provided()) {
      return;
    }

    err.note("`impl Trait` cannot be explicitly specified as a generic argument");
  }

  // impl<'a> Diagnostic<'a> for WrongNumberOfGenericArgs<'_, '_>
  // rustc: compiler/rustc_hir_analysis/src/diagnostics/wrong_number_of_generic_args.rs:1161 into_diag
  into_diag(dcx: DiagCtxtHandle, level: Level): Diag {
    const msg = this.create_error_message();
    const err = Diag.new(dcx, level, msg);
    err.code(E0107);
    err.span(this.path_segment.ident.span);

    const cx_span = this.tcx.def_span(this.cx_def_id);
    if (Span.in_derive_expansion(cx_span)) {
      // Very likely this is a botched `derive` which passes the iten name straight
      // through, but doesn't support type parameters.
      err.span_label(SyntaxContext.outer_expn_data(Span.ctxt(cx_span)).call_site, "this derive macro might not support items with generic parameters");
    } else {
      this.notify(err);
      this.suggest(err);
      this.show_definition(err);
      this.note_synth_provided(err);
    }

    return err;
  }
}

// Provides information about the kind of arguments that were provided for
// the PathSegment, for which missing generic arguments were detected
export type AngleBrackets =
  // No angle brackets were provided, but generic arguments exist in elided form
  | "Implied"

  // No angle brackets were provided
  | "Missing"

  // Angle brackets are available, but missing some generic arguments
  | "Available";
export const AngleBrackets = { Implied: "Implied", Missing: "Missing", Available: "Available" } as const;
export const debug_AngleBrackets: Debug<AngleBrackets> = (v, _f) => v;

// Information about the kind of arguments that are either missing or are unexpected
export type GenericArgsInfo =
  | {
      readonly $: "MissingLifetimes";
      num_missing_args: number;
    }
  | {
      readonly $: "ExcessLifetimes";
      num_redundant_args: number;
    }
  | {
      readonly $: "MissingTypesOrConsts";
      num_missing_args: number;

      // type or const generic arguments can have default values
      num_default_params: number;

      // lifetime arguments precede type and const parameters, this
      // field gives the number of generic lifetime arguments to let
      // us infer the position of type and const generic arguments
      // in the angle brackets
      args_offset: number;
    }
  | {
      readonly $: "ExcessTypesOrConsts";
      num_redundant_args: number;

      // type or const generic arguments can have default values
      num_default_params: number;

      // lifetime arguments precede type and const parameters, this
      // field gives the number of generic lifetime arguments to let
      // us infer the position of type and const generic arguments
      // in the angle brackets
      args_offset: number;

      // if synthetic type arguments (e.g. `impl Trait`) are specified
      synth_provided: boolean;
    };
export const debug_GenericArgsInfo: Debug<GenericArgsInfo> = (v, f) => {
  switch (v.$) {
    case "MissingLifetimes":
      return debug_struct(f, "MissingLifetimes", [["num_missing_args", String(v.num_missing_args)]]);
    case "ExcessLifetimes":
      return debug_struct(f, "ExcessLifetimes", [["num_redundant_args", String(v.num_redundant_args)]]);
    case "MissingTypesOrConsts":
      return debug_struct(f, "MissingTypesOrConsts", [
        ["num_missing_args", String(v.num_missing_args)],
        ["num_default_params", String(v.num_default_params)],
        ["args_offset", String(v.args_offset)],
      ]);
    case "ExcessTypesOrConsts":
      return debug_struct(f, "ExcessTypesOrConsts", [
        ["num_redundant_args", String(v.num_redundant_args)],
        ["num_default_params", String(v.num_default_params)],
        ["args_offset", String(v.args_offset)],
        ["synth_provided", String(v.synth_provided)],
      ]);
  }
};

/** `std::iter::repeat_n(s, n).collect::<Vec<_>>()`. */
function repeat_n(s: string, n: number): string[] {
  return new Array<string>(n).fill(s);
}
