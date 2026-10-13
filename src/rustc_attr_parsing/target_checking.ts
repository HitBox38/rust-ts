// Port of compiler/rustc_attr_parsing/src/target_checking.rs.
// `impl AttributeParser` / `impl AcceptContext` blocks are extension methods (`declare module`);
// rustc_attr_parsing/lib.ts imports this module after interface.ts and context.ts.
import type { AttrStyle } from "../rustc_ast/lib.ts";
import { AssocCtxt } from "../rustc_ast/visit.ts";
import { type AttrItem, type Attribute, display_AttrPath, clone_AttrPath } from "../rustc_attr_ir/lib.ts";
import { MethodKind, Target } from "../rustc_attr_ir/target.ts";
import { type DiagArgValue, MultiSpan } from "../rustc_error_messages/lib.ts";
import { StashKey } from "../rustc_errors/lib.ts";
import type { Features } from "../rustc_feature/lib.ts";
import { MISPLACED_DIAGNOSTIC_ATTRIBUTES, UNUSED_ATTRIBUTES, USELESS_DEPRECATED } from "../rustc_lint_defs/builtin.ts";
import { BytePos, RemapPathScopeComponents, Span } from "../rustc_span/lib.ts";
import { FileName_eq } from "../rustc_span/source_map.ts";
import { sym, type Symbol } from "../rustc_span/symbol.ts";
import { is_whitespace } from "../std/char.ts";
import { unreachable } from "../std/panic.ts";
import { Ok } from "../std/result.ts";
import type { Str } from "../std/str.ts";
import { AcceptContext } from "./context.ts";
import {
  InvalidAttrAtCrateLevel_diagnostic,
  InvalidAttrStyle_diagnostic,
  type InvalidTarget,
  InvalidTarget_diagnostic,
  type InvalidTargetHelp,
  type ItemFollowingInnerAttr,
  UnsupportedAttributesInWhere_diagnostic,
} from "./diagnostics.ts";
import { AttributeParser } from "./interface.ts";

// PORT: `#[derive(PartialEq)]` of `rustc_attr_ir::target::Target` (with `MethodKind` / `AssocCtxt`),
// which rustc_attr_ir does not generate: structural equality of the variant and its fields.
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
// PORT: `#[derive(PartialEq)]` of `Policy`.
function Policy_eq(a: Policy, b: Policy): boolean {
  return a.$ === b.$ && Target_eq(a._0, b._0);
}
// `<[Policy]>::contains`
function contains(list: readonly Policy[], p: Policy): boolean {
  return list.some((x) => Policy_eq(x, p));
}

/** `#[derive(Debug)] pub(crate) enum AllowedTargets<'a>` */
export type AllowedTargets =
  | { readonly $: "AllowList"; readonly _0: readonly Policy[] }
  | { readonly $: "AllowListWarnRest"; readonly _0: readonly Policy[] }
  /// This is useful for argument-dependent target checking.
  /// If debug assertions are enabled,
  /// this emits a delayed bug if the `cx.check_target(...)` method is not called during attribute parsing.
  | { readonly $: "ManuallyChecked" };

/** `pub(crate) enum AllowedResult` */
export type AllowedResult = "Allowed" | "Warn" | "Error";

export const AllowedTargets = {
  ManuallyChecked: Object.freeze({ $: "ManuallyChecked" as const }) as AllowedTargets,

  // rustc: compiler/rustc_attr_parsing/src/target_checking.rs:38 is_allowed
  is_allowed(self: AllowedTargets, target: Target): AllowedResult {
    switch (self.$) {
      case "AllowList": {
        const list = self._0;
        if (contains(list, { $: "Allow", _0: target }) || contains(list, { $: "AllowSilent", _0: target })) {
          return "Allowed";
        } else if (contains(list, { $: "Warn", _0: target })) {
          return "Warn";
        } else {
          return "Error";
        }
      }
      case "AllowListWarnRest": {
        const list = self._0;
        if (contains(list, { $: "Allow", _0: target }) || contains(list, { $: "AllowSilent", _0: target })) {
          return "Allowed";
        } else if (contains(list, { $: "Error", _0: target })) {
          return "Error";
        } else {
          return "Warn";
        }
      }
      case "ManuallyChecked":
        return unreachable();
    }
  },

  // rustc: compiler/rustc_attr_parsing/src/target_checking.rs:66 allowed_targets
  allowed_targets(self: AllowedTargets): Target[] {
    let list: readonly Policy[];
    switch (self.$) {
      case "AllowList":
      case "AllowListWarnRest":
        list = self._0;
        break;
      case "ManuallyChecked":
        return unreachable();
    }
    const out: Target[] = [];
    for (const target of list) {
      switch (target.$) {
        case "Allow":
          out.push(target._0);
          break;
        case "AllowSilent":
        case "Warn":
        case "Error":
          break;
      }
    }
    return out;
  },
};

