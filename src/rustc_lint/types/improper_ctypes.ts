// Port of compiler/rustc_lint/src/types/improper_ctypes.rs. The lint statics and the `impl_lint_pass!` expansion are
// generated (improper_ctypes.lints.gen.ts).
//
// PORT (lint-late-b):
// - `ImproperCTypesLint` is a standalone `LateLintPass` object (lib.ts builds it with `ImproperCTypesLint.default()`).
// - `known_safe: RefCell<FxHashSet<(Hash128, u8)>>` is a `Set<string>` keyed `${hash}:${flags}` (the tuple by value).
// - `bitflags! struct RootUseFlags: u8` is a `number` with the flag consts on the companion `RootUseFlags`.
// - `msg!(..)` is rustc_errors' `msg(..)` (an inline `DiagMessage`); `ControlFlow` is rustc_ast_ir's.
// - `check_ffi_type`'s `check: impl FnOnce() -> FfiResult` is a closure.
// - `FnPtrFinder` implements two traits whose methods are both named `visit_ty` (`hir::intravisit::Visitor` and
//   `ty::TypeVisitor`): the struct is a plain object, and each impl is a small class over it.
// - `debug!` (tracing) calls are comments.
import { ControlFlow, type VisitorResult, VisitorResult as VisitorResultC } from "../../rustc_ast_ir/visit.ts";
import { FIRST_VARIANT } from "../../rustc_abi/lib.ts";
import { ExternAbi } from "../../rustc_abi/extern_abi.ts";
import type { DiagMessage } from "../../rustc_error_messages/lib.ts";
import { msg } from "../../rustc_errors/lib.ts";
import { type AmbigArg, type FieldDef as HirFieldDef, type FnDecl, type ForeignItem, type Item, type Ty as HirTy, VariantData } from "../../rustc_hir/hir.ts";
import { type FnKind, Visitor, walk_ty } from "../../rustc_hir/intravisit.ts";
import type { OwnerId } from "../../rustc_hir_id/lib.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { AdtDef } from "../../rustc_middle/ty/decls.ts";
import type { GenericArgs } from "../../rustc_middle/ty/generic_args.ts";
import type { Clauses } from "../../rustc_middle/ty/list.ts";
import { type Ty, TypingEnv, type VariantDef } from "../../rustc_middle/ty/mod.ts";
import { debug_Ty, fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { format_debug, PLAIN } from "../../std/fmt.ts";
import { type Binder, EarlyBinder } from "../../rustc_type_ir/binder.ts";
import type { PredicateProxy } from "../../rustc_type_ir/fold.ts";
import { TypingMode } from "../../rustc_type_ir/infer_ctxt.ts";
import type { Const, Region } from "../../rustc_type_ir/sty/mod.ts";
import { FnHeader, FnSig, fold_FnSig, PolyFnSig, PolyFnSigTys } from "../../rustc_type_ir/ty_kind.ts";
import { as_interner } from "../../rustc_type_ir/predicate.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { type TypeVisitable, type TypeVisitor, TypeVisitableExt, TypeVisitor_provided } from "../../rustc_type_ir/visit.ts";
import type { LocalDefId } from "../../rustc_span/def_id.ts";
import type { ErrorGuaranteed, Span } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import { sym } from "../../rustc_span/symbol.ts";
import { assert } from "../../std/panic.ts";
import type { LateContext } from "../context.ts";
import { ImproperCTypes_diagnostic, UsesPowerAlignment_diagnostic } from "../diagnostics.ts";
import type { LintPass, LintVec } from "../../rustc_lint_defs/lib.ts";
import type { LateLintPass } from "../passes.ts";
import { repr_nullable_ptr, transparent_newtype_field } from "../types.ts";
import {
  IMPROPER_CTYPES,
  IMPROPER_CTYPES_DEFINITIONS,
  ImproperCTypesLint_impl_lint_pass,
  USES_POWER_ALIGNMENT,
} from "./improper_ctypes.lints.gen.ts";

export * from "./improper_ctypes.lints.gen.ts";

/** `tcx.type_of(def_id).instantiate_identity()` */
function type_of_identity(tcx: TyCtxt, def_id: Parameters<TyCtxt["type_of"]>[0]): Unnormalized<Ty> {
  return EarlyBinder.instantiate_identity(tcx.type_of(def_id) as EarlyBinder<Ty>);
}

/// Remembers types we already checked and found FFI-safe, so we don't check the
/// same type again every time it shows up in another function.
/// We only remember "safe" types, never "unsafe" ones. That way we never need to
/// keep the actual type around, just a fingerprint of it.
// #[derive(Default)]
export class ImproperCTypesLint implements LintPass, LateLintPass {
  constructor(
    /// A fingerprint of the type, not the type itself. Uses a big 128-bit
    /// fingerprint (not a smaller 64-bit one) so two different types can't
    /// accidentally get treated as the same one.
    public known_safe: Set<string>,
  ) {}

  name(): string {
    return ImproperCTypesLint_impl_lint_pass.name();
  }
  get_lints(): LintVec {
    return ImproperCTypesLint_impl_lint_pass.get_lints();
  }
  static lint_vec(): LintVec {
    return ImproperCTypesLint_impl_lint_pass.lint_vec();
  }
  /** `#[derive(Default)]` */
  static default(): ImproperCTypesLint {
    return new ImproperCTypesLint(new Set());
  }

  // rustc: compiler/rustc_lint/src/types/improper_ctypes.rs:149 cache_key
  static cache_key(cx: LateContext, ty: Ty, flags: RootUseFlags): string {
    return `${cx.tcx.type_id_hash(ty)}:${flags}`;
  }

  // rustc: compiler/rustc_lint/src/types/improper_ctypes.rs:153 check_ffi_type
  check_ffi_type(cx: LateContext, ty: Ty, state: VisitorState, span: Span, mode: CItemKind, check: () => FfiResult): void {
    const key = ImproperCTypesLint.cache_key(cx, ty, state.root_use_flags);
    if (this.known_safe.has(key)) {
      return;
    }

    const ffi_res = check();

    if (ffi_res.$ === "FfiSafe") {
      this.known_safe.add(key);
    }

    this.process_ffi_result(cx, span, ffi_res, mode);
  }

  // impl<'tcx> ImproperCTypesLint (second block)

  /// Find any fn-ptr types with external ABIs in `ty`, and FFI-checks them.
  /// For example, `Option<extern "C" fn()>` FFI-checks `extern "C" fn()`.
  // rustc: compiler/rustc_lint/src/types/improper_ctypes.rs:1037 check_type_for_external_abi_fnptr
  check_type_for_external_abi_fnptr(cx: LateContext, state: VisitorState, hir_ty: HirTy, ty: Ty, fn_mode: CItemKind): void {
    const visitor: FnPtrFinder = {
      spans: [],
      tys: [],
      depths: [],
      current_depth: 0,
    };
    fold_Ty.visit_with(ty, new FnPtrFinder_TypeVisitor(visitor));
    new FnPtrFinder_HirVisitor(visitor).visit_ty_unambig(hir_ty);

    // `iter::zip(depths.drain(..), iter::zip(tys.drain(..), spans.drain(..)))`
    const n = Math.min(visitor.depths.length, visitor.tys.length, visitor.spans.length);
    for (let i = 0; i < n; i++) {
      const [depth, fn_ptr_ty0, span] = [visitor.depths[i]!, visitor.tys[i]!, visitor.spans[i]!];
      const fn_ptr_ty = Unnormalized.new_wip(fn_ptr_ty0);
      const v = ImproperCTypesVisitor.new(cx, fn_ptr_ty, fn_mode);
      const bridge_state: VisitorState = { ...state, depth };
      // FIXME(ctypes): make a check_for_fnptr
      const ffi_res = v.check_type(bridge_state, fn_ptr_ty);

      this.process_ffi_result(cx, span, ffi_res, fn_mode);
    }
    visitor.depths.length = 0;
    visitor.tys.length = 0;
    visitor.spans.length = 0;
  }

  /// Regardless of a function's need to be "ffi-safe", look for fn-ptr argument/return types
  /// that need to be checked for ffi-safety.
  // rustc: compiler/rustc_lint/src/types/improper_ctypes.rs:1108 check_fn_for_external_abi_fnptr
  check_fn_for_external_abi_fnptr(cx: LateContext, fn_mode: CItemKind, def_id: LocalDefId, decl: FnDecl): void {
    const sig0 = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(cx.tcx.fn_sig(def_id) as EarlyBinder<Binder<FnSig>>));
    const sig = cx.tcx.instantiate_bound_regions_with_erased(sig0, fold_FnSig);

    const inputs = FnSig.inputs(sig);
    const n = Math.min(inputs.length, decl.inputs.length);
    for (let i = 0; i < n; i++) {
      const [input_ty, input_hir] = [inputs[i]!, decl.inputs[i]!];
      const state = VisitorState.fn_entry_point(fn_mode, "Arg");
      this.check_type_for_external_abi_fnptr(cx, state, input_hir, input_ty, fn_mode);
    }

    if (decl.output.$ === "Return") {
      const ret_hir = decl.output._0;
      const state = VisitorState.fn_entry_point(fn_mode, "Ret");
      this.check_type_for_external_abi_fnptr(cx, state, ret_hir, FnSig.output(sig), fn_mode);
    }
  }

  /// For a local definition of a #[repr(C)] struct/enum/union, check that it is indeed FFI-safe.
  // rustc: compiler/rustc_lint/src/types/improper_ctypes.rs:1130 check_reprc_adt
  check_reprc_adt(cx: LateContext, item: Item, adt_def: AdtDef): void {
    // debug_assert!(adt_def.repr().c() && !adt_def.repr().packed() && adt_def.repr().align.is_none());

    // FIXME(ctypes): this following call is awkward.
    // is there a way to perform its logic in MIR space rather than HIR space?
    // (so that its logic can be absorbed into visitor.visit_struct_or_union)
    check_struct_for_power_alignment(cx, item, adt_def);
  }

  // rustc: compiler/rustc_lint/src/types/improper_ctypes.rs:1146 check_foreign_static
  check_foreign_static(cx: LateContext, id: OwnerId, span: Span): void {
    const ty = type_of_identity(cx.tcx, id);
    const state = VisitorState.static_entry_point();
    this.check_ffi_type(cx, Unnormalized.skip_norm_wip(ty), state, span, "Declaration", () => {
      const visitor = ImproperCTypesVisitor.new(cx, ty, "Declaration");
      return visitor.check_type(state, ty);
    });
  }

  /// Check if a function's argument types and result type are "ffi-safe".
  // rustc: compiler/rustc_lint/src/types/improper_ctypes.rs:1156 check_foreign_fn
  check_foreign_fn(cx: LateContext, fn_mode: CItemKind, def_id: LocalDefId, decl: FnDecl): void {
    const sig0 = Unnormalized.skip_norm_wip(EarlyBinder.instantiate_identity(cx.tcx.fn_sig(def_id) as EarlyBinder<Binder<FnSig>>));
    const sig = cx.tcx.instantiate_bound_regions_with_erased(sig0, fold_FnSig);

    const inputs = FnSig.inputs(sig);
    const n = Math.min(inputs.length, decl.inputs.length);
    for (let i = 0; i < n; i++) {
      const [input_ty, input_hir] = [inputs[i]!, decl.inputs[i]!];
      const state = VisitorState.fn_entry_point(fn_mode, "Arg");
      this.check_ffi_type(cx, input_ty, state, input_hir.span, fn_mode, () => {
        const input_ty_u = Unnormalized.new_wip(input_ty);
        const visitor = ImproperCTypesVisitor.new(cx, input_ty_u, fn_mode);
        return visitor.check_type(state, input_ty_u);
      });
    }

    if (decl.output.$ === "Return") {
      const ret_hir = decl.output._0;
      const state = VisitorState.fn_entry_point(fn_mode, "Ret");
      this.check_ffi_type(cx, FnSig.output(sig), state, ret_hir.span, fn_mode, () => {
        const output_ty = Unnormalized.new_wip(FnSig.output(sig));
        const visitor = ImproperCTypesVisitor.new(cx, output_ty, fn_mode);
        return visitor.check_type(state, output_ty);
      });
    }
  }

  // rustc: compiler/rustc_lint/src/types/improper_ctypes.rs:1185 process_ffi_result
  process_ffi_result(cx: LateContext, sp: Span, res: FfiResult, fn_mode: CItemKind): void {
    switch (res.$) {
      case "FfiSafe":
        break;
      case "FfiPhantom":
        this.emit_ffi_unsafe_type_lint(cx, res._0, sp, msg("composed only of `PhantomData`"), undefined, fn_mode);
        break;
      case "FfiUnsafe":
        this.emit_ffi_unsafe_type_lint(cx, res.ty, sp, res.reason, res.help, fn_mode);
        break;
    }
  }

  // rustc: compiler/rustc_lint/src/types/improper_ctypes.rs:1210 emit_ffi_unsafe_type_lint
  emit_ffi_unsafe_type_lint(cx: LateContext, ty: Ty, sp: Span, note: DiagMessage, help: DiagMessage | undefined, fn_mode: CItemKind): void {
    const lint = fn_mode === "Declaration" ? IMPROPER_CTYPES : IMPROPER_CTYPES_DEFINITIONS;
    const desc = fn_mode === "Declaration" ? "block" : "fn";
    let span_note: Span | undefined;
    const k = ty.kind();
    let sp_local: Span | undefined;
    if (k.$ === "Adt" && (sp_local = cx.tcx.hir_span_if_local(k._0.did())) !== undefined) {
      span_note = sp_local;
    } else {
      span_note = undefined;
    }
    cx.emit_span_lint(lint, sp, ImproperCTypes_diagnostic({ ty, desc, label: sp, help, note, span_note }));
  }

  /// `ImproperCTypesDefinitions` checks items outside of foreign items (e.g. stuff that isn't in
  /// `extern "C" { }` blocks):
  ///
  /// - `extern "<abi>" fn` definitions are checked in the same way as the
  ///   `ImproperCtypesDeclarations` visitor checks functions if `<abi>` is external (e.g. "C").
  /// - All other items which contain types (e.g. other functions, struct definitions, etc) are
  ///   checked for extern fn-ptrs with external ABIs.
  // impl<'tcx> LateLintPass<'tcx> for ImproperCTypesLint
  // rustc: compiler/rustc_lint/src/types/improper_ctypes.rs:1246 check_foreign_item
  check_foreign_item(cx: LateContext, it: ForeignItem): void {
    const abi = cx.tcx.hir_get_foreign_abi(it.hir_id());

    const k = it.kind;
    if (k.$ === "Fn") {
      const sig = k._0;
      // fnptrs are a special case, they always need to be treated as
      // "the element rendered unsafe" because their unsafety doesn't affect
      // their surroundings, and their type is often declared inline
      if (!ExternAbi.is_rustic_abi(abi)) {
        this.check_foreign_fn(cx, "Declaration", it.owner_id.def_id, sig.decl);
      } else {
        this.check_fn_for_external_abi_fnptr(cx, "Declaration", it.owner_id.def_id, sig.decl);
      }
    } else if (k.$ === "Static" && !ExternAbi.is_rustic_abi(abi)) {
      const ty = k._0;
      this.check_foreign_static(cx, it.owner_id, ty.span);
    } else {
      // hir::ForeignItemKind::Static(..) | hir::ForeignItemKind::Type => (),
    }
  }

  // rustc: compiler/rustc_lint/src/types/improper_ctypes.rs:1272 check_item
  check_item(cx: LateContext, item: Item): void {
    const k = item.kind;
    switch (k.$) {
      case "Static":
      case "Const":
      case "TyAlias": {
        const ty = k._2;
        this.check_type_for_external_abi_fnptr(
          cx,
          VisitorState.static_entry_point(),
          ty,
          Unnormalized.skip_norm_wip(type_of_identity(cx.tcx, item.owner_id)),
          "Definition",
        );
        break;
      }
      // See `check_fn` for declarations, `check_foreign_items` for definitions in extern blocks
      case "Fn":
        break;
      case "Struct":
      case "Union":
      case "Enum": {
        // looking for extern FnPtr:s is delegated to `check_field_def`.
        const adt_def: AdtDef = cx.tcx.adt_def(item.owner_id.to_def_id()) as AdtDef;

        if (adt_def.repr().c() && !adt_def.repr().packed() && adt_def.repr().align === undefined) {
          this.check_reprc_adt(cx, item, adt_def);
        }
        break;
      }

      // Doesn't define something that can contain a external type to be checked.
      case "Impl":
      case "TraitAlias":
      case "Trait":
      case "GlobalAsm":
      case "ForeignMod":
      case "Mod":
      case "Macro":
      case "Use":
      case "ExternCrate":
      case "TestBinderConstraints":
        break;
    }
  }

  // rustc: compiler/rustc_lint/src/types/improper_ctypes.rs:1311 check_field_def
  check_field_def(cx: LateContext, field: HirFieldDef): void {
    this.check_type_for_external_abi_fnptr(
      cx,
      VisitorState.static_entry_point(),
      field.ty,
      Unnormalized.skip_norm_wip(type_of_identity(cx.tcx, field.def_id)),
      "Definition",
    );
  }

  // rustc: compiler/rustc_lint/src/types/improper_ctypes.rs:1321 check_fn
  check_fn(cx: LateContext, kind: FnKind, decl: FnDecl, _body: unknown, _span: Span, id: LocalDefId): void {
    let abi: ExternAbi;
    if (kind.$ === "ItemFn") {
      abi = kind._2.abi;
    } else if (kind.$ === "Method") {
      abi = kind._1.header.abi;
    } else {
      return;
    }

    // fnptrs are a special case, they always need to be treated as
    // "the element rendered unsafe" because their unsafety doesn't affect
    // their surroundings, and their type is often declared inline
    if (!ExternAbi.is_rustic_abi(abi)) {
      this.check_foreign_fn(cx, "Definition", id, decl);
    } else {
      this.check_fn_for_external_abi_fnptr(cx, "Definition", id, decl);
    }
  }
}

