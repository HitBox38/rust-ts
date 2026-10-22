// Port of compiler/rustc_passes/src/abi_test.rs (lane passes-dead): the `#[rustc_abi(..)]` test attribute.
//
// PORT notes:
// - `format!("{:#?}", abi)` of a `FnAbi<'tcx, Ty<'tcx>>` is rustc_target callconv's `debug_FnAbi` with `Ty`'s `Display`
//   (lane fn-abi).
import { CanonAbi_eq } from "../rustc_abi/canon_abi.ts";
import { find_attr } from "../rustc_attr_ir/lib.ts";
import type { RustcAbiAttrKind } from "../rustc_attr_ir/lib.ts";
import type { ModuleItems } from "../rustc_middle/hir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { FnAbi } from "../rustc_middle/ty/decls.ts";
import { Instance } from "../rustc_middle/ty/instance.ts";
import { display_LayoutError, type FnAbiError } from "../rustc_middle/ty/layout.ts";
import { RawList } from "../rustc_middle/ty/list.ts";
import { HasAttrs_LocalDefId, type Ty, TypingEnv } from "../rustc_middle/ty/mod.ts";
import { display_Ty } from "../rustc_middle/ty/print/pretty.ts";
import { LocalDefId } from "../rustc_span/def_id.ts";
import type { Span } from "../rustc_span/lib.ts";
import { span_bug } from "../rustc_span/macros.ts";
import { callconv } from "../rustc_target/lib.ts";
import { EarlyBinder } from "../rustc_type_ir/binder.ts";
import { PolyFnSigTys } from "../rustc_type_ir/ty_kind.ts";
import { Unnormalized } from "../rustc_type_ir/unnormalized.ts";
import { PRETTY } from "../std/fmt.ts";
import type { Result } from "../std/result.ts";
import { AbiInvalidAttribute_diagnostic, AbiNe_diagnostic, AbiOf_diagnostic, UnrecognizedArgument_diagnostic } from "./diagnostics.ts";
import { ensure_wf } from "./layout_test.ts";

/** `format!("{:#?}", abi)` of a `FnAbi<'tcx, Ty<'tcx>>` (`impl<Ty: Display> Debug for FnAbi`, rustc_target callconv). */
function debug_FnAbi_pretty(abi: FnAbi<Ty>): string {
  return callconv.debug_FnAbi(abi, PRETTY, display_Ty);
}

// rustc: compiler/rustc_passes/src/abi_test.rs:12 test_abi
export function test_abi(tcx: TyCtxt): void {
  if (!tcx.features().rustc_attrs()) {
    // if the `rustc_attrs` feature is not enabled, don't bother testing ABI
    return;
  }
  for (const id of (tcx.hir_crate_items(null) as ModuleItems).definitions()) {
    const found = find_attr(HasAttrs_LocalDefId.get_attrs(id, tcx), (k): [Span, RustcAbiAttrKind] | undefined =>
      k.$ === "RustcAbi" ? [k.attr_span, k.kind] : undefined,
    );
    if (found === undefined) {
      continue;
    }
    const [attr_span, attr_kind] = found;
    switch (tcx.def_kind(id).$) {
      case "Fn":
      case "AssocFn":
        dump_abi_of_fn_item(tcx, id, attr_span, attr_kind);
        break;
      case "TyAlias":
        dump_abi_of_fn_type(tcx, id, attr_span, attr_kind);
        break;
      default:
        tcx.dcx().emit_err(AbiInvalidAttribute_diagnostic({ span: tcx.def_span(id) }));
        break;
    }
  }
}

// rustc: compiler/rustc_passes/src/abi_test.rs:37 unwrap_fn_abi
function unwrap_fn_abi(abi: Result<FnAbi<Ty>, FnAbiError>, tcx: TyCtxt, item_def_id: LocalDefId): FnAbi<Ty> {
  switch (abi.$) {
    case "Ok":
      return abi._0;
    case "Err": {
      // Err(FnAbiError::Layout(layout_error))
      const layout_error = abi._0._0;
      return tcx.dcx().span_fatal(tcx.def_span(item_def_id), display_LayoutError(layout_error));
    }
  }
}

