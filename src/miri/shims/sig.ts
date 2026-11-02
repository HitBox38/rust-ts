//! Everything related to checking the signature of shim invocations.
// Port of src/tools/miri/src/shims/sig.rs (crate `miri`, plan-m6 D2).
// Fill lane: `miri-shims-b` (plan-m6 wave 37).
// Its types are generated into sig.gen.ts (tools/codegen set `miri`); this module re-exports them.
//
// PORT:
// - The macros `shim_sig!` / `shim_varargs!` / `shim_sig_args_sep!` / `shim_sig_arg!` are the functions `shim_sig`,
//   `shim_varargs`, `shim_sig_args_sep` and `shim_sig_arg`. A type is written as its macro tokens in a string:
//   `"i32"`, `"usize"`, `"()"`, `"!"`, `"bool"`, `"*_"`, `"*u32"` / `"*libc::timespec"` (a pointer to that type),
//   `"fn(..) -> _"`, `"&[u8]"`, `"winapi::BOOL"`, `"libc::off_t"` (any `krate::path`); a trailing `"..."` in the
//   argument list makes the signature c-variadic. Example: `shim_sig!(extern "C" fn(i32, *_) -> isize)` is
//   `shim_sig("C", ["i32", "*_"], "isize")`. An unsupported spelling panics (upstream: `compile_error!`).
// - `const N: usize` (the argument count of `check_shim_sig_deprecated` / `check_shim_sig_llvm_intrinsic`) is a
//   trailing `n` parameter; `check_shim_sig*` / `check_varargs` take it from the signature / type list.
//   `&'a [OpTy; N]` is a `readonly OpTy[]` of length `N`.
import { type OpTy } from "../lib.ts";
import { type MiriInterpCx } from "../machine.ts";
import { throw_machine_stop, path_ty_layout } from "../helpers.ts";
import { ShimSig, type Varargs } from "./sig.gen.ts";
import { type CanonAbi, CanonAbi_eq, display_CanonAbi } from "../../rustc_abi/canon_abi.ts";
import { debug_AbiFromStrErr } from "../../rustc_abi/lib.ts";
import { ExternAbi } from "../../rustc_abi/extern_abi.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { InterpErrorInfo_from_InterpErrorKind, type InterpErrorKind, type InterpResult, interp_ok, Scalar as interp_Scalar } from "../../rustc_middle/mir/interpret/mod.ts";
import { type FnAbi } from "../../rustc_middle/ty/decls.ts";
import { Ty } from "../../rustc_middle/ty/mod.ts";
import { Instance } from "../../rustc_middle/ty/instance.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { RawList } from "../../rustc_middle/ty/list.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { Binder } from "../../rustc_type_ir/binder.ts";
import { FnSigKind, fold_FnSig, type FnSig } from "../../rustc_type_ir/ty_kind.ts";
import { assert, panic, unreachable } from "../../std/panic.ts";
import { Err, expect_result } from "../../std/result.ts";
export * from "./sig.gen.ts";

/** `throw_ub_format!(..)` (`err_ub!(Ub(format!(..)))`) */
function throw_ub_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "UndefinedBehavior", _0: { $: "Ub", _0: msg } }));
}
/** `throw_ub!(..)` */
function throw_ub<T>(ub: Extract<InterpErrorKind, { $: "UndefinedBehavior" }>["_0"]): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "UndefinedBehavior", _0: ub }));
}

/** A `shim_sig!` / `shim_varargs!` constructor: `|this| ..` (upstream a closure coerced to `fn(&MiriInterpCx) -> ..`). */
export type ShimSigFn = (this_: MiriInterpCx) => ShimSig;
export type ShimVarargsFn = (this_: MiriInterpCx) => Ty[];

/// Construct a `ShimSig` with convenient syntax:
/// ```rust,ignore
/// shim_sig!(extern "C" fn (*const T, i32) -> usize)
/// ```
///
/// The following types are supported:
/// - primitive integer types
/// - `()`
/// - (thin) raw pointers, written `*_` since the mutability and pointee type are irrelevant
/// - `$crate::$mod::...::$ty` for a type from the given crate (most commonly that is `libc`)
/// - `winapi::$ty` for a type from `std::sys::pal::windows::c`
// #[macro_export] macro_rules! shim_sig (shims/sig.rs:30)
export function shim_sig(abi: string, args: readonly string[], ret: string): ShimSigFn {
  return (this_) => {
    const [args_, c_variadic] = shim_sig_args_sep(this_, args);
    return new ShimSig(
      expect_result(ExternAbi.from_str(abi), "incorrect abi specified", debug_AbiFromStrErr),
      args_,
      shim_sig_arg(this_, ret),
      c_variadic,
    );
  };
}

