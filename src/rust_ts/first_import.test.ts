// Modules that once failed as the first module of a process, each in a fresh one (lane fixers-48; docs/reviews/unit-parallel.md N2,
// docs/handoff/unit-parallel.md "Hazards left"). Three import cycles have an unsafe entry, the module whose children read its bindings at
// their top level before its own body has run:
// - `rustc_hir/def.gen.ts` (`MacroKinds`): def.gen.ts -> hir.ts -> def.ts spreads def.gen.ts's values. Import def.ts instead.
// - `rustc_target/spec/mod.ts` (`Os`): spec/mod.ts -> lib.ts -> spec/json.ts and target_features.ts read spec/mod.ts. Import
//   `rustc_target/lib.ts` first.
// - `rustc_middle/ty/print/mod.ts` (`Printer`): print/mod.ts -> pretty.ts, whose `PrettyPrinter` extends `Printer`. Import pretty.ts first.
// Three more (lane fixers-49, docs/handoff/fixers-48.md "Other cycles found") are a generated module and the hand-written one that owns
// it: `rustc_type_ir/binder.gen.ts` (`BoundRegionKind`), `rustc_middle/traits/mod.gen.ts` (`ObligationCause`) and
// `rustc_infer/infer/mod.gen.ts` (`InferOk`). Entered from the gen side, the owner runs first and spreads or assigns onto a gen binding that
// does not exist yet. Import the owner (binder.ts, traits/mod.ts, infer/mod.ts), which re-exports its gen module.
// A module here that fails has gained an import that enters one of them (or another cycle) from its unsafe side.
import { expect, test } from "bun:test";
import { join } from "node:path";

const MODULES = [
  // def.gen.ts
  "rustc_const_eval/const_eval/fn_queries.ts",
  "rustc_middle/ty/inhabitedness/mod.ts",
  // spec/mod.ts
  "rustc_mir_transform/remove_noop_landing_pads.ts",
  "rustc_mir_transform/coroutine/mod.ts",
  // print/mod.ts
  "rustc_codegen_ssa/back/symbol_export.ts",
  "rustc_monomorphize/partitioning.ts",
  "rust_ts/codegen_backend.ts",
  "rustc_lint/context.ts",
  "rustc_symbol_mangling/legacy.ts",
  "rustc_pattern_analysis/rustc/print.ts",
  "rustc_hir_analysis/outlives/dump.ts",
  // binder.gen.ts, traits/mod.gen.ts, infer/mod.gen.ts
  "rustc_symbol_mangling/v0.ts",
  "rustc_hir_typeck/op.ts",
  "rustc_hir_typeck/method/suggest.ts",
];

test("each module loads as the first module of a process", async () => {
  const src = join(import.meta.dir, "..");
  const results = await Promise.all(
    MODULES.map(async (m) => {
      const p = Bun.spawn([process.execPath, "-e", `await import(${JSON.stringify(join(src, m))});`], { stdout: "ignore", stderr: "pipe" });
      const [stderr, code] = [await new Response(p.stderr).text(), await p.exited];
      return `${m}: exit ${code}${code === 0 ? "" : `, ${/\w*Error[^\n]*/.exec(stderr)?.[0] ?? stderr.slice(0, 200)}`}`;
    }),
  );
  expect(results).toEqual(MODULES.map((m) => `${m}: exit 0`));
});