/// This policy determines what diagnostics should be emitted based on the `Target` of the attribute.
/** `#[derive(Debug, Eq, PartialEq)] pub(crate) enum Policy` */
export type Policy =
  /// A target that is allowed.
  | { readonly $: "Allow"; readonly _0: Target }
  /// A target that is allowed and not listed in the possible targets.
  /// This is useful if the target is checked elsewhere.
  | { readonly $: "AllowSilent"; readonly _0: Target }
  /// Emits a FCW on this target.
  /// This is useful if the target was previously allowed but should not be.
  | { readonly $: "Warn"; readonly _0: Target }
  /// Emits an error on this target.
  | { readonly $: "Error"; readonly _0: Target };

/** Constructors of the `Policy` variants (`Policy::Allow(target)`, ...; attributes/prelude.rs imports `Allow`, `Error`, `Warn`). */
export const Policy = {
  Allow: (target: Target): Policy => ({ $: "Allow", _0: target }),
  AllowSilent: (target: Target): Policy => ({ $: "AllowSilent", _0: target }),
  Warn: (target: Target): Policy => ({ $: "Warn", _0: target }),
  Error: (target: Target): Policy => ({ $: "Error", _0: target }),
};
const { Allow } = Policy;

declare module "./interface.ts" {
  interface AttributeParser {
    check_invalid_crate_level_attr_item(attr: AttrItem, inner_span: Span): void;
    first_line_of_next_item(span: Span): Span | undefined;
    check_invalid_where_predicate_attrs(attrs: Iterable<Attribute>): void;
  }
}

// rustc: compiler/rustc_attr_parsing/src/target_checking.rs:96 check_target
AttributeParser.check_target = function (allowed_targets: AllowedTargets, attribute_args: string, cx: AcceptContext): void {
  if (cx.shared.cx.should_emit.$ === "Nothing") {
    return;
  }

  if (allowed_targets.$ === "ManuallyChecked") {
    // #[cfg(debug_assertions)]
    // if !cx.has_target_been_checked {
    //     cx.dcx().delayed_bug("Attribute target has not been checked");
    // }

    return;
  }

  // For crate-level attributes we emit a specific set of lints to warn
  // people about accidentally not using them on the crate.
  if (allowed_targets.$ === "AllowList" && is_allow_crate_only(allowed_targets._0)) {
    AttributeParser.check_crate_level(cx, false);
    return;
  }
  if (allowed_targets.$ === "AllowListWarnRest" && is_allow_crate_only(allowed_targets._0)) {
    AttributeParser.check_crate_level(cx, true);
    return;
  }

  const result = AllowedTargets.is_allowed(allowed_targets, cx.shared.target);
  if (result === "Allowed") {
    return;
  }

  const allowed_targets_ = AllowedTargets.allowed_targets(allowed_targets);
  const [applied, only] = allowed_targets_applied(allowed_targets_, cx.shared.target, cx.shared.cx.features_);
  const is_diagnostic_attr = cx.attr_path.segments[0] === sym.diagnostic;

  const diag: InvalidTarget = {
    span:
      attribute_args.length === 0
        ? // Example: for the attribute `#[inline]`, name+attribute_args gives "inline",
          // and the path span covers `inline` which is just what we want.
          cx.attr_path.span
        : // Example 1: for the attribute `#[repr(C)]`, name+attribute_args gives
          // "repr(C)", and the inner span covers `repr(C)` which is just what we want.
          //
          // Example 2: for the attribute `#[repr(C, packed)]`, name+attribute_args gives
          // "repr(C)", and the inner span covers `repr(C, packed)` which doesn't match
          // exactly but is as close as we can get.
          cx.inner_span,
    attr_span: cx.attr_span,
    name: clone_AttrPath(cx.attr_path),
    target: Target.plural_name(cx.shared.target),
    only: only ? "only " : "",
    applied: { $: "StrListSepByAnd", _0: applied } satisfies DiagArgValue,
    attribute_args: attribute_args,
    help: target_checking_help(attribute_args, cx),
    previously_accepted: result === "Warn" && !is_diagnostic_attr,
    on_macro_call: cx.shared.target.$ === "MacroCall",
  };

  switch (result) {
    case "Warn": {
      const lint =
        cx.attr_path.segments[0] === sym.deprecated &&
        ![Target.Closure, Target.Expression, Target.Statement, Target.Arm, Target.MacroCall].some((t) => Target_eq(t, cx.shared.target))
          ? USELESS_DEPRECATED
          : is_diagnostic_attr
            ? MISPLACED_DIAGNOSTIC_ATTRIBUTES
            : UNUSED_ATTRIBUTES;

      const attr_span = cx.attr_span;
      cx.shared.emit_lint(lint, InvalidTarget_diagnostic(diag), attr_span);
      break;
    }
    case "Error":
      cx.shared.cx.dcx().emit_err(InvalidTarget_diagnostic(diag));
      break;
  }
};

