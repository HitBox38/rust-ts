// Port of compiler/rustc_passes/src/check_attr.rs (lane passes-b)
// FIXME(jdonszelmann): should become rustc_attr_validation
//! This module implements some validity checks for attributes.
//! In particular it verifies that `#[inline]` and `#[repr]` attributes are
//! attached to items that actually support them and if there are
//! conflicts between multiple such attributes attached to the same
//! item.
//
// PORT: the file-local `#[derive(Diagnostic)] DiagnosticOnConstOnlyForNonConstTraitImpls` is generated into
// check_attr.gen.ts (tools/codegen/types.ts, set `rustc_passes_check_attr`). `ProcMacroKind` (a fieldless enum with a
// manual `IntoDiagArg`) and `CheckAttrVisitor` are hand-written here. `CheckAttrVisitor` extends rustc_hir intravisit's
// `Visitor` (`type NestedFilter = nested_filter::OnlyBodies`); its `abort: Cell<bool>` is a mutable field.
// `find_attr!(attrs, Pat => e)` is `find_attr(attrs, (k) => ...)` (rustc_attr_ir/lib.ts); the `find_attr!(tcx, id, ..)`
// form goes through the `HasAttrs_*` tables of rustc_middle/ty/mod.ts.
import "../rustc_trait_selection/lib.ts";
import { FnRetTy } from "../rustc_hir/hir.ts";
import { TraitErrors } from "../rustc_infer/traits/engine.ts";
import { ToTrace_FnSig } from "../rustc_infer/infer/at.ts";
import { ObligationCause } from "../rustc_middle/traits/mod.ts";
import { ParamEnv, Ty } from "../rustc_middle/ty/mod.ts";
import { fold_Ty } from "../rustc_middle/ty/structural_impls.ts";
import { ObligationCtxt } from "../rustc_trait_selection/traits/engine.ts";
import { err_ctxt } from "../rustc_trait_selection/traits/mod.ts";
import { Binder, EarlyBinder, fold_Binder } from "../rustc_type_ir/binder.ts";
import { TypingMode } from "../rustc_type_ir/infer_ctxt.ts";
import { FnSig, fold_FnSig } from "../rustc_type_ir/ty_kind.ts";
import type { PolyFnSig } from "../rustc_type_ir/decls.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import type { MetaItemInner } from "../rustc_ast/lib.ts";
import { MetaItemInner as MetaItemInnerC } from "../rustc_ast/attr/mod.ts";
import { ExternAbi } from "../rustc_abi/extern_abi.ts";
import type { Directive } from "../rustc_attr_ir/diagnostic.ts";
import { Attribute, type AttributeKind, type DocAttribute, type EiiImpl, find_attr, type InlineAttr, type ReprAttr } from "../rustc_attr_ir/lib.ts";
import { IntTy_discriminant, UintTy_discriminant } from "../rustc_ast_ir/lib.gen.ts";
import { display_Target, MethodKind, Target } from "../rustc_attr_ir/target.ts";
import { AttributeParser } from "../rustc_attr_parsing/lib.ts";
import { str_into_diag_arg } from "../rustc_error_messages/diagnostic_impls.ts";
import type { DiagArgValue, DiagCtxtHandle } from "../rustc_errors/lib.ts";
import { BUILTIN_ATTRIBUTE_SET } from "../rustc_feature/builtin_attrs.ts";
import {
  Visitor,
  walk_arm,
  walk_expr,
  walk_expr_field,
  walk_field_def,
  walk_foreign_item,
  walk_generic_param,
  walk_impl_item,
  walk_item,
  walk_param,
  walk_pat_field,
  walk_stmt,
  walk_trait_item,
  walk_variant,
  walk_where_predicate,
} from "../rustc_hir/intravisit.ts";
import type { HirTyCtxt } from "../rustc_hir/intravisit.ts";
import type * as hir from "../rustc_hir/lib.ts";
import { Node } from "../rustc_hir/hir.ts";
import { Defaultness } from "../rustc_hir/hir.ts";
import { Target_from_ForeignItem, Target_from_GenericParam, Target_from_Item, Target_from_TraitItem } from "../rustc_hir/target_impls.ts";
import { CRATE_HIR_ID, HirId_eq, type HirId } from "../rustc_hir_id/lib.ts";
import {
  CONFLICTING_REPR_HINTS,
  INVALID_DOC_ATTRIBUTES,
  MALFORMED_DIAGNOSTIC_ATTRIBUTES,
  MALFORMED_DIAGNOSTIC_FORMAT_LITERALS,
  MISPLACED_DIAGNOSTIC_ATTRIBUTES,
  REPEATED_REPRS,
  UNUSED_ATTRIBUTES,
} from "../rustc_lint_defs/builtin.gen.ts";
import { TyCtxt_as_HirTyCtxt } from "../rustc_middle/hir/map.ts";
import { OnlyBodies } from "../rustc_middle/hir/nested_filter.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { AssocItem, AssocItems } from "../rustc_middle/ty/assoc.ts";
import { HasAttrs_DefId, HasAttrs_HirId } from "../rustc_middle/ty/mod.ts";
import { feature_err } from "../rustc_session/diagnostics.ts";
import { Edition, Edition_discriminant } from "../rustc_span/edition.ts";
import { LocalDefId, LocalModId, type DefId } from "../rustc_span/def_id.ts";
import { DUMMY_SP, Span } from "../rustc_span/lib.ts";
import { bug, span_bug } from "../rustc_span/macros.ts";
import { debug_Symbol, type Ident, kw, sym, type Symbol } from "../rustc_span/symbol.ts";
import { PLAIN } from "../std/fmt.ts";
import type { MutRef } from "../std/mut_ref.ts";
import type { PathBuf } from "../rustc_error_messages/lib.ts";
import { unported, unreachable, unwrap } from "../std/panic.ts";
import { DiagnosticOnConstOnlyForNonConstTraitImpls_diagnostic } from "./check_attr.gen.ts";
import * as diagnostics from "./diagnostics.ts";

export * from "./check_attr.gen.ts";

// rustc: compiler/rustc_passes/src/check_attr.rs:60 target_from_impl_item
function target_from_impl_item(tcx: TyCtxt, impl_item: hir.ImplItem): Target {
  switch (impl_item.kind.$) {
    case "Const": {
      const parent_def_id = tcx.hir_get_parent_item(impl_item.hir_id()).def_id;
      const containing_item = tcx.hir_expect_item(parent_def_id);
      let of_trait: boolean;
      if (containing_item.kind.$ === "Impl") {
        const impl_ = containing_item.kind._0;
        of_trait = impl_.of_trait !== undefined;
      } else {
        return bug("parent of an ImplItem must be an Impl");
      }
      return { $: "AssocConst", _0: { $: "Impl", of_trait } };
    }
    case "Fn": {
      const parent_def_id = tcx.hir_get_parent_item(impl_item.hir_id()).def_id;
      const containing_item = tcx.hir_expect_item(parent_def_id);
      let containing_impl_is_for_trait: boolean;
      if (containing_item.kind.$ === "Impl") {
        const impl_ = containing_item.kind._0;
        containing_impl_is_for_trait = impl_.of_trait !== undefined;
      } else {
        return bug("parent of an ImplItem must be an Impl");
      }
      if (containing_impl_is_for_trait) {
        return { $: "Method", _0: MethodKind.TraitImpl };
      } else {
        return { $: "Method", _0: MethodKind.Inherent };
      }
    }
    case "Type": {
      const parent_def_id = tcx.hir_get_parent_item(impl_item.hir_id()).def_id;
      const containing_item = tcx.hir_expect_item(parent_def_id);
      let of_trait: boolean;
      if (containing_item.kind.$ === "Impl") {
        const impl_ = containing_item.kind._0;
        of_trait = impl_.of_trait !== undefined;
      } else {
        return bug("parent of an ImplItem must be an Impl");
      }
      return { $: "AssocTy", _0: { $: "Impl", of_trait } };
    }
  }
}

// rustc-type: compiler/rustc_passes/src/check_attr.rs:97 ProcMacroKind
/** `#[derive(Copy, Clone)]` */
export type ProcMacroKind = "FunctionLike" | "Derive" | "Attribute";
export const ProcMacroKind = { FunctionLike: "FunctionLike", Derive: "Derive", Attribute: "Attribute" } as const;

// impl IntoDiagArg for ProcMacroKind
// rustc: compiler/rustc_passes/src/check_attr.rs:104 into_diag_arg
export function ProcMacroKind_into_diag_arg(self: ProcMacroKind, _: MutRef<PathBuf | undefined>): DiagArgValue {
  let s: string;
  switch (self) {
    case "Attribute":
      s = "attribute proc macro";
      break;
    case "Derive":
      s = "derive proc macro";
      break;
    case "FunctionLike":
      s = "function-like proc macro";
      break;
  }
  return str_into_diag_arg(s, { value: undefined });
}

