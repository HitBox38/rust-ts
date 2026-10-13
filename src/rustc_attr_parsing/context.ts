//! Context given to attribute parsers when parsing.
// Port of compiler/rustc_attr_parsing/src/context.rs
//
// PORT:
// - `static ATTRIBUTE_PARSERS: LazyLock<GroupTypeInner>` -> the accessor `ATTRIBUTE_PARSERS()`, which
//   builds the table on first use (the `BUILTIN_ATTRIBUTE_SET()` precedent of rustc_feature). The
//   `attribute_parsers!` macro is ported as the function `attribute_parsers(names)`, which performs
//   the macro's expansion for each listed parser type in list order; the type list is the argument.
// - `BTreeMap<&'static [Symbol], _>` -> `Map<string, _>` keyed by `path_key(path)` (the symbol
//   indices joined by `,`); the map is only used through `get` / `contains_key` / `entry`.
// - A parser type (`$names`) is its `AttributeParser` trait table (attributes/mod.ts). Its
//   `thread_local! static STATE_OBJECT: RefCell<$names>` is one mutable state object per listed type,
//   created with the table's `default()`; `STATE_OBJECT.take()` returns it and stores a fresh
//   `default()`. Accept fns mutate the state object in place (`&mut T`).
// - `Deref`/`DerefMut` chains (`AttributeDiagnosticContext` -> `AcceptContext` -> `SharedContext` ->
//   `AttributeParser`; `FinalizeContext`/`FinalizeCheckContext` -> `SharedContext`) are written out:
//   `adcx.ctx`, `cx.shared`, `shared.cx` (the `deref()`/`deref_mut()` fns return those fields).
// - `SharedContext`'s field `emit_lint` clashes with its method `emit_lint`, so the field is
//   `emit_lint_`.
// - `ExpectNameValue` / `ExpectStringLiteral`: trait tables per implementing type
//   (`ExpectNameValue.ArgParser`, ...), passed as a trailing argument to the generic
//   `expect_name_value` / `expect_string_literal` (PORTING §5 "pass function tables").
// - `#[track_caller]` has no JS equivalent (see rustc_errors `DiagLocation.caller_`).
// - `#[cfg(debug_assertions)]` fields (`has_lint_been_emitted`, `has_target_been_checked`) are
//   omitted: rustc ships without debug assertions.
import { type AttrStyle, type Item, LitKind, type MetaItemLit, type Safety } from "../rustc_ast/lib.ts";
import { target as target_mod } from "../rustc_attr_ir/lib.ts";
import { type AttrPath, type Attribute, type AttributeKind, clone_AttrPath, display_AttrPath } from "../rustc_attr_ir/lib.ts";
import {
  type Diag,
  DiagLocation,
  type DiagCtxtHandle,
  type Diagnostic,
  type ErrorGuaranteed,
  type IntoMultiSpan,
  Level,
  Level_eq,
  type Lint,
  LintId,
  into_MultiSpan,
} from "../rustc_errors/lib.ts";
import type { AttributeStability } from "../rustc_feature/lib.ts";
import { UNUSED_ATTRIBUTES } from "../rustc_lint_defs/builtin.ts";
import type { parser as rustc_parse_parser } from "../rustc_parse/lib.ts";
import type { Session } from "../rustc_session/lib.ts";
import type { Span } from "../rustc_span/lib.ts";
import { debug_Symbol, type Ident, type Symbol } from "../rustc_span/symbol.ts";
import { type Debug, debug_bool, debug_list, debug_struct, PLAIN } from "../std/fmt.ts";
import { panic } from "../std/panic.ts";