// PORT: the pattern `&AllowedTargets::AllowList(&[Allow(Target::Crate)])` (one element).
function is_allow_crate_only(list: readonly Policy[]): boolean {
  return list.length === 1 && list[0]!.$ === "Allow" && list[0]!._0.$ === "Crate";
}

// rustc: compiler/rustc_attr_parsing/src/target_checking.rs:188 target_checking_help
function target_checking_help(attribute_args: string, cx: AcceptContext): InvalidTargetHelp | undefined {
  const segments = cx.attr_path.segments;
  if (segments.length === 1 && segments[0] === sym.link_name && cx.shared.target.$ === "Static") {
    const needs_unsafe_wrapper = cx.attr_safety.$ === "Default";

    return {
      $: "UseExportName",
      unsafe_open: needs_unsafe_wrapper ? Span.shrink_to_lo(cx.inner_span) : undefined,
      name: cx.attr_path.span,
      unsafe_close: needs_unsafe_wrapper ? Span.shrink_to_hi(cx.inner_span) : undefined,
    };
  } else if (segments.length === 1 && segments[0] === sym.repr && attribute_args === "(align(...))") {
    const target = cx.shared.target;
    if ((target.$ === "Fn" || target.$ === "Method") && cx.shared.cx.features().fn_align()) {
      return { $: "UseRustcAlign" };
    } else if (target.$ === "Static" && cx.shared.cx.features().static_align()) {
      return { $: "UseRustcAlignStatic" };
    } else {
      return undefined;
    }
  } else {
    return undefined;
  }
}
AttributeParser.target_checking_help = target_checking_help;

// rustc: compiler/rustc_attr_parsing/src/target_checking.rs:215 check_crate_level
AttributeParser.check_crate_level = function (cx: AcceptContext, warn: boolean): void {
  if (cx.shared.target.$ === "Crate") {
    return;
  }

  const name = display_AttrPath(cx.attr_path);
  const is_used_as_inner = cx.attr_style === ("Inner" satisfies AttrStyle);
  const target_span = cx.shared.target_span;
  const attr_span = cx.attr_span;

  let show_crate_root_help = false;
  let crate_root_path = "";
  const src = is_used_as_inner ? cx.shared.cx.sess_.local_crate_source_file() : undefined;
  if (src !== undefined && !FileName_eq(cx.shared.cx.sess_.source_map().span_to_filename(attr_span), { $: "Real", _0: src })) {
    // PORT: `PathBuf::display().to_string()` of a UTF-8 path is the path itself.
    [show_crate_root_help, crate_root_path] = [true, src.path(RemapPathScopeComponents.DIAGNOSTICS)];
  }

  const diag = {
    name,
    is_used_as_inner,
    target_span: !is_used_as_inner ? target_span : undefined,
    target: Target.name(cx.shared.target),
    crate_root_path,
    show_crate_root_help,
    span: attr_span,
  };
  if (warn) {
    cx.shared.emit_lint(UNUSED_ATTRIBUTES, InvalidAttrStyle_diagnostic(diag), attr_span);
  } else {
    cx.shared.emit_err(InvalidAttrStyle_diagnostic(diag));
  }
};

