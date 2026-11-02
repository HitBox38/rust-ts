// Port of src/tools/miri/src/shims/foreign_items.rs (crate `miri`, plan-m6 D2).
// Fill lane: `miri-shims-a` (plan-m6 wave 37): ported.
// Its types are generated into foreign_items.gen.ts (tools/codegen set `miri`); this module re-exports them.
//
// PORT:
// - `trait EvalContextExt` / `trait EvalContextExtPriv` (impl for `MiriInterpCx`) are `declare module` augmentations of
//   `InterpCx` (decision C2). `shims::math`, `shims::unix::foreign_items` are called by path (decision C9): module fns.
// - `shim_sig!(extern "<abi>" fn(<args>) -> <ret>)` (shims/sig.rs:30, a macro of lane miri-shims-b) is expanded by hand
//   with `shim_sig(abi, [args], ret)` below: one `SigTy` per `shim_sig_arg!` arm (shims/sig.rs:106), computed from the
//   interpreter when `check_shim_sig` calls the closure, as the macro's closure does. `check_shim_sig` returns
//   `&[OpTy; N]`; here the args slice, destructured with the arity the signature fixes.
// - `cfg(feature = "native-lib")` (foreign_items.rs:266) is off in the port (decision C6).
// - Windows (`shims::windows::foreign_items`) is out of scope (plan-m6 D2): its dispatch arms stop `unported`.
// - `std::io::stdout().write_all` / `stderr()` (miri_write_to_stdout/err, errors ignored) write the host fds 1 / 2.
// - `lookup_exported_symbol`'s `Entry` on the `exported_symbols_cache` is `has` / `get` / `set`; a cached `None` is
//   a present key with value `undefined`.
import { writeSync } from "node:fs";
import { type MPlaceTy, type OpTy, type PlaceTy, type Pointer } from "../lib.ts";
import { GlobalDataRaceHandler } from "../concurrency/data_race_handler.ts";
import { ExitType } from "../concurrency/genmc/dummy.gen.ts";
import { type TerminationInfo, TerminationInfo_into_machine_stop } from "../diagnostics.ts";
import { display_MiriMemoryKind, MemoryKind_from_MiriMemoryKind, type MiriInterpCx, type MiriMemoryKind, debug_Provenance } from "../machine.ts";
import { type Provenance } from "../machine.ts";
import { DynSym } from "./foreign_items.gen.ts";
import * as math from "./math.ts";
import { EmulateItemResult } from "./mod.ts";
import { ShimSig } from "./sig.ts";
import * as unix_foreign_items from "./unix/foreign_items.ts";
import { Align, type AlignFromBytesError, debug_AbiFromStrErr, debug_AlignFromBytesError, Size } from "../../rustc_abi/lib.ts";
import { ExternAbi } from "../../rustc_abi/extern_abi.ts";
import { NO_ALLOC_SHIM_IS_UNSTABLE } from "../../rustc_ast/expand/allocator.ts";
import { type CodegenFnAttrs, CodegenFnAttrFlags } from "../../rustc_middle/middle/codegen_fn_attrs.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { display_MemoryKind } from "../../rustc_const_eval/interpret/memory.ts";
import { PlaceTy_from_MPlaceTy } from "../../rustc_const_eval/interpret/place.ts";
import {
  type AllocId,
  debug_Pointer_Option,
  InterpErrorInfo_from_InterpErrorKind,
  type InterpResult,
  interp_ok,
  Scalar,
} from "../../rustc_middle/mir/interpret/mod.ts";
import { PointerArithmetic_provided } from "../../rustc_middle/mir/interpret/pointer.ts";
import { type BasicBlock, type Body, type UnwindAction } from "../../rustc_middle/mir/mod.ts";
import { type FnAbi } from "../../rustc_middle/ty/decls.ts";
import { Instance } from "../../rustc_middle/ty/instance.ts";
import { type SymbolName, Ty } from "../../rustc_middle/ty/mod.ts";
import { type CrateNum, type DefId } from "../../rustc_span/def_id.ts";
import { Span } from "../../rustc_span/lib.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { spec } from "../../rustc_target/lib.ts";
import { PLAIN } from "../../std/fmt.ts";
import { stdout_write_all } from "../../std/io.ts";
import { assert, unported, unreachable, unwrap } from "../../std/panic.ts";
import { Err, expect_result, unwrap_result } from "../../std/result.ts";
export * from "./foreign_items.gen.ts";

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- shims/foreign_items.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/foreign_items.rs:44
    emulate_foreign_item(this: MiriInterpCx, link_name: Symbol, abi: FnAbi<Ty>, args: readonly OpTy[], dest: PlaceTy, ret: BasicBlock | undefined, unwind: UnwindAction): InterpResult<[Body, Instance] | undefined>;
    // shims/foreign_items.rs:89
    is_dyn_sym(this: MiriInterpCx, name: string): boolean;
    // shims/foreign_items.rs:99
    emulate_dyn_sym(this: MiriInterpCx, sym: DynSym, abi: FnAbi<Ty>, args: readonly OpTy[], dest: PlaceTy, ret: BasicBlock | undefined, unwind: UnwindAction): InterpResult;
    // shims/foreign_items.rs:114
    lookup_exported_symbol(this: MiriInterpCx, link_name: Symbol): InterpResult<Instance | undefined>;
    // shims/foreign_items.rs:217
    lookup_exported_fn(this: MiriInterpCx, link_name: Symbol): InterpResult<[Body, Instance] | undefined>;
    // shims/foreign_items.rs:237
    lookup_exported_static(this: MiriInterpCx, link_name: Symbol): InterpResult<Instance | undefined>;
    // ---- shims/foreign_items.rs: `trait EvalContextExtPriv` (impl for `MiriInterpCx`) ----
    // shims/foreign_items.rs:256
    emulate_foreign_item_inner(this: MiriInterpCx, link_name: Symbol, abi: FnAbi<Ty>, args: readonly OpTy[], dest: MPlaceTy): InterpResult<EmulateItemResult>;
    // shims/foreign_items.rs:937
    memchr(this: MiriInterpCx, ptr: Pointer, idxs: Iterable<bigint>, needle: number): InterpResult<[bigint, Pointer] | undefined>;
  }
}

// PORT(contract): pending miri-shims-b. shims/sig.rs:327 `check_shim_sig` takes `shim_sig: fn(&MiriInterpCx) ->
// ShimSig` (the skeleton's declaration has a `Pending` type there); this overload is the type the callers here pass.
declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    check_shim_sig(this: MiriInterpCx, shim_sig: (this_: MiriInterpCx) => ShimSig, _1: [Symbol, FnAbi<Ty>, readonly OpTy[]]): InterpResult<readonly OpTy[]>;
  }
}

declare module "./foreign_items.gen.ts" {
  namespace DynSym {
    // shims/foreign_items.rs:31
    export let from_str: (name: string) => DynSym;
  }
}

/** helpers.ts, read at call time: helpers.ts assigns `MiriMachine.prototype` methods at load, so a module that
 *  machine.ts may reach must not value-import it (C10; reported by lane miri-shims-b). */
function helpers(): typeof import("../helpers.ts") {
  return require("../helpers.ts") as typeof import("../helpers.ts");
}

// ---- `shim_sig!` (shims/sig.rs:30, lane miri-shims-b), expanded by hand ----

/** A `shim_sig_arg!` type (shims/sig.rs:106), computed from the interpreter. */
export type SigTy = (this_: MiriInterpCx) => Ty;

