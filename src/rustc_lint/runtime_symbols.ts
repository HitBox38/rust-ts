// Port of compiler/rustc_lint/src/runtime_symbols.rs. The lint statics and the `declare_lint_pass!` expansion are
// generated (runtime_symbols.lints.gen.ts).
import { ExternAbi } from "../rustc_abi/extern_abi.ts";
import type { CanonicalSymbols } from "../rustc_attr_ir/canonical_symbols.ts";
import type * as hir from "../rustc_hir/hir.ts";
import { DefineOpaqueTypes } from "../rustc_infer/infer/at.gen.ts";
import { ToTrace_PolyFnSig } from "../rustc_infer/infer/at.ts";
import type { CodegenFnAttrs } from "../rustc_middle/middle/codegen_fn_attrs.ts";
import { ObligationCause } from "../rustc_middle/traits/mod.ts";
import { Instance } from "../rustc_middle/ty/instance.ts";
import { RawList } from "../rustc_middle/ty/list.ts";
import { type ParamEnv, type SymbolName, Ty, type TypingEnv } from "../rustc_middle/ty/mod.ts";
import { DefId_eq, LocalDefId } from "../rustc_span/def_id.ts";
import type { Span } from "../rustc_span/lib.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { Binder, EarlyBinder, fold_Binder } from "../rustc_type_ir/binder.ts";
import type { PolyFnSig as PolyFnSigT } from "../rustc_type_ir/decls.ts";
import type { TypingMode } from "../rustc_type_ir/infer_ctxt.ts";
import { fold_FnSig, PolyFnSig, PolyFnSigTys } from "../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { unported } from "../std/panic.ts";
import type { LateContext } from "./context.ts";
import { RedefiningRuntimeSymbolsDiag_diagnostic } from "./diagnostics.gen.ts";
import type { LateLintPass } from "./passes.ts";
import { INVALID_RUNTIME_SYMBOL_DEFINITIONS, RuntimeSymbols, SUSPICIOUS_RUNTIME_SYMBOL_DEFINITIONS } from "./runtime_symbols.lints.gen.ts";

export * from "./runtime_symbols.lints.gen.ts";

declare module "./runtime_symbols.lints.gen.ts" {
  interface RuntimeSymbols extends LateLintPass {}
}

const fold_PolyFnSig = fold_Binder(fold_FnSig);

// PORT: `LateContext::typing_env` / `typing_mode` / `param_env` are typed `unknown` in context.ts (lane lint-late-a
// types them); these casts go away then.
const typing_env = (cx: LateContext): TypingEnv => cx.typing_env() as TypingEnv;

// impl<'tcx> LateLintPass<'tcx> for RuntimeSymbols
// rustc: compiler/rustc_lint/src/runtime_symbols.rs:78 check_item
RuntimeSymbols.prototype.check_item = function (this: RuntimeSymbols, cx: LateContext, item: hir.Item): void {
  // Bail-out if the item is not a function/method or static.
  const kind = item.kind;
  switch (kind.$) {
    case "Fn": {
      const { sig, generics } = kind;
      // Generic functions cannot have the same runtime symbol as we do not allow
      // any symbol attributes.
      if (generics.params.length !== 0) {
        return;
      }

      // Try to get the overridden symbol name of this function (our mangling
      // cannot ever conflict with runtime symbols, so no need to check for those).
      // PORT: `rustc_symbol_mangling::symbol_name_from_attrs(cx.tcx, InstanceKind::Item(item.owner_id.to_def_id()))`
      // (rustc_symbol_mangling/src/lib.rs:172): the crate is not ported.
      const symbol_name: string | undefined = unported("rustc_symbol_mangling::symbol_name_from_attrs");
      if (symbol_name === undefined) {
        return;
      }

      check_fn(cx, symbol_name, sig, item.owner_id.def_id);
      break;
    }
    case "Static": {
      // Compute the symbol name of this static (without mangling, as our mangling
      // cannot ever conflict with runtime symbols).
      // PORT: `rustc_symbol_mangling::symbol_name_from_attrs` as above.
      const symbol_name: string | undefined = unported("rustc_symbol_mangling::symbol_name_from_attrs");
      if (symbol_name === undefined) {
        return;
      }

      const def_id = item.owner_id.def_id;

      check_static(cx, symbol_name, def_id, item.span);
      break;
    }
    case "ForeignMod": {
      const { items } = kind;
      for (const item_ of items) {
        const item = cx.tcx.hir_foreign_item(item_);

        const did = item.owner_id.def_id;
        const instance = Instance.new_raw(LocalDefId.to_def_id(did), RawList.identity_for_item(cx.tcx, LocalDefId.to_def_id(did)));
        const symbol_name = cx.tcx.symbol_name(instance) as SymbolName;

        switch (item.kind.$) {
          case "Fn": {
            const fn_sig = item.kind._0;
            check_fn(cx, symbol_name.name, fn_sig, did);
            break;
          }
          case "Static":
            // We only check static with #[linkage = "..."] attribute (see std weak! macro)
            if ((cx.tcx.codegen_fn_attrs(did) as CodegenFnAttrs).import_linkage !== undefined) {
              check_static(cx, symbol_name.name, did, item.span);
            }
            break;
          case "Type":
            return;
        }
      }
      break;
    }
    default:
      return;
  }
};

