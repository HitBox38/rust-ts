// Port of compiler/rustc_pattern_analysis/src/diagnostics.rs (lane pat-b): the types and their `#[derive(Diagnostic)]` /
// `#[derive(Subdiagnostic)]` impls are generated into diagnostics.gen.ts (tools/codegen/types.ts, set
// rustc_pattern_analysis); `impl Uncovered` is ported here.
import type { Uncovered } from "./diagnostics.gen.ts";
import type { RustcPatCtxt, WitnessPat } from "./rustc.ts";
import type { Span } from "../rustc_span/lib.ts";
import { unwrap } from "../std/panic.ts";

export * from "./diagnostics.gen.ts";

// impl Uncovered
// PORT: `Uncovered::new` is `Uncovered_new` (`Uncovered` is a generated interface).
// rustc: compiler/rustc_pattern_analysis/src/diagnostics.rs:27 new
export function Uncovered_new(span: Span, cx: RustcPatCtxt, witnesses: WitnessPat[]): Uncovered {
  const witness_1 = cx.print_witness_pat(unwrap(witnesses[0]));
  return {
    span,
    count: witnesses.length,
    // Substitute dummy values if witnesses is smaller than 3. These will never be read.
    witness_2: witnesses[1] !== undefined ? cx.print_witness_pat(witnesses[1]) : "",
    witness_3: witnesses[2] !== undefined ? cx.print_witness_pat(witnesses[2]) : "",
    witness_1,
    remainder: Math.max(witnesses.length - 3, 0),
  };
}