/// A common pattern in this lint is to attempt normalize_erasing_regions,
/// but keep the original type if it were to fail.
/// This may or may not be supported in the logic behind the `Unnormalized` wrapper,
/// (FIXME?)
/// but it should be enough for non-wrapped types to be as normalised as this lint needs them to be.
// rustc: compiler/rustc_lint/src/types/improper_ctypes.rs:188 maybe_normalize_erasing_regions
function maybe_normalize_erasing_regions(cx: LateContext, value: Unnormalized<Ty>): Ty {
  // Use `TypingMode::Borrowck` so the new solver doesn't reveal opaque types since we're now
  // past hir typeck. If we were to attempt to reveal more opaque types, dropping the
  // `InferCtxt` would ICE (see #156352).
  let typing_env: TypingEnv;
  const body_id = cx.enclosing_body;
  if (body_id !== undefined) {
    const body_def_id = cx.tcx.hir_enclosing_body_owner(body_id.hir_id);
    typing_env = TypingEnv.new(cx.param_env, TypingMode.borrowck(as_interner(cx.tcx), body_def_id));
  } else {
    typing_env = cx.typing_env();
  }
  const r = cx.tcx.try_normalize_erasing_regions(typing_env, value, fold_Ty);
  return r.$ === "Ok" ? r._0 : Unnormalized.skip_norm_wip(value);
}

