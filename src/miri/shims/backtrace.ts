// Port of src/tools/miri/src/shims/backtrace.rs (crate `miri`, plan-m6 D2).
// Fill lane: `miri-shims-b` (plan-m6 wave 37).
import { type MPlaceTy, type OpTy, type Pointer } from "../lib.ts";
import { debug_Provenance, type MiriInterpCx } from "../machine.ts";
import { shim_sig } from "./sig.ts";
import { CanonAbi } from "../../rustc_abi/canon_abi.ts";
import { FieldIdx, FieldsShape, Size } from "../../rustc_abi/lib.ts";
import { InterpCx } from "../../rustc_const_eval/interpret/eval_context.ts";
import { type AnyMachine, type Machine } from "../../rustc_const_eval/interpret/machine.ts";
import { InterpErrorInfo_from_InterpErrorKind, type InterpResult, interp_ok, Scalar as interp_Scalar } from "../../rustc_middle/mir/interpret/mod.ts";
import { debug_Pointer_Option } from "../../rustc_middle/mir/interpret/pointer.ts";
import { type FnAbi } from "../../rustc_middle/ty/decls.ts";
import { display_Instance, type Instance } from "../../rustc_middle/ty/instance.ts";
import { type Ty } from "../../rustc_middle/ty/mod.ts";
import { walk_chain_collapsed } from "../../rustc_span/hygiene.ts";
import { BytePos, FileName, type Loc, Span } from "../../rustc_span/lib.ts";
import { type Symbol } from "../../rustc_span/symbol.ts";
import { PLAIN } from "../../std/fmt.ts";
import { panic } from "../../std/panic.ts";
import { Err } from "../../std/result.ts";

/** `throw_unsup_format!(..)` (`err_unsup!(Unsupported(format!(..)))`) */
function throw_unsup_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "Unsupported", _0: { $: "Unsupported", _0: msg } }));
}
/** `throw_ub_format!(..)` (`err_ub!(Ub(format!(..)))`) */
function throw_ub_format<T>(msg: string): InterpResult<T> {
  return Err(InterpErrorInfo_from_InterpErrorKind({ $: "UndefinedBehavior", _0: { $: "Ub", _0: msg } }));
}

declare module "../../rustc_const_eval/interpret/eval_context.ts" {
  interface InterpCx<M extends AnyMachine = Machine> {
    // ---- shims/backtrace.rs: `trait EvalContextExt` (impl for `MiriInterpCx`) ----
    // shims/backtrace.rs:10
    handle_miri_backtrace_size(this: MiriInterpCx, abi: FnAbi<Ty>, link_name: Symbol, args: readonly OpTy[], dest: MPlaceTy): InterpResult;
    // shims/backtrace.rs:31
    handle_miri_get_backtrace(this: MiriInterpCx, abi: FnAbi<Ty>, link_name: Symbol, args: readonly OpTy[]): InterpResult;
    // shims/backtrace.rs:86
    resolve_frame_pointer(this: MiriInterpCx, ptr: OpTy): InterpResult<[Instance, Loc, string, string]>;
    // shims/backtrace.rs:111
    handle_miri_resolve_frame(this: MiriInterpCx, abi: FnAbi<Ty>, link_name: Symbol, args: readonly OpTy[], dest: MPlaceTy): InterpResult;
    // shims/backtrace.rs:188
    handle_miri_resolve_frame_names(this: MiriInterpCx, abi: FnAbi<Ty>, link_name: Symbol, args: readonly OpTy[]): InterpResult;
  }
}

// rustc: src/tools/miri/src/shims/backtrace.rs:10 handle_miri_backtrace_size
InterpCx.prototype.handle_miri_backtrace_size = function (this: MiriInterpCx, abi: FnAbi<Ty>, link_name: Symbol, args: readonly OpTy[], dest: MPlaceTy): InterpResult {
  const this_ = this.eval_context_mut();
  const a = this_.check_shim_sig(shim_sig("Rust", ["u64"], "usize"), [link_name, abi, args]);
  if (a.$ === "Err") return a;
  const [flags] = a._0 as [OpTy];

  const fs = this_.read_scalar(flags);
  if (fs.$ === "Err") return fs;
  const flags_ = interp_Scalar.to_u64(fs._0);
  if (flags_.$ === "Err") return flags_;
  if (flags_._0 !== 0n) {
    return throw_unsup_format(`unknown \`miri_backtrace_size\` flags ${flags_._0}`);
  }

  const frame_count = this_.active_thread_stack().length;

  return this_.write_scalar(interp_Scalar.from_target_usize(BigInt(frame_count), this_), dest);
};

