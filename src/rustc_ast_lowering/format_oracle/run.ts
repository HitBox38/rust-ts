// Test helper of src/rustc_ast_lowering/format.test.ts (lane lower-asm-format-contract): runs the ported driver on a
// file up to expansion + name resolution (`after_expansion` -> `Stop`, as hir_oracle/run.ts), then lowers every
// outermost `format_args!` (`ExprKind::FormatArgs`, in source order) with `LoweringContext::lower_format_args`
// (format.rs) on a recording `LoweringContext`. The recorder stands in for the lib.rs/expr.rs/pat.rs builders the
// format lowering calls (`expr_lang_item_type_relative`, `expr_call`, `expr_byte_str`, `pat_ident`,
// `stmt_super_let_pat`, `block_all`, ...; other lanes port them) and renders what they build in the surface syntax of
// rustc's `-Zunpretty=hir` (rustc_hir_pretty), so the test can find each rendering in the oracle's output.
// Arguments are rendered with rustc_ast_pretty (`lower_expr` of a nested `format_args!` recurses into the format
// lowering). String literals render as `S[<utf-8 hex>]` and byte strings as `B[<hex>]` (the test canonicalizes the
// oracle's escaped literals the same way).
//
//   bun src/rustc_ast_lowering/format_oracle/run.ts <rustc arguments...>
// prints one JSON string per outermost `format_args!`.
import "../lib.ts";
import type { Crate, Expr as AstExpr } from "../../rustc_ast/lib.ts";
import { Visitor, walk_expr } from "../../rustc_ast/visit.ts";
import { pprust } from "../../rustc_ast_pretty/lib.ts";
import type { LangItem } from "../../rustc_attr_ir/lib.ts";
import { Block } from "../../rustc_hir/lib.ts";
import type { Compiler, Config } from "../../rustc_interface/interface.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Span } from "../../rustc_span/lib.ts";
import { ByteSymbol, type Ident, Symbol } from "../../rustc_span/symbol.ts";
import { utf8 } from "../../std/str.ts";
import { LoweringContext } from "../decls.ts";
import type * as hir from "../hir_shim.ts";
import { HIR_ARENA } from "../lib.ts";

/** What the recorder builds instead of HIR nodes: the rendering. */
interface R {
  r: string;
}

const hex = (b: Uint8Array): string => [...b].map((x) => x.toString(16).padStart(2, "0")).join(" ");

function render_kind(kind: hir.ExprKind): string {
  const r = (e: unknown): string => (e as R).r;
  switch (kind.$) {
    case "Call":
      return `${r(kind._0)}(${kind._1.map(r).join(", ")})`;
    case "Block": {
      const b = kind._0;
      if (b instanceof Block) {
        const inner = [...b.stmts.map(r), ...(b.expr !== undefined ? [r(b.expr)] : [])].join(" ");
        return `${b.rules.$ === "UnsafeBlock" ? "unsafe " : ""}{ ${inner} }`;
      }
      return r(b);
    }
    case "Array":
      return `[${kind._0.map(r).join(", ")}]`;
    case "Tup":
      return `(${kind._0.map(r).join(", ")}${kind._0.length === 1 ? "," : ""})`;
    case "AddrOf":
      return `&${kind._1 === "Mut" ? "mut " : ""}${r(kind._2)}`;
    case "Field":
      return `${r(kind._0)}.${kind._1.as_str()}`;
    case "Err":
      return "<err>";
    default:
      throw new Error(`ERROR: format_oracle recorder: unexpected ExprKind ${kind.$}`);
  }
}

/** A `LoweringContext` whose builder methods record (see the header). Test-only: fields and methods are set on the
 *  instance, shadowing the prototype's (unported) placeholders; format.rs's own methods stay the prototype's. */
