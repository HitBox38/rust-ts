// compiler/rustc_codegen_ssa/src/mir/debuginfo.rs: NOT PORTED YET (lane ssa-debuginfo, plan-m7 wave 41).
//
// PORT (ssa-contract): the type surface the traits (traits/debuginfo.ts) need, placed in the file lane ssa-debuginfo
// will port: `VariableKind`, an enum with data (a `$`-tagged union, PORTING §5).

// #[derive(Copy, Clone)]
export type VariableKind =
  | { readonly $: "ArgumentVariable"; _0: number /*index*/ }
  | { readonly $: "LocalVariable" };
export const VariableKind = {
  /** Shared frozen singleton of the unit variant. */
  LocalVariable: Object.freeze({ $: "LocalVariable" }) as { readonly $: "LocalVariable" },
} as const;