// rustc: src/tools/miri/src/shims/backtrace.rs:31 handle_miri_get_backtrace
InterpCx.prototype.handle_miri_get_backtrace = function (this: MiriInterpCx, abi: FnAbi<Ty>, link_name: Symbol, args: readonly OpTy[]): InterpResult {
  const this_ = this.eval_context_mut();
  const ptr_ty = this_.machine.layouts.unit_ptr_mut.ty;
  const ptr_layout_r = this_.layout_of(ptr_ty);
  if (ptr_layout_r.$ === "Err") return Err(InterpErrorInfo_from_InterpErrorKind(ptr_layout_r._0));
  const ptr_layout = ptr_layout_r._0;

  const a = this_.check_shim_sig(shim_sig("Rust", ["u64", "*()"], "()"), [link_name, abi, args]);
  if (a.$ === "Err") return a;
  const [flags, buf] = a._0 as [OpTy, OpTy];

  const fs = this_.read_scalar(flags);
  if (fs.$ === "Err") return fs;
  const flags_r = interp_Scalar.to_u64(fs._0);
  if (flags_r.$ === "Err") return flags_r;
  const flags_ = flags_r._0;
  const buf_place = this_.deref_pointer_as(buf, ptr_layout);
  if (buf_place.$ === "Err") return buf_place;

  const data: [Instance, BytePos][] = [];
  const stack = this_.active_thread_stack();
  for (let i = stack.length - 1; i >= 0; i--) {
    const frame = stack[i]!;
    // Match behavior of debuginfo (`FunctionCx::adjusted_span_and_dbg_scope`).
    const span = walk_chain_collapsed(frame.current_span(), frame.body_().span);
    data.push([frame.instance_(), Span.lo(span)]);
  }

  const ptrs: Pointer[] = data.map(([instance, pos]) => {
    // We represent a frame pointer by using the `span.lo` value
    // as an offset into the function's allocation. This gives us an
    // opaque pointer that we can return to user code, and allows us
    // to reconstruct the needed frame information in `handle_miri_resolve_frame`.
    // Note that we never actually read or write anything from/to this pointer -
    // all of the data is represented by the pointer value itself.
    const fn_ptr = this_.fn_ptr({ $: "Instance", _0: instance });
    return fn_ptr.wrapping_offset(Size.from_bytes(pos), this_) as Pointer;
  });

  if (flags_ === 0n) {
    return throw_unsup_format("miri_get_backtrace: v0 is not supported any more");
  } else if (flags_ === 1n) {
    for (let i = 0; i < ptrs.length; i++) {
      const ptr = ptrs[i]!;
      const offset = ptr_layout.size.checked_mul(BigInt(i), this_);
      if (offset === undefined) return panic("called `Option::unwrap()` on a `None` value");

      const op_place = buf_place._0.offset(offset, ptr_layout, this_);
      if (op_place.$ === "Err") return op_place;

      const w = this_.write_pointer(ptr, op_place._0);
      if (w.$ === "Err") return w;
    }
  } else {
    return throw_unsup_format(`unknown \`miri_get_backtrace\` flags ${flags_}`);
  }

  return interp_ok(undefined);
};

// rustc: src/tools/miri/src/shims/backtrace.rs:86 resolve_frame_pointer
InterpCx.prototype.resolve_frame_pointer = function (this: MiriInterpCx, ptr: OpTy): InterpResult<[Instance, Loc, string, string]> {
  const this_ = this.eval_context_mut();

  const ptr_r = this_.read_pointer(ptr);
  if (ptr_r.$ === "Err") return ptr_r;
  const ptr_ = ptr_r._0;
  // Take apart the pointer, we need its pieces. The offset encodes the span.
  const parts = this_.ptr_get_alloc_id(ptr_, 0n);
  if (parts.$ === "Err") return parts;
  const [alloc_id, offset, _prov] = parts._0;

  // This has to be an actual global fn ptr, not a dlsym function.
  const ga = this_.tcx.deref().try_get_global_alloc(alloc_id);
  if (ga === undefined || ga.$ !== "Function") {
    return throw_ub_format(`expected static function pointer, found ${debug_Pointer_Option(ptr_, PLAIN, debug_Provenance)}`);
  }
  const instance = ga.instance;

  const off = offset.bytes();
  if (off > 0xffffffffn) return panic("called `Result::unwrap()` on an `Err` value: TryFromIntError(())");
  const lo = this_.tcx.deref().sess.source_map().lookup_char_pos(BytePos(Number(off)));

  const name = display_Instance(instance);
  const filename = FileName.prefer_remapped_unconditionally(lo.file.name).to_string();

  return interp_ok([instance, lo, name, filename]);
};