/// Computes a list of types for varargs, using the same syntax as `shim_sig!`.
// #[macro_export] macro_rules! shim_varargs (shims/sig.rs:46)
export function shim_varargs(...args: string[]): ShimVarargsFn {
  return (this_) => {
    const [args_, c_variadic] = shim_sig_args_sep(this_, args);
    assert(!c_variadic); // don't accept `...` here
    return args_;
  };
}

/// Helper for `shim_sig!`.
///
/// Groups tokens into comma-separated chunks and calls the provided macro on them.
/// Returns a list of types and a boolean indicating whether there was a trailing `...`.
// #[macro_export] macro_rules! shim_sig_args_sep (shims/sig.rs:69)
export function shim_sig_args_sep(this_: MiriInterpCx, args: readonly string[]): [Ty[], boolean] {
  // No more tokens, trailing `...` - emit final output, indicate this is variadic.
  if (args.length > 0 && args[args.length - 1] === "...") {
    return [args.slice(0, -1).map((a) => shim_sig_arg(this_, a)), true];
  }
  return [args.map((a) => shim_sig_arg(this_, a)), false];
}

/// Helper for `shim_sig!`.
///
/// Converts a type
// #[macro_export] macro_rules! shim_sig_arg (shims/sig.rs:106)
export function shim_sig_arg(this_: MiriInterpCx, ty: string): Ty {
  const t = ty.trim();
  const types = this_.tcx.deref().types;
  switch (t) {
    case "i8":
      return types.i8;
    case "i16":
      return types.i16;
    case "i32":
      return types.i32;
    case "i64":
      return types.i64;
    case "i128":
      return types.i128;
    case "isize":
      return types.isize;
    case "u8":
      return types.u8;
    case "u16":
      return types.u16;
    case "u32":
      return types.u32;
    case "u64":
      return types.u64;
    case "u128":
      return types.u128;
    case "usize":
      return types.usize;
    case "()":
      return types.unit;
    case "!":
      return types.never;
    case "bool":
      return types.bool;
    case "*_":
      // Mutability does not matter for ABI.
      return this_.machine.layouts.void_ptr_mut.ty;
    case "fn(..) -> _":
      // All function pointer types are the same on the ABI level so we don't care about arg/ret.
      return this_.machine.layouts.fn_ptr.ty;
  }
  if (t.startsWith("*")) {
    // Pointee types matter for varargs so we support explicitly giving them.
    // Mutability does not matter for ABI.
    return Ty.new_ptr(this_.tcx.deref(), shim_sig_arg(this_, t.slice(1)), "Mut");
  }
  if (t.startsWith("&[") && t.endsWith("]")) {
    const tcx = this_.tcx.deref();
    return Ty.new_ref(tcx, tcx.lifetimes.re_erased, Ty.new_slice(tcx, shim_sig_arg(this_, t.slice(2, -1))), "Not");
  }
  const path = t.split("::").map((s) => s.trim());
  if (path.length >= 2 && path.every((s) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(s))) {
    if (path[0] === "winapi" && path.length === 2) {
      return this_.windows_ty_layout(path[1]!).ty;
    }
    return path_ty_layout(this_, path).ty;
  }
  return panic(`unsupported signature type: ${t}`);
}

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- shims/sig.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/sig.rs:273
    check_shim_symbol_clash(this: MiriInterpCx, link_name: Symbol): InterpResult;
    // shims/sig.rs:294 (`const N: usize` is `n`, header)
    check_shim_sig_deprecated(this: MiriInterpCx, abi: FnAbi<Ty>, exp_abi: CanonAbi, link_name: Symbol, args: readonly OpTy[], n: number): InterpResult<readonly OpTy[]>;
    // shims/sig.rs:327
    check_shim_sig(this: MiriInterpCx, shim_sig: ShimSigFn, _1: readonly [Symbol, FnAbi<Ty>, readonly OpTy[]]): InterpResult<readonly OpTy[]>;
    // shims/sig.rs:353
    check_shim_sig_variadic(this: MiriInterpCx, shim_sig: ShimSigFn, _1: readonly [Symbol, FnAbi<Ty>, readonly OpTy[]]): InterpResult<[readonly OpTy[], Varargs]>;
    // shims/sig.rs:379
    check_varargs(this: MiriInterpCx, tys: ShimVarargsFn, varargs: Varargs, fn_name: string): InterpResult<[readonly OpTy[], Varargs]>;
    // shims/sig.rs:438 (`const N: usize` is `n`, header)
    check_shim_sig_llvm_intrinsic(this: MiriInterpCx, link_name: Symbol, args: readonly OpTy[], n: number): InterpResult<readonly OpTy[]>;
  }
}

