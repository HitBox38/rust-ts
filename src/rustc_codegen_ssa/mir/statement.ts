// Port of compiler/rustc_codegen_ssa/src/mir/statement.rs (lane ssa-mir-rest, plan-m7 wave 41).
//
// PORT (ssa-mir-rest): one `impl FunctionCx` block, attached by `install_FunctionCx_statement(FunctionCx)` as constant.ts's
// header says; this file imports mod.ts for types only. `#[instrument(level = "debug")]` is compiled out of rustc and stays a
// comment.
// PORT (ssa-mir-rest): calls into other lanes go through the `stmt_xlane` table, whose entries forward to the installed
// methods so tests can replace them: mir/rvalue.rs `codegen_rvalue`, `codegen_rvalue_operand` (ssa-rvalue-intrinsic; root at
// integ-w54) and mir/debuginfo.rs `codegen_stmt_debuginfos`, `set_debug_loc`, `debug_introduce_local` (ssa-debuginfo; root at
// integ-w55).
import type { Local, SourceInfo } from "../../rustc_middle/mir/mod.ts";
import type { StmtDebugInfos } from "../../rustc_middle/mir/statement.gen.ts";
import type { Statement } from "../../rustc_middle/mir/statement.ts";
import { debug_Rvalue, type Rvalue } from "../../rustc_middle/mir/mod.ts";
import { debug_LayoutError } from "../../rustc_middle/ty/layout.ts";
import { display_Ty } from "../../rustc_middle/ty/print/pretty.ts";
import { bug, span_bug } from "../../rustc_span/macros.ts";
import { PLAIN } from "../../std/fmt.ts";
import { unported } from "../../std/panic.ts";
import { expect_result } from "../../std/result.ts";
import { MemFlags } from "../lib.ts";
import type { BackendTypes } from "../traits/backend.ts";
import type { BuilderMethods } from "../traits/builder.ts";
import type { CodegenMethods } from "../traits/mod.ts";
import type { FunctionCx, LocalRef } from "./mod.ts";
import type { OperandRef } from "./operand.ts";
import type { PlaceRef } from "./place.ts";
import * as retag from "./retag.ts";

/** `FunctionCx::codegen_stmt_debuginfos` (mir/debuginfo.rs, ssa-debuginfo): forwards (root at integ-w55). Upstream passes
 *  `&statement.debuginfos`, which derefs to the slice the method takes. */
function FunctionCx_codegen_stmt_debuginfos<B extends BackendTypes>(fx: FunctionCx<B>, bx: BuilderMethods<B>, debuginfos: StmtDebugInfos): void {
  fx.codegen_stmt_debuginfos(bx, debuginfos.deref());
}

/** `FunctionCx::set_debug_loc` (mir/debuginfo.rs, ssa-debuginfo): forwards (root at integ-w55). */
function FunctionCx_set_debug_loc<B extends BackendTypes>(fx: FunctionCx<B>, bx: BuilderMethods<B>, source_info: SourceInfo): void {
  fx.set_debug_loc(bx, source_info);
}

/** `FunctionCx::debug_introduce_local` (mir/debuginfo.rs, ssa-debuginfo): forwards (root at integ-w55). */
function FunctionCx_debug_introduce_local<B extends BackendTypes>(fx: FunctionCx<B>, bx: BuilderMethods<B>, local: Local): void {
  fx.debug_introduce_local(bx, local);
}

/** `FunctionCx::codegen_rvalue` (mir/rvalue.rs, ssa-rvalue-intrinsic): forwards to the installed method (root at integ-w54). */
function FunctionCx_codegen_rvalue<B extends BackendTypes>(fx: FunctionCx<B>, bx: BuilderMethods<B>, dest: PlaceRef<B["Value"]>, rvalue: Rvalue): void {
  fx.codegen_rvalue(bx, dest, rvalue);
}

/** `FunctionCx::codegen_rvalue_operand` (mir/rvalue.rs, ssa-rvalue-intrinsic): forwards to the installed method (root at
 *  integ-w54). */
function FunctionCx_codegen_rvalue_operand<B extends BackendTypes>(fx: FunctionCx<B>, bx: BuilderMethods<B>, rvalue: Rvalue): OperandRef<B["Value"]> {
  return fx.codegen_rvalue_operand(bx, rvalue);
}

/** The stubs and forwarders above, as one table so a test can replace them (`stmt_xlane`); not upstream. */
export const stmt_xlane = {
  codegen_stmt_debuginfos: FunctionCx_codegen_stmt_debuginfos,
  set_debug_loc: FunctionCx_set_debug_loc,
  debug_introduce_local: FunctionCx_debug_introduce_local,
  codegen_rvalue: FunctionCx_codegen_rvalue,
  codegen_rvalue_operand: FunctionCx_codegen_rvalue_operand,
};

declare module "./mod.ts" {
  interface FunctionCx<B extends BackendTypes, Cx extends CodegenMethods<B> = CodegenMethods<B>, Bx extends BuilderMethods<B, Cx> = BuilderMethods<B, Cx>> {
    codegen_statement(bx: Bx, statement: Statement): void;
  }
}

