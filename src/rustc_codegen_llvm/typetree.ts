// compiler/rustc_codegen_llvm/src/typetree.rs: out of M7 (harness/scope.json; plan-m7 D18, `-Zautodiff`). Lane cg-contract placed
// here the fn another fill lane calls (review F2), as a stub.
import type { FncTree } from "../rustc_ast/expand/typetree.gen.ts";
import { unported } from "../std/panic.ts";
import type { FullCx } from "./context.ts";
import type { Value } from "./llvm/mod.ts";

// Stub (cg-contract): add_tt (typetree.rs:78)
// PORT (lane cg-register): the head of add_tt (typetree.rs:78-88) is ported, as `memcpy` (builder.rs:1196) calls it with a type tree
// in ordinary programs and upstream returns there unless `-Zautodiff=Enable` is set without `NoTT`. The rest (Enzyme's type trees)
// stays the out-of-M7 stop. No `// rustc:` marker: the file is excluded from coverage (harness/scope.json).
export function add_tt(cx: FullCx, _fn_def: Value, _tt: FncTree): void {
  // TypeTree processing uses functions from Enzyme. This feature is not strictly necessary,
  // but skipping this function increases the chance that Enzyme fails to compile some code.

  const tcx = cx.tcx;
  if (!tcx.sess.opts.unstable_opts.autodiff.some((ad) => ad.$ === "Enable")) {
    return;
  }
  if (tcx.sess.opts.unstable_opts.autodiff.some((ad) => ad.$ === "NoTT")) {
    return;
  }

  return unported("excluded (plan-m7 D18): compiler/rustc_codegen_llvm/src/typetree.rs add_tt");
}