declare module "./sig.gen.ts" {
  interface ShimSig {
    // shims/sig.rs:189
    as_abi(ecx: MiriInterpCx): FnAbi<Ty>;
  }
}

// rustc: src/tools/miri/src/shims/sig.rs:189 as_abi
ShimSig.prototype.as_abi = function (this: ShimSig, ecx: MiriInterpCx): FnAbi<Ty> {
  const inputs_and_output: Ty[] = [];
  inputs_and_output.push(...this.args);
  inputs_and_output.push(this.ret);
  const fn_sig: FnSig = {
    inputs_and_output: ecx.machine.tcx.mk_type_list(inputs_and_output),
    fn_sig_kind: FnSigKind.set_abi(FnSigKind.set_c_variadic(FnSigKind.default_(), this.c_variadic), this.abi),
  };
  const fn_sig_binder = Binder.dummy(fn_sig, fold_FnSig);
  const r = ecx.fn_abi_of_fn_ptr(fn_sig_binder, RawList.empty());
  if (r.$ === "Err") return panic("called `Result::unwrap()` on an `Err` value");
  return r._0;
};

/// Helper function to compare two ABIs.
// rustc: src/tools/miri/src/shims/sig.rs:202 check_shim_abi
function check_shim_abi(this_: MiriInterpCx, link_name: Symbol, callee_abi: FnAbi<Ty>, caller_abi: FnAbi<Ty>): InterpResult {
  if (!CanonAbi_eq(callee_abi.conv, caller_abi.conv)) {
    return throw_ub_format(
      `ABI mismatch: \`${Symbol.as_str(link_name)}\` has calling convention "${display_CanonAbi(callee_abi.conv)}", but the caller is using calling convention "${display_CanonAbi(caller_abi.conv)}"`,
    );
  }
  // No need to check unwinding: if the caller signature forbids unwinding, that's already
  // reflected in the unwind destination so if an unwind occurs it will be reported as UB.

  if (caller_abi.c_variadic && !callee_abi.c_variadic) {
    return throw_ub_format(
      `ABI mismatch: \`${Symbol.as_str(link_name)}\` is a non-variadic function, but the caller is using a c-variadic signature`,
    );
  }
  if (!caller_abi.c_variadic && callee_abi.c_variadic) {
    return throw_ub_format(
      `ABI mismatch: \`${Symbol.as_str(link_name)}\` is a c-variadic function, but the caller is using a non-variadic signature`,
    );
  }

  if (callee_abi.fixed_count !== caller_abi.fixed_count) {
    return throw_ub_format(
      `ABI mismatch: calling \`${Symbol.as_str(link_name)}\` which takes ${callee_abi.fixed_count} ${callee_abi.c_variadic ? "fixed (non-variadic) " : ""}argument${callee_abi.fixed_count === 1 ? "" : "s"}, but ${caller_abi.fixed_count} argument${caller_abi.fixed_count === 1 ? " was" : "s were"} given`,
    );
  }

  const ret_compat = this_.check_argument_compat(caller_abi.ret, callee_abi.ret);
  if (ret_compat.$ === "Err") return ret_compat;
  if (!ret_compat._0) {
    return throw_ub({
      $: "AbiMismatchReturn",
      caller_ty: caller_abi.ret.layout.ty,
      callee_ty: callee_abi.ret.layout.ty,
    });
  }

  const n = Math.min(caller_abi.args.length, callee_abi.args.length);
  for (let idx = 0; idx < n; idx++) {
    const caller_arg = caller_abi.args[idx]!;
    const callee_arg = callee_abi.args[idx]!;
    const compat = this_.check_argument_compat(caller_arg, callee_arg);
    if (compat.$ === "Err") return compat;
    if (!compat._0) {
      return throw_ub({
        $: "AbiMismatchArgument",
        arg_idx: idx,
        caller_ty: caller_abi.args[idx]!.layout.ty,
        callee_ty: callee_abi.args[idx]!.layout.ty,
      });
    }
  }

  return interp_ok(undefined);
}