// FIXME: Fix "Cannot determine resolution" error and remove built-in macros
// from this check.
// rustc: compiler/rustc_attr_parsing/src/target_checking.rs:257 check_invalid_crate_level_attr_item
AttributeParser.prototype.check_invalid_crate_level_attr_item = function (this: AttributeParser, attr: AttrItem, inner_span: Span): void {
  // Check for builtin attributes at the crate level
  // which were unsuccessfully resolved due to cannot determine
  // resolution for the attribute macro error.
  const ATTRS_TO_CHECK: readonly Symbol[] = [sym.derive, sym.test, sym.test_case, sym.global_allocator, sym.bench];

  // FIXME(jdonszelmann): all attrs should be combined here cleaning this up some day.
  const name_ = ATTRS_TO_CHECK.find((attr_to_check) => attr.path.segments.length === 1 && attr.path.segments[0] === attr_to_check);
  if (name_ !== undefined) {
    const span = attr.span;
    const name = name_;

    const next = this.first_line_of_next_item(span);
    const item: ItemFollowingInnerAttr | undefined = next === undefined ? undefined : { span: next };

    const err = this.dcx().create_err(
      InvalidAttrAtCrateLevel_diagnostic({
        span,
        pound_to_opening_bracket: Span.until(span, inner_span),
        name,
        item,
      }),
    );

    this.dcx().try_steal_replace_and_emit_err(attr.path.span, StashKey.UndeterminedMacroResolution, err);
  }
};

// rustc: compiler/rustc_attr_parsing/src/target_checking.rs:286 first_line_of_next_item
AttributeParser.prototype.first_line_of_next_item = function (this: AttributeParser, span: Span): Span | undefined {
  // We can't exactly call `tcx.hir_free_items()` here because it's too early and querying
  // this would create a circular dependency. Instead, we resort to getting the original
  // source code that follows `span` and find the next item from here.

  const r = this.sess()
    .source_map()
    .span_to_source(span, (content: Str, _: number, span_end: number) => {
      let source = content.slice(span_end);
      const initial_source_len = source.len();
      // PORT: the `try { loop { .. } }` block; `?` on `None` leaves it with `None`.
      const span_ = ((): Span | undefined => {
        for (;;) {
          const first = source.chars().next();
          if (first === undefined) return undefined;

          if (is_whitespace(first)) {
            const split_idx = find_char(source, (c) => !is_whitespace(c));
            if (split_idx === undefined) return undefined;
            source = source.slice(split_idx);
          } else if (source.starts_with("//")) {
            const line_idx = source.find("\n");
            if (line_idx === undefined) return undefined;
            source = source.slice(line_idx + 1);
          } else if (source.starts_with("/*")) {
            // FIXME: support nested comments.
            const close_idx = source.find("*/");
            if (close_idx === undefined) return undefined;
            source = source.slice(close_idx + 2);
          } else if (first === 0x23 /* '#' */) {
            // FIXME: properly find the end of the attributes in order to accurately
            // skip them. This version just consumes the source code until the next
            // `]`.
            const close_idx = source.find("]");
            if (close_idx === undefined) return undefined;
            source = source.slice(close_idx + 1);
          } else {
            const lo = span_end + initial_source_len - source.len();
            // `source.split('\n').next().map(|s| s.trim_end())`
            const nl = source.find("\n");
            const last_line_len = trim_end_len(source.slice(0, nl ?? source.len()));

            const hi = lo + last_line_len;
            const next_item_span = Span.new(BytePos(lo), BytePos(hi), Span.ctxt(span), undefined);

            return next_item_span;
          }
        }
      })();

      return Ok(span_);
    });
  return r.$ === "Ok" ? r._0 : undefined;
};

// PORT: `str::find(|c: char| ..)`: byte offset of the first char matching `pred`.
function find_char(s: Str, pred: (c: number) => boolean): number | undefined {
  const it = s.chars();
  for (;;) {
    const at = s.len() - it.rest_len();
    const c = it.next();
    if (c === undefined) return undefined;
    if (pred(c)) return at;
  }
}

// PORT: `str::trim_end().len()`: the byte length without trailing `char::is_whitespace` chars.
function trim_end_len(s: Str): number {
  const it = s.chars();
  let end = 0;
  for (;;) {
    const c = it.next();
    if (c === undefined) return end;
    if (!is_whitespace(c)) end = s.len() - it.rest_len();
  }
}

