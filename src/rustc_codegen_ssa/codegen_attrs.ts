// Port of compiler/rustc_codegen_ssa/src/codegen_attrs.rs.
//
// `InterestingAttributeDiagnosticSpans` and the `SanitizeOnInline` / `AsyncBlocking` diagnostics are generated into
// codegen_attrs.gen.ts (tools/codegen/types.ts, set rustc_codegen_ssa).
// PORT: the query values `codegen_fn_attrs` / `sanitizer_settings_for` / `fn_sig` / `asyncness` /
// `all_rust_target_features` are `unknown` (or loosely typed) in queries.gen.ts; their readers here cast to the
// ported types. `codegen_fn_attrs.flags |= X` is `CodegenFnAttrFlags.union` (bitflags `BitOrAssign`).
import { type Align } from "../rustc_abi/lib.ts";
import { ExternAbi } from "../rustc_abi/extern_abi.ts";
import { type Attribute, type AttributeKind, find_attr } from "../rustc_attr_ir/lib.ts";
import { InlineAttr as InlineAttrC } from "../rustc_attr_ir/data_structures.ts";
import { LangItem } from "../rustc_attr_ir/lang_items.ts";
import { DefKind } from "../rustc_hir/def.ts";
import { Node } from "../rustc_hir/hir.ts";
import { INLINE_NO_SANITIZE, RTSAN_NONBLOCKING_ASYNC } from "../rustc_lint_defs/builtin.gen.ts";
import {
  CodegenFnAttrFlags,
  CodegenFnAttrs,
  Option_Align_max,
  PatchableFunctionEntry,
  SanitizerFnAttrs,
  SanitizerFnAttrs_eq,
  type TargetFeature,
} from "../rustc_middle/middle/codegen_fn_attrs.ts";
import type { Providers } from "../rustc_middle/queries.gen.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { Asyncness, HasAttrs_DefId, HasAttrs_LocalDefId } from "../rustc_middle/ty/mod.ts";
import { type DefId, LOCAL_CRATE, LocalDefId } from "../rustc_span/def_id.ts";
import { DUMMY_SP, type Span } from "../rustc_span/lib.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { SanitizerSet } from "../rustc_structures/sanitizer_set.ts";
import { Binder, EarlyBinder } from "../rustc_type_ir/binder.ts";
import { type FnSig, PolyFnSig } from "../rustc_type_ir/ty_kind.ts";
import type { Stability } from "../rustc_target/target_features.ts";
import { bug } from "../rustc_span/macros.ts";
import { assert } from "../std/panic.ts";
import { AsyncBlocking_diagnostic, default_InterestingAttributeDiagnosticSpans, type InterestingAttributeDiagnosticSpans, SanitizeOnInline_diagnostic } from "./codegen_attrs.gen.ts";
import * as diagnostics from "./diagnostics.ts";
import { check_target_feature_trait_unsafe, check_tied_features, from_target_feature_attr } from "./target_features.ts";

export * from "./codegen_attrs.gen.ts";

/// In some cases, attributes are only valid on functions, but it's the `check_attr`
/// pass that checks that they aren't used anywhere else, rather than this module.
/// In these cases, we bail from performing further checks that are only meaningful for
/// functions (such as calling `fn_sig`, which ICEs if given a non-function). We also
/// report a delayed bug, just in case `check_attr` isn't doing its job.
// rustc: compiler/rustc_codegen_ssa/src/codegen_attrs.rs:30 try_fn_sig
function try_fn_sig(tcx: TyCtxt, did: LocalDefId, attr_span: Span): EarlyBinder<Binder<FnSig>> | undefined {
  // use DefKind::*;

  const def_kind = tcx.def_kind(did);
  if (def_kind.$ === "Fn" || def_kind.$ === "AssocFn" || def_kind.$ === "Variant" || def_kind.$ === "Ctor") {
    return tcx.fn_sig(did) as EarlyBinder<Binder<FnSig>>;
  } else {
    tcx.dcx().span_delayed_bug(attr_span, "this attribute can only be applied to functions");
    return undefined;
  }
}