// Glob imports to avoid big, bitrotty import lists
import { AllowInternalUnstableParser, RustcAllowConstFnUnstableParser, UnstableFeatureBoundParser } from "./attributes/allow_unstable.ts";
import { RustcAutodiffParser } from "./attributes/autodiff.ts";
import { CoroutineParser } from "./attributes/body.ts";
import { CfiEncodingParser } from "./attributes/cfi_encoding.ts";
import { ColdParser, CoverageParser, ExportNameParser, ForceTargetFeatureParser, InstrumentFnParser, NakedParser, NoMangleParser, OptimizeParser, PatchableFunctionEntryParser, RustcEiiForeignItemParser, RustcObjcClassParser, RustcObjcSelectorParser, RustcPassIndirectlyInNonRusticAbisParser, SanitizeParser, TargetFeatureParser, ThreadLocalParser, TrackCallerParser, UsedParser } from "./attributes/codegen_attrs.ts";
import { ConfusablesParser } from "./attributes/confusables.ts";
import { CrateNameParser, CrateTypeParser, DefaultLibAllocatorParser, FeatureParser, MoveSizeLimitParser, NeedsPanicRuntimeParser, NoBuiltinsParser, NoCoreParser, NoMainParser, NoStdParser, PanicRuntimeParser, PatternComplexityLimitParser, ProfilerRuntimeParser, RecursionLimitParser, RegisterToolParser, RustcCoherenceIsCoreParser, RustcNoImplicitBoundsParser, RustcPreserveUbChecksParser, TypeLengthLimitParser, WindowsSubsystemParser } from "./attributes/crate_level.ts";
import { DebuggerVisualizerParser } from "./attributes/debugger.ts";
import { DeprecatedParser } from "./attributes/deprecation.ts";
import { DoNotRecommendParser } from "./attributes/diagnostic/do_not_recommend.ts";
import { OnConstParser } from "./attributes/diagnostic/on_const.ts";
import { OnMoveParser } from "./attributes/diagnostic/on_move.ts";
import { OnTypeErrorParser } from "./attributes/diagnostic/on_type_error.ts";
import { OnUnimplementedParser } from "./attributes/diagnostic/on_unimplemented.ts";
import { OnUnknownParser } from "./attributes/diagnostic/on_unknown.ts";
import { OnUnmatchedArgsParser } from "./attributes/diagnostic/on_unmatched_args.ts";
import { OpaqueParser } from "./attributes/diagnostic/opaque.ts";
import { DocParser } from "./attributes/doc.ts";
import { RustcDummyParser } from "./attributes/dummy.ts";
import { InlineParser, RustcForceInlineParser } from "./attributes/inline.ts";
import { InstructionSetParser } from "./attributes/instruction_set.ts";
import { CompilerBuiltinsParser, ExportStableParser, FfiConstParser, FfiPureParser, LinkNameParser, LinkOrdinalParser, LinkParser, LinkSectionParser, LinkageParser, NeedsAllocatorParser, RustcStdInternalSymbolParser } from "./attributes/link_attrs.ts";
import { AutomaticallyDerivedParser, RustcAsPtrParser, RustcPassByValueParser, RustcPubTransparentParser, RustcShouldNotBeCalledOnConstItemsParser } from "./attributes/lint_helpers.ts";
import { ConstContinueParser, LoopMatchParser } from "./attributes/loop_match.ts";
import { AllowInternalUnsafeParser, CollapseDebugInfoParser, MacroEscapeParser, MacroExportParser, MacroUseParser, RustcProcMacroDeclsParser } from "./attributes/macro_attrs.ts";
import { MustNotSuspendParser } from "./attributes/must_not_suspend.ts";
import { MustUseParser } from "./attributes/must_use.ts";
import { NoImplicitPreludeParser } from "./attributes/no_implicit_prelude.ts";
import { NoLinkParser } from "./attributes/no_link.ts";
import { NonExhaustiveParser } from "./attributes/non_exhaustive.ts";
import { PathParser as PathAttributeParser } from "./attributes/path.ts";
import { PinV2Parser } from "./attributes/pin_v2.ts";
import { ProcMacroAttributeParser, ProcMacroDeriveParser, ProcMacroParser, RustcBuiltinMacroParser } from "./attributes/proc_macro_attrs.ts";
import { CustomMirParser } from "./attributes/prototype.ts";
import { ReprParser, RustcAlignParser, RustcAlignStaticParser } from "./attributes/repr.ts";
import { RustcAllocatorParser, RustcAllocatorZeroedParser, RustcAllocatorZeroedVariantParser, RustcDeallocatorParser, RustcReallocatorParser } from "./attributes/rustc_allocator.ts";
import { RustcDumpClausesParser, RustcDumpDefParentsParser, RustcDumpDefPathParser, RustcDumpGenericsParser, RustcDumpHiddenTypeOfOpaquesParser, RustcDumpInferredOutlivesParser, RustcDumpItemBoundsParser, RustcDumpLayoutParser, RustcDumpObjectLifetimeDefaultsParser, RustcDumpSymbolNameParser, RustcDumpUserArgsParser, RustcDumpVariancesOfOpaquesParser, RustcDumpVariancesParser, RustcDumpVtableParser } from "./attributes/rustc_dump.ts";
import { LangParser, PanicHandlerParser, PreludeImportParser, RustcCanonicalSymbolParser, RustcCaptureAnalysisParser, RustcCguTestAttributeParser, RustcCleanParser, RustcConversionSuggestionParser, RustcDeprecatedSafe2024Parser, RustcDiagnosticItemParser, RustcDoNotConstCheckParser, RustcDocPrimitiveParser, RustcEffectiveVisibilityParser, RustcExhaustiveParser, RustcHasIncoherentInherentImplsParser, RustcIfThisChangedParser, RustcInheritOverflowChecksParser, RustcInsignificantDtorParser, RustcIntrinsicConstStableIndirectParser, RustcIntrinsicParser, RustcLegacyConstGenericsParser, RustcLintOptDenyFieldAccessParser, RustcLintOptTyParser, RustcLintQueryInstabilityParser, RustcLintUntrackedQueryInformationParser, RustcMainParser, RustcMirParser, RustcMustImplementOneOfParser, RustcNeverReturnsNullPtrParser, RustcNoImplicitAutorefsParser, RustcNoMirInlineParser, RustcNoWritableParser, RustcNonConstTraitMethodParser, RustcNonnullOptimizationGuaranteedParser, RustcNounwindParser, RustcOffloadKernelParser, RustcPanicsWhenZeroParser, RustcRegionsParser, RustcScalableVectorParser, RustcSimdMonomorphizeLaneLimitParser, RustcStrictCoherenceParser, RustcThenThisWouldNeedParser, RustcTrivialFieldReadsParser } from "./attributes/rustc_internal.ts";
import { AlwaysGcaParser, ComptimeParser, MayDangleParser } from "./attributes/semantics.ts";
import { SplatParser } from "./attributes/splat.ts";
import { BodyStabilityParser, ConstStabilityParser, RustcConstStableIndirectParser, StabilityParser, UnstableRemovedParser } from "./attributes/stability.ts";
import { IgnoreParser, ReexportTestHarnessMainParser, RustcAbiParser, RustcDelayedBugFromInsideQueryParser, RustcEvaluateWhereClausesParser, RustcTestMarkerParser, ShouldPanicParser, TestRunnerParser } from "./attributes/test_attrs.ts";
import { FundamentalParser, MarkerParser, RustcAllowIncoherentImplParser, RustcAllowLifetimeDependentSpecializationParser, RustcCoinductiveParser, RustcDenyExplicitImplParser, RustcDynIncompatibleTraitParser, RustcParenSugarParser, RustcSkipDuringMethodDispatchParser, RustcSpecializationTraitParser } from "./attributes/traits.ts";
import { RustcMacroTransparencyParser } from "./attributes/transparency.ts";
import { UnrollParser } from "./attributes/unroll.ts";
import { type AttributeSafety, Combine, type ErasedAttributeParser, Single, WithoutArgs } from "./attributes/mod.ts";
import {
  AttributeParseError_diagnostic,
  type AttributeParseErrorReason,
  type AttributeParseErrorSuggestions,
  EmptyAttributeList_diagnostic,
  IllFormedAttributeInput,
  IllFormedAttributeInput_diagnostic,
  type ParsedDescription,
  UnusedDuplicate_diagnostic,
} from "./diagnostics.ts";
import { type AttributeParser, EmitAttribute, type EmitLintFn } from "./interface.ts";
import {
  ArgParser,
  type MetaItemListParser,
  MetaItemOrLitParser,
  type MetaItemParser,
  type NameValueParser,
  type RefPathParser,
} from "./parser.ts";
import type { AllowedTargets } from "./target_checking.ts";
import type { AttributeTemplate } from "./template.ts";

type Target = target_mod.Target;
type Recovery = rustc_parse_parser.Recovery;

/** `type GroupType = LazyLock<GroupTypeInner>;` */
export interface GroupTypeInner {
  accepters: Map<string, GroupTypeInnerAccept>;
}

export interface GroupTypeInnerAccept {
  template: AttributeTemplate;
  accept_fn: AcceptFn;
  allowed_targets: AllowedTargets;
  safety: AttributeSafety;
  stability: AttributeStability;
  finalizer: FinalizeFn;
}

/** `Box<dyn for<'sess> Fn(&mut AcceptContext<'_, 'sess>, &ArgParser) + Send + Sync>` */
export type AcceptFn = (cx: AcceptContext, args: ArgParser) => void;

/** `fn(&mut FinalizeContext<'_, '_>) -> FinalizeOutput` */
export type FinalizeFn = (cx: FinalizeContext) => FinalizeOutput;

/// A cross-attribute check that runs *after* all attributes on an item have been
/// finalized, so it can inspect the fully parsed attributes via
/// [`FinalizeCheckContext::parsed_attrs`]. The [`Span`] is the span of the attribute the
/// check is associated with, used for diagnostics.
export type FinalizeCheckFn = (cx: FinalizeCheckContext, span: Span) => void;

/// The result of finalizing a single attribute parser.
export interface FinalizeOutput {
  /// The attribute the parser produced, if any.
  attr: AttributeKind | undefined;
  /// A check to run once *all* attributes on the item have been finalized, together
  /// with the span it should be reported at. Deferred so that it can inspect the fully
  /// parsed attributes via [`FinalizeCheckContext::parsed_attrs`].
  deferred_check: [FinalizeCheckFn, Span] | undefined;
}

/** PORT: the key of an `accepters` entry (`&'static [Symbol]`): the symbol indices joined by `,`. */
export function path_key(path: readonly Symbol[]): string {
  return path.join(",");
}

/**
 * `macro_rules! attribute_parsers` (context.rs:117), applied to the list of parser types `names`:
 * the body of the `LazyLock::new(|| { .. })` closure it expands to, repeated for each `$names`.
 * (Exported for context.test.ts only.)
 */