/** The `shim_sig_arg!` arms (shims/sig.rs:106-185) the shims of this lane use. */
export const sig_ty = {
  i8: ((this_) => this_.tcx.deref().types.i8) as SigTy,
  i16: ((this_) => this_.tcx.deref().types.i16) as SigTy,
  i32: ((this_) => this_.tcx.deref().types.i32) as SigTy,
  i64: ((this_) => this_.tcx.deref().types.i64) as SigTy,
  isize: ((this_) => this_.tcx.deref().types.isize) as SigTy,
  u8: ((this_) => this_.tcx.deref().types.u8) as SigTy,
  u16: ((this_) => this_.tcx.deref().types.u16) as SigTy,
  u32: ((this_) => this_.tcx.deref().types.u32) as SigTy,
  u64: ((this_) => this_.tcx.deref().types.u64) as SigTy,
  usize: ((this_) => this_.tcx.deref().types.usize) as SigTy,
  /** `()` */
  unit: ((this_) => this_.tcx.deref().types.unit) as SigTy,
  /** `!` */
  never: ((this_) => this_.tcx.deref().types.never) as SigTy,
  bool: ((this_) => this_.tcx.deref().types.bool) as SigTy,
  /** `*_`: mutability does not matter for ABI. */
  ptr_any: ((this_) => this_.machine.layouts.void_ptr_mut.ty) as SigTy,
  /** `*$ty`: pointee types matter for varargs so we support explicitly giving them. Mutability does not matter for ABI. */
  ptr(ty: SigTy): SigTy {
    return (this_) => Ty.new_ptr(this_.tcx.deref(), ty(this_), "Mut");
  },
  /** `fn(..) -> _`: all function pointer types are the same on the ABI level so we don't care about arg/ret. */
  fn_ptr: ((this_) => this_.machine.layouts.fn_ptr.ty) as SigTy,
  /** `&[$ty]` */
  slice_ref(ty: SigTy): SigTy {
    return (this_) => {
      const tcx = this_.tcx.deref();
      return Ty.new_ref(tcx, tcx.lifetimes.re_erased, Ty.new_slice(tcx, ty(this_)), "Not");
    };
  },
  /** `$krate :: $($path)::+` */
  path(...path: string[]): SigTy {
    return (this_) => helpers().path_ty_layout(this_, path).ty;
  },
};

/** `shim_sig!(extern "<abi>" fn(<args>) -> <ret>)` (no trailing `...`: `c_variadic` is false). */
export function shim_sig(abi: string, args: readonly SigTy[], ret: SigTy): (this_: MiriInterpCx) => ShimSig {
  return (this_) => {
    const args_ = args.map((a) => a(this_));
    return new ShimSig(
      expect_result(ExternAbi.from_str(abi), "incorrect abi specified", debug_AbiFromStrErr),
      args_,
      ret(this_),
      false,
    );
  };
}

// ---- local macro helpers ----

/** `throw_unsup_format!(..)` */
function throw_unsup_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "Unsupported", _0: { $: "Unsupported", _0: msg } }));
}
/** `throw_ub_format!(..)` */
function throw_ub_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "UndefinedBehavior", _0: { $: "Ub", _0: msg } }));
}
/** `throw_machine_stop!(info)` */
function throw_machine_stop<T>(info: TerminationInfo): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind(TerminationInfo_into_machine_stop(info)));
}

/** `u64::is_power_of_two` */
function is_power_of_two(x: bigint): boolean {
  return x !== 0n && (x & (x - 1n)) === 0n;
}

/** `Align::from_bytes(x).unwrap()` */
function align_from_bytes_unwrap(x: bigint): Align {
  return unwrap_result(Align.from_bytes(x), debug_AlignFromBytesError);
}

/** `0..n` */
function* range(start: bigint, end: bigint): Generator<bigint> {
  for (let i = start; i < end; i++) yield i;
}
/** `(0..n).rev()` */
function* range_rev(start: bigint, end: bigint): Generator<bigint> {
  for (let i = end; i > start; ) {
    i--;
    yield i;
  }
}
/** `std::iter::repeat_n(val, n)` */
function* repeat_n(val: number, n: number): Generator<number> {
  for (let i = 0; i < n; i++) yield val;
}

/** `(BytePos, BytePos)`'s derived `PartialOrd::lt` (`Span::lo_hi`). */
function lo_hi_lt(a: Span, b: Span): boolean {
  const [alo, ahi] = Span.lo_hi(a);
  const [blo, bhi] = Span.lo_hi(b);
  return alo < blo || (alo === blo && ahi < bhi);
}

/** `ptr_get_alloc_id(ptr, 0).map_err_kind(|_e| err_machine_stop!(TerminationInfo::Abort(..)))` */
function get_alloc_id_or_abort(this_: MiriInterpCx, ptr: Pointer): InterpResult<AllocId> {
  const r = this_.ptr_get_alloc_id(ptr, 0n);
  if (r.$ === "Err") {
    return throw_machine_stop({
      $: "Abort",
      _0: `pointer passed to \`miri_get_alloc_id\` must not be dangling, got ${debug_Pointer_Option<Provenance>(ptr, PLAIN, debug_Provenance)}`,
    });
  }
  return interp_ok(r._0[0]);
}

/** `eprintln!` / `std::io::stderr().write_all` (unbuffered, as std's stderr). */
function stderr_write_all(buf: Uint8Array): void {
  let off = 0;
  while (off < buf.length) off += writeSync(2, buf, off);
}

// impl DynSym
// rustc: src/tools/miri/src/shims/foreign_items.rs:31 from_str
DynSym.from_str = function (name: string): DynSym {
  return new DynSym(Symbol.intern(name));
};

/// Emulates calling a foreign item, failing if the item is not supported.
/// This function will handle `goto_block` if needed.
/// Returns Ok(None) if the foreign item was completely handled
/// by this function.
/// Returns Ok(Some(body)) if processing the foreign item
/// is delegated to another function.
// rustc: src/tools/miri/src/shims/foreign_items.rs:44 emulate_foreign_item
InterpCx.prototype.emulate_foreign_item = function (
  this: MiriInterpCx,
  link_name: Symbol,
  abi: FnAbi<Ty>,
  args: readonly OpTy[],
  dest: PlaceTy,
  ret: BasicBlock | undefined,
  unwind: UnwindAction,
): InterpResult<[Body, Instance] | undefined> {
  const this_ = this.eval_context_mut();

  // Handle allocator shim.
  const shim = this_.machine.allocator_shim_symbols.get(link_name);
  if (shim !== undefined) {
    switch (shim.$) {
      case "Left": {
        const other_fn = shim._0;
        const h = this_.lookup_exported_fn(other_fn);
        if (h.$ === "Err") return h;
        const handler = unwrap(h._0, "missing alloc error handler symbol");
        return interp_ok(handler);
      }
      case "Right": {
        const special = shim._0;
        const r = this_.rust_special_allocator_method(special, link_name, abi, args, dest);
        if (r.$ === "Err") return r;
        const r2 = this_.return_to_block(ret);
        if (r2.$ === "Err") return r2;
        return interp_ok(undefined);
      }
    }
  }

  // FIXME: avoid allocating memory
  const dest_r = this_.force_allocation(dest);
  if (dest_r.$ === "Err") return dest_r;
  const dest_ = dest_r._0 as MPlaceTy;

  // The rest either implements the logic, or falls back to `lookup_exported_symbol`.
  const res = this_.emulate_foreign_item_inner(link_name, abi, args, dest_);
  if (res.$ === "Err") return res;
  return EmulateItemResult.jump_to_next_block<[Body, Instance]>(
    res._0,
    this_,
    PlaceTy_from_MPlaceTy(dest_ as never) as unknown as PlaceTy,
    ret,
    unwind,
    (this_) => {
      const body = this_.lookup_exported_fn(link_name);
      if (body.$ === "Err") return body;
      if (body._0 !== undefined) {
        return interp_ok(body._0);
      }

      return throw_machine_stop({
        $: "UnsupportedForeignItem",
        _0: `can't call foreign function \`${Symbol.as_str(link_name)}\` on OS \`${spec.Os.display(this_.tcx.deref().sess.target.os)}\``,
      });
    },
  );
};