/// Process the builtin attrs ([`rustc_attr_ir::Attribute`]) on the item.
/// Many of them directly translate to codegen attrs.
// rustc: compiler/rustc_codegen_ssa/src/codegen_attrs.rs:58 process_builtin_attrs
function process_builtin_attrs(
  tcx: TyCtxt,
  did: LocalDefId,
  attrs: readonly Attribute[],
  codegen_fn_attrs: CodegenFnAttrs,
): InterestingAttributeDiagnosticSpans {
  const interesting_spans = default_InterestingAttributeDiagnosticSpans();
  const rust_target_features = tcx.all_rust_target_features(LOCAL_CRATE) as Map<string, Stability>;

  const parsed_attrs: AttributeKind[] = [];
  for (const attr of attrs) if (attr.$ === "Parsed") parsed_attrs.push(attr._0);
  for (const attr of parsed_attrs) {
    switch (attr.$) {
      case "Cold":
        codegen_fn_attrs.flags = CodegenFnAttrFlags.union(codegen_fn_attrs.flags, CodegenFnAttrFlags.COLD);
        break;
      case "ExportName":
        codegen_fn_attrs.symbol_name = attr.name;
        break;
      case "Inline": {
        const inline = attr._0;
        const span = attr._1;
        codegen_fn_attrs.inline = inline;
        interesting_spans.inline = span;
        break;
      }
      case "Naked":
        codegen_fn_attrs.flags = CodegenFnAttrFlags.union(codegen_fn_attrs.flags, CodegenFnAttrFlags.NAKED);
        break;
      case "RustcAlign":
        codegen_fn_attrs.alignment = attr.align;
        break;
      case "LinkName": {
        // FIXME Remove check for foreign functions once #[link_name] on non-foreign
        // functions is a hard error
        if (tcx.is_foreign_item(did)) {
          codegen_fn_attrs.symbol_name = attr.name;
        }
        break;
      }
      case "LinkOrdinal": {
        codegen_fn_attrs.link_ordinal = attr.ordinal;
        interesting_spans.link_ordinal = attr.span;
        break;
      }
      case "LinkSection":
        codegen_fn_attrs.link_section = attr.name;
        break;
      case "NoMangle": {
        const attr_span = attr._0;
        interesting_spans.no_mangle = attr_span;
        if (tcx.opt_item_name(LocalDefId.to_def_id(did)) !== undefined) {
          codegen_fn_attrs.flags = CodegenFnAttrFlags.union(codegen_fn_attrs.flags, CodegenFnAttrFlags.NO_MANGLE);
        } else {
          tcx.dcx().span_delayed_bug(attr_span, "no_mangle should be on a named function");
        }
        break;
      }
      case "Optimize":
        codegen_fn_attrs.optimize = attr._0;
        break;
      case "TargetFeature": {
        const { features, attr_span, was_forced } = attr;
        const sig = Node.fn_sig(tcx.hir_node_by_def_id(did));
        if (sig === undefined) {
          tcx.dcx().span_delayed_bug(attr_span, "target_feature applied to non-fn");
          continue;
        }
        const safe_target_features = sig.header.safety.$ === "SafeTargetFeatures";
        codegen_fn_attrs.safe_target_features = safe_target_features;
        if (safe_target_features && !was_forced) {
          if (tcx.sess.target.is_like_wasm || tcx.sess.opts.actually_rustdoc) {
            // The `#[target_feature]` attribute is allowed on
            // WebAssembly targets on all functions. Prior to stabilizing
            // the `target_feature_11` feature, `#[target_feature]` was
            // only permitted on unsafe functions because on most targets
            // execution of instructions that are not supported is
            // considered undefined behavior. For WebAssembly which is a
            // 100% safe target at execution time it's not possible to
            // execute undefined instructions, and even if a future
            // feature was added in some form for this it would be a
            // deterministic trap. There is no undefined behavior when
            // executing WebAssembly so `#[target_feature]` is allowed
            // on safe functions (but again, only for WebAssembly)
            //
            // Note that this is also allowed if `actually_rustdoc` so
            // if a target is documenting some wasm-specific code then
            // it's not spuriously denied.
            //
            // Now that `#[target_feature]` is permitted on safe functions,
            // this exception must still exist for allowing the attribute on
            // `main`, `start`, and other functions that are not usually
            // allowed.
          } else {
            check_target_feature_trait_unsafe(tcx, did, attr_span);
          }
        }
        from_target_feature_attr(tcx, did, features, was_forced, rust_target_features, codegen_fn_attrs.target_features);
        break;
      }
      case "TrackCaller": {
        const attr_span = attr._0;
        const is_closure = tcx.is_closure_like(LocalDefId.to_def_id(did));

        let fn_sig: EarlyBinder<Binder<FnSig>> | undefined;
        if (
          !is_closure &&
          (fn_sig = try_fn_sig(tcx, did, attr_span)) !== undefined &&
          !ExternAbi.eq(PolyFnSig.abi(EarlyBinder.skip_binder(fn_sig)), ExternAbi.Rust)
        ) {
          // This error is already reported in `rustc_ast_passes/src/ast_validation.rs`.
          tcx.dcx().delayed_bug("`#[track_caller]` requires the Rust ABI");
        }
        codegen_fn_attrs.flags = CodegenFnAttrFlags.union(codegen_fn_attrs.flags, CodegenFnAttrFlags.TRACK_CALLER);
        break;
      }
      case "Used": {
        switch (attr.used_by) {
          case "Compiler":
            codegen_fn_attrs.flags = CodegenFnAttrFlags.union(codegen_fn_attrs.flags, CodegenFnAttrFlags.USED_COMPILER);
            break;
          case "Linker":
            codegen_fn_attrs.flags = CodegenFnAttrFlags.union(codegen_fn_attrs.flags, CodegenFnAttrFlags.USED_LINKER);
            break;
          case "Default": {
            let used_form: CodegenFnAttrFlags;
            if (tcx.sess.target.os.$ === "Illumos") {
              // illumos' `ld` doesn't support a section header that would represent
              // `#[used(linker)]`, see
              // https://github.com/rust-lang/rust/issues/146169. For that target,
              // downgrade as if `#[used(compiler)]` was requested and hope for the
              // best.
              used_form = CodegenFnAttrFlags.USED_COMPILER;
            } else {
              used_form = CodegenFnAttrFlags.USED_LINKER;
            }
            codegen_fn_attrs.flags = CodegenFnAttrFlags.union(codegen_fn_attrs.flags, used_form);
            break;
          }
        }
        break;
      }
      case "FfiConst":
        codegen_fn_attrs.flags = CodegenFnAttrFlags.union(codegen_fn_attrs.flags, CodegenFnAttrFlags.FFI_CONST);
        break;
      case "FfiPure":
        codegen_fn_attrs.flags = CodegenFnAttrFlags.union(codegen_fn_attrs.flags, CodegenFnAttrFlags.FFI_PURE);
        break;
      case "RustcStdInternalSymbol":
        codegen_fn_attrs.flags = CodegenFnAttrFlags.union(codegen_fn_attrs.flags, CodegenFnAttrFlags.RUSTC_STD_INTERNAL_SYMBOL);
        break;
      case "Linkage": {
        const linkage = attr._0;
        const span = attr._1;

        if (tcx.is_foreign_item(did)) {
          codegen_fn_attrs.import_linkage = linkage;

          if (tcx.is_mutable_static(LocalDefId.to_def_id(did))) {
            tcx.dcx().span_delayed_bug(span, "`extern { #[linkage] static mut ...` is checked in check_attr}");
          }
        } else {
          codegen_fn_attrs.linkage = linkage;
        }
        break;
      }
      case "Sanitize": {
        interesting_spans.sanitize = attr.span;
        break;
      }
      case "RustcObjcClass": {
        codegen_fn_attrs.objc_class = attr.classname;
        break;
      }
      case "RustcObjcSelector": {
        codegen_fn_attrs.objc_selector = attr.methname;
        break;
      }
      case "RustcEiiForeignItem": {
        codegen_fn_attrs.flags = CodegenFnAttrFlags.union(codegen_fn_attrs.flags, CodegenFnAttrFlags.EXTERNALLY_IMPLEMENTABLE_ITEM);
        break;
      }
      case "EiiImpl": {
        const i = attr._0;
        let foreign_item: DefId;
        switch (i.resolution.$) {
          case "Macro": {
            const def_id = i.resolution._0;
            const extern_item = find_attr(HasAttrs_DefId.get_attrs(def_id, tcx), (k) => (k.$ === "EiiDeclaration" ? k._0.foreign_item : undefined));
            if (extern_item === undefined) {
              tcx.dcx().span_delayed_bug(i.span, "resolved to something that's not an EII");
              continue;
            }
            foreign_item = extern_item;
            break;
          }
          case "Known":
            foreign_item = i.resolution._0;
            break;
          case "Error":
            continue;
        }

        // this is to prevent a bug where a single crate defines both the default and explicit implementation
        // for an EII. In that case, both of them may be part of the same final object file. I'm not 100% sure
        // what happens, either rustc deduplicates the symbol or llvm, or it's random/order-dependent.
        // However, the fact that the default one of has weak linkage isn't considered and you sometimes get that
        // the default implementation is used while an explicit implementation is given.
        if (
          // if this is a default impl
          i.is_default &&
          // iterate over all implementations *in the current crate*
          // (this is ok since we generate codegen fn attrs in the local crate)
          // if any of them is *not default* then don't emit the alias.
          (() => {
            const entry = tcx.externally_implementable_items(LOCAL_CRATE).get(foreign_item) ?? bug("EII impl should have an entry");
            const impls = entry[1] as Map<DefId, { is_default: boolean }>;
            return [...impls.values()].some((imp) => !imp.is_default);
          })()
        ) {
          continue;
        }

        codegen_fn_attrs.foreign_item_symbol_aliases.push([foreign_item, i.is_default ? "WeakAny" : "External", "Default"]);
        codegen_fn_attrs.flags = CodegenFnAttrFlags.union(codegen_fn_attrs.flags, CodegenFnAttrFlags.EXTERNALLY_IMPLEMENTABLE_ITEM);

        // If the declaration is `#[track_caller]`, derive it onto the implementation
        // too. The shim that forwards to this impl (see `add_function_aliases`) takes
        // its ABI from the impl's `fn_abi`, so every impl must agree on whether the
        // caller-location argument is present, otherwise it would be silently dropped.
        if (CodegenFnAttrFlags.contains((tcx.codegen_fn_attrs(foreign_item) as CodegenFnAttrs).flags, CodegenFnAttrFlags.TRACK_CALLER)) {
          codegen_fn_attrs.flags = CodegenFnAttrFlags.union(codegen_fn_attrs.flags, CodegenFnAttrFlags.TRACK_CALLER);
        }
        break;
      }
      case "ThreadLocal":
        codegen_fn_attrs.flags = CodegenFnAttrFlags.union(codegen_fn_attrs.flags, CodegenFnAttrFlags.THREAD_LOCAL);
        break;
      case "InstructionSet":
        codegen_fn_attrs.instruction_set = attr._0;
        break;
      case "RustcAllocator":
        codegen_fn_attrs.flags = CodegenFnAttrFlags.union(codegen_fn_attrs.flags, CodegenFnAttrFlags.ALLOCATOR);
        break;
      case "RustcDeallocator":
        codegen_fn_attrs.flags = CodegenFnAttrFlags.union(codegen_fn_attrs.flags, CodegenFnAttrFlags.DEALLOCATOR);
        break;
      case "RustcReallocator":
        codegen_fn_attrs.flags = CodegenFnAttrFlags.union(codegen_fn_attrs.flags, CodegenFnAttrFlags.REALLOCATOR);
        break;
      case "RustcAllocatorZeroed":
        codegen_fn_attrs.flags = CodegenFnAttrFlags.union(codegen_fn_attrs.flags, CodegenFnAttrFlags.ALLOCATOR_ZEROED);
        break;
      case "RustcNounwind":
        codegen_fn_attrs.flags = CodegenFnAttrFlags.union(codegen_fn_attrs.flags, CodegenFnAttrFlags.NEVER_UNWIND);
        break;
      case "RustcOffloadKernel":
        codegen_fn_attrs.flags = CodegenFnAttrFlags.union(codegen_fn_attrs.flags, CodegenFnAttrFlags.OFFLOAD_KERNEL);
        break;
      case "PatchableFunctionEntry": {
        const { prefix, entry, section } = attr;
        codegen_fn_attrs.patchable_function_entry = PatchableFunctionEntry.from_prefix_entry_and_section(prefix, entry, section);
        break;
      }
      case "InstrumentFn": {
        codegen_fn_attrs.instrument_fn = attr._0;
        break;
      }
      default:
        break;
    }
  }

  return interesting_spans;
}