export function attribute_parsers(names: readonly ErasedAttributeParser[]): GroupTypeInner {
  const accepters = new Map<string, GroupTypeInnerAccept>();
  for (const $names of names) {
    {
      // thread_local! {
      //     static STATE_OBJECT: RefCell<$names> = RefCell::new(<$names>::default());
      // };
      const STATE_OBJECT = { value: $names.default() };

      for (const [path, template, stability, accept_fn] of $names.ATTRIBUTES) {
        const key = path_key(path);
        if (!accepters.has(key)) {
          // Entry::Vacant(e)
          accepters.set(key, {
            template,
            accept_fn: (cx, args) => {
              // STATE_OBJECT.with_borrow_mut(|s| accept_fn(s, cx, args))
              accept_fn(STATE_OBJECT.value, cx, args);
            },
            safety: $names.SAFETY,
            stability,
            allowed_targets: $names.ALLOWED_TARGETS,
            finalizer: (cx) => {
              // let state = STATE_OBJECT.take();
              const state = STATE_OBJECT.value;
              STATE_OBJECT.value = $names.default();
              // Compute the deferred check (if any) before consuming
              // the state in `finalize`.
              const deferred_check = $names.deferred_finalize_check(state);
              const attr = $names.finalize(state, cx);
              return { attr, deferred_check };
            },
          });
        } else {
          // Entry::Occupied(_)
          panic(`Attribute ${debug_list(PLAIN, path.map((s) => debug_Symbol(s, PLAIN)))} has multiple accepters`);
        }
      }
    }
  }

  return { accepters };
}

let ATTRIBUTE_PARSERS_: GroupTypeInner | undefined;
/** `pub(crate) static ATTRIBUTE_PARSERS: GroupType` (a `LazyLock`, built on first use). */
export function ATTRIBUTE_PARSERS(): GroupTypeInner {
  if (ATTRIBUTE_PARSERS_ === undefined) {
    ATTRIBUTE_PARSERS_ = attribute_parsers([
      // tidy-alphabetical-start
      BodyStabilityParser,
      ConfusablesParser,
      ConstStabilityParser,
      DocParser,
      MacroUseParser,
      NakedParser,
      OnConstParser,
      OnMoveParser,
      OnTypeErrorParser,
      OnUnimplementedParser,
      OnUnknownParser,
      OnUnmatchedArgsParser,
      OpaqueParser,
      RegisterToolParser,
      RustcAlignParser,
      RustcAlignStaticParser,
      RustcCguTestAttributeParser,
      StabilityParser,
      UsedParser,
      // tidy-alphabetical-end

      // tidy-alphabetical-start
      Combine(AllowInternalUnstableParser),
      Combine(CrateTypeParser),
      Combine(DebuggerVisualizerParser),
      Combine(FeatureParser),
      Combine(ForceTargetFeatureParser),
      Combine(LinkParser),
      Combine(ReprParser),
      Combine(RustcAllowConstFnUnstableParser),
      Combine(RustcCleanParser),
      Combine(RustcDumpLayoutParser),
      Combine(RustcMirParser),
      Combine(RustcThenThisWouldNeedParser),
      Combine(TargetFeatureParser),
      Combine(UnstableFeatureBoundParser),
      Combine(UnstableRemovedParser),
      // tidy-alphabetical-end

      // tidy-alphabetical-start
      Single(CfiEncodingParser),
      Single(CollapseDebugInfoParser),
      Single(CoverageParser),
      Single(CrateNameParser),
      Single(CustomMirParser),
      Single(DeprecatedParser),
      Single(DoNotRecommendParser),
      Single(ExportNameParser),
      Single(IgnoreParser),
      Single(InlineParser),
      Single(InstructionSetParser),
      Single(InstrumentFnParser),
      Single(LangParser),
      Single(LinkNameParser),
      Single(LinkOrdinalParser),
      Single(LinkSectionParser),
      Single(LinkageParser),
      Single(MacroExportParser),
      Single(MoveSizeLimitParser),
      Single(MustNotSuspendParser),
      Single(MustUseParser),
      Single(OptimizeParser),
      Single(PatchableFunctionEntryParser),
      Single(PathAttributeParser),
      Single(PatternComplexityLimitParser),
      Single(ProcMacroDeriveParser),
      Single(RecursionLimitParser),
      Single(ReexportTestHarnessMainParser),
      Single(RustcAbiParser),
      Single(RustcAllocatorZeroedVariantParser),
      Single(RustcAutodiffParser),
      Single(RustcBuiltinMacroParser),
      Single(RustcDeprecatedSafe2024Parser),
      Single(RustcDiagnosticItemParser),
      Single(RustcDocPrimitiveParser),
      Single(RustcDummyParser),
      Single(RustcDumpDefPathParser),
      Single(RustcDumpSymbolNameParser),
      Single(RustcForceInlineParser),
      Single(RustcIfThisChangedParser),
      Single(RustcLegacyConstGenericsParser),
      Single(RustcLintOptDenyFieldAccessParser),
      Single(RustcMacroTransparencyParser),
      Single(RustcMustImplementOneOfParser),
      Single(RustcObjcClassParser),
      Single(RustcObjcSelectorParser),
      Single(RustcScalableVectorParser),
      Single(RustcSimdMonomorphizeLaneLimitParser),
      Single(RustcSkipDuringMethodDispatchParser),
      Single(RustcTestMarkerParser),
      Single(SanitizeParser),
      Single(ShouldPanicParser),
      Single(TestRunnerParser),
      Single(TypeLengthLimitParser),
      Single(UnrollParser),
      Single(WindowsSubsystemParser),
      Single(WithoutArgs(AllowInternalUnsafeParser)),
      Single(WithoutArgs(AlwaysGcaParser)),
      Single(WithoutArgs(AutomaticallyDerivedParser)),
      Single(WithoutArgs(ColdParser)),
      Single(WithoutArgs(CompilerBuiltinsParser)),
      Single(WithoutArgs(ComptimeParser)),
      Single(WithoutArgs(ConstContinueParser)),
      Single(WithoutArgs(CoroutineParser)),
      Single(WithoutArgs(DefaultLibAllocatorParser)),
      Single(WithoutArgs(ExportStableParser)),
      Single(WithoutArgs(FfiConstParser)),
      Single(WithoutArgs(FfiPureParser)),
      Single(WithoutArgs(FundamentalParser)),
      Single(WithoutArgs(LoopMatchParser)),
      Single(WithoutArgs(MacroEscapeParser)),
      Single(WithoutArgs(MarkerParser)),
      Single(WithoutArgs(MayDangleParser)),
      Single(WithoutArgs(NeedsAllocatorParser)),
      Single(WithoutArgs(NeedsPanicRuntimeParser)),
      Single(WithoutArgs(NoBuiltinsParser)),
      Single(WithoutArgs(NoCoreParser)),
      Single(WithoutArgs(NoImplicitPreludeParser)),
      Single(WithoutArgs(NoLinkParser)),
      Single(WithoutArgs(NoMainParser)),
      Single(WithoutArgs(NoMangleParser)),
      Single(WithoutArgs(NoStdParser)),
      Single(WithoutArgs(NonExhaustiveParser)),
      Single(WithoutArgs(PanicHandlerParser)),
      Single(WithoutArgs(PanicRuntimeParser)),
      Single(WithoutArgs(PinV2Parser)),
      Single(WithoutArgs(PreludeImportParser)),
      Single(WithoutArgs(ProcMacroAttributeParser)),
      Single(WithoutArgs(ProcMacroParser)),
      Single(WithoutArgs(ProfilerRuntimeParser)),
      Single(WithoutArgs(RustcAllocatorParser)),
      Single(WithoutArgs(RustcAllocatorZeroedParser)),
      Single(WithoutArgs(RustcAllowIncoherentImplParser)),
      Single(WithoutArgs(RustcAllowLifetimeDependentSpecializationParser)),
      Single(WithoutArgs(RustcAsPtrParser)),
      Single(WithoutArgs(RustcCanonicalSymbolParser)),
      Single(WithoutArgs(RustcCaptureAnalysisParser)),
      Single(WithoutArgs(RustcCoherenceIsCoreParser)),
      Single(WithoutArgs(RustcCoinductiveParser)),
      Single(WithoutArgs(RustcConstStableIndirectParser)),
      Single(WithoutArgs(RustcConversionSuggestionParser)),
      Single(WithoutArgs(RustcDeallocatorParser)),
      Single(WithoutArgs(RustcDelayedBugFromInsideQueryParser)),
      Single(WithoutArgs(RustcDenyExplicitImplParser)),
      Single(WithoutArgs(RustcDoNotConstCheckParser)),
      Single(WithoutArgs(RustcDumpClausesParser)),
      Single(WithoutArgs(RustcDumpDefParentsParser)),
      Single(WithoutArgs(RustcDumpGenericsParser)),
      Single(WithoutArgs(RustcDumpHiddenTypeOfOpaquesParser)),
      Single(WithoutArgs(RustcDumpInferredOutlivesParser)),
      Single(WithoutArgs(RustcDumpItemBoundsParser)),
      Single(WithoutArgs(RustcDumpObjectLifetimeDefaultsParser)),
      Single(WithoutArgs(RustcDumpUserArgsParser)),
      Single(WithoutArgs(RustcDumpVariancesOfOpaquesParser)),
      Single(WithoutArgs(RustcDumpVariancesParser)),
      Single(WithoutArgs(RustcDumpVtableParser)),
      Single(WithoutArgs(RustcDynIncompatibleTraitParser)),
      Single(WithoutArgs(RustcEffectiveVisibilityParser)),
      Single(WithoutArgs(RustcEiiForeignItemParser)),
      Single(WithoutArgs(RustcEvaluateWhereClausesParser)),
      Single(WithoutArgs(RustcExhaustiveParser)),
      Single(WithoutArgs(RustcHasIncoherentInherentImplsParser)),
      Single(WithoutArgs(RustcInheritOverflowChecksParser)),
      Single(WithoutArgs(RustcInsignificantDtorParser)),
      Single(WithoutArgs(RustcIntrinsicConstStableIndirectParser)),
      Single(WithoutArgs(RustcIntrinsicParser)),
      Single(WithoutArgs(RustcLintOptTyParser)),
      Single(WithoutArgs(RustcLintQueryInstabilityParser)),
      Single(WithoutArgs(RustcLintUntrackedQueryInformationParser)),
      Single(WithoutArgs(RustcMainParser)),
      Single(WithoutArgs(RustcNeverReturnsNullPtrParser)),
      Single(WithoutArgs(RustcNoImplicitAutorefsParser)),
      Single(WithoutArgs(RustcNoImplicitBoundsParser)),
      Single(WithoutArgs(RustcNoMirInlineParser)),
      Single(WithoutArgs(RustcNoWritableParser)),
      Single(WithoutArgs(RustcNonConstTraitMethodParser)),
      Single(WithoutArgs(RustcNonnullOptimizationGuaranteedParser)),
      Single(WithoutArgs(RustcNounwindParser)),
      Single(WithoutArgs(RustcOffloadKernelParser)),
      Single(WithoutArgs(RustcPanicsWhenZeroParser)),
      Single(WithoutArgs(RustcParenSugarParser)),
      Single(WithoutArgs(RustcPassByValueParser)),
      Single(WithoutArgs(RustcPassIndirectlyInNonRusticAbisParser)),
      Single(WithoutArgs(RustcPreserveUbChecksParser)),
      Single(WithoutArgs(RustcProcMacroDeclsParser)),
      Single(WithoutArgs(RustcPubTransparentParser)),
      Single(WithoutArgs(RustcReallocatorParser)),
      Single(WithoutArgs(RustcRegionsParser)),
      Single(WithoutArgs(RustcShouldNotBeCalledOnConstItemsParser)),
      Single(WithoutArgs(RustcSpecializationTraitParser)),
      Single(WithoutArgs(RustcStdInternalSymbolParser)),
      Single(WithoutArgs(RustcStrictCoherenceParser)),
      Single(WithoutArgs(RustcTrivialFieldReadsParser)),
      Single(WithoutArgs(SplatParser)),
      Single(WithoutArgs(ThreadLocalParser)),
      Single(WithoutArgs(TrackCallerParser)),
      // tidy-alphabetical-end
    ]);
  }
  return ATTRIBUTE_PARSERS_;
}

