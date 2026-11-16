// Port of src/tools/clippy/clippy_utils/src/macros.rs (crate `clippy_utils`, plan-m8 D4).
// SKELETON (lane clippy-contract-a, root decision "codegen-clippy-macros N5"): only `FormatArgsStorage`, the type
// src/clippy_lints/lib.gen.ts names and `register_lint_passes` builds (`FormatArgsStorage::default()`), as the struct alone.
// Its methods (`get`, `set`) and the rest of the file belong to the fill lane (plan-m8 §2c: `clippy-utils-c`), which ports
// them in place.
import type { format } from "../rustc_ast/lib.ts";
import type { Span } from "../rustc_span/lib.ts";

/// Stores AST [`FormatArgs`] nodes for use in late lint passes, as they are in a desugared form in
/// the HIR
// #[derive(Default, Clone)]
// PORT: `Arc<OnceLock<FxHashMap<Span, FormatArgs>>>` is one shared cell (`value` is `undefined` until set); `Clone` shares it, as
// the `Arc` does (lib.rs passes the same storage to the early collector and to the late passes).
export class FormatArgsStorage {
  constructor(public _0: { value: Map<Span, format.FormatArgs> | undefined }) {}

  /** `#[derive(Default)]` */
  static default(): FormatArgsStorage {
    return new FormatArgsStorage({ value: undefined });
  }
}