// rustc: src/tools/miri/src/shims/foreign_items.rs:89 is_dyn_sym
InterpCx.prototype.is_dyn_sym = function (this: MiriInterpCx, name: string): boolean {
  const this_ = this.eval_context_ref();
  const os = this_.tcx.deref().sess.target.os;
  if (this_.target_os_is_unix()) {
    return unix_foreign_items.is_dyn_sym(name, os);
  } else if (os.$ === "Windows") {
    return unported("miri::shims::windows::foreign_items::is_dyn_sym (Windows shims are out of scope, plan-m6 D2)");
  } else {
    return false;
  }
};

/// Emulates a call to a `DynSym`.
// rustc: src/tools/miri/src/shims/foreign_items.rs:99 emulate_dyn_sym
InterpCx.prototype.emulate_dyn_sym = function (
  this: MiriInterpCx,
  sym: DynSym,
  abi: FnAbi<Ty>,
  args: readonly OpTy[],
  dest: PlaceTy,
  ret: BasicBlock | undefined,
  unwind: UnwindAction,
): InterpResult {
  const res = this.emulate_foreign_item(sym._0, abi, args, dest, ret, unwind);
  if (res.$ === "Err") return res;
  assert(res._0 === undefined, "DynSyms that delegate are not supported");
  return interp_ok(undefined);
};

/// Lookup the instance that has `link_name` as the symbol name.
// rustc: src/tools/miri/src/shims/foreign_items.rs:114 lookup_exported_symbol
InterpCx.prototype.lookup_exported_symbol = function (this: MiriInterpCx, link_name: Symbol): InterpResult<Instance | undefined> {
  const this_ = this.eval_context_ref();
  const tcx = this_.tcx.deref();

  // If the result was cached, just return it.
  // (Cannot use `or_insert` since the code below might have to throw an error.)
  const cache = this_.machine.exported_symbols_cache;
  let instance: Instance | undefined;
  if (cache.has(link_name)) {
    instance = cache.get(link_name);
  } else {
    // Find it if it was not cached.

    interface SymbolTarget {
      instance: Instance;
      cnum: CrateNum;
      is_weak: boolean;
    }
    let symbol_target: SymbolTarget | undefined = undefined;
    const r = helpers().iter_exported_symbols(tcx, (cnum: CrateNum, def_id: DefId, _used: boolean): InterpResult => {
      const attrs = tcx.codegen_fn_attrs(def_id) as CodegenFnAttrs;
      // Skip over items without an explicitly defined symbol name.
      if (
        !(
          attrs.symbol_name !== undefined ||
          CodegenFnAttrFlags.contains(attrs.flags, CodegenFnAttrFlags.NO_MANGLE) ||
          CodegenFnAttrFlags.contains(attrs.flags, CodegenFnAttrFlags.RUSTC_STD_INTERNAL_SYMBOL)
        )
      ) {
        return interp_ok(undefined);
      }

      const instance = Instance.mono(tcx, def_id);
      const symbol_name = (tcx.symbol_name(instance) as SymbolName).name;
      const is_weak = attrs.linkage === "WeakAny";
      if (symbol_name === Symbol.as_str(link_name)) {
        const original: SymbolTarget | undefined = symbol_target;
        if (original !== undefined) {
          // There is more than one definition with this name. What we do now
          // depends on whether one or both definitions are weak.
          if (!is_weak && original.is_weak) {
            // Original definition is a weak definition. Override it.

            symbol_target = {
              instance: Instance.mono(tcx, def_id),
              cnum,
              is_weak,
            };
          } else if (is_weak && !original.is_weak) {
            // Current definition is a weak definition. Keep the original one.
          } else {
            // Either both definitions are non-weak or both are weak. In
            // either case return an error. For weak definitions we error
            // because it is unspecified which definition would have been
            // picked by the linker.

            // Make sure we are consistent wrt what is 'first' and 'second'.
            const original_span = tcx.def_span(Instance.def_id(original.instance));
            const span = tcx.def_span(def_id);
            if (lo_hi_lt(original_span, span)) {
              return throw_machine_stop({
                $: "MultipleSymbolDefinitions",
                link_name,
                first: original_span,
                first_crate: tcx.crate_name(original.cnum),
                second: span,
                second_crate: tcx.crate_name(cnum),
              });
            } else {
              return throw_machine_stop({
                $: "MultipleSymbolDefinitions",
                link_name,
                first: span,
                first_crate: tcx.crate_name(cnum),
                second: original_span,
                second_crate: tcx.crate_name(original.cnum),
              });
            }
          }
        } else {
          symbol_target = {
            instance: Instance.mono(tcx, def_id),
            cnum,
            is_weak,
          };
        }
      }
      return interp_ok(undefined);
    });
    if (r.$ === "Err") return r;

    const target = symbol_target as SymbolTarget | undefined;
    instance = target === undefined ? undefined : target.instance;
    cache.set(link_name, instance);
  }
  return interp_ok(instance);
};

/// Lookup the body of a function that has `link_name` as the symbol name.
// rustc: src/tools/miri/src/shims/foreign_items.rs:217 lookup_exported_fn
InterpCx.prototype.lookup_exported_fn = function (this: MiriInterpCx, link_name: Symbol): InterpResult<[Body, Instance] | undefined> {
  const this_ = this.eval_context_ref();
  const instance_r = this_.lookup_exported_symbol(link_name);
  if (instance_r.$ === "Err") return instance_r;
  const instance = instance_r._0;
  if (instance !== undefined) {
    const def_kind = this_.tcx.deref().def_kind(Instance.def_id(instance));
    if (!(def_kind.$ === "Fn" || def_kind.$ === "AssocFn")) {
      return throw_ub_format("attempt to call an exported symbol that is not defined as a function");
    }
  }
  if (instance === undefined) {
    return interp_ok(undefined);
  } else {
    const body = this_.load_mir(instance.def, undefined);
    if (body.$ === "Err") return body;
    return interp_ok([body._0, instance]);
  }
};

/// Lookup the instance of a static that has `link_name` as the symbol name.
// rustc: src/tools/miri/src/shims/foreign_items.rs:237 lookup_exported_static
InterpCx.prototype.lookup_exported_static = function (this: MiriInterpCx, link_name: Symbol): InterpResult<Instance | undefined> {
  const this_ = this.eval_context_ref();
  const instance_r = this_.lookup_exported_symbol(link_name);
  if (instance_r.$ === "Err") return instance_r;
  const instance = instance_r._0;
  if (instance !== undefined) {
    if (this_.tcx.deref().def_kind(Instance.def_id(instance)).$ !== "Static") {
      return throw_ub_format(
        `attempt to access an exported symbol \`${Symbol.as_str(link_name)}\` that is not defined as a static`,
      );
    }
  }
  return interp_ok(instance);
};

const T = sig_ty;