/// Context given to every attribute parser during finalization.
///
/// Gives [`AttributeParser`](crate::attributes::AttributeParser)s enough information to create
/// errors, for example.
export class SharedContext {
  constructor(
    /// The parse context, gives access to the session and the
    /// diagnostics context.
    public cx: AttributeParser,
    /// The span of the syntactical component this attribute was applied to
    public target_span: Span,
    public target: Target,

    public emit_lint_: EmitLintFn,

    // /// This atomic bool keeps track of whether any lint has been emitted.
    // /// This is used for the arguments-used check.
    // #[cfg(debug_assertions)]
    // pub(crate) has_lint_been_emitted: AtomicBool,
  ) {}

  // #[track_caller]
  // rustc: compiler/rustc_attr_parsing/src/context.rs:412 emit_err
  emit_err(diag: Diagnostic): ErrorGuaranteed {
    return this.cx.emit_err(diag);
  }

  /// Emit a lint. This method is somewhat special, since lints emitted during attribute parsing
  /// must be delayed until after HIR is built. This method will take care of the details of
  /// that.
  // #[track_caller]
  // rustc: compiler/rustc_attr_parsing/src/context.rs:420 emit_lint
  emit_lint(lint: Lint, diagnostic: Diagnostic, span: IntoMultiSpan): void {
    const emitted_at = DiagLocation.caller_();
    this.emit_lint_inner(
      lint,
      new EmitAttribute((dcx, level, _) => {
        const diag = diagnostic.into_diag(dcx, level);
        diag.deref_mut().emitted_at = emitted_at;
        return diag;
      }),
      span,
    );
  }

  // rustc: compiler/rustc_attr_parsing/src/context.rs:438 emit_lint_with_sess
  emit_lint_with_sess(lint: Lint, callback: (dcx: DiagCtxtHandle, level: Level, sess: Session) => Diag, span: IntoMultiSpan): void {
    this.emit_lint_inner(lint, new EmitAttribute(callback), span);
  }

  // rustc: compiler/rustc_attr_parsing/src/context.rs:452 emit_lint_inner
  emit_lint_inner(lint: Lint, kind: EmitAttribute, span: IntoMultiSpan): void {
    // #[cfg(debug_assertions)]
    // self.has_lint_been_emitted.store(true, Ordering::Relaxed);
    const should_emit = this.cx.should_emit;
    if (!(should_emit.$ === "ErrorsAndLints" || (should_emit.$ === "EarlyFatal" && should_emit.also_emit_lints === true))) {
      return;
    }
    this.emit_lint_(LintId.of(lint), into_MultiSpan(span), kind);
  }

  // rustc: compiler/rustc_attr_parsing/src/context.rs:469 warn_unused_duplicate
  warn_unused_duplicate(used_span: Span, unused_span: Span): void {
    this.emit_lint(
      UNUSED_ATTRIBUTES,
      UnusedDuplicate_diagnostic({ this: unused_span, other: used_span, warning: false }),
      unused_span,
    );
  }

