// Test helper of src/rustc_ast_lowering/contract.test.ts (lane lower-asm-format-contract): runs the ported driver on
// a file up to expansion + name resolution (`after_expansion` -> `Stop`, as hir_oracle/run.ts), then lowers the body
// of every top-level fn with a contract through `LoweringContext::lower_contract` (contract.rs) on a recording
// `LoweringContext`. The recorder stands in for the lib.rs/expr.rs/block.rs builders contract.rs calls
// (`stmt_expr`, `stmt_let_pat`, `block_all`, `expr_call_lang_item_fn`, `expr_enum_variant_lang_item`,
// `pat_ident_binding_mode_mut`, `lower_attrs`, ...; other lanes port them) and renders what they build in the surface
// syntax of rustc's `-Zunpretty=hir` (rustc_hir_pretty: an expression statement ends with `;` unless the expression
// is block-like). The fn body, the `requires`/`ensures` expressions and the declarations are rendered by
// rustc_ast_pretty, so the cases avoid `return` in bodies (lowered through `checked_return`, unit-tested instead).
//
//   bun src/rustc_ast_lowering/contract_oracle/run.ts <rustc arguments...>
// prints one JSON string per fn with a contract.
import "../lib.ts";
import { Expr as AstExpr, type Block as AstBlock, type Crate, type Stmt as AstStmt } from "../../rustc_ast/lib.ts";
import { pprust } from "../../rustc_ast_pretty/lib.ts";
import type { LangItem } from "../../rustc_attr_ir/lib.ts";
import type { Compiler, Config } from "../../rustc_interface/interface.ts";
import type { TyCtxt } from "../../rustc_middle/ty/context.ts";
import type { Span } from "../../rustc_span/lib.ts";
import type { Ident } from "../../rustc_span/symbol.ts";
import { LoweringContext } from "../decls.ts";
import type * as hir from "../hir_shim.ts";
import { HIR_ARENA } from "../lib.ts";

/** What the recorder builds instead of HIR nodes. */
interface R {
  r: string;
  blocky: boolean;
  hir_id: object;
  span: Span | undefined;
}

const LANG_FN: Partial<Record<LangItem, string>> = {
  ContractCheckRequires: "contract_check_requires",
  ContractBuildCheckEnsures: "contract_build_check_ensures",
  ContractCheckEnsures: "contract_check_ensures",
};

/** A `LoweringContext` whose builder methods record (see the header); contract.rs's own methods stay the
 *  prototype's. Test-only. */
function recorder(tcx: TyCtxt): LoweringContext {
  const ctx = Object.create(LoweringContext.prototype) as LoweringContext;
  const by_id = new Map<object, R>();
  const ex = (r: string, blocky = false): R => {
    const o: R = { r, blocky, hir_id: {}, span: undefined };
    by_id.set(o.hir_id, o);
    return o;
  };
  const h = <T>(x: R): T => x as unknown as T;
  const r = (x: unknown): string => (x as R).r;
  const o: Partial<Record<keyof LoweringContext, unknown>> = {
    tcx,
    arena: HIR_ARENA,
    contract_ensures: undefined,
    lower_span: (sp: Span) => sp,
    mark_span_with_reason: (_reason: unknown, sp: Span) => sp,
    lower_stmts: (stmts: readonly AstStmt[]) => [stmts.map((s) => h<hir.Stmt>(ex(pprust.stmt_to_string(s)))), undefined],
    lower_expr_mut: (e: AstExpr) => h<hir.Expr>(ex(pprust.expr_to_string(e))),
    expr_call_lang_item_fn: (_sp: Span, li: LangItem, args: readonly hir.Expr[]) =>
      h<hir.Expr>(ex(`${LANG_FN[li] ?? li}(${args.map(r).join(", ")})`)),
    expr_call_lang_item_fn_mut: (_sp: Span, li: LangItem, args: readonly hir.Expr[]) =>
      h<hir.Expr>(ex(`${LANG_FN[li] ?? li}(${args.map(r).join(", ")})`)),
    stmt_expr: (_sp: Span, e: hir.Expr) => h<hir.Stmt>(ex((e as unknown as R).blocky ? r(e) : `${r(e)};`)),
    stmt_let_pat: (_attrs: unknown, _sp: Span, init: hir.Expr | undefined, pat: hir.Pat) =>
      h<hir.Stmt>(ex(`let ${r(pat)}${init !== undefined ? ` = ${r(init)}` : ""};`)),
    block_all: (_sp: Span, stmts: readonly hir.Stmt[], expr: hir.Expr | undefined) =>
      h<hir.Block>(ex(`{ ${[...stmts, ...(expr !== undefined ? [expr] : [])].map(r).join(" ")} }`, true)),
    block_expr: (e: hir.Expr) => h<hir.Block>(ex(`{ ${r(e)} }`, true)),
    expr_block: (b: hir.Block) => h<hir.Expr>(ex(r(b), true)),
    block_expr_block: (e: hir.Expr) => h<hir.Expr>(ex(`{ ${r(e)} }`, true)),
    expr_bool_literal: (_sp: Span, v: boolean) => h<hir.Expr>(ex(String(v))),
    expr_unit: (_sp: Span) => h<hir.Expr>(ex("()")),
    expr: (_sp: Span, kind: hir.ExprKind) => {
      switch (kind.$) {
        case "If":
          return h<hir.Expr>(ex(`if ${r(kind._0)} ${r(kind._1)}${kind._2 !== undefined ? ` else ${r(kind._2)}` : ""}`, true));
        case "Ret":
          return h<hir.Expr>(ex(kind._0 !== undefined ? `return ${r(kind._0)}` : "return"));
        default:
          throw new Error(`ERROR: contract_oracle recorder: unexpected ExprKind ${kind.$}`);
      }
    },
    expr_enum_variant_lang_item: (_sp: Span, li: LangItem, fields: readonly hir.Expr[]) =>
      h<hir.Expr>(
        ex(`${li === "OptionSome" ? "Some" : li === "OptionNone" ? "None" : li} { ${fields.map((f, i) => `${i}: ${r(f)}`).join(", ")} }`),
      ),
    pat_ident_binding_mode_mut: (_sp: Span, ident: Ident) => [ex(ident.as_str()), {}],
    expr_ident: (_sp: Span, ident: Ident) => h<hir.Expr>(ex(ident.as_str())),
    unreachable_code_attr: (_sp: Span) => ({ $: "allow(unreachable_code)" }),
    lower_attrs: (id: object, attrs: readonly { $: string }[]) => {
      const e = by_id.get(id)!;
      e.r = `${attrs.map((a) => `#[${a.$}] `).join("")}${e.r}`;
      return [];
    },
  };
  return Object.assign(ctx, o);
}

function dump(tcx: TyCtxt): string {
  const [, krate_steal] = tcx.resolver_for_lowering();
  const krate = (krate_steal as unknown as { borrow(): Crate }).borrow();
  let out = "";
  for (const item of krate.items) {
    if (item.kind.$ !== "Fn" || item.kind._0.contract === undefined) continue;
    const f = item.kind._0;
    const body: AstBlock = f.body!;
    const ctx = recorder(tcx);
    const lowered = ctx.lower_contract(
      () =>
        ({
          r: pprust.expr_to_string(new AstExpr(body.id, { $: "Block", _0: body, _1: undefined }, body.span, [], undefined)),
          blocky: true,
          hir_id: {},
          span: body.span,
        }) as unknown as hir.Expr,
      f.contract!,
    );
    out += `${JSON.stringify((lowered as unknown as R).r)}\n`;
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