// rustc-type: compiler/rustc_passes/src/check_attr.rs:115 CheckAttrVisitor
class CheckAttrVisitor extends Visitor {
  // impl<'tcx> Visitor<'tcx> for CheckAttrVisitor<'tcx>
  // type NestedFilter = nested_filter::OnlyBodies;
  override NestedFilter = OnlyBodies;

  constructor(
    public tcx: TyCtxt,
    // Whether or not this visitor should abort after finding errors
    public abort: boolean,
  ) {
    super();
  }

  // ---- impl<'tcx> CheckAttrVisitor<'tcx> ----

  // rustc: compiler/rustc_passes/src/check_attr.rs:122 dcx
  dcx(): DiagCtxtHandle {
    return this.tcx.dcx();
  }

  /// Checks any attribute.
  // rustc: compiler/rustc_passes/src/check_attr.rs:127 check_attributes
  check_attributes(hir_id: HirId, span: Span, target: Target, item: hir.Item | undefined): void {
    const attrs = this.tcx.hir_attrs(hir_id);
    for (const attr of attrs) {
      switch (attr.$) {
        case "Parsed": {
          const attr_kind = attr._0;
          this.check_one_parsed_attribute(hir_id, span, target, item, attr_kind);
          this.check_unused_attribute(hir_id, attr);
          break;
        }
        case "Unparsed": {
          const path = Attribute.path(attr);
          if (path.length > 0 && (path[0] === sym.allow || path[0] === sym.expect || path[0] === sym.warn || path[0] === sym.deny || path[0] === sym.forbid)) {
            // ok
          } else if (path.length > 0) {
            const name = path[0]!;
            const rest = path.slice(1);
            if (BUILTIN_ATTRIBUTE_SET().has(name)) {
              if (rest.length > 0 && AttributeParser.is_parsed_attribute([name])) {
                // Check if we tried to use a builtin attribute as an attribute
                // namespace, like `#[must_use::skip]`. This check is here to
                // solve <https://github.com/rust-lang/rust/issues/137590>.
                // An error is already produced for this case elsewhere.
                return;
              }

              return span_bug(Attribute.span(attr), `builtin attribute ${debug_Symbol(name, PLAIN)} not handled by \`CheckAttrVisitor\``);
            }
          } else {
            return unreachable();
          }

          this.check_unused_attribute(hir_id, attr);
          break;
        }
      }
    }

    this.check_repr(attrs, span, target, item, hir_id);
    this.check_rustc_force_inline(hir_id, attrs, target);
    this.check_mix_no_mangle_export(hir_id, attrs);
    this.check_optimize_and_inline(attrs);
  }

  /// Called by [`Self::check_attributes()`] to check a single attribute which is
  /// [`Attribute::Parsed`].
  ///
  /// This is a separate function to help with comprehensibility and rustfmt-ability.
  // rustc: compiler/rustc_passes/src/check_attr.rs:183 check_one_parsed_attribute
  check_one_parsed_attribute(hir_id: HirId, span: Span, target: Target, item: hir.Item | undefined, attr: AttributeKind): void {
    switch (attr.$) {
      case "ProcMacro":
        this.check_proc_macro(hir_id, target, ProcMacroKind.FunctionLike);
        break;
      case "ProcMacroAttribute":
        this.check_proc_macro(hir_id, target, ProcMacroKind.Attribute);
        break;
      case "ProcMacroDerive":
        this.check_proc_macro(hir_id, target, ProcMacroKind.Derive);
        break;
      case "RustcAllowConstFnUnstable": {
        const first_span = attr._1;
        this.check_rustc_allow_const_fn_unstable(hir_id, first_span, span, target);
        break;
      }
      case "Naked":
        this.check_naked(hir_id, target);
        break;
      case "MayDangle": {
        const attr_span = attr._0;
        this.check_may_dangle(hir_id, attr_span);
        break;
      }
      case "Doc":
        this.check_doc_attrs(attr._0, hir_id, target);
        break;
      case "EiiImpl":
        this.check_eii_impl(attr._0);
        break;
      case "RustcMustImplementOneOf": {
        const { attr_span, fn_names } = attr;
        this.check_rustc_must_implement_one_of(attr_span, fn_names, hir_id, target);
        break;
      }
      case "OnUnimplemented":
        this.check_diagnostic_on_unimplemented(hir_id, attr.directive);
        break;
      case "OnConst":
        this.check_diagnostic_on_const(attr.span, hir_id, target, item, attr.directive);
        break;
      case "OnMove":
        this.check_diagnostic_on_move(hir_id, attr.directive);
        break;
      case "OnTypeError":
        this.check_diagnostic_on_type_error(hir_id, attr.directive);
        break;
      case "Linkage": {
        const span = attr._1;
        this.check_linkage(span, hir_id, target, item);
        break;
      }

      // All of the following attributes have no specific checks.
      // tidy-alphabetical-start
      case "AllowInternalUnsafe":
      case "AllowInternalUnstable":
      case "AlwaysGca":
      case "AutomaticallyDerived":
      case "CfgAttrTrace":
      case "CfgTrace":
      case "CfiEncoding":
      case "Cold":
      case "CollapseDebugInfo":
      case "CompilerBuiltins":
      case "ConstContinue":
      case "Coroutine":
      case "Coverage":
      case "CrateName":
      case "CrateType":
      case "CustomMir":
      case "DebuggerVisualizer":
      case "DefaultLibAllocator":
      case "Deprecated":
      case "DoNotRecommend":
      // `#[doc]` is actually a lot more than just doc comments, so is checked below
      case "DocComment":
      case "EiiDeclaration":
      case "ExportName":
      case "ExportStable":
      case "Feature":
      case "FfiConst":
      case "FfiPure":
      case "Fundamental":
      case "Ignore":
      case "Inline":
      case "InstructionSet":
      case "InstrumentFn":
      case "Lang":
      case "Link":
      case "LinkName":
      case "LinkOrdinal":
      case "LinkSection":
      case "LoopMatch":
      case "MacroEscape":
      case "MacroExport":
      case "MacroUse":
      case "Marker":
      case "MoveSizeLimit":
      case "MustNotSupend":
      case "MustUse":
      case "NeedsAllocator":
      case "NeedsPanicRuntime":
      case "NoBuiltins":
      case "NoCore":
      case "NoImplicitPrelude":
      case "NoLink":
      case "NoMain":
      case "NoMangle":
      case "NoStd":
      case "NonExhaustive":
      case "OnUnknown":
      case "OnUnmatchedArgs":
      case "Opaque":
      case "Optimize":
      case "PanicRuntime":
      case "PatchableFunctionEntry":
        break;
      case "Path": {
        const span = attr._1;
        this.check_path(span, hir_id);
        break;
      }
      case "PatternComplexityLimit":
      case "PinV2":
      case "PreludeImport":
      case "ProfilerRuntime":
      case "RecursionLimit":
      case "ReexportTestHarnessMain":
      case "RegisterTool":
      // handled below this loop and elsewhere
      case "Repr":
      case "RustcAbi":
      case "RustcAlign":
      case "RustcAllocator":
      case "RustcAllocatorZeroed":
      case "RustcAllocatorZeroedVariant":
      case "RustcAllowIncoherentImpl":
      case "RustcAllowLifetimeDependentSpecialization":
      case "RustcAsPtr":
      case "RustcAutodiff":
      case "RustcBodyStability":
      case "RustcBuiltinMacro":
      case "RustcCanonicalSymbol":
      case "RustcCaptureAnalysis":
      case "RustcCguTestAttr":
      case "RustcClean":
      case "RustcCoherenceIsCore":
      case "RustcCoinductive":
      case "RustcComptime":
      case "RustcConfusables":
      case "RustcConstStability":
      case "RustcConstStableIndirect":
      case "RustcConversionSuggestion":
      case "RustcDeallocator":
      case "RustcDelayedBugFromInsideQuery":
      case "RustcDenyExplicitImpl":
      case "RustcDeprecatedSafe2024":
      case "RustcDiagnosticItem":
      case "RustcDoNotConstCheck":
      case "RustcDocPrimitive":
      case "RustcDummy":
      case "RustcDumpClauses":
      case "RustcDumpDefParents":
      case "RustcDumpDefPath":
      case "RustcDumpGenerics":
      case "RustcDumpHiddenTypeOfOpaques":
      case "RustcDumpInferredOutlives":
      case "RustcDumpItemBounds":
      case "RustcDumpLayout":
      case "RustcDumpObjectLifetimeDefaults":
      case "RustcDumpSymbolName":
      case "RustcDumpUserArgs":
      case "RustcDumpVariances":
      case "RustcDumpVariancesOfOpaques":
      case "RustcDumpVtable":
      case "RustcDynIncompatibleTrait":
      case "RustcEffectiveVisibility":
      case "RustcEiiForeignItem":
      case "RustcEvaluateWhereClauses":
      case "RustcHasIncoherentInherentImpls":
      case "RustcIfThisChanged":
      case "RustcInheritOverflowChecks":
      case "RustcInsignificantDtor":
      case "RustcIntrinsic":
      case "RustcIntrinsicConstStableIndirect":
      case "RustcLegacyConstGenerics":
      case "RustcLintOptDenyFieldAccess":
      case "RustcLintOptTy":
      case "RustcLintQueryInstability":
      case "RustcLintUntrackedQueryInformation":
      case "RustcMacroTransparency":
      case "RustcMain":
      case "RustcMir":
      case "RustcMustMatchExhaustively":
      case "RustcNeverReturnsNullPtr":
      case "RustcNoImplicitAutorefs":
      case "RustcNoImplicitBounds":
      case "RustcNoMirInline":
      case "RustcNoWritable":
      case "RustcNonConstTraitMethod":
      case "RustcNonnullOptimizationGuaranteed":
      case "RustcNounwind":
      case "RustcObjcClass":
      case "RustcObjcSelector":
      case "RustcOffloadKernel":
      case "RustcPanicsWhenZero":
      case "RustcParenSugar":
      case "RustcPassByValue":
      case "RustcPassIndirectlyInNonRusticAbis":
      case "RustcPreserveUbChecks":
      case "RustcProcMacroDecls":
      case "RustcPubTransparent":
      case "RustcReallocator":
      case "RustcRegions":
      case "RustcScalableVector":
      case "RustcShouldNotBeCalledOnConstItems":
      case "RustcSimdMonomorphizeLaneLimit":
      case "RustcSkipDuringMethodDispatch":

      case "RustcSpecializationTrait":
      case "RustcStdInternalSymbol":
      case "RustcStrictCoherence":
      case "RustcTestMarker":
      case "RustcThenThisWouldNeed":
      case "RustcTrivialFieldReads":
      case "Sanitize":
      case "ShouldPanic":
      case "Splat":
      case "Stability":
      case "TargetFeature":
      case "TestRunner":
      case "ThreadLocal":
      case "TrackCaller":
      case "TypeLengthLimit":
      case "Unroll":
      case "UnstableFeatureBound":
      case "UnstableRemoved":
      case "Used":
      case "WindowsSubsystem":
        // tidy-alphabetical-end
        break;
      default: {
        const _exhaustive: never = attr;
        return _exhaustive;
      }
    }
  }