  // rustc: compiler/rustc_attr_parsing/src/context.rs:477 warn_unused_duplicate_future_error
  warn_unused_duplicate_future_error(used_span: Span, unused_span: Span): void {
    this.emit_lint(
      UNUSED_ATTRIBUTES,
      UnusedDuplicate_diagnostic({ this: unused_span, other: used_span, warning: true }),
      unused_span,
    );
  }

  // impl Deref for SharedContext { type Target = AttributeParser; }
  // rustc: compiler/rustc_attr_parsing/src/context.rs:880 deref
  deref(): AttributeParser {
    return this.cx;
  }

  // rustc: compiler/rustc_attr_parsing/src/context.rs:886 deref_mut
  deref_mut(): AttributeParser {
    return this.cx;
  }
}

/// Context given to every attribute parser when accepting
///
/// Gives [`AttributeParser`]s enough information to create errors, for example.
export class AcceptContext {
  constructor(
    public shared: SharedContext,

    /// The outer span of the attribute currently being parsed
    ///
    /// ```none
    /// #[attribute(...)]
    /// ^^^^^^^^^^^^^^^^^ outer span
    /// ```
    /// For attributes in `cfg_attr`, the outer span and inner spans are equal.
    public attr_span: Span,
    /// The inner span of the attribute currently being parsed.
    ///
    /// ```none
    /// #[attribute(...)]
    ///   ^^^^^^^^^^^^^^  inner span
    /// ```
    public inner_span: Span,

    /// Whether it is an inner or outer attribute.
    public attr_style: AttrStyle,

    /// A description of the thing we are parsing using this attribute parser.
    /// We are not only using these parsers for attributes, but also for macros such as the `cfg!()` macro.
    public parsed_description: ParsedDescription,

    /// The expected structure of the attribute.
    ///
    /// Used in reporting errors to give a hint to users what the attribute *should* look like.
    public template: AttributeTemplate,

    /// The safety attribute (if any) applied to the attribute.
    public attr_safety: Safety,

    /// The name of the attribute we're currently accepting.
    public attr_path: AttrPath,

    // /// Used for `AllowedTargets::ManuallyChecked`, to assert that the manual target check has been done
    // #[cfg(debug_assertions)]
    // pub(crate) has_target_been_checked: bool,
  ) {}

  // rustc: compiler/rustc_attr_parsing/src/context.rs:491 adcx
  adcx(): AttributeDiagnosticContext {
    return new AttributeDiagnosticContext(this, []);
  }

  /// Asserts that this `MetaItem` is a list that contains a single element. Emits an error and
  /// returns `None` if it is not the case.
  ///
  /// Some examples:
  ///
  /// - In `#[allow(warnings)]`, `warnings` is returned
  /// - In `#[cfg_attr(docsrs, doc = "foo")]`, `None` is returned, "expected a single argument
  ///   here" is emitted.
  /// - In `#[cfg()]`, `None` is returned, "expected an argument here" is emitted.
  ///
  /// The provided span is used as a fallback for diagnostic generation in case `arg` does not
  /// contain any. It should be the span of the node that contains `arg`.
  // #[track_caller]
  // rustc: compiler/rustc_attr_parsing/src/context.rs:508 expect_single_element_list
  expect_single_element_list(arg: ArgParser, span: Span): MetaItemOrLitParser | undefined {
    if (arg.$ !== "List") {
      this.adcx().expected_list(span, arg);
      return undefined;
    }
    const l = arg._0;

    const single = l.as_single();
    if (single === undefined) {
      this.adcx().expected_single_argument(l.span, l.len());
      return undefined;
    }

    return single;
  }

  /// Asserts that an [`ArgParser`] is a list and returns it, or emits an error and returns
  /// `None`.
  ///
  /// Some examples:
  ///
  /// - `#[allow(clippy::complexity)]`: `(clippy::complexity)` is a list
  /// - `#[rustfmt::skip::macros(target_macro_name)]`: `(target_macro_name)` is a list
  ///
  /// This is a higher-level (and harder to misuse) wrapper over [`ArgParser::as_list`] that
  /// allows using `?` when the attribute parsing function allows it. You may still want to use
  /// [`ArgParser::as_list`] for the following reasons:
  ///
  /// - You want to emit your own diagnostics (for instance, with [`SharedContext::emit_err`]).
  /// - The attribute can be parsed in multiple ways and it does not make sense to emit an error.
  // #[track_caller]
  // rustc: compiler/rustc_attr_parsing/src/context.rs:541 expect_list
  expect_list(args: ArgParser, span: Span): MetaItemListParser | undefined {
    const list = ArgParser.as_list(args);
    if (list === undefined) {
      this.adcx().expected_list(span, args);
    }
    return list;
  }

  /// Asserts that a [`MetaItemListParser`] contains a single element and returns it, or emits an
  /// error and returns `None`.
  ///
  /// This is a higher-level (and harder to misuse) wrapper over [`MetaItemListParser::as_single`],
  /// that allows using `?` to early return. You may still want to use
  /// [`MetaItemListParser::as_single`] for the following reasons:
  ///
  /// - You want to emit your own diagnostics (for instance, with [`SharedContext::emit_err`]).
  /// - The attribute can be parsed in multiple ways and it does not make sense to emit an error.
  // #[track_caller]
  // rustc: compiler/rustc_attr_parsing/src/context.rs:563 expect_single
  expect_single(list: MetaItemListParser): MetaItemOrLitParser | undefined {
    const single = list.as_single();
    if (single === undefined) {
      this.adcx().expected_single_argument(list.span, list.len());
    }
    return single;
  }

  /// Asserts that a node is a name-value pair.
  ///
  /// Some examples:
  ///
  /// - `#[clippy::cyclomatic_complexity = "100"]`: `clippy::cyclomatic_complexity = "100"` is a
  ///   name-value pair, where the name is a path (`clippy::cyclomatic_complexity`). You already
  ///   checked the path to get an `ArgParser`, so this method will effectively only assert that
  ///   the `= "100"` is there and returns it.
  /// - `#[doc = "hello"]`: `doc = "hello`  is also a name value pair. `= "hello"` is returned.
  /// - `#[serde(rename_all = "lowercase")]`: `rename_all = "lowercase"` is a name value pair,
  ///   where the name is an identifier (`rename_all`) and the value is a literal (`"lowercase"`).
  ///   This returns both the path and the value.
  ///
  /// `arg` must be a reference to any node that may contain a name-value pair, that is:
  ///
  /// - [`MetaItemOrLitParser`],
  /// - [`MetaItemParser`],
  /// - [`ArgParser`].
  ///
  /// `name` can be set to `Some` for a nicer error message talking about the specific name that
  /// was found lacking a value.
  ///
  /// This is a higher-level (and harder to misuse) wrapper over multiple `as_` methods in the
  /// [`parser`][crate::parser] module. You may still want to use the lower-level methods for the
  /// following reasons:
  ///
  /// - You want to emit your own diagnostics (for instance, with [`SharedContext::emit_err`]).
  /// - The attribute can be parsed in multiple ways and it does not make sense to emit an error.
  // #[track_caller]
  // rustc: compiler/rustc_attr_parsing/src/context.rs:603 expect_name_value
  expect_name_value<Arg, Output>(
    arg: Arg,
    span: Span,
    name: Symbol | undefined,
    Arg_ExpectNameValue: ExpectNameValue<Arg, Output>,
  ): Output | undefined {
    return Arg_ExpectNameValue.expect_name_value(arg, this, span, name);
  }