// rustc: compiler/rustc_lint/src/runtime_symbols.rs:143 check_fn
function check_fn(cx: LateContext, symbol_name: string, sig: hir.FnSig, did: LocalDefId): void {
  const s = Symbol.intern(symbol_name);
  const cs = [...(cx.tcx.all_canonical_symbols(null) as CanonicalSymbols).iter()].find((cs) => cs.symbol === s);
  if (cs === undefined) {
    // The symbol name does not correspond to a runtime symbols, bail out
    return;
  }
  const expected_def_id = cs.def_id;

  // Get the two function signatures
  const lang_sig = cx.tcx.normalize_erasing_regions(typing_env(cx), EarlyBinder.instantiate_identity(cx.tcx.fn_sig(expected_def_id) as EarlyBinder<PolyFnSigT>), fold_PolyFnSig);
  const user_sig = cx.tcx.normalize_erasing_regions(typing_env(cx), EarlyBinder.instantiate_identity(cx.tcx.fn_sig(LocalDefId.to_def_id(did)) as EarlyBinder<PolyFnSigT>), fold_PolyFnSig);

  check(cx, symbol_name, did, sig.span, lang_sig, user_sig);
}

// rustc: compiler/rustc_lint/src/runtime_symbols.rs:164 check_static
function check_static(cx: LateContext, symbol_name: string, did: LocalDefId, sp: Span): void {
  const s = Symbol.intern(symbol_name);
  const cs = [...(cx.tcx.all_canonical_symbols(null) as CanonicalSymbols).iter()].find((cs) => cs.symbol === s);
  if (cs === undefined) {
    // The symbol name does not correspond to a runtime symbols, bail out
    return;
  }
  const expected_def_id = cs.def_id;

  // Get the expected symbol function signature
  const lang_sig = cx.tcx.normalize_erasing_regions(typing_env(cx), EarlyBinder.instantiate_identity(cx.tcx.fn_sig(expected_def_id) as EarlyBinder<PolyFnSigT>), fold_PolyFnSig);

  // Get the static type
  const outer_user_sig = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(cx.tcx.type_of(LocalDefId.to_def_id(did)) as EarlyBinder<Ty>));

  // Peel Option<...> and get the inner type (see std weak! macro with #[linkage = "extern_weak"])
  const ok = outer_user_sig.kind();
  let user_sig_ty: Ty;
  const option_type = ok.$ === "Adt" ? cx.tcx.lang_items().option_type() : undefined;
  if (ok.$ === "Adt" && option_type !== undefined && DefId_eq(ok._0.did(), option_type)) {
    user_sig_ty = ok._1.type_at(0);
  } else {
    user_sig_ty = outer_user_sig;
  }

  const uk = user_sig_ty.kind();
  let user_sig: PolyFnSigT;
  if (uk.$ === "FnPtr") {
    user_sig = PolyFnSigTys.with(uk._0, uk._1);
  } else {
    // not a function pointer, report an error

    const lang_sig_ = Ty.new_fn_ptr(cx.tcx, lang_sig);
    cx.emit_span_lint(
      INVALID_RUNTIME_SYMBOL_DEFINITIONS,
      sp,
      RedefiningRuntimeSymbolsDiag_diagnostic({
        $: "Invalid",
        symbol_name,
        found_fn_sig: user_sig_ty,
        expected_fn_sig: lang_sig_,
      }),
    );
    return;
  }

  // Compare the signatures and report a warning/error depending on the mismatch
  check(cx, symbol_name, did, sp, lang_sig, user_sig);
}

// rustc: compiler/rustc_lint/src/runtime_symbols.rs:212 check
function check(cx: LateContext, symbol_name: string, did: LocalDefId, sp: Span, lang_sig: PolyFnSigT, user_sig: PolyFnSigT): void {
  // Compare the two signatures with an inference context
  const infcx = cx.tcx.infer_ctxt().build(cx.typing_mode() as TypingMode);
  const cause = ObligationCause.misc(sp, did);
  const result = infcx.at(cause, cx.param_env as ParamEnv).eq(DefineOpaqueTypes.No, lang_sig, user_sig, ToTrace_PolyFnSig);

  // If they don't match, emit our own mismatch signatures
  if (result.$ === "Err") {
    // Create fn pointers for diagnostics purpose
    const expected = Ty.new_fn_ptr(cx.tcx, lang_sig);
    const actual = Ty.new_fn_ptr(cx.tcx, user_sig);

    // ! is ABI compatible with ()
    // https://github.com/rust-lang/rust/issues/159446
    const lang_ret_incompatible_with_unit = !Binder.skip_binder(PolyFnSig.output(lang_sig)).is_unit() && !Binder.skip_binder(PolyFnSig.output(lang_sig)).is_never();
    const user_sig_ret_is_unit = Binder.skip_binder(PolyFnSig.output(user_sig)).is_unit();

    if (
      !ExternAbi.eq(PolyFnSig.abi(lang_sig), PolyFnSig.abi(user_sig)) ||
      PolyFnSig.c_variadic(lang_sig) !== PolyFnSig.c_variadic(user_sig) ||
      Binder.skip_binder(PolyFnSig.inputs(lang_sig)).length !== Binder.skip_binder(PolyFnSig.inputs(user_sig)).length ||
      (lang_ret_incompatible_with_unit && user_sig_ret_is_unit)
    ) {
      cx.emit_span_lint(
        INVALID_RUNTIME_SYMBOL_DEFINITIONS,
        sp,
        RedefiningRuntimeSymbolsDiag_diagnostic({
          $: "Invalid",
          symbol_name,
          found_fn_sig: actual,
          expected_fn_sig: expected,
        }),
      );
    } else {
      cx.emit_span_lint(
        SUSPICIOUS_RUNTIME_SYMBOL_DEFINITIONS,
        sp,
        RedefiningRuntimeSymbolsDiag_diagnostic({
          $: "Suspicious",
          symbol_name,
          found_fn_sig: actual,
          expected_fn_sig: expected,
        }),
      );
    }
  }
}