// rustc: compiler/rustc_attr_parsing/src/target_checking.rs:336 check_invalid_where_predicate_attrs
AttributeParser.prototype.check_invalid_where_predicate_attrs = function (this: AttributeParser, attrs: Iterable<Attribute>): void {
  // FIXME(where_clause_attrs): Currently, as the following check shows,
  // only `#[cfg]` and `#[cfg_attr]` are allowed, but it should be removed
  // if we allow more attributes (e.g., tool attributes and `allow/deny/warn`)
  // in where clauses. After that, this function would become useless.
  const spans: Span[] = [];
  for (const attr of attrs) {
    let s: Span | undefined;
    if (attr.$ === "Parsed") {
      const k = attr._0;
      if (k.$ === "DocComment") s = k.span;
      // FIXME: We shouldn't need to special-case `doc`!
      else if (k.$ === "Doc") s = k._0.first_span;
      // Checked during attribute parsing target checking
      else s = undefined;
    } else {
      s = attr._0.span;
    }
    if (s !== undefined) spans.push(s);
  }
  if (spans.length !== 0) {
    this.dcx().emit_err(UnsupportedAttributesInWhere_diagnostic({ span: MultiSpan.from_spans(spans) }));
  }
};

/// Takes a list of `allowed_targets` for an attribute, and the `target` the attribute was applied to.
/// Does some heuristic-based filtering to remove uninteresting targets, and formats the targets into a string
// rustc: compiler/rustc_attr_parsing/src/target_checking.rs:366 allowed_targets_applied
export function allowed_targets_applied(allowed_targets: Target[], target: Target, features: Features | undefined): [string[], boolean] {
  // Remove unstable targets from `allowed_targets` if their features are not enabled
  if (features !== undefined) {
    if (!features.fn_delegation()) {
      allowed_targets = allowed_targets.filter((t) => !(t.$ === "Delegation"));
    }
    if (!features.stmt_expr_attributes()) {
      allowed_targets = allowed_targets.filter((t) => !(t.$ === "Expression" || t.$ === "Statement"));
    }
    if (!features.extern_types()) {
      allowed_targets = allowed_targets.filter((t) => !(t.$ === "ForeignTy"));
    }
  }

  // We define groups of "similar" targets.
  // If at least two of the targets are allowed, and the `target` is not in the group,
  // we collapse the entire group to a single entry to simplify the target list
  const FUNCTION_LIKE: readonly Target[] = [
    Target.Fn,
    Target.Closure,
    Target.ForeignFn,
    { $: "Method", _0: MethodKind.Inherent },
    { $: "Method", _0: { $: "Trait", body: false } },
    { $: "Method", _0: { $: "Trait", body: true } },
    { $: "Method", _0: MethodKind.TraitImpl },
  ];
  const FUNCTION_WITH_BODY_LIKE: readonly Target[] = [
    Target.Fn,
    Target.Closure,
    { $: "Method", _0: MethodKind.Inherent },
    { $: "Method", _0: { $: "Trait", body: true } },
    { $: "Method", _0: MethodKind.TraitImpl },
  ];
  const METHOD_LIKE: readonly Target[] = [
    { $: "Method", _0: MethodKind.Inherent },
    { $: "Method", _0: { $: "Trait", body: false } },
    { $: "Method", _0: { $: "Trait", body: true } },
    { $: "Method", _0: MethodKind.TraitImpl },
  ];
  const IMPL_LIKE: readonly Target[] = [
    { $: "Impl", of_trait: false },
    { $: "Impl", of_trait: true },
  ];
  const ADT_LIKE: readonly Target[] = [Target.Struct, Target.Enum, Target.Union];

  const added_fake_targets: string[] = [];
  const at = { value: allowed_targets };
  filter_targets(at, FUNCTION_LIKE, "functions", target, added_fake_targets);
  filter_targets(at, FUNCTION_WITH_BODY_LIKE, "functions with a body", target, added_fake_targets);
  filter_targets(at, METHOD_LIKE, "methods", target, added_fake_targets);
  filter_targets(at, IMPL_LIKE, "impl blocks", target, added_fake_targets);
  filter_targets(at, ADT_LIKE, "data types", target, added_fake_targets);
  allowed_targets = at.value;

  const target_strings: string[] = [...added_fake_targets, ...allowed_targets.map((t) => Target.plural_name(t))];

  // ensure a consistent order
  // PORT: `Vec<String>::sort` compares bytes; the strings are ASCII, so UTF-16 order is the same.
  target_strings.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  // `dedup`
  const deduped = target_strings.filter((s, i) => i === 0 || s !== target_strings[i - 1]);

  // If there is now only 1 target left, show that as the only possible target
  const only_target = deduped.length === 1;

  return [deduped, only_target];
}