  /// Assert that an [`ArgParser`] has no args, or emits an error and return `None`.
  ///
  /// This is a higher-level (and harder to misuse) wrapper over multiple
  /// [`ArgParser::as_no_args`]. You may still want to use the lower-level methods for the
  /// following reasons:
  ///
  /// - You want to emit your own diagnostics (for instance, with [`SharedContext::emit_err`]).
  /// - The attribute can be parsed in multiple ways and it does not make sense to emit an error.
  // #[track_caller]
  // rustc: compiler/rustc_attr_parsing/src/context.rs:624 expect_no_args
  expect_no_args(arg: ArgParser): [] | undefined {
    const r = ArgParser.as_no_args(arg);
    if (r.$ === "Err") {
      const span = r._0;
      this.adcx().expected_no_args(span);
      return undefined;
    }

    return [];
  }

  /// Asserts that a node is a string literal, or emits an error and return `None`
  ///
  /// `arg` must be a reference to any node that may contain a name-value pair, that is:
  ///
  /// - [`NameValueParser`],
  /// - [`MetaItemOrLitParser`],
  ///
  /// This is a higher-level (and harder to misuse) wrapper over multiple `as_` methods in the
  /// [`parser`][crate::parser] module. You may still want to use the lower-level methods for the
  /// following reasons:
  ///
  /// - You want to emit your own diagnostics (for instance, with [`SharedContext::emit_err`]).
  /// - The attribute can be parsed in multiple ways and it does not make sense to emit an error.
  // #[track_caller]
  // rustc: compiler/rustc_attr_parsing/src/context.rs:647 expect_string_literal
  expect_string_literal<Arg>(arg: Arg, Arg_ExpectStringLiteral: ExpectStringLiteral<Arg>): Symbol | undefined {
    return Arg_ExpectStringLiteral.expect_string_literal(arg, this);
  }

  // impl Deref for AcceptContext { type Target = SharedContext; }
  // rustc: compiler/rustc_attr_parsing/src/context.rs:776 deref
  deref(): SharedContext {
    return this.shared;
  }

  // rustc: compiler/rustc_attr_parsing/src/context.rs:782 deref_mut
  deref_mut(): SharedContext {
    return this.shared;
  }
}

/** `pub(crate) trait ExpectNameValue` (`type Output<'a>` is the parameter `Output`). */
export interface ExpectNameValue<Self, Output> {
  // #[track_caller]
  // rustc: compiler/rustc_attr_parsing/src/context.rs:661 expect_name_value
  expect_name_value(self: Self, cx: AcceptContext, span: Span, name: Symbol | undefined): Output | undefined;
}

/** The `impl ExpectNameValue for ..` tables. */
export const ExpectNameValue: {
  MetaItemOrLitParser: ExpectNameValue<MetaItemOrLitParser, [Ident, NameValueParser]>;
  MetaItemParser: ExpectNameValue<MetaItemParser, [Ident, NameValueParser]>;
  ArgParser: ExpectNameValue<ArgParser, NameValueParser>;
} = {
  MetaItemOrLitParser: {
    // #[track_caller]
    // rustc: compiler/rustc_attr_parsing/src/context.rs:673 expect_name_value
    expect_name_value(self, cx, span, name) {
      const meta_item = MetaItemOrLitParser.meta_item(self);
      if (meta_item === undefined) {
        cx.adcx().expected_name_value(MetaItemOrLitParser.span(self), name);
        return undefined;
      }

      return ExpectNameValue.MetaItemParser.expect_name_value(meta_item, cx, span, name);
    },
  },
  MetaItemParser: {
    // #[track_caller]
    // rustc: compiler/rustc_attr_parsing/src/context.rs:692 expect_name_value
    expect_name_value(self, cx, _span /* Not needed: `MetaItemOrLitParser` carry its own span. */, name) {
      const word = self.path().word();
      const arg = ArgParser.as_name_value(self.args());

      if (word === undefined) {
        cx.adcx().expected_identifier(self.path().span());
      }

      if (arg === undefined) {
        cx.adcx().expected_name_value(self.span(), name);
      }

      // `word.zip(arg)`
      return word !== undefined && arg !== undefined ? [word, arg] : undefined;
    },
  },
  ArgParser: {
    // #[track_caller]
    // rustc: compiler/rustc_attr_parsing/src/context.rs:717 expect_name_value
    expect_name_value(self, cx, span, name) {
      const nv = ArgParser.as_name_value(self);
      if (nv === undefined) {
        cx.adcx().expected_name_value(span, name);
        return undefined;
      }

      return nv;
    },
  },
};

/** `pub(crate) trait ExpectStringLiteral` */
export interface ExpectStringLiteral<Self> {
  // #[track_caller]
  // rustc: compiler/rustc_attr_parsing/src/context.rs:734 expect_string_literal
  expect_string_literal(self: Self, cx: AcceptContext): Symbol | undefined;
}

/** The `impl ExpectStringLiteral for ..` tables. */
export const ExpectStringLiteral: {
  NameValueParser: ExpectStringLiteral<NameValueParser>;
  MetaItemOrLitParser: ExpectStringLiteral<MetaItemOrLitParser>;
} = {
  NameValueParser: {
    // #[track_caller]
    // rustc: compiler/rustc_attr_parsing/src/context.rs:740 expect_string_literal
    expect_string_literal(self, cx) {
      const value = self.value_as_str();
      if (value === undefined) {
        cx.adcx().expected_string_literal(self.value_span, self.value_as_lit());
      }
      return value;
    },
  },
  MetaItemOrLitParser: {
    // #[track_caller]
    // rustc: compiler/rustc_attr_parsing/src/context.rs:754 expect_string_literal
    expect_string_literal(self, cx) {
      const lit = MetaItemOrLitParser.as_lit(self);
      if (lit === undefined) {
        cx.adcx().expected_string_literal(MetaItemOrLitParser.span(self), undefined);
        return undefined;
      }

      const str = lit.value_as_str();

      if (str === undefined) {
        cx.adcx().expected_string_literal(MetaItemOrLitParser.span(self), lit);
      }

      return str;
    },
  },
};

/// Context given to every attribute parser during finalization.
///
/// Gives [`AttributeParser`](crate::attributes::AttributeParser)s enough information to create
/// errors, for example.
export class FinalizeContext {
  constructor(
    public shared: SharedContext,

    /// A list of all attribute on this syntax node.
    ///
    /// Useful for compatibility checks with other attributes in [`finalize`](crate::attributes::AttributeParser::finalize)
    ///
    /// Usually, you should use normal attribute parsing logic instead,
    /// especially when making a *denylist* of other attributes.
    public all_attrs: readonly RefPathParser[],
  ) {}

  // rustc: compiler/rustc_attr_parsing/src/context.rs:826 deref
  deref(): SharedContext {
    return this.shared;
  }

  // rustc: compiler/rustc_attr_parsing/src/context.rs:832 deref_mut
  deref_mut(): SharedContext {
    return this.shared;
  }
}

/// Context given to deferred cross-attribute checks (`finalize_check`).
///
/// These checks run *after* every attribute on an item has been finalized, so unlike
/// [`FinalizeContext`] this context can also inspect the fully parsed attributes via
/// [`parsed_attrs`](Self::parsed_attrs).
export class FinalizeCheckContext {
  constructor(
    public shared: SharedContext,

    /// A list of all attribute on this syntax node.
    ///
    /// Useful for compatibility checks with other attributes.
    ///
    /// Unlike [`parsed_attrs`](Self::parsed_attrs), this only contains the *paths* of the
    /// attributes.
    public all_attrs: readonly RefPathParser[],

    /// All attributes that have been parsed on this syntax node.
    ///
    /// Unlike [`all_attrs`](Self::all_attrs), this contains the fully parsed attributes.
    public parsed_attrs: readonly Attribute[],

    /// The AST item these attributes were applied to, when the target is an item.
    /// Used by `finalize_check` to inspect item structure that is not encoded in [`Target`].
    public target_item: Item | undefined,
  ) {}

