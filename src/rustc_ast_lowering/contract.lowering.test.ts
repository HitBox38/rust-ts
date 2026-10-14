// Tests of lane lower-asm-format-contract for compiler/rustc_ast_lowering/src/contract.rs.
// (contract.test.ts is lane lowering-contract's test of the crate contract, decls.ts.)
//
// Oracle test: contract_oracle/run.ts lowers the body of every fn with a contract in contract_oracle/cases.rs through
// the ported `lower_contract` (`lower_decls`, `lower_precond`, `lower_postcond_checker`,
// `lower_contract_check_just_precond`, `lower_contract_check_with_postcond`, `wrap_body_with_contract_check`,
// `inject_ensures_check`) on a recording LoweringContext and renders it in `-Zunpretty=hir` syntax; each rendering
// must occur, in order, in the pinned rustc's `-Zunpretty=hir` of the same file (whitespace collapsed), with
// `-Zcontract-checks` off and on. The oracle runs live (skipped without the pinned toolchain unless
// RUST_TS_REQUIRE_PROBES=1).
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { PIN } from "../../scripts/lib/common.ts";
import "./lib.ts";
import type { HirId } from "../rustc_hir_id/lib.ts";
import { create_default_session_globals_then, type Span } from "../rustc_span/lib.ts";
import { Ident, sym } from "../rustc_span/symbol.ts";
import { LoweringContext } from "./decls.ts";
import type * as hir from "./hir_shim.ts";

const DIR = join(import.meta.dir, "contract_oracle");
const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const ENV = { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" };

function sysroot(): string | undefined {
  try {
    const { oracleSysroot } = require("../../scripts/lib/oracle.ts") as typeof import("../../scripts/lib/oracle.ts");
    return oracleSysroot();
  } catch {
    return undefined;
  }
}

function rustc_at_pin(): boolean {
  try {
    const r = Bun.spawnSync(["rustc", `+${PIN.toolchain}`, "-vV"], { stdout: "pipe", stderr: "pipe" });
    return r.exitCode === 0 && r.stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
}

function run(cmd: string[]): { exit: number; stdout: string; stderr: string } {
  const r = Bun.spawnSync(cmd, { cwd: DIR, env: ENV, stdout: "pipe", stderr: "pipe" });
  return { exit: r.exitCode, stdout: r.stdout.toString(), stderr: r.stderr.toString() };
}

const norm = (s: string): string => s.replace(/\s+/g, " ").replace(/\{ \}/g, "{}");

describe("contract_oracle: lower_contract against rustc -Zunpretty=hir", () => {
  for (const flags of [[], ["-Zcontract-checks=yes"]]) {
    test(flags.join(" ") || "default", () => {
      const s = sysroot();
      if (s === undefined || !rustc_at_pin()) {
        if (REQUIRE) throw new Error("ERROR: pinned toolchain missing");
        return;
      }
      const args = ["--target", "x86_64-unknown-linux-gnu", "--sysroot", s, "--edition=2021", ...flags, "cases.rs"];
      const oracle = run(["rustc", `+${PIN.toolchain}`, "-Zunpretty=hir", ...args]);
      expect(oracle.exit).toBe(0);
      const port = run(["bun", join(DIR, "run.ts"), ...args]);
      expect({ exit: port.exit, stderr: port.stderr }).toEqual({ exit: 0, stderr: "" });
      const o = norm(oracle.stdout);
      const lines = port.stdout.trimEnd().split("\n").map((l) => norm(JSON.parse(l) as string));
      expect(lines.length).toBe(4);
      expect(lines.every((l) => l.includes(flags.length === 0 ? "if false" : "if true"))).toBe(true);
      let cursor = 0;
      for (const l of lines) {
        const at = o.indexOf(l, cursor);
        expect({ found: at >= 0, l }).toEqual({ found: true, l });
        cursor = at + l.length;
      }
    }, 120_000);
  }
});

test("checked_return: plain `return` without an ensures clause, wrapped in the ensures check with one (contract.rs:282)", () =>
  create_default_session_globals_then(() => {
    const calls: string[] = [];
    const ctx = Object.create(LoweringContext.prototype) as LoweringContext;
    const e = (r: string): hir.Expr => ({ r }) as unknown as hir.Expr;
    Object.assign(ctx, {
      contract_ensures: undefined,
      expr_unit: (_sp: Span) => e("()"),
      inject_ensures_check: (expr: hir.Expr, _sp: Span, ident: Ident, _id: HirId) => {
        calls.push(`inject(${(expr as unknown as { r: string }).r}, ${ident.as_str()})`);
        return e("checked");
      },
    });
    const x = e("x");
    expect(ctx.checked_return(x)).toEqual({ $: "Ret", _0: x });
    expect(ctx.checked_return(undefined)).toEqual({ $: "Ret", _0: undefined });
    expect(calls).toEqual([]);
    const id = {} as HirId;
    ctx.contract_ensures = [0 as Span, Ident.new(sym.__ensures_checker, 0 as Span), id];
    expect(ctx.checked_return(x)).toEqual({ $: "Ret", _0: e("checked") });
    expect(ctx.checked_return(undefined)).toEqual({ $: "Ret", _0: e("checked") });
    expect(calls).toEqual(["inject(x, __ensures_checker)", "inject((), __ensures_checker)"]);
  }));