  // rustc: compiler/rustc_passes/src/check_attr.rs:413 check_path
  check_path(span: Span, hir_id: HirId): void {
    const node = this.tcx.hir_node(hir_id);
    if (node.$ !== "Item") {
      return;
    }
    const item = node._0;

    if (item.kind.$ !== "Mod") {
      return;
    }
    const module = item.kind._1;

    if (item.span === module.spans.inner_span || !Span.contains(item.span, module.spans.inner_span)) {
      return;
    }

    // Do not warn when a nested module uses `#[path]` or is out-of-line,
    // because the attribute may affect nested module path resolution.
    if (this.has_nested_module_path_dependency(module)) {
      return;
    }

    this.tcx.emit_node_span_lint(
      UNUSED_ATTRIBUTES,
      hir_id,
      span,
      diagnostics.Unused_diagnostic({
        attr_span: span,
        note: diagnostics.UnusedNote.PathOnInlineModule,
      }),
    );
  }

  // rustc: compiler/rustc_passes/src/check_attr.rs:443 has_nested_module_path_dependency
  has_nested_module_path_dependency(module: hir.Mod): boolean {
    return module.item_ids.some((item_id) => {
      const child = this.tcx.hir_item(item_id);

      if (child.kind.$ !== "Mod") {
        return false;
      }
      const child_module = child.kind._1;

      const is_out_of_line = child.span === child_module.spans.inner_span || !Span.contains(child.span, child_module.spans.inner_span);

      const has_path_attr = find_attr(HasAttrs_HirId.get_attrs(child.hir_id(), this.tcx), (k) => (k.$ === "Path" ? null : undefined)) !== undefined;

      return is_out_of_line || has_path_attr || this.has_nested_module_path_dependency(child_module);
    });
  }

  // rustc: compiler/rustc_passes/src/check_attr.rs:460 check_rustc_must_implement_one_of
  check_rustc_must_implement_one_of(attr_span: Span, list: readonly Ident[], hir_id: HirId, target: Target): void {
    // Ignoring invalid targets because TyCtxt::associated_items emits bug if the target isn't valid
    // the parser has already produced an error for the target being invalid
    if (!(target.$ === "Trait")) {
      return;
    }

    const def_id = hir_id.owner.def_id;

    const items = this.tcx.associated_items(def_id) as AssocItems;
    // Check that all arguments of `#[rustc_must_implement_one_of]` reference
    // functions in the trait with default implementations
    for (const ident of list) {
      let item: AssocItem | undefined;
      for (const i of AssocItems.filter_by_name_unhygienic(items, ident.name)) {
        if (AssocItem.ident(i, this.tcx).eq(ident)) {
          item = i;
          break;
        }
      }

      if (item !== undefined && item.kind.$ === "Fn") {
        if (!Defaultness.has_value(AssocItem.defaultness(item, this.tcx))) {
          this.tcx.dcx().emit_err(
            diagnostics.FunctionNotHaveDefaultImplementation_diagnostic({
              span: this.tcx.def_span(item.def_id),
              note_span: attr_span,
            }),
          );
        }
      } else if (item !== undefined) {
        this.dcx().emit_err(
          diagnostics.MustImplementNotFunction_diagnostic({
            span: this.tcx.def_span(item.def_id),
            span_note: {
              span: attr_span,
            },
            note: {},
          }),
        );
      } else {
        this.dcx().emit_err(diagnostics.FunctionNotFoundInTrait_diagnostic({ span: ident.span }));
      }
    }
  }

  /// Checks that each externally implementable item (EII) implementation uses `unsafe`
  /// exactly when its declaration requires it.
  // rustc: compiler/rustc_passes/src/check_attr.rs:512 check_eii_impl
  check_eii_impl(eii_impl: EiiImpl): void {
    const { span, inner_span, resolution, impl_unsafe_span } = eii_impl;
    let impl_unsafe: boolean | undefined;
    switch (resolution.$) {
      case "Macro": {
        const eii_macro = resolution._0;
        impl_unsafe = find_attr(HasAttrs_DefId.get_attrs(eii_macro, this.tcx), (k) => (k.$ === "EiiDeclaration" ? k._0.impl_unsafe : undefined));
        break;
      }
      case "Known": {
        const foreign_item_did = resolution._0;
        // PORT: the query value is typed `unknown` (queries.gen.ts); upstream it is
        // `FxIndexMap<DefId, (EiiDecl, FxIndexMap<DefId, EiiImpl>)>`.
        const map = this.tcx.externally_implementable_items(foreign_item_did.krate) as { get(k: DefId): [{ impl_unsafe: boolean }, unknown] | undefined };
        const e = map.get(foreign_item_did);
        impl_unsafe = e === undefined ? undefined : e[0].impl_unsafe;
        break;
      }
      case "Error":
        impl_unsafe = undefined;
        break;
    }
    if (impl_unsafe === undefined) {
      return;
    }
    const needs_unsafe = impl_unsafe;

    let name: Symbol;
    switch (resolution.$) {
      case "Macro": {
        const eii_macro = resolution._0;
        name = this.tcx.item_name(eii_macro);
        break;
      }
      case "Known": {
        const def_id = resolution._0;
        name = this.tcx.item_name(def_id);
        break;
      }
      case "Error":
        return unreachable();
    }

    if (needs_unsafe === true && impl_unsafe_span === undefined) {
      this.dcx().emit_err(
        diagnostics.EiiImplRequiresUnsafe_diagnostic({
          span,
          name,
          suggestion: {
            left: Span.shrink_to_lo(inner_span),
            right: Span.shrink_to_hi(inner_span),
          },
        }),
      );
    } else if (needs_unsafe === false && impl_unsafe_span !== undefined) {
      const unsafe_span = impl_unsafe_span;
      this.dcx().emit_err(
        diagnostics.EiiImplCannotBeUnsafe_diagnostic({
          impl_span: span,
          unsafe_span,
          name,
        }),
      );
    } else {
      // _ => {}
    }
  }