/// Applies overrides for codegen fn attrs. These often have a specific reason why they're necessary.
/// Please comment why when adding a new one!
// rustc: compiler/rustc_codegen_ssa/src/codegen_attrs.rs:305 apply_overrides
function apply_overrides(tcx: TyCtxt, did: LocalDefId, codegen_fn_attrs: CodegenFnAttrs): void {
  // Apply the minimum function alignment here. This ensures that a function's alignment is
  // determined by the `-C` flags of the crate it is defined in, not the `-C` flags of the crate
  // it happens to be codegen'd (or const-eval'd) in.
  codegen_fn_attrs.alignment = Option_Align_max(codegen_fn_attrs.alignment, tcx.sess.opts.unstable_opts.min_function_alignment);

  // Passed in sanitizer settings are always the default.
  assert(SanitizerFnAttrs_eq(codegen_fn_attrs.sanitizers, SanitizerFnAttrs.default()), "assertion failed: codegen_fn_attrs.sanitizers == SanitizerFnAttrs::default()");
  // Replace with #[sanitize] value
  codegen_fn_attrs.sanitizers = tcx.sanitizer_settings_for(did) as SanitizerFnAttrs;
  // On trait methods, inherit the `#[align]` of the trait's method prototype.
  codegen_fn_attrs.alignment = Option_Align_max(codegen_fn_attrs.alignment, tcx.inherited_align(did));

  // naked function MUST NOT be inlined! This attribute is required for the rust compiler itself,
  // but not for the code generation backend because at that point the naked function will just be
  // a declaration, with a definition provided in global assembly.
  if (CodegenFnAttrFlags.contains(codegen_fn_attrs.flags, CodegenFnAttrFlags.NAKED)) {
    codegen_fn_attrs.inline = { $: "Never" };
  }

  // #73631: closures inherit `#[target_feature]` annotations
  //
  // If this closure is marked `#[inline(always)]`, simply skip adding `#[target_feature]`.
  //
  // At this point, `unsafe` has already been checked and `#[target_feature]` only affects codegen.
  // Due to LLVM limitations, emitting both `#[inline(always)]` and `#[target_feature]` is *unsound*:
  // the function may be inlined into a caller with fewer target features. Also see
  // <https://github.com/rust-lang/rust/issues/116573>.
  //
  // Using `#[inline(always)]` implies that this closure will most likely be inlined into
  // its parent function, which effectively inherits the features anyway. Boxing this closure
  // would result in this closure being compiled without the inherited target features, but this
  // is probably a poor usage of `#[inline(always)]` and easily avoided by not using the attribute.
  // PORT: `codegen_fn_attrs.inline != InlineAttr::Always` (derived `PartialEq`; `Always` has no fields).
  if (tcx.is_closure_like(LocalDefId.to_def_id(did)) && codegen_fn_attrs.inline.$ !== "Always") {
    const owner_id = tcx.parent(LocalDefId.to_def_id(did));
    if (DefKind.has_codegen_attrs(tcx.def_kind(owner_id))) {
      const owner_features: readonly TargetFeature[] = (tcx.codegen_fn_attrs(owner_id) as CodegenFnAttrs).target_features;
      for (const f of owner_features) codegen_fn_attrs.target_features.push({ name: f.name, kind: f.kind });
    }
  }

  // Closures inherit `#[optimize]` annotations.
  if (tcx.is_closure_like(LocalDefId.to_def_id(did))) {
    const owner_id = tcx.parent(LocalDefId.to_def_id(did));
    if (DefKind.has_codegen_attrs(tcx.def_kind(owner_id))) {
      const owner_attrs = tcx.codegen_fn_attrs(owner_id) as CodegenFnAttrs;
      if (codegen_fn_attrs.optimize === "Default") {
        codegen_fn_attrs.optimize = owner_attrs.optimize;
      }
    }
  }

  // When `no_builtins` is applied at the crate level, we should add the
  // `no-builtins` attribute to each function to ensure it takes effect in LTO.
  const no_builtins = find_attr(tcx.hir_krate_attrs(), (k) => (k.$ === "NoBuiltins" ? null : undefined)) !== undefined;
  if (no_builtins) {
    codegen_fn_attrs.flags = CodegenFnAttrFlags.union(codegen_fn_attrs.flags, CodegenFnAttrFlags.NO_BUILTINS);
  }

  // inherit track-caller properly
  if (tcx.should_inherit_track_caller(did)) {
    codegen_fn_attrs.flags = CodegenFnAttrFlags.union(codegen_fn_attrs.flags, CodegenFnAttrFlags.TRACK_CALLER);
  }

  // Foreign items by default use no mangling for their symbol name.
  if (tcx.is_foreign_item(did)) {
    codegen_fn_attrs.flags = CodegenFnAttrFlags.union(codegen_fn_attrs.flags, CodegenFnAttrFlags.FOREIGN_ITEM);

    // There's a few exceptions to this rule though:
    if (CodegenFnAttrFlags.contains(codegen_fn_attrs.flags, CodegenFnAttrFlags.RUSTC_STD_INTERNAL_SYMBOL)) {
      // * `#[rustc_std_internal_symbol]` mangles the symbol name in a special way
      //   both for exports and imports through foreign items. This is handled further,
      //   during symbol mangling logic.
    } else if (CodegenFnAttrFlags.contains(codegen_fn_attrs.flags, CodegenFnAttrFlags.EXTERNALLY_IMPLEMENTABLE_ITEM)) {
      // * externally implementable items keep their mangled symbol name.
      //   multiple EIIs can have the same name, so not mangling them would be a bug.
      //   Implementing an EII does the appropriate name resolution to make sure the implementations
      //   get the same symbol name as the *mangled* foreign item they refer to so that's all good.
    } else if (codegen_fn_attrs.symbol_name !== undefined) {
      // * This can be overridden with the `#[link_name]` attribute
    } else {
      // NOTE: there's one more exception that we cannot apply here. On wasm,
      // some items cannot be `no_mangle`.
      // However, we don't have enough information here to determine that.
      // As such, no_mangle foreign items on wasm that have the same defid as some
      // import will *still* be mangled despite this.
      //
      // if none of the exceptions apply; apply no_mangle
      codegen_fn_attrs.flags = CodegenFnAttrFlags.union(codegen_fn_attrs.flags, CodegenFnAttrFlags.NO_MANGLE);
    }
  }
}