/// Ensure the given symbol is not exported by the program.
// rustc: src/tools/miri/src/shims/sig.rs:273 check_shim_symbol_clash
InterpCx.prototype.check_shim_symbol_clash = function (this: MiriInterpCx, link_name: Symbol): InterpResult {
  const this_ = this.eval_context_ref();
  const r = this_.lookup_exported_symbol(link_name);
  if (r.$ === "Err") return r;
  const instance = r._0;
  if (instance !== undefined) {
    // If compiler-builtins is providing the symbol, then don't treat it as a clash.
    // We'll use our built-in implementation in `emulate_foreign_item_inner` for increased
    // performance. Note that this means we won't catch any undefined behavior in
    // compiler-builtins when running other crates, but Miri can still be run on
    // compiler-builtins itself (or any crate that uses it as a normal dependency)
    const tcx = this_.tcx.deref();
    if (tcx.is_compiler_builtins(Instance.def_id(instance).krate)) {
      return interp_ok(undefined);
    }

    return throw_machine_stop({
      $: "SymbolShimClashing",
      link_name,
      span: tcx.def_span(Instance.def_id(instance)),
    });
  }
  return interp_ok(undefined);
};

/// 'Lenient' signature check. Deprecated; use `check_shim_sig` instead.
// rustc: src/tools/miri/src/shims/sig.rs:294 check_shim_sig_deprecated
InterpCx.prototype.check_shim_sig_deprecated = function (this: MiriInterpCx, abi: FnAbi<Ty>, exp_abi: CanonAbi, link_name: Symbol, args: readonly OpTy[], n: number): InterpResult<readonly OpTy[]> {
  const c = this.check_shim_symbol_clash(link_name);
  if (c.$ === "Err") return c;

  if (!CanonAbi_eq(abi.conv, exp_abi)) {
    return throw_ub_format(
      `calling a function with calling convention "${display_CanonAbi(exp_abi)}" using caller calling convention "${display_CanonAbi(abi.conv)}"`,
    );
  }
  if (abi.c_variadic) {
    return throw_ub_format("calling a non-variadic function with a c-variadic caller-side signature");
  }

  // if let Ok(ops) = args.try_into()
  if (args.length === n) {
    return interp_ok(args);
  }
  return throw_ub_format(`incorrect number of arguments for \`${Symbol.as_str(link_name)}\`: got ${args.length}, expected ${n}`);
};

/// Check that the given `caller_fn_abi` matches the expected ABI described by `shim_sig`, and
/// then returns the list of arguments.
// rustc: src/tools/miri/src/shims/sig.rs:327 check_shim_sig
InterpCx.prototype.check_shim_sig = function (this: MiriInterpCx, shim_sig: ShimSigFn, [link_name, caller_fn_abi, caller_args]: readonly [Symbol, FnAbi<Ty>, readonly OpTy[]]): InterpResult<readonly OpTy[]> {
  const this_ = this.eval_context_ref();

  // Compute callee ABI.
  const shim_sig_ = shim_sig(this_);
  assert(!shim_sig_.c_variadic);
  const callee_fn_abi = shim_sig_.as_abi(this_);

  // Check everything.
  const r = check_shim_abi(this_, link_name, callee_fn_abi, caller_fn_abi);
  if (r.$ === "Err") return r;
  const c = this_.check_shim_symbol_clash(link_name);
  if (c.$ === "Err") return c;

  // Return arguments.
  // if let Ok(ops) = caller_args.try_into()
  if (caller_args.length === shim_sig_.args.length) {
    return interp_ok(caller_args);
  }
  return unreachable();
};