  /// Checks use of generic formatting parameters in `#[diagnostic::on_unimplemented]`
  // rustc: compiler/rustc_passes/src/check_attr.rs:560 check_diagnostic_on_unimplemented
  check_diagnostic_on_unimplemented(hir_id: HirId, directive: Directive | undefined): void {
    if (directive !== undefined) {
      const node = this.tcx.hir_node(hir_id);
      if (node.$ === "Item" && node._0.kind.$ === "Trait") {
        const { ident: trait_name, generics } = node._0.kind;
        directive.visit_params((argument_name, span) => {
          const has_generic = generics.params.some((p) => {
            if (p.kind.$ !== "Lifetime" && p.name.$ === "Plain" && p.name._0.name === argument_name) {
              return true;
            } else {
              return false;
            }
          });
          if (!has_generic) {
            this.tcx.emit_node_span_lint(
              MALFORMED_DIAGNOSTIC_FORMAT_LITERALS,
              hir_id,
              span,
              diagnostics.UnknownFormatParameterForOnUnimplementedAttr_diagnostic({
                argument_name,
                trait_name,
                help: !directive.is_rustc_attr,
              }),
            );
          }
        });
      }
    }
  }

  /// Checks if `#[diagnostic::on_const]` is applied to a on-const trait impl
  // rustc: compiler/rustc_passes/src/check_attr.rs:596 check_diagnostic_on_const
  check_diagnostic_on_const(attr_path_span: Span, hir_id: HirId, target: Target, item: hir.Item | undefined, directive: Directive | undefined): void {
    // We only check the non-constness here. A diagnostic for use
    // on not-trait impl items is issued during attribute parsing.
    if (target.$ === "Impl" && target.of_trait === true) {
      let node: Node | undefined;
      if (directive !== undefined && (node = this.tcx.hir_node(hir_id)).$ === "Item" && node._0.kind.$ === "Impl") {
        const { generics } = node._0.kind._0;
        directive.visit_params((argument_name, span) => {
          const has_generic = generics.params.some((p) => {
            if (p.kind.$ !== "Lifetime" && p.name.$ === "Plain" && p.name._0.name === argument_name) {
              return true;
            } else {
              return false;
            }
          });
          if (!has_generic) {
            this.tcx.emit_node_span_lint(
              MALFORMED_DIAGNOSTIC_FORMAT_LITERALS,
              hir_id,
              span,
              diagnostics.OnConstMalformedFormatLiterals_diagnostic({ name: argument_name }),
            );
          }
        });
      }
      switch (unwrap(item).expect_impl().constness.$) {
        case "Const": {
          const item_span = this.tcx.hir_span(hir_id);
          this.tcx.emit_node_span_lint(
            MISPLACED_DIAGNOSTIC_ATTRIBUTES,
            hir_id,
            attr_path_span,
            DiagnosticOnConstOnlyForNonConstTraitImpls_diagnostic({ item_span }),
          );
          return;
        }
        case "NotConst":
          return;
      }
    }
  }

  /// Checks use of generic formatting parameters in `#[diagnostic::on_move]`
  // rustc: compiler/rustc_passes/src/check_attr.rs:649 check_diagnostic_on_move
  check_diagnostic_on_move(hir_id: HirId, directive: Directive | undefined): void {
    if (directive !== undefined) {
      const node = this.tcx.hir_node(hir_id);
      if (node.$ === "Item" && (node._0.kind.$ === "Struct" || node._0.kind.$ === "Enum" || node._0.kind.$ === "Union")) {
        const generics = node._0.kind._1;
        directive.visit_params((argument_name, span) => {
          const has_generic = generics.params.some((p) => {
            if (p.kind.$ !== "Lifetime" && p.name.$ === "Plain" && p.name._0.name === argument_name) {
              return true;
            } else {
              return false;
            }
          });
          if (!has_generic) {
            this.tcx.emit_node_span_lint(
              MALFORMED_DIAGNOSTIC_FORMAT_LITERALS,
              hir_id,
              span,
              diagnostics.OnMoveMalformedFormatLiterals_diagnostic({ name: argument_name }),
            );
          }
        });
      }
    }
  }

  // rustc: compiler/rustc_passes/src/check_attr.rs:683 check_diagnostic_on_type_error
  check_diagnostic_on_type_error(hir_id: HirId, directive: Directive | undefined): void {
    if (directive !== undefined) {
      const node = this.tcx.hir_node(hir_id);
      if (node.$ === "Item" && (node._0.kind.$ === "Struct" || node._0.kind.$ === "Enum" || node._0.kind.$ === "Union")) {
        const generics = node._0.kind._1;
        const generic_count = generics.params.filter((p) => !(p.kind.$ === "Lifetime")).length;

        // Enforce: at most one generic
        if (generic_count !== 1) {
          this.tcx.emit_node_span_lint(
            MALFORMED_DIAGNOSTIC_ATTRIBUTES,
            hir_id,
            generics.span,
            diagnostics.OnTypeErrorNotExactlyOneGeneric_diagnostic({ count: generic_count }),
          );
        }

        directive.visit_params((argument_name, span) => {
          const has_generic = generics.params.some((p) => {
            if (p.kind.$ !== "Lifetime" && p.name.$ === "Plain" && p.name._0.name === argument_name) {
              return true;
            } else {
              return false;
            }
          });

          const is_allowed = argument_name === sym.Expected || argument_name === sym.Found;
          if (!(has_generic || is_allowed)) {
            this.tcx.emit_node_span_lint(
              MALFORMED_DIAGNOSTIC_FORMAT_LITERALS,
              hir_id,
              span,
              diagnostics.OnTypeErrorMalformedFormatLiterals_diagnostic({ name: argument_name }),
            );
          }
        });
      }
    }
  }

  /// Checks if `#[naked]` is applied to a function definition.
  // rustc: compiler/rustc_passes/src/check_attr.rs:736 check_naked
  check_naked(hir_id: HirId, target: Target): void {
    if (
      target.$ === "Fn" ||
      (target.$ === "Method" && ((target._0.$ === "Trait" && target._0.body === true) || target._0.$ === "TraitImpl" || target._0.$ === "Inherent"))
    ) {
      const fn_sig = unwrap(Node.fn_sig(this.tcx.hir_node(hir_id)));
      const abi = fn_sig.header.abi;
      if (ExternAbi.is_rustic_abi(abi) && !this.tcx.features().naked_functions_rustic_abi()) {
        feature_err(this.tcx.sess, sym.naked_functions_rustic_abi, fn_sig.span, `\`#[naked]\` is currently unstable on \`extern "${ExternAbi.as_str(abi)}"\` functions`).emit();
      }
    } else {
      // _ => {}
    }
  }

  // rustc: compiler/rustc_passes/src/check_attr.rs:761 check_doc_alias_value
  check_doc_alias_value(span: Span, hir_id: HirId, target: Target, alias: Symbol): void {
    let location: string | undefined;
    switch (target.$) {
      case "AssocTy": {
        if (this.tcx.def_kind(this.tcx.local_parent(hir_id.owner.def_id)).$ === "Impl") {
          location = "type alias in implementation block";
        } else {
          location = undefined;
        }
        break;
      }
      case "AssocConst": {
        const parent_def_id = this.tcx.hir_get_parent_item(hir_id).def_id;
        const containing_item = this.tcx.hir_expect_item(parent_def_id);
        // We can't link to trait impl's consts.
        const err = "associated constant in trait implementation block";
        if (containing_item.kind.$ === "Impl" && containing_item.kind._0.of_trait !== undefined) {
          location = err;
        } else {
          location = undefined;
        }
        break;
      }
      // we check the validity of params elsewhere
      case "Param":
        return;
      case "Expression":
      case "Statement":
      case "Arm":
      case "ForeignMod":
      case "Closure":
      case "Impl":
      case "WherePredicate":
        location = Target.name(target);
        break;
      case "ExternCrate":
      case "Use":
      case "Static":
      case "Const":
      case "Fn":
      case "Mod":
      case "GlobalAsm":
      case "TyAlias":
      case "Enum":
      case "Variant":
      case "Struct":
      case "Field":
      case "Union":
      case "Trait":
      case "TraitAlias":
      case "Method":
      case "ForeignFn":
      case "ForeignStatic":
      case "ForeignTy":
      case "TypeParam":
      case "LifetimeParam":
      case "ConstParam":
      case "MacroDef":
      case "PatField":
      case "ExprField":
      case "Crate":
      case "MacroCall":
      case "Delegation":
      case "Loop":
      case "ForLoop":
      case "While":
      case "Break":
        location = undefined;
        break;
    }
    if (location !== undefined) {
      this.tcx.dcx().emit_err(diagnostics.DocAliasBadLocation_diagnostic({ span, location }));
      return;
    }
    if (this.tcx.hir_opt_name(hir_id) === alias) {
      this.tcx.dcx().emit_err(diagnostics.DocAliasNotAnAlias_diagnostic({ span, attr_str: alias }));
      return;
    }
  }