// rustc: compiler/rustc_codegen_ssa/src/codegen_attrs.rs:412 check_result
function check_result(tcx: TyCtxt, did: LocalDefId, interesting_spans: InterestingAttributeDiagnosticSpans, codegen_fn_attrs: CodegenFnAttrs): void {
  // If a function uses `#[target_feature]` it can't be inlined into general
  // purpose functions as they wouldn't have the right target features
  // enabled. For that reason we also forbid `#[inline(always)]` as it can't be
  // respected.
  //
  // `#[rustc_force_inline]` doesn't need to be prohibited here, only
  // `#[inline(always)]`, as forced inlining is implemented entirely within
  // rustc (and so the MIR inliner can do any necessary checks for compatible target
  // features).
  //
  // This sidesteps the LLVM blockers in enabling `target_features` +
  // `inline(always)` to be used together (see rust-lang/rust#116573 and
  // llvm/llvm-project#70563).
  if (!(codegen_fn_attrs.target_features.length === 0) && codegen_fn_attrs.inline.$ === "Always" && interesting_spans.inline !== undefined) {
    const span = interesting_spans.inline;
    const diag = tcx.dcx().struct_span_err(span, "cannot use `#[inline(always)]` with `#[target_feature]`");
    diag.note("See this issue for full discussion: https://github.com/rust-lang/rust/issues/145574");
    diag.emit();
  }

  // warn that inline has no effect when no_sanitize is present
  if (
    !SanitizerFnAttrs_eq(codegen_fn_attrs.sanitizers, SanitizerFnAttrs.default()) &&
    InlineAttr_always(codegen_fn_attrs.inline) &&
    interesting_spans.sanitize !== undefined &&
    interesting_spans.inline !== undefined
  ) {
    const sanitize_span = interesting_spans.sanitize;
    const inline_span = interesting_spans.inline;
    const hir_id = tcx.local_def_id_to_hir_id(did);
    tcx.emit_node_span_lint(INLINE_NO_SANITIZE, hir_id, sanitize_span, SanitizeOnInline_diagnostic({ inline_span }));
  }

  // warn for nonblocking async functions, blocks and closures.
  // This doesn't behave as expected, because the executor can run blocking code without the sanitizer noticing.
  if (
    codegen_fn_attrs.sanitizers.rtsan_setting === "Nonblocking" &&
    interesting_spans.sanitize !== undefined &&
    // async fn
    (Asyncness.is_async(tcx.asyncness(did) as Asyncness) ||
      // async block
      tcx.is_coroutine(LocalDefId.to_def_id(did)) ||
      // async closure
      (tcx.is_closure_like(LocalDefId.to_def_id(did)) && Node.expect_closure(tcx.hir_node_by_def_id(did)).kind.$ !== "Closure"))
  ) {
    const sanitize_span = interesting_spans.sanitize;
    const hir_id = tcx.local_def_id_to_hir_id(did);
    tcx.emit_node_span_lint(RTSAN_NONBLOCKING_ASYNC, hir_id, sanitize_span, AsyncBlocking_diagnostic({}));
  }

  // error when specifying link_name together with link_ordinal
  if (codegen_fn_attrs.symbol_name !== undefined && codegen_fn_attrs.link_ordinal !== undefined) {
    const msg = "cannot use `#[link_name]` with `#[link_ordinal]`";
    if (interesting_spans.link_ordinal !== undefined) {
      const span = interesting_spans.link_ordinal;
      tcx.dcx().span_err(span, msg);
    } else {
      tcx.dcx().err(msg);
    }
  }

  const tied_map: Map<string, boolean> = new Map();
  for (const features of codegen_fn_attrs.target_features) tied_map.set(Symbol.as_str(features.name), true);
  const features = check_tied_features(tcx.sess.target, tied_map);
  if (features !== undefined) {
    const span =
      find_attr(HasAttrs_LocalDefId.get_attrs(did, tcx), (k) => (k.$ === "TargetFeature" ? k.attr_span : undefined)) ?? tcx.def_span(did);

    tcx.dcx().emit_err(
      diagnostics.TargetFeatureDisableOrEnable_diagnostic({
        features,
        span: span,
        missing_features: {},
      }),
    );
  }
}

