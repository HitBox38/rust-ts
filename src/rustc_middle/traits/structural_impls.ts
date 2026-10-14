// Port of compiler/rustc_middle/src/traits/structural_impls.rs (lane middle-traits-thir).
import { debug_DefId } from "../../rustc_span/def_id.ts";
import { type Debug, debug_vec, type Fmt, PLAIN } from "../../std/fmt.ts";
import { debug_GenericArgs } from "../ty/generic_args.ts";
import type { ImplSource, ImplSourceUserDefinedData } from "./mod.gen.ts";
import { debug_BuiltinImplSource } from "../../rustc_type_ir/solve/mod.ts";

// Structural impls for the structs in `traits`.

// `impl<'tcx, N: fmt::Debug> fmt::Debug for traits::ImplSource<'tcx, N>`
// rustc: compiler/rustc_middle/src/traits/structural_impls.rs:8 fmt
export function debug_ImplSource<N>(self: ImplSource<N>, _f: Fmt, debug_N: Debug<N>): string {
  switch (self.$) {
    case "UserDefined":
      // PORT: `write!(f, "{v:?}")` formats with a fresh `{:?}` spec (not `f`'s flags): `PLAIN`.
      return debug_ImplSourceUserDefinedData(self._0, PLAIN, debug_N);

    case "Builtin":
      return `Builtin(${debug_BuiltinImplSource(self._0, PLAIN)}, ${debug_vec(self._1, PLAIN, debug_N)})`;

    case "Param":
      return `ImplSourceParamData(${debug_vec(self._0, PLAIN, debug_N)})`;
  }
}

// `impl<'tcx, N: fmt::Debug> fmt::Debug for traits::ImplSourceUserDefinedData<'tcx, N>`
// rustc: compiler/rustc_middle/src/traits/structural_impls.rs:24 fmt
export function debug_ImplSourceUserDefinedData<N>(self: ImplSourceUserDefinedData<N>, _f: Fmt, debug_N: Debug<N>): string {
  // `write!(f, "..{:?}..", ..)`: fresh `{:?}` specs (`PLAIN`).
  return `ImplSourceUserDefinedData(impl_def_id=${debug_DefId(self.impl_def_id, PLAIN)}, args=${debug_GenericArgs(self.args, PLAIN)}, nested=${debug_vec(self.nested, PLAIN, debug_N)})`;
}