/// Check a variant of a non-exhaustive enum for improper ctypes
///
/// We treat `#[non_exhaustive] enum` as "ensure that code will compile if new variants are added".
/// This includes linting, on a best-effort basis. There are valid additions that are unlikely.
///
/// Adding a data-carrying variant to an existing C-like enum that is passed to C is "unlikely",
/// so we don't need the lint to account for it.
/// e.g. going from enum Foo { A, B, C } to enum Foo { A, B, C, D(u32) }.
// rustc: compiler/rustc_lint/src/types/improper_ctypes.rs:212 check_non_exhaustive_variant
export function check_non_exhaustive_variant(non_exhaustive_variant_list: boolean, variant: VariantDef): ControlFlow<DiagMessage> {
  // non_exhaustive suggests it is possible that someone might break ABI
  // see: https://github.com/rust-lang/rust/issues/44109#issuecomment-537583344
  // so warn on complex enums being used outside their crate
  if (non_exhaustive_variant_list) {
    // which is why we only warn about really_tagged_union reprs from https://rust.tf/rfc2195
    // with an enum like `#[repr(u8)] enum Enum { A(DataA), B(DataB), }`
    // but exempt enums with unit ctors like C's (e.g. from rust-bindgen)
    if (variant_has_complex_ctor(variant)) {
      return ControlFlow.Break(msg("this enum is non-exhaustive"));
    }
  }

  if (variant.field_list_has_applicable_non_exhaustive()) {
    return ControlFlow.Break(msg("this enum has non-exhaustive variants"));
  }

  return ControlFlow.CONTINUE;
}

// rustc: compiler/rustc_lint/src/types/improper_ctypes.rs:235 variant_has_complex_ctor
function variant_has_complex_ctor(variant: VariantDef): boolean {
  // CtorKind::Const means a "unit" ctor
  return !(variant.ctor_kind() === "Const");
}