  // rustc: compiler/rustc_passes/src/check_attr.rs:833 check_doc_fake_variadic
  check_doc_fake_variadic(span: Span, hir_id: HirId): void {
    const node = this.tcx.hir_node(hir_id);
    const item_kind = node.$ === "Item" ? node._0.kind : undefined;
    if (item_kind !== undefined && item_kind.$ === "Impl") {
      const i = item_kind._0;
      let is_valid: boolean;
      if (doc_fake_variadic_is_allowed_self_ty(i.self_ty)) {
        is_valid = true;
      } else {
        const last_segment = i.of_trait === undefined ? undefined : i.of_trait.trait_ref.path.segments.at(-1);
        const args = last_segment === undefined ? undefined : last_segment.args_().args;
        if (args !== undefined && args.length === 1 && args[0]!.$ === "Type") {
          const ty = args[0]!._0;
          is_valid = ty.kind.$ === "Tup" && ty.kind._0.length === 1;
        } else {
          is_valid = false;
        }
      }
      if (!is_valid) {
        this.dcx().emit_err(diagnostics.DocFakeVariadicNotValid_diagnostic({ span }));
      }
    } else {
      this.dcx().emit_err(diagnostics.DocKeywordOnlyImpl_diagnostic({ span }));
    }
  }

  // rustc: compiler/rustc_passes/src/check_attr.rs:860 check_doc_search_unbox
  check_doc_search_unbox(span: Span, hir_id: HirId): void {
    const node = this.tcx.hir_node(hir_id);
    if (node.$ !== "Item") {
      this.dcx().emit_err(diagnostics.DocSearchUnboxInvalid_diagnostic({ span }));
      return;
    }
    const item = node._0;
    const kind = item.kind;
    if ((kind.$ === "Enum" || kind.$ === "Struct") && kind._1.params.length !== 0) {
      // {}
    } else if (
      kind.$ === "Trait" &&
      (kind.generics.params.length !== 0 || kind.items.some((item) => this.tcx.def_kind(item.owner_id).$ === "AssocTy"))
    ) {
      // {}
    } else if (kind.$ === "TyAlias" && kind._1.params.length !== 0) {
      // {}
    } else {
      this.dcx().emit_err(diagnostics.DocSearchUnboxInvalid_diagnostic({ span }));
    }
  }

  // rustc: compiler/rustc_passes/src/check_attr.rs:880 check_doc_masked
  check_doc_masked(span: Span, hir_id: HirId, target: Target): void {
    if (target.$ !== "ExternCrate") {
      this.tcx.emit_node_span_lint(
        INVALID_DOC_ATTRIBUTES,
        hir_id,
        span,
        diagnostics.DocMaskedOnlyExternCrate_diagnostic({
          attr_span: span,
          item_span: this.tcx.hir_span(hir_id),
        }),
      );
      return;
    }

    if (this.tcx.extern_mod_stmt_cnum(hir_id.owner.def_id) === undefined) {
      this.tcx.emit_node_span_lint(
        INVALID_DOC_ATTRIBUTES,
        hir_id,
        span,
        diagnostics.DocMaskedNotExternCrateSelf_diagnostic({
          attr_span: span,
          item_span: this.tcx.hir_span(hir_id),
        }),
      );
    }
  }

  // rustc: compiler/rustc_passes/src/check_attr.rs:907 check_doc_keyword_and_attribute
  check_doc_keyword_and_attribute(span: Span, hir_id: HirId, attr_name: string): void {
    const node = this.tcx.hir_node(hir_id);
    const item_kind = node.$ === "Item" ? node._0.kind : undefined;
    if (item_kind !== undefined && item_kind.$ === "Const" && item_kind._0.name === kw.Underscore) {
      // {}
    } else {
      this.dcx().emit_err(diagnostics.DocKeywordAttributeNotAnonConst_diagnostic({ span, attr_name }));
    }
  }

  /// Runs various checks on `#[doc]` attributes.
  // rustc: compiler/rustc_passes/src/check_attr.rs:921 check_doc_attrs
  check_doc_attrs(attr: DocAttribute, hir_id: HirId, target: Target): void {
    const {
      // first_span: _,
      aliases,
      // valid pretty much anywhere, not checked here?
      // FIXME: should we?
      // hidden: _,
      // already checked in attr_parsing
      // inline: _,
      // FIXME: currently unchecked
      // cfg: _,
      // already checked in attr_parsing
      // auto_cfg: _,
      // already checked in attr_parsing
      // auto_cfg_change: _,
      fake_variadic,
      keyword,
      masked,
      // FIXME: currently unchecked
      // notable_trait: _,
      search_unbox,
      // already checked in attr_parsing
      // html_favicon_url: _,
      // already checked in attr_parsing
      // html_logo_url: _,
      // already checked in attr_parsing
      // html_playground_url: _,
      // already checked in attr_parsing
      // html_root_url: _,
      // already checked in attr_parsing
      // html_no_source: _,
      // already checked in attr_parsing
      // issue_tracker_base_url: _,
      // already checked in attr_parsing
      // rust_logo: _,
      // allowed anywhere
      // test_attrs: _,
      // already checked in attr_parsing
      // no_crate_inject: _,
      attribute,
    } = attr;

    for (const [alias, span] of aliases) {
      this.check_doc_alias_value(span, hir_id, target, alias);
    }

    if (keyword !== undefined) {
      const span = keyword[1];
      this.check_doc_keyword_and_attribute(span, hir_id, "keyword");
    }
    if (attribute !== undefined) {
      const span = attribute[1];
      this.check_doc_keyword_and_attribute(span, hir_id, "attribute");
    }

    if (fake_variadic !== undefined) {
      this.check_doc_fake_variadic(fake_variadic, hir_id);
    }

    if (search_unbox !== undefined) {
      this.check_doc_search_unbox(search_unbox, hir_id);
    }

    if (masked !== undefined) {
      this.check_doc_masked(masked, hir_id, target);
    }
  }

  /// Checks if `#[may_dangle]` is applied to a lifetime or type generic parameter in `Drop` impl.
  // rustc: compiler/rustc_passes/src/check_attr.rs:988 check_may_dangle
  check_may_dangle(hir_id: HirId, attr_span: Span): void {
    const node = this.tcx.hir_node(hir_id);
    if (!(node.$ === "GenericParam" && (node._0.kind.$ === "Lifetime" || node._0.kind.$ === "Type"))) {
      this.dcx().delayed_bug("Checked in attr parser");
      return;
    }
    const param = node._0;

    if (param.source === "Generics") {
      const parent_hir_id = this.tcx.parent_hir_id(hir_id);
      const parent = this.tcx.hir_node(parent_hir_id);
      if (parent.$ === "Item" && parent._0.kind.$ === "Impl") {
        const impl_ = parent._0.kind._0;
        const of_trait = impl_.of_trait;
        if (of_trait !== undefined) {
          const def_id = of_trait.trait_ref.trait_def_id();
          if (def_id !== undefined && this.tcx.is_lang_item(def_id, "Drop")) {
            return;
          }
        }
      }
    }

    this.dcx().emit_err(diagnostics.InvalidMayDangle_diagnostic({ attr_span }));
  }