/** `InlineAttr::always` (rustc_attr_ir data_structures.rs; on the companion in data_structures.ts). */
function InlineAttr_always(inline: CodegenFnAttrs["inline"]): boolean {
  return InlineAttrC.always(inline);
}

// rustc: compiler/rustc_codegen_ssa/src/codegen_attrs.rs:508 handle_lang_items
function handle_lang_items(
  tcx: TyCtxt,
  did: LocalDefId,
  interesting_spans: InterestingAttributeDiagnosticSpans,
  attrs: readonly Attribute[],
  codegen_fn_attrs: CodegenFnAttrs,
): void {
  const lang_item = find_attr(attrs, (k) => (k.$ === "Lang" ? k._0 : undefined));

  // Weak lang items have the same semantics as "std internal" symbols in the
  // sense that they're preserved through all our LTO passes and only
  // strippable by the linker.
  //
  // Additionally weak lang items have predetermined symbol names.
  let link_name: Symbol | undefined;
  if (lang_item !== undefined && (link_name = LangItem.link_name(lang_item)) !== undefined) {
    codegen_fn_attrs.flags = CodegenFnAttrFlags.union(codegen_fn_attrs.flags, CodegenFnAttrFlags.RUSTC_STD_INTERNAL_SYMBOL);
    codegen_fn_attrs.symbol_name = link_name;
  }

  // error when using no_mangle on a lang item item
  if (
    CodegenFnAttrFlags.contains(codegen_fn_attrs.flags, CodegenFnAttrFlags.RUSTC_STD_INTERNAL_SYMBOL) &&
    CodegenFnAttrFlags.contains(codegen_fn_attrs.flags, CodegenFnAttrFlags.NO_MANGLE)
  ) {
    let err = tcx
      .dcx()
      .struct_span_err(interesting_spans.no_mangle ?? DUMMY_SP, "`#[no_mangle]` cannot be used on internal language items")
      .with_note("Rustc requires this item to have a specific mangled name.")
      .with_span_label(tcx.def_span(did), "should be the internal language item");
    let link_name: Symbol | undefined;
    if (lang_item !== undefined && (link_name = LangItem.link_name(lang_item)) !== undefined) {
      const link_name_ = Symbol.as_str(link_name);
      err = err
        .with_note("If you are trying to prevent mangling to ease debugging, many")
        .with_note(`debuggers support a command such as \`rbreak ${link_name_}\` to`)
        .with_note(`match \`.*${link_name_}.*\` instead of \`break ${link_name_}\` on a specific name`);
    }
    err.emit();
  }
}