/// Per-struct-field function that checks if a struct definition follows
/// the Power alignment Rule (see the `check_struct_for_power_alignment` function).
// rustc: compiler/rustc_lint/src/types/improper_ctypes.rs:242 check_arg_for_power_alignment
function check_arg_for_power_alignment(cx: LateContext, ty: Ty): boolean {
  const tcx = cx.tcx;
  assert(tcx.sess.target.os.$ === "Aix", "assertion failed: tcx.sess.target.os == Os::Aix");

  // Structs (under repr(C)) follow the power alignment rule if:
  //   - the first field of the struct is a floating-point type that
  //     is greater than 4-bytes, or
  //   - the first field of the struct is an aggregate whose
  //     recursively first field is a floating-point type greater than
  //     4 bytes.
  const k = ty.kind();
  if (ty.is_floating_point() && ty.primitive_size(tcx).bytes() > 4) {
    return true;
  } else if (k.$ === "Adt" && k._0.is_struct() && k._0.repr().c() && !k._0.repr().packed() && k._0.repr().align === undefined) {
    const adt_def = k._0;
    const struct_variant = adt_def.variant(FIRST_VARIANT);
    // Within a nested struct, all fields are examined to correctly
    // report if any fields after the nested struct within the
    // original struct are misaligned.
    for (const struct_field of struct_variant.fields) {
      const field_ty = Unnormalized.skip_norm_wip(type_of_identity(tcx, struct_field.did));
      if (check_arg_for_power_alignment(cx, field_ty)) {
        return true;
      }
    }
  }
  return false;
}

/// Check a struct definition for respect of the Power alignment Rule (as in PowerPC),
/// which should be respected in the "aix" target OS.
/// To do so, we must follow one of the two following conditions:
/// - The first field of the struct must be floating-point type that
///    is greater than 4-bytes.
///  - The first field of the struct must be an aggregate whose
///    recursively first field is a floating-point type greater than
///    4 bytes.
// rustc: compiler/rustc_lint/src/types/improper_ctypes.rs:282 check_struct_for_power_alignment
function check_struct_for_power_alignment(cx: LateContext, item: Item, adt_def: AdtDef): void {
  const tcx = cx.tcx;

  // Only consider structs (not enums or unions) on AIX.
  if (tcx.sess.target.os.$ !== "Aix" || !adt_def.is_struct()) {
    return;
  }

  // The struct must be repr(C), but ignore it if it explicitly specifies its alignment with
  // either `align(N)` or `packed(N)`.
  if (adt_def.repr().c() && !adt_def.repr().packed() && adt_def.repr().align === undefined) {
    const struct_variant_data = item.expect_struct()[2];
    for (const field_def of VariantData.fields(struct_variant_data).slice(1)) {
      // Struct fields (after the first field) are checked for the
      // power alignment rule, as fields after the first are likely
      // to be the fields that are misaligned.
      const ty = Unnormalized.skip_norm_wip(type_of_identity(tcx, field_def.def_id));
      if (check_arg_for_power_alignment(cx, ty)) {
        cx.emit_span_lint(USES_POWER_ALIGNMENT, field_def.span, UsesPowerAlignment_diagnostic({}));
      }
    }
  }
}

/// Annotates whether we are in the context of an item *defined* in rust
/// and exposed to an FFI boundary,
/// or the context of an item from elsewhere, whose interface is re-*declared* in rust.
// #[derive(Clone, Copy)]
type CItemKind = "Declaration" | "Definition";

/// Annotates whether we are in the context of a function's argument types or return type.
// #[derive(Clone, Copy)]
type FnPos = "Arg" | "Ret";

type FfiResult =
  | { readonly $: "FfiSafe" }
  | { readonly $: "FfiPhantom"; readonly _0: Ty }
  | { readonly $: "FfiUnsafe"; readonly ty: Ty; readonly reason: DiagMessage; readonly help: DiagMessage | undefined };
const FfiSafe: FfiResult = Object.freeze({ $: "FfiSafe" as const });

/// The result when a type has been checked but perhaps not completely. `None` indicates that
/// FFI safety/unsafety has not yet been determined, `Some(res)` indicates that the safety/unsafety
/// in the `FfiResult` is final.
type PartialFfiResult = FfiResult | undefined;

/// What type indirection points to a given type.
// #[derive(Clone, Copy)]
type IndirectionKind =
  /// Box (valid non-null pointer, owns pointee).
  | "Box"
  /// Ref (valid non-null pointer, borrows pointee).
  | "Ref"
  /// Raw pointer (not necessarily non-null or valid. no info on ownership).
  | "RawPtr";

/// VisitorState flags that are linked with the root type's use.
/// (These are the permanent part of the state, kept when visiting new Ty.)
// #[derive(Clone, Copy, Debug, PartialEq, Eq)]
type RootUseFlags = number;
const RootUseFlags = {
  /// For use in (externally-linked) static variables.
  STATIC: 0b000001,
  /// For use in functions in general.
  FUNC: 0b000010,
  /// For variables in function returns (implicitly: not for static variables).
  FN_RETURN: 0b000100,
  /// For variables in functions/variables which are defined in rust.
  DEFINED: 0b001000,
  /// For times where we are only defining the type of something
  /// (struct/enum/union definitions, FnPtrs).
  THEORETICAL: 0b010000,

  /** `bitflags` `contains` */
  contains(self: RootUseFlags, other: RootUseFlags): boolean {
    return (self & other) === other;
  },

  // impl RootUseFlags
  // The values that can be set.
  STATIC_TY: 0b000001,
  ARGUMENT_TY_IN_DEFINITION: 0b000010 | 0b001000,
  RETURN_TY_IN_DEFINITION: 0b000010 | 0b000100 | 0b001000,
  ARGUMENT_TY_IN_DECLARATION: 0b000010,
  RETURN_TY_IN_DECLARATION: 0b000010 | 0b000100,
  ARGUMENT_TY_IN_FNPTR: 0b000010 | 0b010000,
  RETURN_TY_IN_FNPTR: 0b000010 | 0b010000 | 0b000100,
};

/// Description of the relationship between current Ty and
/// the type (or lack thereof) immediately containing it
// #[derive(Copy, Clone, Debug, PartialEq, Eq)]
type OuterTyKind =
  | "None"
  /// A variant that should not exist,
  /// but is needed because we don't change the lint's behavior yet
  | "NoneThroughFnPtr"
  /// Placeholder for properties that will be used eventually
  | "Other";

const OuterTyKind = {
  /// Computes the relationship by providing the containing Ty itself
  // rustc: compiler/rustc_lint/src/types/improper_ctypes.rs:381 from_ty
  from_ty(ty: Ty): OuterTyKind {
    const k = ty.kind();
    switch (k.$) {
      case "FnPtr":
        return "NoneThroughFnPtr";
      case "RawPtr":
      case "Ref":
      case "Adt":
      case "Tuple":
      case "Array":
      case "Slice":
        return "Other";
      default:
        return bug(`Unexpected outer type ${debug_ty(ty)}`);
    }
  },
};

