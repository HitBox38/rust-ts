// Test helper of src/rustc_ast_lowering/asm.test.ts (lane lower-asm-format-contract): runs the ported driver on a
// file up to expansion + name resolution (`after_expansion` -> `Stop`, as hir_oracle/run.ts), then lowers every
// `asm!` expression (`ExprKind::InlineAsm`, in source order) with `LoweringContext::lower_inline_asm` (asm.rs) on a
// recording `LoweringContext`, and prints the resulting `hir::InlineAsm` as rustc_hir_pretty's `print_inline_asm`
// does (rustc_hir_pretty/src/lib.rs:1473): the template, every operand (incl. the clobbers added for
// `clobber_abi`) with its register's `Display`, and the options. The recorder stands in for the builders asm.rs
// calls (`lower_expr`, `lower_const_block`, `lower_qpath`, `lower_block`, `get_partial_res`; other lanes port them):
// operand expressions, paths and blocks are rendered by rustc_ast_pretty, the partial resolutions come from the real
// resolver. String literals render as `S[<utf-8 hex>]` (the test canonicalizes the oracle's the same way).
//
//   bun src/rustc_ast_lowering/asm_oracle/run.ts <rustc arguments...>
// prints one JSON string per `asm!`.
import "../lib.ts";
import {
  Expr as AstExpr,
  InlineAsmOptions,
  InlineAsmTemplatePiece,
  type AnonConst,
  type Block as AstBlock,
  type Crate,
  type Path,
} from "../../rustc_ast/lib.ts";
import { Visitor, walk_expr } from "../../rustc_ast/visit.ts";
import { pprust } from "../../rustc_ast_pretty/lib.ts";
import { display_InlineAsmRegOrRegClass } from "../../rustc_hir/lib.ts";
import type { Compiler, Config } from "../../rustc_interface/interface.ts";
import type { NodeId } from "../../rustc_ast/node_id.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { utf8 } from "../../std/str.ts";
import { LoweringContext } from "../decls.ts";
import type * as hir from "../hir_shim.ts";
import { HIR_ARENA } from "../lib.ts";

interface R {
  r: string;
}
const r = (x: unknown): string => (x as R).r;
const hex = (b: Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, "0")).join(" ");

/** rustc_hir_pretty `print_inline_asm` (whitespace aside). */
function print_inline_asm(asm: hir.InlineAsm): string {
  const args: string[] = [`S[${hex(utf8(InlineAsmTemplatePiece.to_string(asm.template)))}]`];
  for (const [op] of asm.operands) {
    switch (op.$) {
      case "In":
        args.push(`in(${display_InlineAsmRegOrRegClass(op.reg)}) ${r(op.expr)}`);
        break;
      case "Out":
        args.push(`${op.late ? "lateout" : "out"}(${display_InlineAsmRegOrRegClass(op.reg)}) ${op.expr !== undefined ? r(op.expr) : "_"}`);
        break;
      case "InOut":
        args.push(`${op.late ? "inlateout" : "inout"}(${display_InlineAsmRegOrRegClass(op.reg)}) ${r(op.expr)}`);
        break;
      case "SplitInOut":
        args.push(
          `${op.late ? "inlateout" : "inout"}(${display_InlineAsmRegOrRegClass(op.reg)}) ${r(op.in_expr)} => ${op.out_expr !== undefined ? r(op.out_expr) : "_"}`,
        );
        break;
      case "Const":
        args.push(`const ${r(op.anon_const)}`);
        break;
      case "SymFn":
        args.push(`sym_fn ${r(op.expr)}`);
        break;
      case "SymStatic":
        args.push(`sym_static ${r(op.path)}`);
        break;
      case "Label":
        args.push(`label ${r(op.block)}`);
        break;
    }
  }
  if (!InlineAsmOptions.is_empty(asm.options)) {
    args.push(`options(${InlineAsmOptions.human_readable_names(asm.options).join(", ")})`);
  }
  return `asm!(${args.join(", ")})`;
}

/** A `LoweringContext` whose builder methods record (see the header); asm.rs's own method stays the prototype's. */
function recorder(tcx: TyCtxt): LoweringContext {
  const ctx = Object.create(LoweringContext.prototype) as LoweringContext;
  const [resolver] = tcx.resolver_for_lowering();
  const res = (resolver as unknown as { borrow(): { partial_res_map: Map<NodeId, unknown> } }).borrow();
  const o: Partial<Record<keyof LoweringContext, unknown>> = {
    tcx,
    arena: HIR_ARENA,
    dcx: () => tcx.dcx(),
    lower_span: (sp: Span) => sp,
    get_partial_res: (id: NodeId) => res.partial_res_map.get(id),
    lower_expr: (e: AstExpr) => ({ r: pprust.expr_to_string(e) }),
    lower_const_block: (c: AnonConst) => ({ r: pprust.expr_to_string(c.value) }),
    lower_qpath: (_id: NodeId, _qself: unknown, p: Path) => ({ r: pprust.path_to_string(p) }),
    lower_block: (b: AstBlock) => ({ r: pprust.expr_to_string(new AstExpr(b.id, { $: "Block", _0: b, _1: undefined }, b.span, [], undefined)) }),
  };
  return Object.assign(ctx, o);
}

class InlineAsmCollector extends Visitor {
  found: AstExpr[] = [];
  override visit_expr(e: AstExpr): undefined {
    if (e.kind.$ === "InlineAsm") this.found.push(e);
    return walk_expr(this, e);
  }
}

function dump(tcx: TyCtxt): string {
  const [, krate_steal] = tcx.resolver_for_lowering();
  const krate = (krate_steal as unknown as { borrow(): Crate }).borrow();
  const c = new InlineAsmCollector();
  c.visit_crate(krate);
  let out = "";
  for (const e of c.found) {
    if (e.kind.$ !== "InlineAsm") continue;
    out += `${JSON.stringify(print_inline_asm(recorder(tcx).lower_inline_asm(e.span, e.kind._0)))}\n`;
  }
  return out;
}

async function main(args: string[]): Promise<number> {
  const { catch_with_exit_code, compiler_entrypoint } = await import("../../rustc_driver_impl/lib.ts");
  const { std_print } = await import("../../rustc_session/config.ts");
  const callbacks = {
    config(config: Config): void {
      config.opts.trimmed_def_paths = true;
    },
    after_expansion(_compiler: Compiler, tcx: TyCtxt): "Stop" | "Continue" {
      std_print(dump(tcx));
      return "Stop" as const;
    },
  };
  return catch_with_exit_code(() => compiler_entrypoint(["rustc", ...args], callbacks));
}

process.exitCode = await main(process.argv.slice(2));