// rustc: src/tools/miri/src/shims/foreign_items.rs:256 emulate_foreign_item_inner
InterpCx.prototype.emulate_foreign_item_inner = function (
  this: MiriInterpCx,
  link_name: Symbol,
  abi: FnAbi<Ty>,
  args: readonly OpTy[],
  dest: MPlaceTy,
): InterpResult<EmulateItemResult> {
  const this_ = this.eval_context_mut();

  // First deal with any external C functions in linked .so file.
  // #[cfg(all(feature = "native-lib", unix))]  (off in the port, decision C6)

  // When adding a new shim, you should follow the following pattern:
  // ```
  // "shim_name" => {
  //     let [arg1, arg2, arg3] = this.check_shim(abi, CanonAbi::C , link_name, args)?;
  //     let result = this.shim_name(arg1, arg2, arg3)?;
  //     this.write_scalar(result, dest)?;
  // }
  // ```
  // and then define `shim_name` as a helper function in an extension trait in a suitable file
  // (see e.g. `unix/fs.rs`):
  // ```
  // fn shim_name(
  //     &mut self,
  //     arg1: &OpTy<'tcx>,
  //     arg2: &OpTy<'tcx>,
  //     arg3: &OpTy<'tcx>,
  //     arg4: &OpTy<'tcx>)
  // -> InterpResult<'tcx, Scalar> {
  //     let this = self.eval_context_mut();
  //
  //     // First thing: load all the arguments. Details depend on the shim.
  //     let arg1 = this.read_scalar(arg1)?.to_u32()?;
  //     let arg2 = this.read_pointer(arg2)?; // when you need to work with the pointer directly
  //     // when you want to load/store through the pointer
  //     let arg3 = this.deref_pointer_as(arg3, this.libc_ty_layout("some_libc_struct"))?;
  //
  //     // ...
  //
  //     interp_ok(Scalar::from_u32(42))
  // }
  // ```
  // You might find existing shims not following this pattern, most
  // likely because they predate it or because for some reason they cannot be made to fit.

  // Here we dispatch all the shims for foreign functions. If you have a platform specific
  // shim, add it to the corresponding submodule.
  const sig = (shim: (this_: MiriInterpCx) => ShimSig): InterpResult<readonly OpTy[]> =>
    this_.check_shim_sig(shim, [link_name, abi, args]);
  const name = Symbol.as_str(link_name);
  // Magic function Rust emits (and not as part of the allocator shim).
  if (name === this_.mangle_internal_symbol(NO_ALLOC_SHIM_IS_UNSTABLE)) {
    // This is a no-op shim that only exists to prevent making the allocator shims
    // instantly stable.
    const a = sig(shim_sig("Rust", [], T.unit));
    if (a.$ === "Err") return a;
  } else {
    switch (name) {
      // Miri-specific extern functions
      case "miri_alloc": {
        const a = sig(shim_sig("Rust", [T.usize, T.usize], T.ptr(T.unit)));
        if (a.$ === "Err") return a;
        const [size_op, align_op] = a._0 as [OpTy, OpTy];
        const size = this_.read_target_usize(size_op);
        if (size.$ === "Err") return size;
        const align = this_.read_target_usize(align_op);
        if (align.$ === "Err") return align;

        const c = this_.check_rust_alloc_request(size._0, align._0);
        if (c.$ === "Err") return c;

        const ptr = this_.allocate_ptr(
          Size.from_bytes(size._0),
          align_from_bytes_unwrap(align._0),
          MemoryKind_from_MiriMemoryKind("Miri"),
          "Uninit",
        );
        if (ptr.$ === "Err") return ptr;

        const w = this_.write_pointer(ptr._0, dest);
        if (w.$ === "Err") return w;
        break;
      }
      case "miri_dealloc": {
        const a = sig(shim_sig("Rust", [T.ptr(T.unit), T.usize, T.usize], T.unit));
        if (a.$ === "Err") return a;
        const [ptr_op, old_size_op, align_op] = a._0 as [OpTy, OpTy, OpTy];
        const ptr = this_.read_pointer(ptr_op);
        if (ptr.$ === "Err") return ptr;
        const old_size = this_.read_target_usize(old_size_op);
        if (old_size.$ === "Err") return old_size;
        const align = this_.read_target_usize(align_op);
        if (align.$ === "Err") return align;

        // No need to check old_size/align; we anyway check that they match the allocation.
        const d = this_.deallocate_ptr(
          ptr._0,
          [Size.from_bytes(old_size._0), align_from_bytes_unwrap(align._0)],
          MemoryKind_from_MiriMemoryKind("Miri"),
        );
        if (d.$ === "Err") return d;
        break;
      }
      case "miri_track_alloc": {
        const a = sig(shim_sig("Rust", [T.ptr(T.unit)], T.unit));
        if (a.$ === "Err") return a;
        const [ptr_op] = a._0 as [OpTy];
        const ptr = this_.read_pointer(ptr_op);
        if (ptr.$ === "Err") return ptr;
        const alloc_id = get_alloc_id_or_abort(this_, ptr._0);
        if (alloc_id.$ === "Err") return alloc_id;
        // `HashSet::insert` returns whether the value was newly inserted.
        if (!this_.machine.tracked_alloc_ids.has(alloc_id._0)) {
          this_.machine.tracked_alloc_ids.add(alloc_id._0);
          const info = this_.get_alloc_info(alloc_id._0);
          this_.emit_diagnostic({ $: "TrackingAlloc", _0: alloc_id._0, _1: info.size, _2: info.align });
        }
        break;
      }
      case "miri_start_unwind": {
        const a = sig(shim_sig("Rust", [T.ptr(T.unit)], T.never));
        if (a.$ === "Err") return a;
        const [payload] = a._0 as [OpTy];
        const r = this_.handle_miri_start_unwind(payload);
        if (r.$ === "Err") return r;
        return interp_ok("NeedsUnwind");
      }
      case "miri_run_provenance_gc": {
        const a = sig(shim_sig("Rust", [], T.unit));
        if (a.$ === "Err") return a;
        this_.run_provenance_gc();
        break;
      }
      case "miri_get_alloc_id": {
        const a = sig(shim_sig("Rust", [T.ptr(T.unit)], T.u64));
        if (a.$ === "Err") return a;
        const [ptr_op] = a._0 as [OpTy];
        const ptr = this_.read_pointer(ptr_op);
        if (ptr.$ === "Err") return ptr;
        const alloc_id = get_alloc_id_or_abort(this_, ptr._0);
        if (alloc_id.$ === "Err") return alloc_id;
        const w = this_.write_scalar(Scalar.from_u64(BigInt(alloc_id._0)), dest);
        if (w.$ === "Err") return w;
        break;
      }
      case "miri_print_borrow_state": {
        const a = sig(shim_sig("Rust", [T.u64, T.bool], T.unit));
        if (a.$ === "Err") return a;
        const [id_op, show_unnamed_op] = a._0 as [OpTy, OpTy];
        const id_s = this_.read_scalar(id_op);
        if (id_s.$ === "Err") return id_s;
        const id = Scalar.to_u64(id_s._0);
        if (id.$ === "Err") return id;
        const show_unnamed_s = this_.read_scalar(show_unnamed_op);
        if (show_unnamed_s.$ === "Err") return show_unnamed_s;
        const show_unnamed = Scalar.to_bool(show_unnamed_s._0);
        if (show_unnamed.$ === "Err") return show_unnamed;
        // `std::num::NonZero::new(id).map(AllocId)`
        let alloc_id: AllocId | undefined = undefined;
        if (id._0 !== 0n) {
          if (id._0 > BigInt(Number.MAX_SAFE_INTEGER)) {
            return unported("miri::shims::foreign_items: `miri_print_borrow_state` with an id beyond 2^53 (AllocId is a number)");
          }
          alloc_id = Number(id._0) as AllocId;
        }
        if (alloc_id !== undefined && this_.get_alloc_info(alloc_id).kind === "LiveData") {
          const r = this_.print_borrow_state(alloc_id, show_unnamed._0);
          if (r.$ === "Err") return r;
        } else {
          stderr_write_all(new TextEncoder().encode(`${id._0} is not the ID of a live data allocation\n`));
        }
        break;
      }
      case "miri_pointer_name": {
        // This associates a name to a tag. Very useful for debugging, and also makes
        // tests more strict.
        const a = sig(shim_sig("Rust", [T.ptr(T.unit), T.u8, T.slice_ref(T.u8)], T.unit));
        if (a.$ === "Err") return a;
        const [ptr_op, nth_parent_op, name_op] = a._0 as [OpTy, OpTy, OpTy];
        const ptr = this_.read_pointer(ptr_op);
        if (ptr.$ === "Err") return ptr;
        const nth_parent_s = this_.read_scalar(nth_parent_op);
        if (nth_parent_s.$ === "Err") return nth_parent_s;
        const nth_parent = Scalar.to_u8(nth_parent_s._0);
        if (nth_parent.$ === "Err") return nth_parent;
        const name_imm = this_.read_immediate(name_op);
        if (name_imm.$ === "Err") return name_imm;

        const name_bytes = this_.read_byte_slice(name_imm._0);
        if (name_bytes.$ === "Err") return name_bytes;
        // We must make `name` owned because we need to
        // end the shared borrow from `read_byte_slice` before we can
        // start the mutable borrow for `give_pointer_debug_name`.
        // `String::from_utf8_lossy` (TextDecoder's replacement is U+FFFD per maximal subpart, as std's).
        const name_ = new TextDecoder("utf-8", { fatal: false }).decode(name_bytes._0);
        const r = this_.give_pointer_debug_name(ptr._0, nth_parent._0, name_);
        if (r.$ === "Err") return r;
        break;
      }
      case "miri_static_root": {
        const a = sig(shim_sig("Rust", [T.ptr(T.unit)], T.unit));
        if (a.$ === "Err") return a;
        const [ptr_op] = a._0 as [OpTy];
        const ptr = this_.read_pointer(ptr_op);
        if (ptr.$ === "Err") return ptr;
        const r = this_.ptr_get_alloc_id(ptr._0, 0n);
        if (r.$ === "Err") return r;
        const [alloc_id, offset] = r._0;
        if (offset.bytes_u64() !== 0n) {
          return throw_unsup_format("pointer passed to `miri_static_root` must point to beginning of an allocated block");
        }
        this_.machine.static_roots.push(alloc_id);
        break;
      }
      case "miri_host_to_target_path": {
        const a = sig(shim_sig("Rust", [T.ptr(T.unit), T.ptr(T.unit), T.usize], T.usize));
        if (a.$ === "Err") return a;
        const [ptr_op, out_op, out_size_op] = a._0 as [OpTy, OpTy, OpTy];
        const ptr = this_.read_pointer(ptr_op);
        if (ptr.$ === "Err") return ptr;
        const out = this_.read_pointer(out_op);
        if (out.$ === "Err") return out;
        const out_size_s = this_.read_scalar(out_size_op);
        if (out_size_s.$ === "Err") return out_size_s;
        const out_size = Scalar.to_target_usize(out_size_s._0, this_);
        if (out_size.$ === "Err") return out_size;

        // The host affects program behavior here, so this requires isolation to be disabled.
        const c = this_.check_no_isolation("`miri_host_to_target_path`");
        if (c.$ === "Err") return c;

        // We read this as a plain OsStr and write it as a path, which will convert it to the target.
        const path = this_.read_os_str_from_c_str(ptr._0);
        if (path.$ === "Err") return path;
        const w = this_.write_path_to_c_str(path._0, out._0, out_size._0);
        if (w.$ === "Err") return w;
        const [success, needed_size] = w._0;
        // Return value: 0 on success, otherwise the size it would have needed.
        const w2 = this_.write_int(success ? 0n : needed_size, dest);
        if (w2.$ === "Err") return w2;
        break;
      }
      case "miri_thread_spawn": {
        const a = sig(
          // FIXME: The first argument is actually a function pointer.
          shim_sig("Rust", [T.fn_ptr, T.ptr(T.unit)], T.usize),
        );
        if (a.$ === "Err") return a;
        const [start_routine_op, func_arg_op] = a._0 as [OpTy, OpTy];
        const start_routine = this_.read_pointer(start_routine_op);
        if (start_routine.$ === "Err") return start_routine;
        const func_arg = this_.read_immediate(func_arg_op);
        if (func_arg.$ === "Err") return func_arg;

        const r = this_.start_regular_thread(dest, start_routine._0, ExternAbi.Rust, func_arg._0, this_.machine.layouts.unit);
        if (r.$ === "Err") return r;
        break;
      }
      case "miri_thread_join": {
        const a = sig(shim_sig("Rust", [T.usize], T.bool));
        if (a.$ === "Err") return a;
        const [thread_id_op] = a._0 as [OpTy];

        const thread_r = this_.read_target_usize(thread_id_op);
        if (thread_r.$ === "Err") return thread_r;
        // Joining a terminated thread is valid.
        // use crate::concurrency::thread::ThreadLookupError;
        const lookup = this_.thread_id_try_from(thread_r._0);
        const thread =
          lookup.$ === "Ok" ? lookup._0 : lookup._0.$ === "Terminated" ? lookup._0._0 : /* InvalidId */ undefined;
        if (thread !== undefined) {
          const r = this_.join_thread_exclusive(thread, /* success_retval */ Scalar.from_bool(true), dest);
          if (r.$ === "Err") return r;
        } else {
          const w = this_.write_scalar(Scalar.from_bool(false), dest);
          if (w.$ === "Err") return w;
        }
        break;
      }
      // Hint that a loop is spinning indefinitely.
      case "miri_spin_loop": {
        const a = sig(shim_sig("Rust", [], T.unit));
        if (a.$ === "Err") return a;

        // Try to run another thread to maximize the chance of finding actual bugs.
        this_.yield_active_thread();
        break;
      }
      // Obtains the size of a Miri backtrace. See the README for details.
      case "miri_backtrace_size": {
        const r = this_.handle_miri_backtrace_size(abi, link_name, args, dest);
        if (r.$ === "Err") return r;
        break;
      }
      // Obtains a Miri backtrace. See the README for details.
      case "miri_get_backtrace": {
        // `check_shim` happens inside `handle_miri_get_backtrace`.
        const r = this_.handle_miri_get_backtrace(abi, link_name, args);
        if (r.$ === "Err") return r;
        break;
      }
      // Resolves a Miri backtrace frame. See the README for details.
      case "miri_resolve_frame": {
        // `check_shim` happens inside `handle_miri_resolve_frame`.
        const r = this_.handle_miri_resolve_frame(abi, link_name, args, dest);
        if (r.$ === "Err") return r;
        break;
      }
      // Writes the function and file names of a Miri backtrace frame into a user provided buffer. See the README for details.
      case "miri_resolve_frame_names": {
        const r = this_.handle_miri_resolve_frame_names(abi, link_name, args);
        if (r.$ === "Err") return r;
        break;
      }
      // Writes some bytes to the interpreter's stdout/stderr. See the README for details.
      case "miri_write_to_stdout":
      case "miri_write_to_stderr": {
        const a = sig(shim_sig("Rust", [T.slice_ref(T.u8)], T.unit));
        if (a.$ === "Err") return a;
        const [msg_op] = a._0 as [OpTy];
        const msg_imm = this_.read_immediate(msg_op);
        if (msg_imm.$ === "Err") return msg_imm;
        const msg = this_.read_byte_slice(msg_imm._0);
        if (msg.$ === "Err") return msg;
        // Note: we're ignoring errors writing to host stdout/stderr.
        switch (name) {
          case "miri_write_to_stdout":
            void stdout_write_all(msg._0);
            break;
          case "miri_write_to_stderr":
            try {
              stderr_write_all(msg._0);
            } catch {
              // ignored, as upstream's `let _ignore = ..`
            }
            break;
          default:
            return unreachable();
        }
        break;
      }
      // Promises that a pointer has a given symbolic alignment.
      case "miri_promise_symbolic_alignment": {
        // use rustc_abi::AlignFromBytesError;

        const a = sig(shim_sig("Rust", [T.ptr(T.unit), T.usize], T.unit));
        if (a.$ === "Err") return a;
        const [ptr_op, align_op] = a._0 as [OpTy, OpTy];

        const ptr = this_.read_pointer(ptr_op);
        if (ptr.$ === "Err") return ptr;
        const align_r = this_.read_target_usize(align_op);
        if (align_r.$ === "Err") return align_r;
        const align_u = align_r._0;
        if (!is_power_of_two(align_u)) {
          return throw_unsup_format(
            `\`miri_promise_symbolic_alignment\`: alignment must be a power of 2, got ${align_u}`,
          );
        }
        const align_from = Align.from_bytes(align_u);
        let align: Align;
        if (align_from.$ === "Ok") {
          align = align_from._0;
        } else {
          switch (align_from._0.$) {
            case "NotPowerOfTwo":
              return unreachable();
            // When the alignment is a power of 2 but too big, clamp it to MAX.
            case "TooLarge":
              align = Align.MAX;
              break;
          }
        }
        const addr = ptr._0.addr(this_.machine.Provenance);
        // Cannot panic since `align` is a power of 2 and hence non-zero.
        if (addr.bytes_u64() % BigInt(align.bytes()) !== 0n) {
          return throw_unsup_format("`miri_promise_symbolic_alignment`: pointer is not actually aligned");
        }
        const tried = this_.ptr_try_get_alloc_id(ptr._0, 0n);
        if (tried.$ === "Ok") {
          const [alloc_id, offset] = tried._0;
          const alloc_align = this_.get_alloc_info(alloc_id).align;
          // If the newly promised alignment is bigger than the native alignment of this
          // allocation, and bigger than the previously promised alignment, then set it.
          const old = this_.machine.symbolic_alignment.get(alloc_id);
          if (align.pow2 > alloc_align.pow2 && (old === undefined || align.pow2 > old[1].pow2)) {
            this_.machine.symbolic_alignment.set(alloc_id, [offset, align]);
          }
        }
        break;
      }
      // GenMC mode: Assume statements block the current thread when their condition is false.
      case "miri_genmc_assume": {
        const a = sig(shim_sig("Rust", [T.bool], T.unit));
        if (a.$ === "Err") return a;
        const [condition] = a._0 as [OpTy];

        if (GlobalDataRaceHandler.as_genmc_ref(this_.machine.data_race) !== undefined) {
          const r = this_.handle_genmc_verifier_assume(condition);
          if (r.$ === "Err") return r;
        } else {
          return throw_unsup_format("miri_genmc_assume is only supported in GenMC mode");
        }
        break;
      }

      // Aborting the process.
      case "exit": {
        // FIXME: This does not have a direct test (#3179).
        const a = sig(shim_sig("C", [T.i32], T.unit));
        if (a.$ === "Err") return a;
        const [code_op] = a._0 as [OpTy];
        const code_s = this_.read_scalar(code_op);
        if (code_s.$ === "Err") return code_s;
        const code = Scalar.to_i32(code_s._0);
        if (code.$ === "Err") return code;
        const genmc_ctx = GlobalDataRaceHandler.as_genmc_ref(this_.machine.data_race);
        if (genmc_ctx !== undefined) {
          // If there is no error, execution should continue (on a different thread).
          const r = genmc_ctx.handle_exit(this_.machine.threads.active_thread_(), code._0, ExitType.ExitCalled);
          if (r.$ === "Err") return r;
          return interp_ok("AlreadyJumped");
        }
        return throw_machine_stop({ $: "Exit", code: code._0, leak_check: false });
      }
      case "abort": {
        // FIXME: This does not have a direct test (#3179).
        const a = sig(shim_sig("C", [], T.unit));
        if (a.$ === "Err") return a;
        return throw_machine_stop({ $: "Abort", _0: "the program aborted execution" });
      }

      // Standard C allocation
      case "malloc": {
        const a = sig(shim_sig("C", [T.usize], T.ptr_any));
        if (a.$ === "Err") return a;
        const [size_op] = a._0 as [OpTy];
        const size = this_.read_target_usize(size_op);
        if (size.$ === "Err") return size;
        if (size._0 <= max_size_of_val_bytes(this_)) {
          const res = this_.malloc(size._0, "Uninit");
          if (res.$ === "Err") return res;
          const w = this_.write_pointer(res._0, dest);
          if (w.$ === "Err") return w;
        } else {
          // If this does not fit in an isize, return null and, on Unix, set errno.
          if (this_.target_os_is_unix()) {
            const e = this_.set_last_error({ $: "LibcError", _0: "ENOMEM" });
            if (e.$ === "Err") return e;
          }
          const w = this_.write_null(dest);
          if (w.$ === "Err") return w;
        }
        break;
      }
      case "calloc": {
        const a = sig(shim_sig("C", [T.usize, T.usize], T.ptr_any));
        if (a.$ === "Err") return a;
        const [items_op, elem_size_op] = a._0 as [OpTy, OpTy];
        const items = this_.read_target_usize(items_op);
        if (items.$ === "Err") return items;
        const elem_size = this_.read_target_usize(elem_size_op);
        if (elem_size.$ === "Err") return elem_size;
        const size = this_.compute_size_in_bytes(Size.from_bytes(elem_size._0), items._0);
        if (size !== undefined) {
          const res = this_.malloc(size.bytes_u64(), "Zero");
          if (res.$ === "Err") return res;
          const w = this_.write_pointer(res._0, dest);
          if (w.$ === "Err") return w;
        } else {
          // On size overflow, return null and, on Unix, set errno.
          if (this_.target_os_is_unix()) {
            const e = this_.set_last_error({ $: "LibcError", _0: "ENOMEM" });
            if (e.$ === "Err") return e;
          }
          const w = this_.write_null(dest);
          if (w.$ === "Err") return w;
        }
        break;
      }
      case "free": {
        const a = sig(shim_sig("C", [T.ptr_any], T.unit));
        if (a.$ === "Err") return a;
        const [ptr_op] = a._0 as [OpTy];
        const ptr = this_.read_pointer(ptr_op);
        if (ptr.$ === "Err") return ptr;
        const r = this_.free(ptr._0);
        if (r.$ === "Err") return r;
        break;
      }
      case "realloc": {
        const a = sig(shim_sig("C", [T.ptr_any, T.usize], T.ptr_any));
        if (a.$ === "Err") return a;
        const [old_ptr_op, new_size_op] = a._0 as [OpTy, OpTy];
        const old_ptr = this_.read_pointer(old_ptr_op);
        if (old_ptr.$ === "Err") return old_ptr;
        const new_size = this_.read_target_usize(new_size_op);
        if (new_size.$ === "Err") return new_size;
        if (new_size._0 <= max_size_of_val_bytes(this_)) {
          const res = this_.realloc(old_ptr._0, new_size._0);
          if (res.$ === "Err") return res;
          const w = this_.write_pointer(res._0, dest);
          if (w.$ === "Err") return w;
        } else {
          // If this does not fit in an isize, return null and, on Unix, set errno.
          if (this_.target_os_is_unix()) {
            const e = this_.set_last_error({ $: "LibcError", _0: "ENOMEM" });
            if (e.$ === "Err") return e;
          }
          const w = this_.write_null(dest);
          if (w.$ === "Err") return w;
        }
        break;
      }
      case "malloc_usable_size": {
        const c = this_.check_target_os([spec.Os.Linux, spec.Os.FreeBsd, spec.Os.Android], link_name);
        if (c.$ === "Err") return c;

        const a = sig(shim_sig("C", [T.ptr_any], T.usize));
        if (a.$ === "Err") return a;
        const [ptr_op] = a._0 as [OpTy];
        const ptr = this_.read_pointer(ptr_op);
        if (ptr.$ === "Err") return ptr;
        const is_null = this_.ptr_is_null(ptr._0);
        if (is_null.$ === "Err") return is_null;
        let size: bigint;
        if (is_null._0) {
          size = 0n;
        } else {
          const r = this_.ptr_get_alloc_id(ptr._0, 0n);
          if (r.$ === "Err") return r;
          const [alloc_id, offset] = r._0;
          if (offset.bytes_u64() !== 0n) {
            return throw_ub_format(
              "`malloc_usable_size` was called on a pointer that does not point to the beginning of its allocation",
            );
          }
          const entry = this_.memory.alloc_map_().get(alloc_id);
          if (entry === undefined) {
            return throw_ub_format("`malloc_usable_size` was called on a pointer to memory not managed by the C allocator");
          }
          const [alloc_kind] = entry;
          if (!(alloc_kind.$ === "Machine" && alloc_kind._0 === "C")) {
            return throw_ub_format(
              `\`malloc_usable_size\` was called on a pointer to ${display_MemoryKind<MiriMemoryKind>(alloc_kind, PLAIN, (v) => display_MiriMemoryKind(v))} memory, which is not managed by the C allocator`,
            );
          }
          size = this_.get_alloc_info(alloc_id).size.bytes_u64();
        }
        const w = this_.write_scalar(Scalar.from_target_usize(size, this_), dest);
        if (w.$ === "Err") return w;
        break;
      }

      // C memory handling functions
      case "memcmp": {
        const a = sig(shim_sig("C", [T.ptr_any, T.ptr_any, T.usize], T.i32));
        if (a.$ === "Err") return a;
        const [left_op, right_op, n_op] = a._0 as [OpTy, OpTy, OpTy];
        const left = this_.read_pointer(left_op);
        if (left.$ === "Err") return left;
        const right = this_.read_pointer(right_op);
        if (right.$ === "Err") return right;
        const n_u = this_.read_target_usize(n_op);
        if (n_u.$ === "Err") return n_u;
        const n = Size.from_bytes(n_u._0);

        // C requires that this must always be a valid pointer (C18 §7.1.4).
        const l0 = this_.ptr_get_alloc_id(left._0, 0n);
        if (l0.$ === "Err") return l0;
        const r0 = this_.ptr_get_alloc_id(right._0, 0n);
        if (r0.$ === "Err") return r0;

        // memcmp does *not* have any wording like `memchr` that says anything about
        // stopping as soon as a difference is found. So we requires both buffers
        // to be fully inbounds and initialized.

        let result: number;
        {
          const left_bytes = this_.read_bytes_ptr_strip_provenance(left._0, n);
          if (left_bytes.$ === "Err") return left_bytes;
          const right_bytes = this_.read_bytes_ptr_strip_provenance(right._0, n);
          if (right_bytes.$ === "Err") return right_bytes;

          // use std::cmp::Ordering::*;
          result = cmp_bytes(left_bytes._0, right_bytes._0);
        }

        const w = this_.write_scalar(Scalar.from_i32(result), dest);
        if (w.$ === "Err") return w;
        break;
      }
      case "memchr": {
        const a = sig(shim_sig("C", [T.ptr_any, T.i32, T.usize], T.ptr_any));
        if (a.$ === "Err") return a;
        const [ptr_op, val_op, num_op] = a._0 as [OpTy, OpTy, OpTy];
        const ptr = this_.read_pointer(ptr_op);
        if (ptr.$ === "Err") return ptr;
        const val_s = this_.read_scalar(val_op);
        if (val_s.$ === "Err") return val_s;
        const val_i = Scalar.to_i32(val_s._0);
        if (val_i.$ === "Err") return val_i;
        const num = this_.read_target_usize(num_op);
        if (num.$ === "Err") return num;
        // The docs say val is "interpreted as unsigned char".
        // #[expect(clippy::as_conversions)]
        const val = val_i._0 & 0xff;

        // C requires that this must always be a valid pointer (C18 §7.1.4).
        const p0 = this_.ptr_get_alloc_id(ptr._0, 0n);
        if (p0.$ === "Err") return p0;

        // "The implementation shall behave as if it reads the characters sequentially and
        // stops as soon as a matching character is found."
        const found = this_.memchr(ptr._0, range(0n, num._0), val);
        if (found.$ === "Err") return found;
        const needle_ptr = found._0 === undefined ? undefined : found._0[1];

        if (needle_ptr !== undefined) {
          const w = this_.write_pointer(needle_ptr, dest);
          if (w.$ === "Err") return w;
        } else {
          const w = this_.write_null(dest);
          if (w.$ === "Err") return w;
        }
        break;
      }
      case "memrchr": {
        const c = this_.check_target_os([spec.Os.Linux, spec.Os.Android, spec.Os.FreeBsd], link_name);
        if (c.$ === "Err") return c;

        const a = sig(shim_sig("C", [T.ptr_any, T.i32, T.usize], T.ptr_any));
        if (a.$ === "Err") return a;
        const [ptr_op, val_op, num_op] = a._0 as [OpTy, OpTy, OpTy];
        const ptr = this_.read_pointer(ptr_op);
        if (ptr.$ === "Err") return ptr;
        const val_s = this_.read_scalar(val_op);
        if (val_s.$ === "Err") return val_s;
        const val_i = Scalar.to_i32(val_s._0);
        if (val_i.$ === "Err") return val_i;
        const num = this_.read_target_usize(num_op);
        if (num.$ === "Err") return num;
        // The docs say val is "interpreted as unsigned char".
        // #[expect(clippy::as_conversions)]
        const val = val_i._0 & 0xff;

        // C requires that this must always be a valid pointer (C18 §7.1.4).
        const p0 = this_.ptr_get_alloc_id(ptr._0, 0n);
        if (p0.$ === "Err") return p0;

        // We use the same early-abort search strategy as `memchr` (see above).
        const found = this_.memchr(ptr._0, range_rev(0n, num._0), val);
        if (found.$ === "Err") return found;
        const needle_ptr = found._0 === undefined ? undefined : found._0[1];

        if (needle_ptr !== undefined) {
          const w = this_.write_pointer(needle_ptr, dest);
          if (w.$ === "Err") return w;
        } else {
          const w = this_.write_null(dest);
          if (w.$ === "Err") return w;
        }
        break;
      }
      case "strlen": {
        const a = sig(shim_sig("C", [T.ptr_any], T.usize));
        if (a.$ === "Err") return a;
        const [ptr_op] = a._0 as [OpTy];
        const ptr = this_.read_pointer(ptr_op);
        if (ptr.$ === "Err") return ptr;
        // This reads at least 1 byte, so we are already enforcing that this is a valid pointer.
        const s = this_.read_c_str(ptr._0);
        if (s.$ === "Err") return s;
        const n = s._0.length;
        const w = this_.write_scalar(Scalar.from_target_usize(BigInt(n), this_), dest);
        if (w.$ === "Err") return w;
        break;
      }
      case "strnlen": {
        const a = sig(shim_sig("C", [T.ptr_any, T.usize], T.usize));
        if (a.$ === "Err") return a;
        const [ptr_op, num_op] = a._0 as [OpTy, OpTy];
        const ptr = this_.read_pointer(ptr_op);
        if (ptr.$ === "Err") return ptr;
        const num = this_.read_target_usize(num_op);
        if (num.$ === "Err") return num;

        // C requires that this must always be a valid pointer (C18 §7.1.4).
        const p0 = this_.ptr_get_alloc_id(ptr._0, 0n);
        if (p0.$ === "Err") return p0;

        // The docs say this behaves like memchr, which only deref's the memory it actually
        // needs to compare.
        const found = this_.memchr(ptr._0, range(0n, num._0), 0);
        if (found.$ === "Err") return found;
        const idx = found._0 === undefined ? num._0 : found._0[0];
        const w = this_.write_scalar(Scalar.from_target_usize(idx, this_), dest);
        if (w.$ === "Err") return w;
        break;
      }
      case "wcslen": {
        const a = sig(shim_sig("C", [T.ptr_any], T.usize));
        if (a.$ === "Err") return a;
        const [ptr_op] = a._0 as [OpTy];
        const ptr = this_.read_pointer(ptr_op);
        if (ptr.$ === "Err") return ptr;
        // This reads at least 1 byte, so we are already enforcing that this is a valid pointer.
        const s = this_.read_wchar_t_str(ptr._0);
        if (s.$ === "Err") return s;
        const n = s._0.length;
        const w = this_.write_scalar(Scalar.from_target_usize(BigInt(n), this_), dest);
        if (w.$ === "Err") return w;
        break;
      }
      case "memcpy": {
        const a = sig(shim_sig("C", [T.ptr_any, T.ptr_any, T.usize], T.ptr_any));
        if (a.$ === "Err") return a;
        const [ptr_dest_op, ptr_src_op, n_op] = a._0 as [OpTy, OpTy, OpTy];
        const ptr_dest = this_.read_pointer(ptr_dest_op);
        if (ptr_dest.$ === "Err") return ptr_dest;
        const ptr_src = this_.read_pointer(ptr_src_op);
        if (ptr_src.$ === "Err") return ptr_src;
        const n = this_.read_target_usize(n_op);
        if (n.$ === "Err") return n;

        // C requires that this must always be a valid pointer, even if `n` is zero, so we better check that.
        // (This is more than Rust requires, so `mem_copy` is not sufficient.)
        const d0 = this_.ptr_get_alloc_id(ptr_dest._0, 0n);
        if (d0.$ === "Err") return d0;
        const s0 = this_.ptr_get_alloc_id(ptr_src._0, 0n);
        if (s0.$ === "Err") return s0;

        const c = this_.mem_copy(ptr_src._0, ptr_dest._0, Size.from_bytes(n._0), true);
        if (c.$ === "Err") return c;
        const w = this_.write_pointer(ptr_dest._0, dest);
        if (w.$ === "Err") return w;
        break;
      }
      case "strcpy": {
        const a = sig(shim_sig("C", [T.ptr_any, T.ptr_any], T.ptr_any));
        if (a.$ === "Err") return a;
        const [ptr_dest_op, ptr_src_op] = a._0 as [OpTy, OpTy];
        const ptr_dest = this_.read_pointer(ptr_dest_op);
        if (ptr_dest.$ === "Err") return ptr_dest;
        const ptr_src = this_.read_pointer(ptr_src_op);
        if (ptr_src.$ === "Err") return ptr_src;

        // We use `read_c_str` to determine the amount of data to copy,
        // and then use `mem_copy` for the actual copy. This means
        // pointer provenance is preserved by this implementation of `strcpy`.
        // That is probably overly cautious, but there also is no fundamental
        // reason to have `strcpy` destroy pointer provenance.
        // This reads at least 1 byte, so we are already enforcing that this is a valid pointer.
        const s = this_.read_c_str(ptr_src._0);
        if (s.$ === "Err") return s;
        const n = s._0.length + 1;
        const c = this_.mem_copy(ptr_src._0, ptr_dest._0, Size.from_bytes(n), true);
        if (c.$ === "Err") return c;
        const w = this_.write_pointer(ptr_dest._0, dest);
        if (w.$ === "Err") return w;
        break;
      }
      case "memset": {
        const a = sig(shim_sig("C", [T.ptr_any, T.i32, T.usize], T.ptr_any));
        if (a.$ === "Err") return a;
        const [ptr_dest_op, val_op, n_op] = a._0 as [OpTy, OpTy, OpTy];
        const ptr_dest = this_.read_pointer(ptr_dest_op);
        if (ptr_dest.$ === "Err") return ptr_dest;
        const val_s = this_.read_scalar(val_op);
        if (val_s.$ === "Err") return val_s;
        const val_i = Scalar.to_i32(val_s._0);
        if (val_i.$ === "Err") return val_i;
        const n = this_.read_target_usize(n_op);
        if (n.$ === "Err") return n;
        // The docs say val is "interpreted as unsigned char".
        // #[expect(clippy::as_conversions)]
        const val = val_i._0 & 0xff;

        // C requires that this must always be a valid pointer, even if `n` is zero, so we better check that.
        const p0 = this_.ptr_get_alloc_id(ptr_dest._0, 0n);
        if (p0.$ === "Err") return p0;

        // `n.try_into().unwrap()` (u64 -> usize)
        if (n._0 > BigInt(Number.MAX_SAFE_INTEGER)) {
          return unported("miri::shims::foreign_items: `memset` of more than 2^53 bytes");
        }
        const bytes = repeat_n(val, Number(n._0));
        const wb = this_.write_bytes_ptr(ptr_dest._0, bytes);
        if (wb.$ === "Err") return wb;
        const w = this_.write_pointer(ptr_dest._0, dest);
        if (w.$ === "Err") return w;
        break;
      }

      // Fallback to shims in submodules.
      default: {
        // Math shims
        const res = math.emulate_foreign_item_inner(this_, link_name, abi, args, dest);
        if (res.$ === "Err") return res;
        if (res._0 !== "NotSupported") {
          return interp_ok(res._0);
        }

        // Platform-specific shims
        const os = this_.tcx.deref().sess.target.os;
        if (this_.target_os_is_unix()) {
          return unix_foreign_items.emulate_foreign_item_inner(this_, link_name, abi, args, dest);
        } else if (os.$ === "Windows") {
          return unported(
            "miri::shims::windows::foreign_items::EvalContextExt::emulate_foreign_item_inner (Windows shims are out of scope, plan-m6 D2)",
          );
        } else {
          return interp_ok("NotSupported");
        }
      }
    }
  }
  // We only fall through to here if we did *not* hit the `_` arm above,
  // i.e., if we actually emulated the function with one of the shims.
  return interp_ok("NeedsReturn");
};

