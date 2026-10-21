// Port of compiler/rustc_abi/src/callconv/reg.rs (lane layout-contract: the types with their Debug; the fns are
// `// stub:` declarations for lane abi-lib, docs/handoff/layout-contract.md).
// Init order: lib.ts re-exports this module (through callconv.ts), so its top-level code must not touch lib.ts's values.
import { type Debug, debug_struct } from "../../std/fmt.ts";
import { unported } from "../../std/panic.ts";
import { type Align, debug_Primitive, debug_Size, type HasDataLayout, type Primitive, type Size } from "../lib.ts";

// #[cfg_attr(feature = "nightly", derive(StableHash))]
// #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
export type RegKind =
  | { readonly $: "Integer" }
  | { readonly $: "Float" }
  | { readonly $: "PpcF128" }
  | { readonly $: "Vector"; readonly hint_vector_elem: Primitive };
export const RegKind = {
  Integer: Object.freeze({ $: "Integer" }) as RegKind,
  Float: Object.freeze({ $: "Float" }) as RegKind,
  PpcF128: Object.freeze({ $: "PpcF128" }) as RegKind,

  // stub: compiler/rustc_abi/src/callconv/reg.rs:26 from_primitive (lane abi-lib)
  from_primitive(_primitive: Primitive): RegKind {
    return unported("rustc_abi::callconv::reg::RegKind::from_primitive");
  },
} as const;
// derive(Debug)
export const debug_RegKind: Debug<RegKind> = (v, f) => {
  switch (v.$) {
    case "Integer":
      return "Integer";
    case "Float":
      return "Float";
    case "PpcF128":
      return "PpcF128";
    case "Vector":
      return debug_struct(f, "Vector", [["hint_vector_elem", debug_Primitive(v.hint_vector_elem, f)]]);
  }
};

// #[cfg_attr(feature = "nightly", derive(StableHash))]
// #[derive(Copy, Clone, PartialEq, Eq, Hash, Debug)]
// PORT (layout-contract): a struct with an inherent impl is a class; the `reg_ctor!` constructors (`Reg::i8()`, ..,
// `Reg::f128()`) are macro-generated and belong to the fill lane (not fns in the coverage table).
export class Reg {
  constructor(
    readonly kind: RegKind,
    readonly size: Size,
  ) {}

  // stub: compiler/rustc_abi/src/callconv/reg.rs:66 opaque_vector (lane abi-lib)
  static opaque_vector(_size: Size): Reg {
    return unported("rustc_abi::callconv::reg::Reg::opaque_vector");
  }

  // stub: compiler/rustc_abi/src/callconv/reg.rs:73 align (lane abi-lib)
  align(_cx: HasDataLayout): Align {
    return unported("rustc_abi::callconv::reg::Reg::align");
  }
}
// derive(Debug)
export const debug_Reg: Debug<Reg> = (v, f) =>
  debug_struct(f, "Reg", [
    ["kind", debug_RegKind(v.kind, f)],
    ["size", debug_Size(v.size, f)],
  ]);