  /// Checks if the `#[repr]` attributes on `item` are valid.
  // rustc: compiler/rustc_passes/src/check_attr.rs:1015 check_repr
  check_repr(attrs: readonly Attribute[], span: Span, target: Target, item: hir.Item | undefined, hir_id: HirId): void {
    // Extract the names of all repr hints, e.g., [foo, bar, align] for:
    // ```
    // #[repr(foo)]
    // #[repr(bar, align(8))]
    // ```
    const [reprs, _first_attr_span] = find_attr(attrs, (k): [readonly [ReprAttr, Span][], Span | undefined] | undefined => (k.$ === "Repr" ? [k.reprs, k.first_span] : undefined)) ?? [[], undefined];

    let int_reprs = 0;
    let is_explicit_rust = false;
    let is_c = false;
    let is_simd = false;
    let is_transparent = false;

    for (const [repr, _repr_span] of reprs) {
      switch (repr.$) {
        case "ReprRust":
          is_explicit_rust = true;
          break;
        case "ReprC":
          is_c = true;
          break;
        case "ReprAlign":
          break;
        case "ReprPacked":
          break;
        case "ReprSimd":
          is_simd = true;
          break;
        case "ReprTransparent":
          is_transparent = true;
          break;
        case "ReprInt":
          int_reprs += 1;
          break;
      }
    }

    if (reprs.length !== 0) {
      const sorted_reprs = (() => {
        const to_sort = [...reprs];
        // PORT: `sort_unstable_by_key(|(attr, span)| (*attr, span.lo_hi()))` with the derived `Ord` of `ReprAttr`
        // (`cmp_ReprAttr`); equal keys are equal values, so the unstable sort is not observable.
        to_sort.sort(([a_attr, a_span], [b_attr, b_span]) => {
          const c = cmp_ReprAttr(a_attr, b_attr);
          if (c !== 0) return c;
          const [a_lo, a_hi] = Span.lo_hi(a_span);
          const [b_lo, b_hi] = Span.lo_hi(b_span);
          if (a_lo !== b_lo) return a_lo < b_lo ? -1 : 1;
          if (a_hi !== b_hi) return a_hi < b_hi ? -1 : 1;
          return 0;
        });
        return to_sort;
      })();

      // To collect all duplicates, get subslices where all of the elements of the subslice
      // are equal, then filter out all those whose length is not 1. We could return warnings
      // for each of them, but that's annoyingly excessive. So we instead collect all spans in
      // one big Vec.
      const spans: Span[] = [];
      let start = 0;
      for (let i = 1; i <= sorted_reprs.length; i++) {
        // `chunk_by(|(a, _), (b, _)| a == b)`
        if (i === sorted_reprs.length || cmp_ReprAttr(sorted_reprs[i - 1]![0], sorted_reprs[i]![0]) !== 0) {
          if (i - start !== 1) {
            for (let j = start; j < i; j++) {
              spans.push(sorted_reprs[j]![1]);
            }
          }
          start = i;
        }
      }

      if (spans.length !== 0) {
        this.tcx.emit_node_span_lint(REPEATED_REPRS, hir_id, spans, diagnostics.RepeatedRepr_diagnostic({}));
      }
    }

    // Just point at all repr hints if there are any incompatibilities.
    // This is not ideal, but tracking precisely which ones are at fault is a huge hassle.
    const hint_spans = (): Span[] => reprs.map(([_, span]) => span);

    // Error on repr(transparent, <anything else>).
    if (is_transparent && reprs.length > 1) {
      const hint_spans_ = hint_spans();
      this.dcx().emit_err(
        diagnostics.TransparentIncompatible_diagnostic({
          hint_spans: hint_spans_,
          target: display_Target(target),
        }),
      );
    }
    // Error on `#[repr(transparent)]` in combination with
    // `#[rustc_pass_indirectly_in_non_rustic_abis]`
    let pass_indirectly_span: Span | undefined;
    if (is_transparent && (pass_indirectly_span = find_attr(attrs, (k) => (k.$ === "RustcPassIndirectlyInNonRusticAbis" ? k._0 : undefined))) !== undefined) {
      this.dcx().emit_err(
        diagnostics.TransparentIncompatible_diagnostic({
          hint_spans: [span, pass_indirectly_span],
          target: display_Target(target),
        }),
      );
    }
    if (is_explicit_rust && (int_reprs > 0 || is_c || is_simd)) {
      const hint_spans_ = hint_spans();
      this.dcx().emit_err(diagnostics.ReprConflicting_diagnostic({ hint_spans: hint_spans_ }));
    }
    // Warn on repr(u8, u16), repr(C, simd), and c-like-enum-repr(C, u8)
    if (int_reprs > 1 || (is_simd && is_c) || (int_reprs === 1 && is_c && item !== undefined && is_c_like_enum(item))) {
      this.tcx.emit_node_span_lint(CONFLICTING_REPR_HINTS, hir_id, hint_spans(), diagnostics.ReprConflictingLint_diagnostic({}));
    }
  }

  /// Outputs an error for `#[allow_internal_unstable]` which can only be applied to macros.
  /// (Allows proc_macro functions)
  // rustc: compiler/rustc_passes/src/check_attr.rs:1132 check_rustc_allow_const_fn_unstable
  check_rustc_allow_const_fn_unstable(hir_id: HirId, attr_span: Span, span: Span, target: Target): void {
    switch (target.$) {
      case "Fn":
      case "Method": {
        if (!this.tcx.is_const_fn(hir_id.expect_owner().to_def_id())) {
          this.tcx.dcx().emit_err(diagnostics.RustcAllowConstFnUnstable_diagnostic({ attr_span, span }));
        }
        break;
      }
      default:
        break;
    }
  }

  // rustc: compiler/rustc_passes/src/check_attr.rs:1151 check_unused_attribute
  check_unused_attribute(hir_id: HirId, attr: Attribute): void {
    // Warn on useless empty attributes.
    // FIXME(jdonszelmann): this lint should be moved to attribute parsing, see `AcceptContext::warn_empty_attribute`
    let note: diagnostics.UnusedNote;
    let meta: MetaItemInner[] | undefined;
    let list: MetaItemInner[] | undefined;
    if (
      Attribute.has_any_name(attr, [sym.allow, sym.expect, sym.warn, sym.deny, sym.forbid]) &&
      (list = Attribute.meta_item_list(attr)) !== undefined &&
      list.length === 0
    ) {
      note = { $: "EmptyList", name: unwrap(Attribute.name(attr)) };
    } else if (
      Attribute.has_any_name(attr, [sym.allow, sym.warn, sym.deny, sym.forbid, sym.expect]) &&
      (meta = Attribute.meta_item_list(attr)) !== undefined &&
      meta.length === 1 &&
      (() => {
        const item = MetaItemInnerC.meta_item(meta[0]!);
        return item !== undefined && item.kind.$ === "NameValue" && item.path.eq_Symbol(sym.reason);
      })()
    ) {
      note = { $: "NoLints", name: unwrap(Attribute.name(attr)) };
    } else if (
      Attribute.has_any_name(attr, [sym.allow, sym.warn, sym.deny, sym.forbid, sym.expect]) &&
      (meta = Attribute.meta_item_list(attr)) !== undefined &&
      meta.some((meta) => {
        const item = MetaItemInnerC.meta_item(meta);
        return item !== undefined && (item.path.eq_Symbol(sym.linker_messages) || item.path.eq_Symbol(sym.linker_info));
      })
    ) {
      if (!HirId_eq(hir_id, CRATE_HIR_ID)) {
        return;
      } else {
        const never_needs_link = this.tcx.crate_types().every((kind) => kind === "Rlib" || kind === "StaticLib");
        if (never_needs_link) {
          note = diagnostics.UnusedNote.LinkerMessagesBinaryCrateOnly;
        } else {
          return;
        }
      }
    } else if (
      HirId_eq(hir_id, CRATE_HIR_ID) &&
      Attribute.has_any_name(attr, [sym.allow, sym.warn, sym.deny, sym.forbid, sym.expect]) &&
      (meta = Attribute.meta_item_list(attr)) !== undefined &&
      meta.some((meta) => {
        const item = MetaItemInnerC.meta_item(meta);
        return item !== undefined && item.path.eq_Symbol(sym.dead_code_pub_in_binary);
      }) &&
      !this.tcx.crate_types().includes("Executable")
    ) {
      note = diagnostics.UnusedNote.NoEffectDeadCodePubInBinary;
    } else {
      return;
    }

    this.tcx.emit_node_span_lint(UNUSED_ATTRIBUTES, hir_id, Attribute.span(attr), diagnostics.Unused_diagnostic({ attr_span: Attribute.span(attr), note }));
  }