/// Check that the given `caller_fn_abi` matches the expected ABI described by `shim_sig`, and
/// then returns the list of fixed and variadic arguments in separate lists.
// rustc: src/tools/miri/src/shims/sig.rs:353 check_shim_sig_variadic
InterpCx.prototype.check_shim_sig_variadic = function (this: MiriInterpCx, shim_sig: ShimSigFn, [link_name, caller_fn_abi, caller_args]: readonly [Symbol, FnAbi<Ty>, readonly OpTy[]]): InterpResult<[readonly OpTy[], Varargs]> {
  const this_ = this.eval_context_ref();

  // Compute callee ABI.
  const shim_sig_ = shim_sig(this_);
  assert(shim_sig_.c_variadic);
  const callee_fn_abi = shim_sig_.as_abi(this_);

  // Check everything.
  const r = check_shim_abi(this_, link_name, callee_fn_abi, caller_fn_abi);
  if (r.$ === "Err") return r;
  const c = this_.check_shim_symbol_clash(link_name);
  if (c.$ === "Err") return c;

  // Return arguments.
  const n = shim_sig_.args.length;
  // if let Some((fixed, var)) = caller_args.split_first_chunk()
  if (caller_args.length >= n) {
    return interp_ok([caller_args.slice(0, n), { args: caller_args.slice(n), already_gone: n }]);
  }
  return unreachable();
};

/// Fetches `N` arguments from `varargs`, checking their types.
/// Also returns the remaining varargs.
// rustc: src/tools/miri/src/shims/sig.rs:379 check_varargs
InterpCx.prototype.check_varargs = function (this: MiriInterpCx, tys: ShimVarargsFn, varargs: Varargs, fn_name: string): InterpResult<[readonly OpTy[], Varargs]> {
  const this_ = this.eval_context_ref();
  const tys_ = tys(this_);
  const N = tys_.length;

  // let Some((now, tail)) = varargs.args.split_first_chunk::<N>() else { .. }
  if (varargs.args.length < N) {
    return throw_ub_format(
      `not enough arguments for \`${fn_name}\`: got ${varargs.already_gone + varargs.args.length}, expected at least ${varargs.already_gone + N}`,
    );
  }
  const now = varargs.args.slice(0, N);
  const tail = varargs.args.slice(N);

  for (let n = 0; n < N; n++) {
    const caller_gave = now[n]!;
    const callee_expected = tys_[n]!;
    // Check ABI compatibility.
    const compatible_r = this_.validate_c_variadic_compatible_ty(caller_gave.layout.ty, callee_expected);
    if (compatible_r.$ === "Err") return compatible_r;
    const compatible = compatible_r._0;
    switch (compatible.$) {
      case "Compatible":
        break;
      case "Incompatible":
        return throw_ub_format(
          `incorrect c-variadic argument type for \`${fn_name}\`: expected argument #${varargs.already_gone + n + 1} to have type \`${display_Ty(callee_expected)}\` but got incompatible type \`${display_Ty(caller_gave.layout.ty)}\``,
        );
      case "CastIntTo": {
        const source_is_signed = compatible.source_is_signed;
        // Check that the value can be represented in the target type.
        const size = caller_gave.layout.size;
        const scalar = this_.read_scalar(caller_gave);
        if (scalar.$ === "Err") return scalar;
        const as_int = interp_Scalar.to_int(scalar._0, size);
        if (as_int.$ === "Err") return as_int;
        if (as_int._0 < 0n) {
          let value: string;
          if (source_is_signed) {
            const v = interp_Scalar.to_int(scalar._0, size);
            if (v.$ === "Err") return v;
            value = v._0.toString();
          } else {
            const v = interp_Scalar.to_uint(scalar._0, size);
            if (v.$ === "Err") return v;
            value = v._0.toString();
          }
          return throw_ub_format(
            `incorrect c-variadic argument type for \`${fn_name}\`: argument #${varargs.already_gone + n + 1} has value \`${value}_${display_Ty(caller_gave.layout.ty)}\` which cannot be represented in expected type \`${display_Ty(callee_expected)}\``,
          );
        }
        break;
      }
    }
  }

  return interp_ok([now, { args: tail, already_gone: varargs.already_gone + N }]);
};

/// Check that the given function has the expected amount of arguments, and then
/// return the list of arguments.
///
/// This may only be used for `extern "llvm-intrinsic"` LLVM intrinsics.
// rustc: src/tools/miri/src/shims/sig.rs:438 check_shim_sig_llvm_intrinsic
InterpCx.prototype.check_shim_sig_llvm_intrinsic = function (this: MiriInterpCx, link_name: Symbol, args: readonly OpTy[], n: number): InterpResult<readonly OpTy[]> {
  assert(Symbol.as_str(link_name).startsWith("llvm."));

  const c = this.check_shim_symbol_clash(link_name);
  if (c.$ === "Err") return c;

  if (args.length === n) {
    return interp_ok(args);
  }
  return throw_ub_format(`incorrect number of arguments for \`${Symbol.as_str(link_name)}\`: got ${args.length}, expected ${n}`);
};