// rustc: compiler/rustc_passes/src/abi_test.rs:50 dump_abi_of_fn_item
function dump_abi_of_fn_item(tcx: TyCtxt, item_def_id: LocalDefId, attr_span: Span, attr_kind: RustcAbiAttrKind): void {
  const typing_env = TypingEnv.post_analysis(tcx, item_def_id);
  const args = RawList.identity_for_item(tcx, LocalDefId.to_def_id(item_def_id));
  const r = Instance.try_resolve(tcx, typing_env, LocalDefId.to_def_id(item_def_id), args);
  let instance: Instance;
  if (r.$ === "Ok" && r._0 !== undefined) {
    instance = r._0;
  } else if (r.$ === "Ok") {
    // Not sure what to do here, but `LayoutError::Unknown` seems reasonable?
    const ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(item_def_id) as EarlyBinder<Ty>));
    return tcx.dcx().span_fatal(tcx.def_span(item_def_id), display_LayoutError({ $: "Unknown", _0: ty }));
  } else {
    // Err(_guaranteed)
    return;
  }
  const abi = unwrap_fn_abi(
    tcx.fn_abi_of_instance(typing_env.as_query_input([instance, /* extra_args */ RawList.empty<Ty>()])),
    tcx,
    item_def_id,
  );

  // Check out the `#[rustc_abi(..)]` attribute to tell what to dump.
  // The `..` are the names of fields to dump.
  switch (attr_kind) {
    case "Debug": {
      const fn_name = tcx.item_name(item_def_id);
      tcx.dcx().emit_err(
        AbiOf_diagnostic({
          span: tcx.def_span(item_def_id),
          fn_name,
          // FIXME: using the `Debug` impl here isn't ideal.
          fn_abi: debug_FnAbi_pretty(abi),
        }),
      );
      break;
    }
    default:
      tcx.dcx().emit_err(UnrecognizedArgument_diagnostic({ span: attr_span }));
      break;
  }
}

// rustc: compiler/rustc_passes/src/abi_test.rs:93 test_abi_eq
function test_abi_eq(abi1: FnAbi<Ty>, abi2: FnAbi<Ty>): boolean {
  if (
    !CanonAbi_eq(abi1.conv, abi2.conv) ||
    abi1.args.length !== abi2.args.length ||
    abi1.c_variadic !== abi2.c_variadic ||
    abi1.fixed_count !== abi2.fixed_count ||
    abi1.can_unwind !== abi2.can_unwind
  ) {
    return false;
  }

  return abi1.ret.eq_abi(abi2.ret) && abi1.args.every((arg1, i) => arg1.eq_abi(abi2.args[i]!));
}

// rustc: compiler/rustc_passes/src/abi_test.rs:107 dump_abi_of_fn_type
function dump_abi_of_fn_type(tcx: TyCtxt, item_def_id: LocalDefId, attr_span: Span, attr_kind: RustcAbiAttrKind): void {
  const typing_env = TypingEnv.post_analysis(tcx, item_def_id);
  const ty = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(tcx.type_of(item_def_id) as EarlyBinder<Ty>));
  const span = tcx.def_span(item_def_id);
  if (!ensure_wf(tcx, typing_env, ty, item_def_id, span)) {
    return;
  }

  switch (attr_kind) {
    case "Debug": {
      const k = ty.kind();
      if (k.$ !== "FnPtr") {
        return span_bug(attr_span, "`#[rustc_abi(debug)]` on a type alias requires function pointer type");
      }
      const [sig_tys, hdr] = [k._0, k._1];
      const abi = unwrap_fn_abi(
        tcx.fn_abi_of_fn_ptr(typing_env.as_query_input([PolyFnSigTys.with(sig_tys, hdr), /* extra_args */ RawList.empty<Ty>()])),
        tcx,
        item_def_id,
      );

      const fn_name = tcx.item_name(item_def_id);
      tcx.dcx().emit_err(AbiOf_diagnostic({ span, fn_name, fn_abi: debug_FnAbi_pretty(abi) }));
      break;
    }
    case "AssertEq": {
      const k = ty.kind();
      if (k.$ !== "Tuple") {
        return span_bug(attr_span, "`#[rustc_abi(assert_eq)]` on a type alias requires pair type");
      }
      const fields = k._0;
      if (fields.length !== 2) {
        return span_bug(attr_span, "`#[rustc_abi(assert_eq)]` on a type alias requires pair type");
      }
      const [field1, field2] = [fields[0]!, fields[1]!];
      const k1 = field1.kind();
      if (k1.$ !== "FnPtr") {
        return span_bug(attr_span, "`#[rustc_abi(assert_eq)]` on a type alias requires pair of function pointer types");
      }
      const abi1 = unwrap_fn_abi(
        tcx.fn_abi_of_fn_ptr(typing_env.as_query_input([PolyFnSigTys.with(k1._0, k1._1), /* extra_args */ RawList.empty<Ty>()])),
        tcx,
        item_def_id,
      );
      const k2 = field2.kind();
      if (k2.$ !== "FnPtr") {
        return span_bug(attr_span, "`#[rustc_abi(assert_eq)]` on a type alias requires pair of function pointer types");
      }
      const abi2 = unwrap_fn_abi(
        tcx.fn_abi_of_fn_ptr(typing_env.as_query_input([PolyFnSigTys.with(k2._0, k2._1), /* extra_args */ RawList.empty<Ty>()])),
        tcx,
        item_def_id,
      );

      if (!test_abi_eq(abi1, abi2)) {
        tcx.dcx().emit_err(
          AbiNe_diagnostic({
            span,
            left: debug_FnAbi_pretty(abi1),
            right: debug_FnAbi_pretty(abi2),
          }),
        );
      }
      break;
    }
  }
}