  /// A best effort attempt to create an error for a mismatching proc macro signature.
  ///
  /// If this best effort goes wrong, it will just emit a worse error later (see #102923)
  // rustc: compiler/rustc_passes/src/check_attr.rs:1223 check_proc_macro
  check_proc_macro(hir_id: HirId, target: Target, kind: ProcMacroKind): void {
    if (target.$ !== "Fn") {
      return;
    }

    const tcx = this.tcx;
    const token_stream_def_id = tcx.get_diagnostic_item(sym.TokenStream);
    if (token_stream_def_id === undefined) {
      return;
    }
    const token_stream = EarlyBinder.no_bound_vars(tcx.type_of(token_stream_def_id) as EarlyBinder<Ty>, fold_Ty);
    if (token_stream === undefined) {
      return;
    }

    const def_id = hir_id.expect_owner().def_id;
    const param_env = ParamEnv.empty();

    const infcx = tcx.infer_ctxt().build(TypingMode.non_body_analysis());
    const ocx = ObligationCtxt.new_with_diagnostics(infcx);

    const span = tcx.def_span(def_id);
    const fresh_args = infcx.fresh_args_for_item(span, LocalDefId.to_def_id(def_id));
    const sig_ = tcx.liberate_late_bound_regions(
      LocalDefId.to_def_id(def_id),
      Unnormalized.skip_norm_wip(EarlyBinder.instantiate(tcx.fn_sig(def_id) as EarlyBinder<PolyFnSig>, tcx, fresh_args, fold_Binder(fold_FnSig))),
      fold_FnSig,
    );

    // PORT: `let mut cause`: a fresh value, mutated below.
    const cause = ObligationCause.misc(span, def_id);
    const sig = ocx.normalize(cause, param_env, Unnormalized.new_wip(sig_), fold_FnSig);

    // proc macro is not WF.
    const errors = ocx.try_evaluate_obligations();
    if (!TraitErrors.no_errors(errors)) {
      return;
    }

    let n: number;
    switch (kind) {
      case "Attribute":
        n = 2;
        break;
      case "Derive":
      case "FunctionLike":
        n = 1;
        break;
    }
    const expected_sig = tcx.mk_fn_sig_safe_rust_abi(Array.from({ length: n }, () => token_stream), token_stream);

    const eq = ocx.eq(cause, param_env, expected_sig, sig, ToTrace_FnSig);
    if (eq.$ === "Err") {
      const terr = eq._0;
      const diag = tcx.dcx().create_err(diagnostics.ProcMacroBadSig_diagnostic({ span, kind }));

      const hir_sig = tcx.hir_fn_sig_by_hir_id(hir_id);
      if (hir_sig !== undefined) {
        switch (terr.$) {
          case "ArgumentMutability":
          case "ArgumentSorts": {
            const idx = terr.$ === "ArgumentMutability" ? terr._0 : terr._1;
            const ty = hir_sig.decl.inputs[idx];
            if (ty !== undefined) {
              diag.span(ty.span);
              cause.span = ty.span;
            } else if (idx === hir_sig.decl.inputs.length) {
              const span = FnRetTy.span(hir_sig.decl.output);
              diag.span(span);
              cause.span = span;
            }
            break;
          }
          case "ArgCount": {
            const ty = hir_sig.decl.inputs[FnSig.inputs(expected_sig).length];
            if (ty !== undefined) {
              diag.span(ty.span);
              cause.span = ty.span;
            }
            break;
          }
          case "SafetyMismatch":
            // FIXME: Would be nice if we had a span here..
            break;
          case "AbiMismatch":
            // FIXME: Would be nice if we had a span here..
            break;
          case "VariadicMismatch":
            // FIXME: Would be nice if we had a span here..
            break;
          default:
            break;
        }
      }

      // PORT: `TypeErrCtxt::note_type_err` (rustc_trait_selection error_reporting, wave 19) through the pending
      // `infcx.err_ctxt()` (its placeholder stops as UNPORTED).
      (infcx.err_ctxt() as unknown as { note_type_err(diag: unknown, cause: ObligationCause, secondary_span: undefined, values: unknown, terr: unknown, prefer_label: boolean, override_span: undefined): void }).note_type_err(
        diag,
        cause,
        undefined,
        param_env.and({ $: "PolySigs", _0: { expected: Binder.dummy(expected_sig, fold_FnSig), found: Binder.dummy(sig, fold_FnSig) } }),
        terr,
        false,
        undefined,
      );
      diag.emit();
      this.abort = true;
    }

    const errors2 = ocx.evaluate_obligations_error_on_ambiguity();
    if (errors2.$ === "HasErrors") {
      err_ctxt(infcx).report_fulfillment_errors(errors2._0);
      this.abort = true;
    }
  }

  // rustc: compiler/rustc_passes/src/check_attr.rs:1327 check_rustc_force_inline
  check_rustc_force_inline(hir_id: HirId, attrs: readonly Attribute[], target: Target): void {
    if (target.$ === "Closure" && find_attr(attrs, (k) => (k.$ === "Inline" && k._0.$ === "Force" ? k._0.attr_span : undefined)) === undefined) {
      const kind = this.tcx.hir_expect_expr(hir_id).kind;
      const is_coro = kind.$ === "Closure" && (kind._0.kind.$ === "Coroutine" || kind._0.kind.$ === "CoroutineClosure");
      const parent_did = this.tcx.hir_get_parent_item(hir_id).to_def_id();
      const parent_span = this.tcx.def_span(parent_did);

      const attr_span = find_attr(HasAttrs_DefId.get_attrs(parent_did, this.tcx), (k) => (k.$ === "Inline" && k._0.$ === "Force" ? k._0.attr_span : undefined));
      if (attr_span !== undefined && is_coro) {
        this.dcx().emit_err(diagnostics.RustcForceInlineCoro_diagnostic({ attr_span, span: parent_span }));
      }
    }
  }

  // rustc: compiler/rustc_passes/src/check_attr.rs:1353 check_mix_no_mangle_export
  check_mix_no_mangle_export(hir_id: HirId, attrs: readonly Attribute[]): void {
    const export_name_span = find_attr(attrs, (k) => (k.$ === "ExportName" ? k.span : undefined));
    let no_mangle_span: Span | undefined;
    if (export_name_span !== undefined && (no_mangle_span = find_attr(attrs, (k) => (k.$ === "NoMangle" ? k._0 : undefined))) !== undefined) {
      const no_mangle_attr = Edition_discriminant[Span.edition(no_mangle_span)] >= Edition_discriminant[Edition.Edition2024] ? "#[unsafe(no_mangle)]" : "#[no_mangle]";
      const export_name_attr = Edition_discriminant[Span.edition(export_name_span)] >= Edition_discriminant[Edition.Edition2024] ? "#[unsafe(export_name)]" : "#[export_name]";

      this.tcx.emit_node_span_lint(
        UNUSED_ATTRIBUTES,
        hir_id,
        no_mangle_span,
        diagnostics.MixedExportNameAndNoMangle_diagnostic({
          no_mangle_span,
          export_name_span,
          no_mangle_attr,
          export_name_attr,
        }),
      );
    }
  }

  // rustc: compiler/rustc_passes/src/check_attr.rs:1384 check_optimize_and_inline
  check_optimize_and_inline(attrs: readonly Attribute[]): void {
    const optimize_span = find_attr(attrs, (k) => (k.$ === "Optimize" && k._0 === "DoNotOptimize" ? k._1 : undefined));
    let inline: [InlineAttr, Span] | undefined;
    if (
      optimize_span !== undefined &&
      (inline = find_attr(attrs, (k): [InlineAttr, Span] | undefined => (k.$ === "Inline" ? [k._0, k._1] : undefined))) !== undefined &&
      inline[0].$ !== "Never"
    ) {
      const inline_span = inline[1];
      this.dcx().emit_err(diagnostics.BothOptimizeNoneAndInline_diagnostic({ optimize_span, inline_span }));
    }
  }

  // rustc: compiler/rustc_passes/src/check_attr.rs:1396 check_linkage
  check_linkage(span: Span, hir_id: HirId, target: Target, item: hir.Item | undefined): void {
    // FIXME(eii) Once eii is no longer so experimental, suggest doing
    // linkage stuff with externally implementable items instead
    let it: hir.Item;
    if (target.$ === "ForeignStatic" && this.tcx.is_mutable_static(LocalDefId.to_def_id(hir_id.expect_owner().def_id))) {
      this.tcx.dcx().emit_err(diagnostics.StaticMutLinkage_diagnostic({ span }));
    } else if (target.$ === "Fn" && (it = unwrap(item)).kind.$ === "Fn" && it.kind.sig.header.constness.$ === "Const") {
      this.tcx.dcx().emit_err(diagnostics.ConstFnLinkage_diagnostic({ span }));
    } else {
      // _ => {}
    }
  }

  // ---- impl<'tcx> Visitor<'tcx> for CheckAttrVisitor<'tcx> ----

  // rustc: compiler/rustc_passes/src/check_attr.rs:1425 maybe_tcx
  override maybe_tcx(): HirTyCtxt {
    return TyCtxt_as_HirTyCtxt(this.tcx);
  }

  // rustc: compiler/rustc_passes/src/check_attr.rs:1429 visit_item
  override visit_item(item: hir.Item): undefined {
    // Historically we've run more checks on non-exported than exported macros,
    // so this lets us continue to run them while maintaining backwards compatibility.
    // In the long run, the checks should be harmonized.
    if (item.kind.$ === "Macro") {
      const macro_def = item.kind._1;
      const def_id = item.owner_id.to_def_id();
      if (macro_def.macro_rules && !(find_attr(HasAttrs_DefId.get_attrs(def_id, this.tcx), (k) => (k.$ === "MacroExport" ? null : undefined)) !== undefined)) {
        check_non_exported_macro_for_invalid_attrs(this.tcx, item);
      }
    }

    const target = Target_from_Item(item);
    this.check_attributes(item.hir_id(), item.span, target, item);
    return walk_item(this, item);
  }