/// Generate the [`CodegenFnAttrs`] for an item (identified by the [`LocalDefId`]).
///
/// This happens in 4 stages:
/// - apply built-in attributes that directly translate to codegen attributes.
/// - handle lang items. These have special codegen attrs applied to them.
/// - apply overrides, like minimum requirements for alignment and other settings that don't rely directly the built-in attrs on the item.
///   overrides come after applying built-in attributes since they may only apply when certain attributes were already set in the stage before.
/// - check that the result is valid. There's various ways in which this may not be the case, such as certain combinations of attrs.
// rustc: compiler/rustc_codegen_ssa/src/codegen_attrs.rs:563 codegen_fn_attrs
function codegen_fn_attrs(tcx: TyCtxt, did: LocalDefId): CodegenFnAttrs {
  // if cfg!(debug_assertions) {
  //     let def_kind = tcx.def_kind(did);
  //     assert!(
  //         def_kind.has_codegen_attrs(),
  //         "unexpected `def_kind` in `codegen_fn_attrs`: {def_kind:?}",
  //     );
  // }
  // PORT: rustc ships without debug assertions (PORTING §3).

  const codegen_fn_attrs = CodegenFnAttrs.new();
  const attrs = tcx.hir_attrs(tcx.local_def_id_to_hir_id(did));

  const interesting_spans = process_builtin_attrs(tcx, did, attrs, codegen_fn_attrs);
  handle_lang_items(tcx, did, interesting_spans, attrs, codegen_fn_attrs);
  apply_overrides(tcx, did, codegen_fn_attrs);
  check_result(tcx, did, interesting_spans, codegen_fn_attrs);

  return codegen_fn_attrs;
}