/** `impl<'a, 'tcx, Bx: BuilderMethods<'a, 'tcx>> FunctionCx<'a, 'tcx, Bx>` of statement.rs (header). */
// PORT: installer instead of top-level prototype writes (TDZ cycle with mod.ts; constant.ts header).
export function install_FunctionCx_statement(FunctionCx_: { prototype: FunctionCx<BackendTypes> }): void {
  // #[instrument(level = "debug", skip(self, bx))]
  // rustc: compiler/rustc_codegen_ssa/src/mir/statement.rs:12 codegen_statement
  FunctionCx_.prototype.codegen_statement = function (this: FunctionCx<BackendTypes>, bx: BuilderMethods<BackendTypes>, statement: Statement): void {
    stmt_xlane.codegen_stmt_debuginfos(this, bx, statement.debuginfos);
    stmt_xlane.set_debug_loc(this, bx, statement.source_info);
    const kind = statement.kind;
    switch (kind.$) {
      case "Assign": {
        const [place, rvalue] = kind._0;
        const needs_retag = bx.tcx_().sess.opts.unstable_opts.codegen_emit_retag !== undefined && retag.rvalue_needs_retag(rvalue);

        const index = place.as_local();
        if (index !== undefined) {
          const local_ref: LocalRef<unknown> = this.locals.index(index);
          switch (local_ref.$) {
            case "Place": {
              const cg_dest = local_ref._0;
              stmt_xlane.codegen_rvalue(this, bx, cg_dest, rvalue);
              if (needs_retag) {
                this.codegen_retag_place(bx, cg_dest, false);
              }
              break;
            }
            case "UnsizedPlace": {
              const cg_indirect_dest = local_ref._0;
              const ty = cg_indirect_dest.layout.ty;
              span_bug(
                statement.source_info.span,
                `cannot reallocate from \`UnsizedPlace(${display_Ty(ty)})\` into \`${debug_Rvalue(rvalue, PLAIN)}\`; dynamic alloca is not supported`,
              );
              break;
            }
            case "PendingOperand": {
              let operand = stmt_xlane.codegen_rvalue_operand(this, bx, rvalue);
              if (needs_retag) {
                operand = this.codegen_retag_operand(bx, operand, false);
              }
              this.overwrite_local(index, { $: "Operand", _0: operand });
              stmt_xlane.debug_introduce_local(this, bx, index);
              break;
            }
            case "Operand": {
              const op = local_ref._0;
              if (!op.layout.is_zst()) {
                span_bug(statement.source_info.span, `operand ${debug_Rvalue(rvalue, PLAIN)} already assigned`);
              }

              // If the type is zero-sized, it's already been set here,
              // but we still need to make sure we codegen the operand
              // and emit a retag.
              const operand = stmt_xlane.codegen_rvalue_operand(this, bx, rvalue);
              if (needs_retag) {
                this.codegen_retag_operand(bx, operand, false);
              }
              break;
            }
          }
        } else {
          const cg_dest = this.codegen_place(bx, place.as_ref());
          stmt_xlane.codegen_rvalue(this, bx, cg_dest, rvalue);
          if (needs_retag) {
            this.codegen_retag_place(bx, cg_dest, false);
          }
        }
        break;
      }
      case "SetDiscriminant": {
        const place = kind.place;
        const variant_index = kind.variant_index;
        this.codegen_place(bx, place.as_ref()).codegen_set_discr(bx, variant_index);
        break;
      }
      case "StorageLive": {
        const local = kind._0;
        const l = this.locals.index(local);
        if (l.$ === "Place") {
          const cg_place = l._0;
          cg_place.storage_live(bx);
        } else if (l.$ === "UnsizedPlace") {
          const cg_indirect_place = l._0;
          cg_indirect_place.storage_live(bx);
        }
        break;
      }
      case "StorageDead": {
        const local = kind._0;
        const l = this.locals.index(local);
        if (l.$ === "Place") {
          const cg_place = l._0;
          cg_place.storage_dead(bx);
        } else if (l.$ === "UnsizedPlace") {
          const cg_indirect_place = l._0;
          cg_indirect_place.storage_dead(bx);
        }
        break;
      }
      case "Coverage": {
        this.codegen_coverage(bx, kind._0, statement.source_info.scope);
        break;
      }
      case "Intrinsic": {
        const intrinsic = kind._0;
        switch (intrinsic.$) {
          case "Assume": {
            const op = intrinsic._0;
            const op_val = this.codegen_operand(bx, op);
            bx.assume(op_val.immediate(bx.debug_Value));
            break;
          }
          case "CopyNonOverlapping": {
            const { count: count_op, src, dst: dst_op } = intrinsic._0;
            const dst_val = this.codegen_operand(bx, dst_op);
            const src_val = this.codegen_operand(bx, src);
            const count = this.codegen_operand(bx, count_op).immediate(bx.debug_Value);

            const k = dst_val.layout.ty.kind();
            if (k.$ !== "RawPtr") {
              return bug("expected pointer");
            }
            const pointee = k._0;
            const pointee_layout = expect_result(
              bx.tcx_().layout_of(bx.typing_env_().as_query_input(pointee)),
              "expected pointee to have a layout",
              debug_LayoutError,
            );
            const elem_size = pointee_layout.size.bytes_u64();
            const bytes = bx.unchecked_sumul(count, bx.const_usize(elem_size));

            const align = pointee_layout.align.abi;
            const dst = dst_val.immediate(bx.debug_Value);
            const src_ = src_val.immediate(bx.debug_Value);

            bx.memcpy(dst, align, src_, align, bytes, MemFlags.empty(), undefined);
            break;
          }
        }
        break;
      }
      case "FakeRead":
      case "AscribeUserType":
      case "ConstEvalCounter":
      case "PlaceMention":
      case "BackwardIncompatibleDropHint":
      case "Nop":
        break;
    }
  };
}