  // rustc: compiler/rustc_passes/src/check_attr.rs:1445 visit_where_predicate
  override visit_where_predicate(where_predicate: hir.WherePredicate): undefined {
    this.check_attributes(where_predicate.hir_id, where_predicate.span, Target.WherePredicate, undefined);
    return walk_where_predicate(this, where_predicate);
  }

  // rustc: compiler/rustc_passes/src/check_attr.rs:1455 visit_generic_param
  override visit_generic_param(generic_param: hir.GenericParam): undefined {
    const target = Target_from_GenericParam(generic_param);
    this.check_attributes(generic_param.hir_id, generic_param.span, target, undefined);
    return walk_generic_param(this, generic_param);
  }

  // rustc: compiler/rustc_passes/src/check_attr.rs:1461 visit_trait_item
  override visit_trait_item(trait_item: hir.TraitItem): undefined {
    const target = Target_from_TraitItem(trait_item);
    this.check_attributes(trait_item.hir_id(), trait_item.span, target, undefined);
    return walk_trait_item(this, trait_item);
  }

  // rustc: compiler/rustc_passes/src/check_attr.rs:1467 visit_field_def
  override visit_field_def(struct_field: hir.FieldDef): undefined {
    this.check_attributes(struct_field.hir_id, struct_field.span, Target.Field, undefined);
    walk_field_def(this, struct_field);
    return undefined;
  }

  // rustc: compiler/rustc_passes/src/check_attr.rs:1472 visit_arm
  override visit_arm(arm: hir.Arm): undefined {
    this.check_attributes(arm.hir_id, arm.span, Target.Arm, undefined);
    walk_arm(this, arm);
    return undefined;
  }

  // rustc: compiler/rustc_passes/src/check_attr.rs:1477 visit_foreign_item
  override visit_foreign_item(f_item: hir.ForeignItem): undefined {
    const target = Target_from_ForeignItem(f_item);
    this.check_attributes(f_item.hir_id(), f_item.span, target, undefined);
    return walk_foreign_item(this, f_item);
  }

  // rustc: compiler/rustc_passes/src/check_attr.rs:1483 visit_impl_item
  override visit_impl_item(impl_item: hir.ImplItem): undefined {
    const target = target_from_impl_item(this.tcx, impl_item);
    this.check_attributes(impl_item.hir_id(), impl_item.span, target, undefined);
    return walk_impl_item(this, impl_item);
  }

  // rustc: compiler/rustc_passes/src/check_attr.rs:1489 visit_stmt
  override visit_stmt(stmt: hir.Stmt): undefined {
    // When checking statements ignore expressions, they will be checked later.
    if (stmt.kind.$ === "Let") {
      const l = stmt.kind._0;
      this.check_attributes(l.hir_id, stmt.span, Target.Statement, undefined);
    }
    return walk_stmt(this, stmt);
  }

  // rustc: compiler/rustc_passes/src/check_attr.rs:1497 visit_expr
  override visit_expr(expr: hir.Expr): undefined {
    let target: Target;
    switch (expr.kind.$) {
      case "Closure":
        target = Target.Closure;
        break;
      default:
        target = Target.Expression;
        break;
    }

    this.check_attributes(expr.hir_id, expr.span, target, undefined);
    return walk_expr(this, expr);
  }

  // rustc: compiler/rustc_passes/src/check_attr.rs:1507 visit_expr_field
  override visit_expr_field(field: hir.ExprField): undefined {
    this.check_attributes(field.hir_id, field.span, Target.ExprField, undefined);
    return walk_expr_field(this, field);
  }

  // rustc: compiler/rustc_passes/src/check_attr.rs:1512 visit_variant
  override visit_variant(variant: hir.Variant): undefined {
    this.check_attributes(variant.hir_id, variant.span, Target.Variant, undefined);
    return walk_variant(this, variant);
  }

  // rustc: compiler/rustc_passes/src/check_attr.rs:1517 visit_param
  override visit_param(param: hir.Param): undefined {
    this.check_attributes(param.hir_id, param.span, Target.Param, undefined);

    walk_param(this, param);
    return undefined;
  }

  // rustc: compiler/rustc_passes/src/check_attr.rs:1523 visit_pat_field
  override visit_pat_field(field: hir.PatField): undefined {
    this.check_attributes(field.hir_id, field.span, Target.PatField, undefined);
    walk_pat_field(this, field);
    return undefined;
  }
}

// PORT: the derived `Ord` of `ReprAttr` (variant order, then the field: `IntType`'s derived `Ord` over
// `SignedInt(IntTy)` / `UnsignedInt(UintTy)`, `Align`'s over `pow2`).
function cmp_ReprAttr(a: ReprAttr, b: ReprAttr): -1 | 0 | 1 {
  const order = ["ReprInt", "ReprRust", "ReprC", "ReprPacked", "ReprSimd", "ReprTransparent", "ReprAlign"] as const;
  const da = order.indexOf(a.$);
  const db = order.indexOf(b.$);
  if (da !== db) return da < db ? -1 : 1;
  const num = (x: number, y: number): -1 | 0 | 1 => (x < y ? -1 : x > y ? 1 : 0);
  if (a.$ === "ReprInt" && b.$ === "ReprInt") {
    const ia = a._0;
    const ib = b._0;
    if (ia.$ !== ib.$) return ia.$ === "SignedInt" ? -1 : 1;
    if (ia.$ === "SignedInt" && ib.$ === "SignedInt") return num(IntTy_discriminant[ia._0], IntTy_discriminant[ib._0]);
    if (ia.$ === "UnsignedInt" && ib.$ === "UnsignedInt") return num(UintTy_discriminant[ia._0], UintTy_discriminant[ib._0]);
    return 0;
  }
  if ((a.$ === "ReprPacked" && b.$ === "ReprPacked") || (a.$ === "ReprAlign" && b.$ === "ReprAlign")) {
    return num(a._0.pow2, b._0.pow2);
  }
  return 0;
}

// rustc: compiler/rustc_passes/src/check_attr.rs:1529 is_c_like_enum
function is_c_like_enum(item: hir.Item): boolean {
  if (item.kind.$ === "Enum") {
    const def = item.kind._2;
    for (const variant of def.variants) {
      switch (variant.data.$) {
        case "Unit":
          /* continue */
          break;
        default:
          return false;
      }
    }
    return true;
  } else {
    return false;
  }
}

// rustc: compiler/rustc_passes/src/check_attr.rs:1543 check_non_exported_macro_for_invalid_attrs
function check_non_exported_macro_for_invalid_attrs(tcx: TyCtxt, item: hir.Item): void {
  const attrs = tcx.hir_attrs(item.hir_id());

  const attr_span = find_attr(attrs, (k) => (k.$ === "Inline" && !(k._0.$ === "Force") ? k._1 : undefined));
  if (attr_span !== undefined) {
    tcx.dcx().emit_err(diagnostics.NonExportedMacroInvalidAttrs_diagnostic({ attr_span }));
  }
}

// rustc: compiler/rustc_passes/src/check_attr.rs:1553 check_mod_attrs
function check_mod_attrs(tcx: TyCtxt, module_def_id: LocalModId): null {
  const check_attr_visitor = new CheckAttrVisitor(tcx, false);
  tcx.hir_visit_item_likes_in_module(module_def_id, check_attr_visitor);
  if (LocalDefId.is_top_level_module(LocalModId.to_local_def_id(module_def_id))) {
    check_attr_visitor.check_attributes(CRATE_HIR_ID, DUMMY_SP, Target.Mod, undefined);
  }
  if (check_attr_visitor.abort) {
    tcx.dcx().abort_if_errors();
  }
  return null;
}

// rustc: compiler/rustc_passes/src/check_attr.rs:1564 provide
export function provide(providers: Providers): void {
  providers.check_mod_attrs = check_mod_attrs;
}

// rustc: compiler/rustc_passes/src/check_attr.rs:1568 doc_fake_variadic_is_allowed_self_ty
function doc_fake_variadic_is_allowed_self_ty(self_ty: hir.Ty): boolean {
  if (self_ty.kind.$ === "Tup" && self_ty.kind._0.length === 1) {
    return true;
  }
  if (self_ty.kind.$ === "FnPtr" ? self_ty.kind._0.decl.inputs.length === 1 : false) {
    return true;
  }
  if (self_ty.kind.$ === "Path" && self_ty.kind._0.$ === "Resolved") {
    const path = self_ty.kind._0._1;
    const last = path.segments.at(-1);
    const args = last === undefined ? undefined : last.args_().args;
    if (args !== undefined && args.length === 1 && args[0]!.$ === "Type") {
      const ty = args[0]!._0;
      return doc_fake_variadic_is_allowed_self_ty(ty.as_unambig_ty());
    }
  }
  return false;
}