// rustc: compiler/rustc_codegen_ssa/src/codegen_attrs.rs:583 sanitizer_settings_for
function sanitizer_settings_for(tcx: TyCtxt, did: LocalDefId): SanitizerFnAttrs {
  // Backtrack to the crate root.
  const parent = tcx.opt_local_parent(did);
  let settings: SanitizerFnAttrs;
  if (parent !== undefined) {
    // Check the parent (recursively).
    // PORT: the query value is `Copy`; copy it before the field updates below.
    const p = tcx.sanitizer_settings_for(parent) as SanitizerFnAttrs;
    settings = { disabled: p.disabled, rtsan_setting: p.rtsan_setting };
  } else {
    // We reached the crate root without seeing an attribute, so
    // there is no sanitizers to exclude.
    settings = SanitizerFnAttrs.default();
  }

  // Check for a sanitize annotation directly on this def.
  const found = find_attr(HasAttrs_LocalDefId.get_attrs(did, tcx), (k) =>
    k.$ === "Sanitize" ? ([k.on_set, k.off_set, k.rtsan] as const) : undefined,
  );
  if (found !== undefined) {
    const [on_set, off_set, rtsan] = found;
    // the on set is the set of sanitizers explicitly enabled.
    // we mask those out since we want the set of disabled sanitizers here
    settings.disabled = SanitizerSet.intersection(settings.disabled, SanitizerSet.complement(on_set));
    // the off set is the set of sanitizers explicitly disabled.
    // we or those in here.
    settings.disabled = SanitizerSet.union(settings.disabled, off_set);
    // the on set and off set are distjoint since there's a third option: unset.
    // a node may not set the sanitizer setting in which case it inherits from parents.
    // the code above in this function does this backtracking

    // if rtsan was specified here override the parent
    if (rtsan !== undefined) {
      settings.rtsan_setting = rtsan;
    }
  }
  return settings;
}