// #[derive(Copy, Clone, Debug, PartialEq, Eq)]
interface VisitorState {
  /// Flags describing both the overall context in which the current Ty is,
  /// linked to how the Visitor's original Ty was used.
  readonly root_use_flags: RootUseFlags;
  /// Flags describing both the immediate context in which the current Ty is,
  /// linked to how it relates to its parent Ty (or lack thereof).
  readonly outer_ty_kind: OuterTyKind;
  /// Type recursion depth, to prevent infinite recursion
  readonly depth: number;
}

const VisitorState = {
  /// From an existing state, compute the state of any subtype of the current type.
  /// (General case. For the case where the current type is a function pointer, see `next_in_fnptr`.)
  // rustc: compiler/rustc_lint/src/types/improper_ctypes.rs:427 next
  next(self: VisitorState, current_ty: Ty): VisitorState {
    assert(current_ty.kind().$ !== "FnPtr", "assertion failed: !matches!(current_ty.kind(), ty::FnPtr(..))");
    return {
      root_use_flags: self.root_use_flags,
      outer_ty_kind: OuterTyKind.from_ty(current_ty),
      depth: self.depth + 1,
    };
  },

  /// From an existing state, compute the state of any subtype of the current type.
  /// (Case where the current type is a function pointer,
  /// meaning we need to specify if the subtype is an argument or the return.)
  // rustc: compiler/rustc_lint/src/types/improper_ctypes.rs:439 next_in_fnptr
  next_in_fnptr(self: VisitorState, current_ty: Ty, fn_pos: FnPos): VisitorState {
    assert(current_ty.kind().$ === "FnPtr", "assertion failed: matches!(current_ty.kind(), ty::FnPtr(..))");
    return {
      root_use_flags: fn_pos === "Ret" ? RootUseFlags.RETURN_TY_IN_FNPTR : RootUseFlags.ARGUMENT_TY_IN_FNPTR,
      outer_ty_kind: OuterTyKind.from_ty(current_ty),
      depth: self.depth + 1,
    };
  },

  /// Get the proper visitor state for a given function's arguments or return type.
  // rustc: compiler/rustc_lint/src/types/improper_ctypes.rs:452 fn_entry_point
  fn_entry_point(fn_mode: CItemKind, fn_pos: FnPos): VisitorState {
    let p_flags: RootUseFlags;
    if (fn_mode === "Definition" && fn_pos === "Ret") {
      p_flags = RootUseFlags.RETURN_TY_IN_DEFINITION;
    } else if (fn_mode === "Declaration" && fn_pos === "Ret") {
      p_flags = RootUseFlags.RETURN_TY_IN_DECLARATION;
    } else if (fn_mode === "Definition" && fn_pos === "Arg") {
      p_flags = RootUseFlags.ARGUMENT_TY_IN_DEFINITION;
    } else {
      p_flags = RootUseFlags.ARGUMENT_TY_IN_DECLARATION;
    }
    return { root_use_flags: p_flags, outer_ty_kind: "None", depth: 0 };
  },

  /// Get the proper visitor state for a static variable's type
  // rustc: compiler/rustc_lint/src/types/improper_ctypes.rs:463 static_entry_point
  static_entry_point(): VisitorState {
    return {
      root_use_flags: RootUseFlags.STATIC_TY,
      outer_ty_kind: "None",
      depth: 0,
    };
  },

  /// Whether the type is used in a function.
  // rustc: compiler/rustc_lint/src/types/improper_ctypes.rs:472 is_in_function
  is_in_function(self: VisitorState): boolean {
    const ret = RootUseFlags.contains(self.root_use_flags, RootUseFlags.FUNC);
    if (ret) {
      // debug_assert!(!self.root_use_flags.contains(RootUseFlags::STATIC));
    }
    return ret;
  },

  /// Whether the type is used (directly or not) in a function, in return position.
  // rustc: compiler/rustc_lint/src/types/improper_ctypes.rs:481 is_in_function_return
  is_in_function_return(self: VisitorState): boolean {
    const ret = RootUseFlags.contains(self.root_use_flags, RootUseFlags.FN_RETURN);
    if (ret) {
      // debug_assert!(self.is_in_function());
    }
    return ret;
  },

  /// Whether the type is used (directly or not) in a defined function.
  /// In other words, whether or not we allow non-FFI-safe types behind a C pointer,
  /// to be treated as an opaque type on the other side of the FFI boundary.
  // rustc: compiler/rustc_lint/src/types/improper_ctypes.rs:492 is_in_defined_function
  is_in_defined_function(self: VisitorState): boolean {
    return RootUseFlags.contains(self.root_use_flags, RootUseFlags.DEFINED) && VisitorState.is_in_function(self);
  },

  /// Whether the type is used (directly or not) in a function pointer type.
  /// Here, we also allow non-FFI-safe types behind a C pointer,
  /// to be treated as an opaque type on the other side of the FFI boundary.
  // rustc: compiler/rustc_lint/src/types/improper_ctypes.rs:499 is_in_fnptr
  is_in_fnptr(self: VisitorState): boolean {
    return RootUseFlags.contains(self.root_use_flags, RootUseFlags.THEORETICAL) && VisitorState.is_in_function(self);
  },

  /// Whether we can expect type parameters and co in a given type.
  // rustc: compiler/rustc_lint/src/types/improper_ctypes.rs:504 can_expect_ty_params
  can_expect_ty_params(self: VisitorState): boolean {
    // rust-defined functions, as well as FnPtrs
    return RootUseFlags.contains(self.root_use_flags, RootUseFlags.THEORETICAL) || VisitorState.is_in_defined_function(self);
  },
};

/// Visitor used to recursively traverse MIR types and evaluate FFI-safety.
/// It uses ``check_*`` methods as entrypoints to be called elsewhere,
/// and ``visit_*`` methods to recurse.
class ImproperCTypesVisitor {
  constructor(
    public cx: LateContext,
    /// To prevent problems with recursive types,
    /// add a types-in-check cache.
    public cache: Set<Ty>,
    /// The original type being checked, before we recursed
    /// to any other types it contains.
    public base_ty: Ty,
    public base_fn_mode: CItemKind,
  ) {}

  // rustc: compiler/rustc_lint/src/types/improper_ctypes.rs:525 new
  static new(cx: LateContext, base_ty_u: Unnormalized<Ty>, base_fn_mode: CItemKind): ImproperCTypesVisitor {
    // Skip normalization for opaques: even in `TypingMode::Borrowck` the body's own
    // defining opaques still get revealed, leaving entries in `OpaqueTypeStorage` that
    // ICE on `InferCtxt` drop (issue #156352).
    const base_ty = TypeVisitableExt.has_opaque_types(Unnormalized.skip_norm_wip(base_ty_u), fold_Ty)
      ? Unnormalized.skip_norm_wip(base_ty_u)
      : maybe_normalize_erasing_regions(cx, base_ty_u);
    return new ImproperCTypesVisitor(cx, new Set(), base_ty, base_fn_mode);
  }