  // rustc: compiler/rustc_attr_parsing/src/context.rs:866 deref
  deref(): SharedContext {
    return this.shared;
  }

  // rustc: compiler/rustc_attr_parsing/src/context.rs:872 deref_mut
  deref_mut(): SharedContext {
    return this.shared;
  }
}

/** `#[derive(Copy, Clone, Debug)] pub enum ShouldEmit` */
export type ShouldEmit =
  /// The operations will emit errors, and lints, and errors are fatal.
  ///
  /// Only relevant when early parsing, in late parsing equivalent to `ErrorsAndLints`.
  /// Late parsing is never fatal, and instead tries to emit as many diagnostics as possible.
  | { readonly $: "EarlyFatal"; readonly also_emit_lints: boolean }
  /// The operation will emit errors and lints.
  /// This is usually what you need.
  | {
      readonly $: "ErrorsAndLints";
      /// Whether [`ArgParser`] will attempt to recover from errors.
      ///
      /// Whether it is allowed to recover from bad input (like an invalid literal). Setting
      /// this to `Forbidden` will instead return early, and not raise errors except at the top
      /// level (in [`ArgParser::from_attr_args`]).
      readonly recovery: Recovery;
    }
  /// The operation will *not* emit errors and lints.
  ///
  /// The parser can still call `delay_bug`, so you *must* ensure that this operation will also be
  /// called with `ShouldEmit::ErrorsAndLints`.
  | { readonly $: "Nothing" };

export const debug_ShouldEmit: Debug<ShouldEmit> = (v, f) => {
  switch (v.$) {
    case "EarlyFatal":
      return debug_struct(f, "EarlyFatal", [["also_emit_lints", debug_bool(v.also_emit_lints, f)]]);
    case "ErrorsAndLints":
      return debug_struct(f, "ErrorsAndLints", [["recovery", v.recovery]]);
    case "Nothing":
      return "Nothing";
  }
};

export const ShouldEmit = {
  Nothing: Object.freeze({ $: "Nothing" as const }) as ShouldEmit,

  // #[track_caller]
  // rustc: compiler/rustc_attr_parsing/src/context.rs:917 emit_err
  emit_err(self: ShouldEmit, diag: Diag): ErrorGuaranteed {
    switch (self.$) {
      case "EarlyFatal":
        if (Level_eq(diag.deref().level_(), Level.DelayedBug)) {
          return diag.emit_err();
        }
        return diag.upgrade_to_fatal().emit_fatal();
      case "ErrorsAndLints":
        return diag.emit_err();
      case "Nothing":
        return diag.delay_as_bug();
    }
  },
};

/// The interface for issuing argument parsing related diagnostics.
///
/// It can be obtained through the [`adcx`](AcceptContext::adcx) method on [`AcceptContext`].
export class AttributeDiagnosticContext {
  constructor(
    public ctx: AcceptContext,
    public custom_suggestions: Suggestion[],
  ) {}

  // #[track_caller]
  // rustc: compiler/rustc_attr_parsing/src/context.rs:937 emit_parse_error
  emit_parse_error(span: Span, reason: AttributeParseErrorReason): ErrorGuaranteed {
    let suggestions: AttributeParseErrorSuggestions;
    if (this.custom_suggestions.length === 0) {
      suggestions = { $: "CreatedByTemplate", _0: this.suggestions() };
    } else {
      // `mem::take(&mut self.custom_suggestions)`
      const taken = this.custom_suggestions;
      this.custom_suggestions = [];
      suggestions = { $: "CreatedByParser", _0: taken };
    }

    // If the span is the full attribute (including the `#[`/`]` delimiters) shrink it to
    // exclude those delimiters, because that's what we want in error messages.
    if (span === this.ctx.attr_span) {
      span = this.ctx.inner_span;
    }

    return this.ctx.shared.emit_err(
      AttributeParseError_diagnostic({
        span,
        inner_span: this.ctx.inner_span,
        template: this.ctx.template,
        path: clone_AttrPath(this.ctx.attr_path),
        description: this.ctx.parsed_description,
        reason,
        suggestions,
      }),
    );
  }

  /// Adds a custom suggestion to the diagnostic. This also prevents the default (template-based)
  /// suggestion to be emitted.
  // rustc: compiler/rustc_attr_parsing/src/context.rs:967 push_suggestion
  push_suggestion(msg: string, span: Span, code: string): this {
    this.custom_suggestions.push({ msg, sp: span, code });
    return this;
  }

  // #[track_caller]
  // rustc: compiler/rustc_attr_parsing/src/context.rs:976 expected_integer_literal_in_range
  expected_integer_literal_in_range(span: Span, lower_bound: number, upper_bound: number): ErrorGuaranteed {
    return this.emit_parse_error(span, { $: "ExpectedIntegerLiteralInRange", lower_bound, upper_bound });
  }

  /// The provided span is used as a fallback in case `args` does not contain any. It should be
  /// the span of the node that contains `args`.
  // #[track_caller]
  // rustc: compiler/rustc_attr_parsing/src/context.rs:991 expected_list
  expected_list(span: Span, args: ArgParser): ErrorGuaranteed {
    let span_: Span;
    switch (args.$) {
      case "NoArgs":
        span_ = span;
        break;
      case "List":
        span_ = args._0.span;
        break;
      case "NameValue":
        span_ = args._0.args_span();
        break;
    }
    return this.emit_parse_error(span_, { $: "ExpectedList" });
  }

  // #[track_caller]
  // rustc: compiler/rustc_attr_parsing/src/context.rs:1001 expected_list_with_num_args_or_more
  expected_list_with_num_args_or_more(args: number, span: Span): ErrorGuaranteed {
    return this.emit_parse_error(span, { $: "ExpectedListWithNumArgsOrMore", args });
  }

  // #[track_caller]
  // rustc: compiler/rustc_attr_parsing/src/context.rs:1013 expected_list_or_no_args
  expected_list_or_no_args(span: Span): ErrorGuaranteed {
    return this.emit_parse_error(span, { $: "ExpectedListOrNoArgs" });
  }

  // #[track_caller]
  // rustc: compiler/rustc_attr_parsing/src/context.rs:1018 expected_nv_or_no_args
  expected_nv_or_no_args(span: Span): ErrorGuaranteed {
    return this.emit_parse_error(span, { $: "ExpectedNameValueOrNoArgs" });
  }

  // #[track_caller]
  // rustc: compiler/rustc_attr_parsing/src/context.rs:1023 expected_non_empty_string_literal
  expected_non_empty_string_literal(span: Span): ErrorGuaranteed {
    return this.emit_parse_error(span, { $: "ExpectedNonEmptyStringLiteral" });
  }

  // #[track_caller]
  // rustc: compiler/rustc_attr_parsing/src/context.rs:1028 expected_no_args
  expected_no_args(span: Span): ErrorGuaranteed {
    return this.emit_parse_error(span, { $: "ExpectedNoArgs" });
  }