/// Checks if the provided DefId is a method in a trait impl for a trait which has track_caller
/// applied to the method prototype.
// rustc: compiler/rustc_codegen_ssa/src/codegen_attrs.rs:617 should_inherit_track_caller
function should_inherit_track_caller(tcx: TyCtxt, def_id: DefId): boolean {
  const id = tcx.trait_item_of(def_id);
  return id !== undefined && CodegenFnAttrFlags.intersects((tcx.codegen_fn_attrs(id) as CodegenFnAttrs).flags, CodegenFnAttrFlags.TRACK_CALLER);
}

/// If the provided DefId is a method in a trait impl, return the value of the `#[align]`
/// attribute on the method prototype (if any).
// rustc: compiler/rustc_codegen_ssa/src/codegen_attrs.rs:625 inherited_align
function inherited_align(tcx: TyCtxt, def_id: DefId): Align | undefined {
  const id = tcx.trait_item_of(def_id);
  if (id === undefined) return undefined;
  return (tcx.codegen_fn_attrs(id) as CodegenFnAttrs).alignment;
}

// rustc: compiler/rustc_codegen_ssa/src/codegen_attrs.rs:629 provide
export function provide(providers: Providers): void {
  providers.codegen_fn_attrs = codegen_fn_attrs;
  providers.should_inherit_track_caller = should_inherit_track_caller;
  providers.inherited_align = inherited_align;
  providers.sanitizer_settings_for = sanitizer_settings_for;
}