  /// Checks if the given indirection (box,ref,pointer) is "ffi-safe".
  // rustc: compiler/rustc_lint/src/types/improper_ctypes.rs:542 visit_indirection
  visit_indirection(state: VisitorState, ty: Ty, inner_ty: Ty, indirection_kind: IndirectionKind): FfiResult {
    const tcx = this.cx.tcx;

    switch (indirection_kind) {
      case "Box": {
        // FIXME(ctypes): this logic is broken, but it still fits the current tests:
        // - for some reason `Box<_>`es in `extern "ABI" {}` blocks
        //   (including within FnPtr:s)
        //   are not treated as pointers but as FFI-unsafe structs
        // - otherwise, treat the box itself correctly, and follow pointee safety logic
        //   as described in the other `indirection_type` match branch.
        if (VisitorState.is_in_defined_function(state) || (VisitorState.is_in_fnptr(state) && this.base_fn_mode === "Definition")) {
          if (inner_ty.is_sized(tcx, this.cx.typing_env())) {
            return FfiSafe;
          } else {
            return {
              $: "FfiUnsafe",
              ty,
              reason: msg("box cannot be represented as a single pointer"),
              help: undefined,
            };
          }
        } else {
          // (mid-retcon-commit-chain comment:)
          // this is the original fallback behavior, which is wrong
          const k = ty.kind();
          if (k.$ === "Adt") {
            return this.visit_struct_or_union(state, ty, k._0, k._1);
          } else {
            // PORT: `cfg!(debug_assertions)` is false (rustc ships without debug assertions).
            return FfiSafe;
          }
        }
      }
      case "Ref":
      case "RawPtr": {
        // Weird behaviour for pointee safety. the big question here is
        // "if you have a FFI-unsafe pointee behind a FFI-safe pointer type, is it ok?"
        // The answer until now is:
        // "It's OK for rust-defined functions and callbacks, we'll assume those are
        // meant to be opaque types on the other side of the FFI boundary".
        //
        // Reasoning:
        // For extern function declarations, the actual definition of the function is
        // written somewhere else, meaning the declaration is free to express this
        // opaqueness with an extern type (opaque caller-side) or a std::ffi::c_void
        // (opaque callee-side). For extern function definitions, however, in the case
        // where the type is opaque caller-side, it is not opaque callee-side,
        // and having the full type information is necessary to compile the function.
        //
        // It might be better to rething this, or even ignore pointee safety for a first
        // batch of behaviour changes. See the discussion that ends with
        // https://github.com/rust-lang/rust/pull/134697#issuecomment-2692610258
        if ((VisitorState.is_in_defined_function(state) || VisitorState.is_in_fnptr(state)) && inner_ty.is_sized(this.cx.tcx, this.cx.typing_env())) {
          return FfiSafe;
        } else {
          return this.visit_type(VisitorState.next(state, ty), inner_ty);
        }
      }
    }
  }

  /// Checks if the given `VariantDef`'s field types are "ffi-safe".
  // rustc: compiler/rustc_lint/src/types/improper_ctypes.rs:614 visit_variant_fields
  visit_variant_fields(state: VisitorState, ty: Ty, def: AdtDef, variant: VariantDef, args: GenericArgs): FfiResult {
    let transparent_with_all_zst_fields: boolean;
    if (def.repr().transparent()) {
      const field = transparent_newtype_field(this.cx.tcx, variant);
      if (field !== undefined) {
        // Transparent newtypes have at most one non-ZST field which needs to be checked..
        const field_ty = maybe_normalize_erasing_regions(this.cx, field.ty(this.cx.tcx, args));
        const r = this.visit_type(VisitorState.next(state, ty), field_ty);
        if (r.$ === "FfiUnsafe" && r.ty.is_unit()) {
          // ()
        } else {
          return r;
        }

        transparent_with_all_zst_fields = false;
      } else {
        // ..or have only ZST fields, which is FFI-unsafe (unless those fields are all
        // `PhantomData`).
        transparent_with_all_zst_fields = true;
      }
    } else {
      transparent_with_all_zst_fields = false;
    }

    // We can't completely trust `repr(C)` markings, so make sure the fields are actually safe.
    let all_phantom = variant.fields.length !== 0;
    for (const field of variant.fields) {
      const field_ty = maybe_normalize_erasing_regions(this.cx, field.ty(this.cx.tcx, args));
      const r = this.visit_type(VisitorState.next(state, ty), field_ty);
      let b: boolean;
      if (r.$ === "FfiSafe") {
        b = false;
      } else if (r.$ === "FfiUnsafe" && r.ty.is_unit()) {
        // `()` fields are FFI-safe!
        b = false;
      } else if (r.$ === "FfiPhantom") {
        b = true;
      } else {
        return r;
      }
      all_phantom = all_phantom && b;
    }

    if (all_phantom) {
      return { $: "FfiPhantom", _0: ty };
    } else if (transparent_with_all_zst_fields) {
      return {
        $: "FfiUnsafe",
        ty,
        reason: msg("this struct contains only zero-sized fields"),
        help: undefined,
      };
    } else {
      return FfiSafe;
    }
  }

  // rustc: compiler/rustc_lint/src/types/improper_ctypes.rs:670 visit_struct_or_union
  visit_struct_or_union(state: VisitorState, ty: Ty, def: AdtDef, args: GenericArgs): FfiResult {
    // debug_assert!(matches!(def.adt_kind(), AdtKind::Struct | AdtKind::Union));

    if (!def.repr().c() && !def.repr().transparent()) {
      return {
        $: "FfiUnsafe",
        ty,
        reason: def.is_struct() ? msg("this struct has unspecified layout") : msg("this union has unspecified layout"),
        help: def.is_struct()
          ? msg("consider adding a `#[repr(C)]` or `#[repr(transparent)]` attribute to this struct")
          : // FIXME(#60405): confirm that this makes sense for unions once #60405 / RFC2645 stabilises
            msg("consider adding a `#[repr(C)]` or `#[repr(transparent)]` attribute to this union"),
      };
    }

    if (def.non_enum_variant().field_list_has_applicable_non_exhaustive()) {
      return {
        $: "FfiUnsafe",
        ty,
        reason: def.is_struct() ? msg("this struct is non-exhaustive") : msg("this union is non-exhaustive"),
        help: undefined,
      };
    }

    if (def.non_enum_variant().fields.length === 0) {
      return {
        $: "FfiUnsafe",
        ty,
        reason: def.is_struct() ? msg("this struct has no fields") : msg("this union has no fields"),
        help: def.is_struct() ? msg("consider adding a member to this struct") : msg("consider adding a member to this union"),
      };
    } else {
      return this.visit_variant_fields(state, ty, def, def.non_enum_variant(), args);
    }
  }