// rustc: src/tools/miri/src/shims/backtrace.rs:111 handle_miri_resolve_frame
InterpCx.prototype.handle_miri_resolve_frame = function (this: MiriInterpCx, abi: FnAbi<Ty>, link_name: Symbol, args: readonly OpTy[], dest: MPlaceTy): InterpResult {
  const this_ = this.eval_context_mut();
  const a = this_.check_shim_sig_deprecated(abi, CanonAbi.Rust, link_name, args, 2);
  if (a.$ === "Err") return a;
  const [ptr, flags] = a._0 as [OpTy, OpTy];

  const fs = this_.read_scalar(flags);
  if (fs.$ === "Err") return fs;
  const flags_r = interp_Scalar.to_u64(fs._0);
  if (flags_r.$ === "Err") return flags_r;
  const flags_ = flags_r._0;

  const r = this_.resolve_frame_pointer(ptr);
  if (r.$ === "Err") return r;
  const [fn_instance, lo, name, filename] = r._0;

  // Reconstruct the original function pointer,
  // which we pass to user code.
  const fn_ptr = this_.fn_ptr({ $: "Instance", _0: fn_instance });

  const num_fields = FieldsShape.count(dest.layout.fields);

  if (!(4 <= num_fields && num_fields <= 5)) {
    // Always mention 5 fields, since the 4-field struct
    // is deprecated and slated for removal.
    return throw_ub_format("bad declaration of miri_resolve_frame - should return a struct with 5 fields");
  }

  // `u32` is not enough to fit line/colno, which can be `usize`. It seems unlikely that a
  // file would have more than 2^32 lines or columns, but whatever, just default to 0.
  const lineno = lo.line <= 0xffffffff ? lo.line : 0;
  // `lo.col` is 0-based - add 1 to make it 1-based for the caller.
  const col1 = lo.col + 1; // saturating_add(1): a column is far below usize::MAX
  const colno = col1 <= 0xffffffff ? col1 : 0;

  const kind = dest.layout.ty.kind();
  if (kind.$ === "Adt") {
    const adt = kind._0;
    if (!adt.repr().c()) {
      return throw_ub_format("miri_resolve_frame must be declared with a `#[repr(C)]` return type");
    }
  }

  if (flags_ === 0n) {
    return throw_unsup_format("miri_resolve_frame: v0 is not supported any more");
  } else if (flags_ === 1n) {
    const f0 = this_.project_field(dest, FieldIdx.from_u32(0));
    if (f0.$ === "Err") return f0;
    const w0 = this_.write_scalar(interp_Scalar.from_target_usize(BigInt(Buffer.byteLength(name, "utf8")), this_), f0._0);
    if (w0.$ === "Err") return w0;
    const f1 = this_.project_field(dest, FieldIdx.from_u32(1));
    if (f1.$ === "Err") return f1;
    const w1 = this_.write_scalar(interp_Scalar.from_target_usize(BigInt(Buffer.byteLength(filename, "utf8")), this_), f1._0);
    if (w1.$ === "Err") return w1;
  } else {
    return throw_unsup_format(`unknown \`miri_resolve_frame\` flags ${flags_}`);
  }

  const f2 = this_.project_field(dest, FieldIdx.from_u32(2));
  if (f2.$ === "Err") return f2;
  const w2 = this_.write_scalar(interp_Scalar.from_u32(lineno), f2._0);
  if (w2.$ === "Err") return w2;
  const f3 = this_.project_field(dest, FieldIdx.from_u32(3));
  if (f3.$ === "Err") return f3;
  const w3 = this_.write_scalar(interp_Scalar.from_u32(colno), f3._0);
  if (w3.$ === "Err") return w3;

  // Support a 4-field struct for now - this is deprecated
  // and slated for removal.
  if (num_fields === 5) {
    const f4 = this_.project_field(dest, FieldIdx.from_u32(4));
    if (f4.$ === "Err") return f4;
    const w4 = this_.write_pointer(fn_ptr, f4._0);
    if (w4.$ === "Err") return w4;
  }

  return interp_ok(undefined);
};

// rustc: src/tools/miri/src/shims/backtrace.rs:188 handle_miri_resolve_frame_names
InterpCx.prototype.handle_miri_resolve_frame_names = function (this: MiriInterpCx, abi: FnAbi<Ty>, link_name: Symbol, args: readonly OpTy[]): InterpResult {
  const this_ = this.eval_context_mut();

  const a = this_.check_shim_sig(shim_sig("Rust", ["*()", "u64", "*()", "*()"], "()"), [link_name, abi, args]);
  if (a.$ === "Err") return a;
  const [ptr, flags, name_ptr, filename_ptr] = a._0 as [OpTy, OpTy, OpTy, OpTy];

  const fs = this_.read_scalar(flags);
  if (fs.$ === "Err") return fs;
  const flags_ = interp_Scalar.to_u64(fs._0);
  if (flags_.$ === "Err") return flags_;
  if (flags_._0 !== 0n) {
    return throw_unsup_format(`unknown \`miri_resolve_frame_names\` flags ${flags_._0}`);
  }

  const r = this_.resolve_frame_pointer(ptr);
  if (r.$ === "Err") return r;
  const [, , name, filename] = r._0;

  const np = this_.read_pointer(name_ptr);
  if (np.$ === "Err") return np;
  const w1 = this_.write_bytes_ptr(np._0, Buffer.from(name, "utf8").values());
  if (w1.$ === "Err") return w1;
  const fp = this_.read_pointer(filename_ptr);
  if (fp.$ === "Err") return fp;
  const w2 = this_.write_bytes_ptr(fp._0, Buffer.from(filename, "utf8").values());
  if (w2.$ === "Err") return w2;

  return interp_ok(undefined);
};
