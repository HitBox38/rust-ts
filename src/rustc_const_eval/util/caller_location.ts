// Port of compiler/rustc_const_eval/src/util/caller_location.rs (declared by lane interp-contract; `alloc_caller_location`
// ported by lane ctfe-util).
import { FieldIdx } from "../../rustc_abi/layout.ts";
import { LangItem } from "../../rustc_attr_ir/lang_items.ts";
import { CanAccessMutGlobal, type CompileTimeInterpCx } from "../const_eval/machine.ts";
import { mk_eval_cx_to_read_const_val } from "../const_eval/eval_queries.ts";
import { InternKind, intern_const_alloc_recursive } from "../interpret/intern.ts";
import { MemoryKind } from "../interpret/memory.ts";
import { Immediate } from "../interpret/operand.ts";
import { type CtfeProvenance, InterpResult, Pointer_Option_from_Pointer, Scalar } from "../../rustc_middle/mir/interpret/mod.ts";
import { debug_InterpErrorKind } from "../../rustc_middle/mir/interpret/error.gen.ts";
import { GenericArg } from "../../rustc_middle/ty/generic_args.ts";
import { type Ty, TypingEnv } from "../../rustc_middle/ty/mod.ts";
import { DUMMY_SP } from "../../rustc_span/lib.ts";
import { bug } from "../../rustc_span/macros.ts";
import { type ConstValue } from "../../rustc_middle/mir/mod.ts";
import { type TyCtxt } from "../../rustc_middle/ty/context.ts";
import { Symbol } from "../../rustc_span/symbol.ts";
import { EarlyBinder } from "../../rustc_type_ir/binder.ts";
import { Unnormalized } from "../../rustc_type_ir/unnormalized.ts";
import { assert } from "../../std/panic.ts";
import { unwrap_result } from "../../std/result.ts";
import { utf8, utf8_len } from "../../std/str.ts";
import { fold_Ty } from "../../rustc_middle/ty/structural_impls.ts";
import { MPlaceTy } from "../interpret/place.gen.ts";

/// Allocate a `const core::panic::Location` with the provided filename and line/column numbers.
// rustc: compiler/rustc_const_eval/src/util/caller_location.rs:12 alloc_caller_location
export function alloc_caller_location(ecx: CompileTimeInterpCx, filename_: Symbol, line_: number, col_: number): MPlaceTy {
  // Ensure that the filename itself does not contain nul bytes.
  // This isn't possible via POSIX or Windows, but we should ensure no one
  // ever does such a thing.
  assert(!Symbol.as_str(filename_).includes("\0"), "assertion failed: !filename.as_str().as_bytes().contains(&0)");

  const loc_details = ecx.tcx.deref().sess.opts.unstable_opts.location_detail;
  const filename = ((): Immediate => {
    const filename = loc_details.file ? Symbol.as_str(filename_) : "<redacted>";
    const filename_with_nul = filename + "\0";
    // This can fail if rustc runs out of memory right here. Trying to emit an error would be
    // pointless, since that would require allocating more memory than these short strings.
    const file_ptr = InterpResult.unwrap(ecx.allocate_bytes_dedup(utf8(filename_with_nul)));
    const file_len = BigInt(utf8_len(filename));
    return Immediate.new_slice(Pointer_Option_from_Pointer(file_ptr), file_len, ecx);
  })();
  const line = loc_details.line ? Scalar.from_u32<CtfeProvenance>(line_) : Scalar.from_u32<CtfeProvenance>(0);
  const col = loc_details.column ? Scalar.from_u32<CtfeProvenance>(col_) : Scalar.from_u32<CtfeProvenance>(0);

  // Allocate memory for `CallerLocation` struct.
  // PORT: the `type_of` query value is `unknown` in queries.gen.ts.
  const loc_ty = Unnormalized.skip_norm_wip(
    EarlyBinder.instantiate(
      ecx.tcx.type_of(ecx.tcx.deref().require_lang_item(LangItem.PanicLocation, ecx.tcx.span)) as EarlyBinder<Ty>,
      ecx.tcx.deref(),
      ecx.tcx.deref().mk_args([GenericArg.from_Region(ecx.tcx.deref().lifetimes.re_erased)]),
      fold_Ty,
    ),
  );
  const loc_layout = unwrap_result(ecx.layout_of(loc_ty), debug_InterpErrorKind);
  const location = InterpResult.unwrap(ecx.allocate(loc_layout, MemoryKind.CallerLocation));

  // Initialize fields.
  const [filename_field, line_field, col_field] = InterpResult.unwrap(ecx.project_fields(location, [0, 1, 2].map(FieldIdx.from_u32)));
  InterpResult.expect(ecx.write_immediate(filename, filename_field!), "writing to memory we just allocated cannot fail");
  InterpResult.expect(ecx.write_scalar(line, line_field!), "writing to memory we just allocated cannot fail");
  InterpResult.expect(ecx.write_scalar(col, col_field!), "writing to memory we just allocated cannot fail");

  return location;
}

// rustc: compiler/rustc_const_eval/src/util/caller_location.rs:56 const_caller_location_provider
export function const_caller_location_provider(tcx: TyCtxt, file: Symbol, line: number, col: number): ConstValue {
  // trace!("const_caller_location: {}:{}:{}", file, line, col);
  const ecx = mk_eval_cx_to_read_const_val(
    tcx,
    DUMMY_SP, // This interpreter cannot fail, so the span is irrelevant.
    TypingEnv.fully_monomorphized(),
    CanAccessMutGlobal.No,
  );

  const loc_place = alloc_caller_location(ecx, file, line, col);
  if (intern_const_alloc_recursive(ecx, InternKind.Constant, loc_place).$ === "Err") {
    bug("intern_const_alloc_recursive should not error in this case");
  }
  return { $: "Scalar", _0: Scalar.from_maybe_pointer(loc_place.ptr(), tcx) };
}