function recorder(tcx: TyCtxt): LoweringContext {
  const ctx = Object.create(LoweringContext.prototype) as LoweringContext;
  const rec = (r: string): hir.Expr => ({ r }) as unknown as hir.Expr;
  const o: Partial<Record<keyof LoweringContext, unknown>> = {
    tcx,
    arena: HIR_ARENA,
    lower_span: (sp: Span) => sp,
    mark_span_with_reason: (_reason: unknown, sp: Span) => sp,
    dcx: () => tcx.dcx(),
    next_id: () => ({}),
    expr_lang_item_type_relative: (_sp: Span, li: LangItem, name: Symbol) =>
      rec(`${li === "FormatArgument" ? "format_argument" : li === "FormatArguments" ? "format_arguments" : li}::${Symbol.as_str(name)}`),
    expr_call: (_sp: Span, f: hir.Expr, args: readonly hir.Expr[]) => rec(render_kind({ $: "Call", _0: f, _1: args })),
    expr_call_mut: (_sp: Span, f: hir.Expr, args: readonly hir.Expr[]) => rec(render_kind({ $: "Call", _0: f, _1: args })),
    expr_str: (_sp: Span, s: Symbol) => rec(`S[${hex(utf8(Symbol.as_str(s)))}]`),
    expr_byte_str: (_sp: Span, b: ByteSymbol) => rec(`B[${hex(ByteSymbol.as_byte_str(b))}]`),
    expr: (_sp: Span, kind: hir.ExprKind) => rec(render_kind(kind)),
    expr_ref: (_sp: Span, e: hir.Expr) => rec(`&${(e as unknown as R).r}`),
    expr_ident: (_sp: Span, ident: Ident) => rec(ident.as_str()),
    expr_ident_mut: (_sp: Span, ident: Ident) => rec(ident.as_str()),
    pat_ident: (_sp: Span, ident: Ident) => [{ r: ident.as_str() }, {}],
    stmt_super_let_pat: (_sp: Span, pat: hir.Pat, init: hir.Expr) =>
      ({ r: `super let ${(pat as unknown as R).r} = ${(init as unknown as R).r};` }) as unknown as hir.Stmt,
    block_all: (_sp: Span, stmts: readonly hir.Stmt[], expr: hir.Expr) =>
      ({ r: `{ ${[...stmts, expr].map((x) => (x as unknown as R).r).join(" ")} }` }) as unknown as hir.Block,
    lower_expr: (e: AstExpr): hir.Expr => lower_expr(e),
  };
  // As expr.rs's `lower_expr_mut`: `Paren` lowers to its operand (HIR has no parentheses), `&` recurses (so a nested
  // `format_args!` under it is lowered), `FormatArgs` goes through format.rs; anything else is rendered by
  // rustc_ast_pretty.
  const lower_expr = (e: AstExpr): hir.Expr =>
    e.kind.$ === "Paren"
      ? lower_expr(e.kind._0)
      : e.kind.$ === "AddrOf" && e.kind._0 === "Ref"
        ? rec(render_kind({ $: "AddrOf", _0: "Ref", _1: e.kind._1, _2: lower_expr(e.kind._2) }))
        : e.kind.$ === "FormatArgs"
          ? rec(render_kind(ctx.lower_format_args(e.span, e.kind._0)))
          : rec(pprust.expr_to_string(e));
  return Object.assign(ctx, o);
}

/** The outermost `ExprKind::FormatArgs` expressions, in source order (nested ones are lowered through them). */
class FormatArgsCollector extends Visitor {
  found: AstExpr[] = [];
  override visit_expr(e: AstExpr): undefined {
    if (e.kind.$ === "FormatArgs") {
      this.found.push(e);
      return undefined;
    }
    return walk_expr(this, e);
  }
}

function dump(tcx: TyCtxt): string {
  const [, krate_steal] = tcx.resolver_for_lowering();
  const krate = (krate_steal as unknown as { borrow(): Crate }).borrow();
  const c = new FormatArgsCollector();
  c.visit_crate(krate);
  let out = "";
  for (const e of c.found) {
    if (e.kind.$ !== "FormatArgs") continue;
    const ctx = recorder(tcx);
    out += `${JSON.stringify(render_kind(ctx.lower_format_args(e.span, e.kind._0)))}\n`;
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