// rustc: compiler/rustc_attr_parsing/src/target_checking.rs:449 filter_targets
function filter_targets(
  allowed_targets: { value: Target[] },
  target_group: readonly Target[],
  target_group_name: string,
  target: Target,
  added_fake_targets: string[],
): void {
  const in_group = (t: Target) => target_group.some((g) => Target_eq(g, t));
  if (in_group(target)) {
    return;
  }
  if (allowed_targets.value.filter((at) => in_group(at)).length < 2) {
    return;
  }
  allowed_targets.value = allowed_targets.value.filter((t) => !in_group(t));
  added_fake_targets.push(target_group_name);
}

declare module "./context.ts" {
  interface AcceptContext {
    check_target(attribute_args: string, allowed_targets: AllowedTargets): void;
    ignore_target_checks(): void;
  }
}

// rustc: compiler/rustc_attr_parsing/src/target_checking.rs:467 check_target
AcceptContext.prototype.check_target = function (this: AcceptContext, attribute_args: string, allowed_targets: AllowedTargets): void {
  this.ignore_target_checks();
  AttributeParser.check_target(allowed_targets, attribute_args, this);
};

// rustc: compiler/rustc_attr_parsing/src/target_checking.rs:476 ignore_target_checks
AcceptContext.prototype.ignore_target_checks = function (this: AcceptContext): void {
  // #[cfg(debug_assertions)]
  // {
  //     self.has_target_been_checked = true;
  // }
};

/// This is the list of all targets to which a attribute can be applied
/// This is used for:
/// - `rustc_dummy`, which can be applied to all targets
/// - Attributes that are not parted to the new target system yet can use this list as a placeholder
export const ALL_TARGETS: readonly Policy[] = [
  Allow(Target.ExternCrate),
  Allow(Target.Use),
  Allow(Target.Static),
  Allow(Target.Const),
  Allow(Target.Fn),
  Allow(Target.Closure),
  Allow(Target.Mod),
  Allow(Target.ForeignMod),
  Allow(Target.GlobalAsm),
  Allow(Target.TyAlias),
  Allow(Target.Enum),
  Allow(Target.Variant),
  Allow(Target.Struct),
  Allow(Target.Field),
  Allow(Target.Union),
  Allow(Target.Trait),
  Allow(Target.TraitAlias),
  Allow({ $: "Impl", of_trait: false }),
  Allow({ $: "Impl", of_trait: true }),
  Allow(Target.Expression),
  Allow(Target.Statement),
  Allow(Target.Arm),
  Allow({ $: "AssocConst", _0: { $: "Impl", of_trait: false } }),
  Allow({ $: "AssocConst", _0: AssocCtxt.Trait }),
  Allow({ $: "AssocConst", _0: { $: "Impl", of_trait: true } }),
  Allow({ $: "Method", _0: MethodKind.Inherent }),
  Allow({ $: "Method", _0: { $: "Trait", body: false } }),
  Allow({ $: "Method", _0: { $: "Trait", body: true } }),
  Allow({ $: "Method", _0: MethodKind.TraitImpl }),
  Allow({ $: "AssocTy", _0: { $: "Impl", of_trait: false } }),
  Allow({ $: "AssocTy", _0: AssocCtxt.Trait }),
  Allow({ $: "AssocTy", _0: { $: "Impl", of_trait: true } }),
  Allow(Target.ForeignFn),
  Allow(Target.ForeignStatic),
  Allow(Target.ForeignTy),
  Allow(Target.MacroDef),
  Allow(Target.Param),
  Allow(Target.PatField),
  Allow(Target.ExprField),
  Allow(Target.WherePredicate),
  Allow(Target.MacroCall),
  Allow(Target.Crate),
  Allow({ $: "Delegation", mac: false }),
  Allow({ $: "Delegation", mac: true }),
  Allow(Target.ConstParam),
  Allow(Target.LifetimeParam),
  Allow(Target.TypeParam),
  Allow(Target.Loop),
  Allow(Target.ForLoop),
  Allow(Target.While),
  Allow(Target.Break),
];