  // rustc: compiler/rustc_lint/src/types/improper_ctypes.rs:732 visit_enum
  visit_enum(state: VisitorState, ty: Ty, def: AdtDef, args: GenericArgs): FfiResult {
    // debug_assert!(matches!(def.adt_kind(), AdtKind::Enum));

    if (def.variants().length === 0) {
      // Empty enums are okay... although sort of useless.
      return FfiSafe;
    }
    // Check for a repr() attribute to specify the size of the
    // discriminant.
    if (!def.repr().c() && !def.repr().transparent() && def.repr().int === undefined) {
      // Special-case types like `Option<extern fn()>` and `Result<extern fn(), ()>`
      const inner_ty = repr_nullable_ptr(this.cx.tcx, this.cx.typing_env(), ty);
      if (inner_ty !== undefined) {
        return this.visit_type(VisitorState.next(state, ty), inner_ty);
      }

      return {
        $: "FfiUnsafe",
        ty,
        reason: msg("enum has no representation hint"),
        help: msg("consider adding a `#[repr(C)]`, `#[repr(transparent)]`, or integer `#[repr(...)]` attribute to this enum"),
      };
    }

    const non_exhaustive = def.variant_list_has_applicable_non_exhaustive();
    // Check the contained variants.
    for (const variant of def.variants()) {
      const c = check_non_exhaustive_variant(non_exhaustive, variant);
      if (c.$ === "Break") {
        return { $: "FfiUnsafe", ty, reason: c._0, help: undefined };
      }

      const r = this.visit_variant_fields(state, ty, def, variant, args);
      if (r.$ !== "FfiSafe") {
        return r;
      }
    }

    return FfiSafe;
  }

  /// Checks if the given type is "ffi-safe" (has a stable, well-defined
  /// representation which can be exported to C code).
  // rustc: compiler/rustc_lint/src/types/improper_ctypes.rs:783 visit_type
  visit_type(state: VisitorState, ty: Ty): FfiResult {
    const tcx = this.cx.tcx;

    // Protect against infinite recursion, for example
    // `struct S(*mut S);`.
    const inserted = !this.cache.has(ty);
    if (inserted) this.cache.add(ty);
    if (!(inserted && this.cx.tcx.recursion_limit().value_within_limit(state.depth))) {
      return FfiSafe;
    }

    const k = ty.kind();
    switch (k.$) {
      case "Adt": {
        const [def, args] = [k._0, k._1];
        const inner_ty = ty.boxed_ty();
        if (inner_ty !== undefined) {
          return this.visit_indirection(state, ty, inner_ty, "Box");
        }
        if (def.is_phantom_data()) {
          return { $: "FfiPhantom", _0: ty };
        }
        switch (def.adt_kind()) {
          case "Struct":
          case "Union": {
            const name = tcx.get_diagnostic_name(def.did());
            if ((name === sym.cstring_type || name === sym.cstr_type) && !this.base_ty.is_mutable_ptr()) {
              return {
                $: "FfiUnsafe",
                ty,
                reason: msg("`CStr`/`CString` do not have a guaranteed layout"),
                help: msg("consider passing a `*const std::ffi::c_char` instead, and use `CStr::as_ptr()`"),
              };
            }
            return this.visit_struct_or_union(state, ty, def, args);
          }
          case "Enum":
            return this.visit_enum(state, ty, def, args);
        }
      }

      // Pattern types are just extra invariants on the type that you need to uphold,
      // but only the base type is relevant for being representable in FFI.
      // (note: this lint was written when pattern types could only be integers constrained to ranges)
      // (also note: the lack of ".next(ty)" on the state is on purpose)
      case "Pat":
        return this.visit_type(state, k._0);

      // types which likely have a stable representation, if the target architecture defines those
      // note: before rust 1.77, 128-bit ints were not FFI-safe on x86_64
      case "Int":
      case "Uint":
      case "Float":
        return FfiSafe;

      case "Bool":
        return FfiSafe;

      case "Char":
        return {
          $: "FfiUnsafe",
          ty,
          reason: msg("the `char` type has no C equivalent"),
          help: msg("consider using `u32` or `libc::wchar_t` instead"),
        };

      case "Slice":
        return {
          $: "FfiUnsafe",
          ty,
          reason: msg("slices have no C equivalent"),
          help: msg("consider using a raw pointer instead"),
        };

      case "Dynamic":
        return { $: "FfiUnsafe", ty, reason: msg("trait objects have no C equivalent"), help: undefined };

      case "Str":
        return {
          $: "FfiUnsafe",
          ty,
          reason: msg("string slices have no C equivalent"),
          help: msg("consider using `*const u8` and a length instead"),
        };

      case "Tuple": {
        const tuple = k._0;
        if (tuple.length === 0 && VisitorState.is_in_function_return(state) && (state.outer_ty_kind === "None" || state.outer_ty_kind === "NoneThroughFnPtr")) {
          // C functions can return void
          return FfiSafe;
        } else {
          return {
            $: "FfiUnsafe",
            ty,
            reason: msg("tuples have unspecified layout"),
            help: msg("consider using a struct instead"),
          };
        }
      }

      case "RawPtr": {
        const pk = k._0.kind();
        if (pk.$ === "Tuple" && pk._0.length === 0) {
          return FfiSafe;
        }
        return this.visit_indirection(state, ty, k._0, "RawPtr");
      }
      case "Ref":
        return this.visit_indirection(state, ty, k._1, "Ref");

      case "Array": {
        const inner_ty = k._0;
        if (
          VisitorState.is_in_function(state) &&
          // FIXME(ctypes): VVV-this-VVV shouldn't make a difference between ::None and ::NoneThroughFnPtr
          state.outer_ty_kind === "None"
        ) {
          // C doesn't really support passing arrays by value - the only way to pass an array by value
          // is through a struct.
          return {
            $: "FfiUnsafe",
            ty,
            reason: msg("passing raw arrays by value is not FFI-safe"),
            help: msg("consider passing a pointer to the array"),
          };
        } else {
          // let's allow phantoms to go through,
          // since an array of 1-ZSTs is also a 1-ZST
          return this.visit_type(VisitorState.next(state, ty), inner_ty);
        }
      }

      case "FnPtr": {
        const [sig_tys, hdr] = [k._0, k._1];
        const sig0 = PolyFnSigTys.with(sig_tys, hdr);
        if (ExternAbi.is_rustic_abi(PolyFnSig.abi(sig0))) {
          return {
            $: "FfiUnsafe",
            ty,
            reason: msg("this function pointer has Rust-specific calling convention"),
            help: msg("consider using an `extern fn(...) -> ...` function pointer instead"),
          };
        }

        const sig = tcx.instantiate_bound_regions_with_erased(sig0, fold_FnSig);
        for (const arg of FnSig.inputs(sig)) {
          const r = this.visit_type(VisitorState.next_in_fnptr(state, ty, "Arg"), arg);
          if (r.$ !== "FfiSafe") {
            return r;
          }
        }

        const ret_ty = FnSig.output(sig);
        return this.visit_type(VisitorState.next_in_fnptr(state, ty, "Ret"), ret_ty);
      }

      case "Foreign":
        return FfiSafe;

      case "Never":
        return FfiSafe;

      default:
        break;
    }

    // While opaque types are checked for earlier, if a projection in a struct field
    // normalizes to an opaque type, then it will reach this branch.
    if (k.$ === "Alias" && k._1.kind.$ === "Opaque") {
      return { $: "FfiUnsafe", ty, reason: msg("opaque types have no C equivalent"), help: undefined };
    }

    // `extern "C" fn` functions can have type parameters, which may or may not be FFI-safe,
    //  so they are currently ignored for the purposes of this lint.
    if ((k.$ === "Param" || (k.$ === "Alias" && (k._1.kind.$ === "Projection" || k._1.kind.$ === "Inherent"))) && VisitorState.can_expect_ty_params(state)) {
      return FfiSafe;
    }

    if (k.$ === "UnsafeBinder") {
      return {
        $: "FfiUnsafe",
        ty,
        reason: msg("unsafe binders are incompatible with foreign function interfaces"),
        help: undefined,
      };
    }

    // Safety net for when normalization reveals a body's own defining opaque
    // (e.g. `async extern fn`'s `impl Future` → `Coroutine`); the nicer
    // "opaque types have no C equivalent" message comes from `visit_for_opaque_ty`
    // in `check_type` before normalization (issue #156352).
    if (k.$ === "Closure" || k.$ === "CoroutineClosure" || k.$ === "Coroutine" || k.$ === "CoroutineWitness") {
      return {
        $: "FfiUnsafe",
        ty,
        reason: msg("closures and coroutines are not FFI-safe"),
        help: undefined,
      };
    }

    // ty::Param(..) | ty::Alias(_, Projection | Inherent | Free) | ty::Infer(..) | ty::Bound(..) | ty::Error(_)
    // | ty::Placeholder(..) | ty::FnDef(..)
    return bug(`unexpected type in foreign function: ${debug_ty(ty)}`);
  }