  /// Emit an error that a `name` was expected here
  // #[track_caller]
  // rustc: compiler/rustc_attr_parsing/src/context.rs:1034 expected_identifier
  expected_identifier(span: Span): ErrorGuaranteed {
    return this.emit_parse_error(span, { $: "ExpectedIdentifier" });
  }

  /// Emit an error that a `name = value` pair was expected at this span. The symbol can be given for
  /// a nicer error message talking about the specific name that was found lacking a value.
  // #[track_caller]
  // rustc: compiler/rustc_attr_parsing/src/context.rs:1041 expected_name_value
  expected_name_value(span: Span, name: Symbol | undefined): ErrorGuaranteed {
    return this.emit_parse_error(span, { $: "ExpectedNameValue", _0: name });
  }

  /// Emit an error that a `name = value` argument is missing in a list of name-value pairs.
  // #[track_caller]
  // rustc: compiler/rustc_attr_parsing/src/context.rs:1047 missing_name_value
  missing_name_value(span: Span, name: Symbol): ErrorGuaranteed {
    return this.emit_parse_error(span, { $: "MissingNameValue", _0: name });
  }

  /// Emit an error that a `name = value` pair was found where that name was already seen.
  // #[track_caller]
  // rustc: compiler/rustc_attr_parsing/src/context.rs:1053 duplicate_key
  duplicate_key(span: Span, key: Symbol): ErrorGuaranteed {
    return this.emit_parse_error(span, { $: "DuplicateKey", _0: key });
  }

  /// An error that should be emitted when a [`MetaItemOrLitParser`]
  /// was expected *not* to be a literal, but instead a meta item.
  // #[track_caller]
  // rustc: compiler/rustc_attr_parsing/src/context.rs:1060 expected_not_literal
  expected_not_literal(span: Span): ErrorGuaranteed {
    return this.emit_parse_error(span, { $: "ExpectedNotLiteral" });
  }

  /// Signals that we expected exactly one argument and that we got either zero or two or more.
  /// The `provided_arguments` argument allows distinguishing between "expected an argument here"
  /// (when zero arguments are provided) and "expect a single argument here" (when two or more
  /// arguments are provided).
  // #[track_caller]
  // rustc: compiler/rustc_attr_parsing/src/context.rs:1069 expected_single_argument
  expected_single_argument(span: Span, provided_arguments: number): ErrorGuaranteed {
    const reason: AttributeParseErrorReason =
      provided_arguments === 0 ? { $: "ExpectedArgument" } : { $: "ExpectedSingleArgument" };

    return this.emit_parse_error(span, reason);
  }

  // #[track_caller]
  // rustc: compiler/rustc_attr_parsing/src/context.rs:1084 expected_at_least_one_argument
  expected_at_least_one_argument(span: Span): ErrorGuaranteed {
    return this.emit_parse_error(span, { $: "ExpectedAtLeastOneArgument" });
  }

  /// Produces an error along the lines of `expected one of [foo, meow]`
  // #[track_caller]
  // rustc: compiler/rustc_attr_parsing/src/context.rs:1090 expected_specific_argument
  expected_specific_argument(span: Span, possibilities: readonly Symbol[]): ErrorGuaranteed {
    return this.emit_parse_error(span, { $: "ExpectedSpecificArgument", possibilities, strings: false, list: false });
  }

  /// Produces an error along the lines of `expected one of [foo, meow] as an argument`.
  /// i.e. slightly different wording to [`expected_specific_argument`](Self::expected_specific_argument).
  // #[track_caller]
  // rustc: compiler/rustc_attr_parsing/src/context.rs:1108 expected_specific_argument_and_list
  expected_specific_argument_and_list(span: Span, possibilities: readonly Symbol[]): ErrorGuaranteed {
    return this.emit_parse_error(span, { $: "ExpectedSpecificArgument", possibilities, strings: false, list: true });
  }

  /// produces an error along the lines of `expected one of ["foo", "meow"]`
  // #[track_caller]
  // rustc: compiler/rustc_attr_parsing/src/context.rs:1125 expected_specific_argument_strings
  expected_specific_argument_strings(span: Span, possibilities: readonly Symbol[]): ErrorGuaranteed {
    return this.emit_parse_error(span, { $: "ExpectedSpecificArgument", possibilities, strings: true, list: false });
  }

  // rustc: compiler/rustc_attr_parsing/src/context.rs:1140 warn_empty_attribute
  warn_empty_attribute(span: Span): void {
    const attr_path = display_AttrPath(this.ctx.attr_path);
    const valid_without_list = this.ctx.template.word;
    this.ctx.shared.emit_lint(
      UNUSED_ATTRIBUTES,
      EmptyAttributeList_diagnostic({ attr_span: span, attr_path, valid_without_list }),
      span,
    );
  }

  // rustc: compiler/rustc_attr_parsing/src/context.rs:1154 warn_ill_formed_attribute_input
  warn_ill_formed_attribute_input(lint: Lint): void {
    this.warn_ill_formed_attribute_input_with_help(lint, undefined);
  }
  // rustc: compiler/rustc_attr_parsing/src/context.rs:1157 warn_ill_formed_attribute_input_with_help
  warn_ill_formed_attribute_input_with_help(lint: Lint, help: string | undefined): void {
    const suggestions = this.suggestions();
    const span = this.ctx.inner_span;
    this.ctx.shared.emit_lint(
      lint,
      IllFormedAttributeInput_diagnostic(IllFormedAttributeInput.new(suggestions, undefined, help)),
      span,
    );
  }

  // rustc: compiler/rustc_attr_parsing/src/context.rs:1171 suggestions
  suggestions(): string[] {
    return this.ctx.template.suggestions(this.ctx.parsed_description, this.ctx.attr_safety, display_AttrPath(this.ctx.attr_path));
  }
  /// Error that a string literal was expected.
  /// You can optionally give the literal you did find (which you found not to be a string literal)
  /// which can make better errors. For example, if the literal was a byte string it will suggest
  /// removing the `b` prefix.
  // rustc: compiler/rustc_attr_parsing/src/context.rs:1178 expected_string_literal
  expected_string_literal(span: Span, actual_literal: MetaItemLit | undefined): ErrorGuaranteed {
    return this.emit_parse_error(span, {
      $: "ExpectedStringLiteral",
      byte_string:
        actual_literal === undefined
          ? undefined
          : LitKind.is_bytestr(actual_literal.kind)
            ? this.ctx.shared.cx.sess().source_map().start_point(actual_literal.span)
            : undefined,
    });
  }

  /// Error that a filename string literal was expected.
  // rustc: compiler/rustc_attr_parsing/src/context.rs:1194 expected_filename_literal
  expected_filename_literal(span: Span): void {
    this.emit_parse_error(span, { $: "ExpectedFilenameLiteral" });
  }

  // rustc: compiler/rustc_attr_parsing/src/context.rs:1198 expected_integer_literal
  expected_integer_literal(span: Span): ErrorGuaranteed {
    return this.emit_parse_error(span, { $: "ExpectedIntegerLiteral" });
  }

  // impl Deref for AttributeDiagnosticContext { type Target = AcceptContext; }
  // rustc: compiler/rustc_attr_parsing/src/context.rs:1206 deref
  deref(): AcceptContext {
    return this.ctx;
  }

  // rustc: compiler/rustc_attr_parsing/src/context.rs:1212 deref_mut
  deref_mut(): AcceptContext {
    return this.ctx;
  }
}

/// Represents a custom suggestion that an attribute parser can emit.
export interface Suggestion {
  msg: string;
  sp: Span;
  code: string;
}
