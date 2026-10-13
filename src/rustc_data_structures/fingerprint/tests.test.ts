// Port of compiler/rustc_data_structures/src/fingerprint/tests.rs.
import { expect, test } from "bun:test";
import { Hash64 } from "../../rustc_hashes/lib.ts";
import { Fingerprint } from "../fingerprint.ts";

// Check that `combine_commutative` is order independent.
// rustc: compiler/rustc_data_structures/src/fingerprint/tests.rs:5 combine_commutative_is_order_independent
test("combine_commutative_is_order_independent", () => {
  const a = Fingerprint.new(Hash64.new(0xf6622fb349898b06n), Hash64.new(0x70be9377b2f9c610n));
  const b = Fingerprint.new(Hash64.new(0xa9562bf5a2a5303cn), Hash64.new(0x67d9b6c82034f13dn));
  const c = Fingerprint.new(Hash64.new(0x0d013a27811dbbc3n), Hash64.new(0x9a3f7b3d9142ec43n));
  const permutations = [
    [a, b, c],
    [a, c, b],
    [b, a, c],
    [b, c, a],
    [c, a, b],
    [c, b, a],
  ] as const;
  const f = Fingerprint.combine_commutative(Fingerprint.combine_commutative(a, b), c);
  for (const p of permutations) {
    expect(f).toBe(Fingerprint.combine_commutative(Fingerprint.combine_commutative(p[0], p[1]), p[2]));
  }
});