  // rustc: compiler/rustc_lint/src/types/improper_ctypes.rs:989 visit_for_opaque_ty
  visit_for_opaque_ty(ty: Ty): PartialFfiResult {
    const r = fold_Ty.visit_with(ty, new ProhibitOpaqueTypes());
    if (r.$ !== "Break") return undefined;
    return {
      $: "FfiUnsafe",
      ty: r._0,
      reason: msg("opaque types have no C equivalent"),
      help: undefined,
    };
  }

  // rustc: compiler/rustc_lint/src/types/improper_ctypes.rs:1014 check_type
  check_type(state: VisitorState, ty_u: Unnormalized<Ty>): FfiResult {
    // Catch opaques before normalization so the new solver doesn't reveal them
    // (e.g. `async extern fn` return → `Coroutine`) and we get the nicer
    // "opaque types have no C equivalent" message.
    let res = this.visit_for_opaque_ty(Unnormalized.skip_norm_wip(ty_u));
    if (res !== undefined) {
      return res;
    }
    const ty = maybe_normalize_erasing_regions(this.cx, ty_u);
    res = this.visit_for_opaque_ty(ty);
    if (res !== undefined) {
      return res;
    }

    return this.visit_type(state, ty);
  }
}

// rustc-type: compiler/rustc_lint/src/types/improper_ctypes.rs:990 ProhibitOpaqueTypes
// PORT: the fn-local `struct ProhibitOpaqueTypes` of `visit_for_opaque_ty` (and its `TypeVisitor` impl), at module level.
class ProhibitOpaqueTypes implements TypeVisitor<ControlFlow<Ty>> {
  readonly Result: VisitorResult<ControlFlow<Ty>, unknown> = VisitorResultC.ControlFlow<Ty>();

  // rustc: compiler/rustc_lint/src/types/improper_ctypes.rs:994 visit_ty
  visit_ty(ty: Ty): ControlFlow<Ty> {
    if (!TypeVisitableExt.has_opaque_types(ty, fold_Ty)) {
      return ControlFlow.CONTINUE;
    }

    const k = ty.kind();
    if (k.$ === "Alias" && k._1.kind.$ === "Opaque") {
      return ControlFlow.Break(ty);
    } else {
      return fold_Ty.super_visit_with(ty, this);
    }
  }

  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): ControlFlow<Ty> {
    return TypeVisitor_provided.visit_binder(this, t, d);
  }
  visit_region(r: Region): ControlFlow<Ty> {
    return TypeVisitor_provided.visit_region(this, r);
  }
  visit_const(c: Const): ControlFlow<Ty> {
    return TypeVisitor_provided.visit_const(this, c);
  }
  visit_predicate<P>(p: P, d: PredicateProxy<P>): ControlFlow<Ty> {
    return TypeVisitor_provided.visit_predicate(this, p, d);
  }
  visit_clauses(c: Clauses): ControlFlow<Ty> {
    return TypeVisitor_provided.visit_clauses(this, c);
  }
  visit_error(guar: ErrorGuaranteed): ControlFlow<Ty> {
    return TypeVisitor_provided.visit_error(this, guar);
  }
}

// rustc-type: compiler/rustc_lint/src/types/improper_ctypes.rs:1045 FnPtrFinder
// PORT: the fn-local `struct FnPtrFinder` of `check_type_for_external_abi_fnptr` (header: its two visitor impls are
// the classes below).
interface FnPtrFinder {
  current_depth: number;
  depths: number[];
  spans: Span[];
  tys: Ty[];
}

/** `impl<'tcx> hir::intravisit::Visitor<'_> for FnPtrFinder<'tcx>` */
class FnPtrFinder_HirVisitor extends Visitor {
  constructor(public self: FnPtrFinder) {
    super();
  }

  // rustc: compiler/rustc_lint/src/types/improper_ctypes.rs:1053 visit_ty
  override visit_ty(ty: HirTy<AmbigArg>): undefined {
    // debug!(?ty);
    this.self.current_depth += 1;
    if (ty.kind.$ === "FnPtr" && !ExternAbi.is_rustic_abi(ty.kind._0.abi)) {
      this.self.depths.push(this.self.current_depth);
      this.self.spans.push(ty.span);
    }

    walk_ty(this, ty);
    this.self.current_depth -= 1;
    return undefined;
  }
}

/** `impl<'tcx> ty::TypeVisitor<TyCtxt<'tcx>> for FnPtrFinder<'tcx>` */
class FnPtrFinder_TypeVisitor implements TypeVisitor<undefined> {
  readonly Result: VisitorResult<undefined, unknown> = VisitorResultC.unit;

  constructor(public self: FnPtrFinder) {}

  // rustc: compiler/rustc_lint/src/types/improper_ctypes.rs:1071 visit_ty
  visit_ty(ty: Ty): undefined {
    const k = ty.kind();
    if (k.$ === "FnPtr" && !ExternAbi.is_rustic_abi(FnHeader.abi(k._1))) {
      this.self.tys.push(ty);
    }

    return fold_Ty.super_visit_with(ty, this);
  }

  visit_binder<T>(t: Binder<T>, d: TypeVisitable<T>): undefined {
    return TypeVisitor_provided.visit_binder(this, t, d);
  }
  visit_region(r: Region): undefined {
    return TypeVisitor_provided.visit_region(this, r);
  }
  visit_const(c: Const): undefined {
    return TypeVisitor_provided.visit_const(this, c);
  }
  visit_predicate<P>(p: P, d: PredicateProxy<P>): undefined {
    return TypeVisitor_provided.visit_predicate(this, p, d);
  }
  visit_clauses(c: Clauses): undefined {
    return TypeVisitor_provided.visit_clauses(this, c);
  }
  visit_error(guar: ErrorGuaranteed): undefined {
    return TypeVisitor_provided.visit_error(this, guar);
  }
}

/** `{:?}` of a `Ty` */
function debug_ty(ty: Ty): string {
  return format_debug(ty, debug_Ty, PLAIN);
}
