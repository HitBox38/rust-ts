// Test driver for the early lint passes (lane lint-early-b; not a port). Like lintlevels.ts (lane lint-early-a): runs
// the ported driver up to `after_crate_root_parsing`, then the pre-expansion and early `rustc_lint::check_ast_node` on
// the crate root, and stops. Before that it gives every AST node a fresh `NodeId`, as expansion's
// `InvocationCollector` does (`assign_id!`), because some passes key state on node ids (UnusedParens'
// `parens_in_cast_in_lt` / `in_no_bounds_pos`, EllipsisInclusiveRangePatterns' `node_id`): with every id still
// `DUMMY_NODE_ID` they would see one node everywhere. The crate is otherwise unexpanded (no macro expansion, cfg
// stripping or `mod` loading), so it suits crates without macros. src/rustc_lint/early_passes.oracle.test.ts
// compares the output with rustc's.
//   bun src/rust_ts/earlylints.ts <rustc arguments...>
// Exit codes as src/rust_ts/main.ts (70 = reached unported code).
import type { Crate } from "../rustc_ast/lib.ts";
import type { Compiler } from "../rustc_interface/interface.ts";
import { EarlyDiagCtxt } from "../rustc_session/session.ts";
import { ErrorOutputType } from "../rustc_session/config.ts";
import { Panic, Unported } from "../std/panic.ts";

async function main(): Promise<number> {
  const { catch_with_exit_code, compiler_entrypoint } = await import("../rustc_driver_impl/lib.ts");
  const { raw_args } = await import("../rustc_driver_impl/args.ts");
  const rustc_lint = await import("../rustc_lint/lib.ts");
  const { features } = await import("../rustc_expand/config.ts");
  const { registered_lint_tools_ast } = await import("../rustc_resolve/lib.ts");
  const { Symbol } = await import("../rustc_span/symbol.ts");
  const { MutVisitor, walk_crate } = await import("../rustc_ast/mut_visit.ts");
  const { CRATE_NODE_ID, DUMMY_NODE_ID, NodeId } = await import("../rustc_ast/node_id.ts");
  class AssignIds extends MutVisitor {
    next = 1;
    override visit_id(id: { value: typeof DUMMY_NODE_ID }): void {
      if (id.value === DUMMY_NODE_ID) id.value = NodeId.from_u32(this.next++);
    }
  }
  const callbacks = {
    config(_config: unknown): void {},
    after_crate_root_parsing(compiler: Compiler, krate: Crate): "Stop" {
      const sess = compiler.sess;
      walk_crate(new AssignIds(), krate);
      krate.id = CRATE_NODE_ID;
      const feats = features(sess, krate.attrs, Symbol.intern("earlylints"));
      const tools = registered_lint_tools_ast(sess, krate.attrs);
      const store = rustc_lint.unerased_lint_store(sess);
      rustc_lint.check_ast_node(sess, feats, true, store, tools, undefined, { $: "CrateRoot", _0: krate, _1: krate.attrs });
      rustc_lint.check_ast_node(sess, feats, false, store, tools, undefined, { $: "CrateRoot", _0: krate, _1: krate.attrs });
      return "Stop";
    },
  };
  const early_dcx = EarlyDiagCtxt.new(ErrorOutputType.default());
  return catch_with_exit_code(() => compiler_entrypoint(raw_args(early_dcx), callbacks));
}

try {
  process.exitCode = await main();
} catch (e) {
  if (e instanceof Unported) {
    process.stderr.write(`rust-ts: unported: ${e.what}\n`);
    process.exitCode = 70;
  } else {
    const msg = e instanceof Panic ? e.message : String(e);
    process.stderr.write(`rust-ts: internal compiler error: ${msg}\n${e instanceof Error ? e.stack : ""}\n`);
    process.exitCode = 101;
  }
}