/** `self.max_size_of_val().bytes()` (`PointerArithmetic`, rustc_middle pointer.rs:23), as the exact `u64`. */
function max_size_of_val_bytes(this_: MiriInterpCx): bigint {
  return PointerArithmetic_provided.max_size_of_val(this_).bytes_u64();
}

/** `<[u8] as Ord>::cmp` mapped to `Less => -1i32, Equal => 0, Greater => 1`. */
function cmp_bytes(left: Uint8Array, right: Uint8Array): number {
  const n = Math.min(left.length, right.length);
  for (let i = 0; i < n; i++) {
    const l = left[i]!;
    const r = right[i]!;
    if (l !== r) return l < r ? -1 : 1;
  }
  return left.length < right.length ? -1 : left.length > right.length ? 1 : 0;
}

/// For each `idx` yielded by `idxs`, check if `ptr + idx` equals `needle` and return that
/// index and a pointer to that element if so. Return `None` if none of the indices match.
// rustc: src/tools/miri/src/shims/foreign_items.rs:937 memchr
InterpCx.prototype.memchr = function (
  this: MiriInterpCx,
  ptr: Pointer,
  idxs: Iterable<bigint>,
  needle: number,
): InterpResult<[bigint, Pointer] | undefined> {
  const this_ = this.eval_context_ref();
  for (const idx of idxs) {
    const ptr_ = ptr.wrapping_offset(Size.from_bytes(idx), this_);
    const place = this_.ptr_to_mplace(ptr_, this_.machine.layouts.u8);
    const val_s = this_.read_scalar(place);
    if (val_s.$ === "Err") return val_s;
    const val = Scalar.to_u8(val_s._0);
    if (val.$ === "Err") return val;
    if (val._0 === needle) {
      return interp_ok([idx, ptr_]);
    }
  }
  return interp_ok(undefined);
};
