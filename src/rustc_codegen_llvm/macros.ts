// Port of compiler/rustc_codegen_llvm/src/macros.rs (lane cg-contract).
//
// PORT (cg-contract): the derive macro `TryFromU32` generates `impl TryFrom<u32> for $Type` from a fieldless enum's
// variants and discriminants. Enums are string unions with a `<Enum>_discriminant` table (PORTING §5), so the derive is
// a function of that table: `TryFromU32(CallConv_discriminant)` is `CallConv::try_from`. The variants are tried in
// declaration order (the table's key order), as the macro's chain of `if`s does.
import type { Result } from "../std/result.ts";

/** `#[derive(TryFromU32)]`: the `try_from` of `impl TryFrom<u32> for $Type` (`type Error = u32`). */
export function TryFromU32<T extends string>(discriminants: Readonly<Record<T, number>>): (value: number) => Result<T, number> {
  const variants = Object.entries(discriminants) as [T, number][];
  // #[allow(deprecated)] // Don't warn about deprecated variants.
  // rustc: compiler/rustc_codegen_llvm/src/macros.rs:14 try_from
  return function try_from(value: number): Result<T, number> {
    for (const [variant, discr] of variants) {
      if (value === discr) {
        return { $: "Ok", _0: variant };
      }
    }
    return { $: "Err", _0: value };
  };
}
