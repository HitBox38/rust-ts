// Port of compiler/rustc_index/src/slice.rs (partial; merge-layout). `IndexSlice<I, T>` is a `T[]` indexed by the
// handle number (PORTING §5), so its methods are free functions taking the array first. Only what the port needs so far
// is here (`invert_bijective_mapping`, was a local copy in rustc_abi layout/coroutine.ts).

/// Invert a bijective mapping, i.e. `invert(map)[y] = x` if `map[x] = y`,
/// assuming the values in `self` are a permutation of `0..self.len()`.
///
// FIXME(eddyb) build a better abstraction for permutations, if possible.
// rustc: compiler/rustc_index/src/slice.rs:185 invert_bijective_mapping
export function invert_bijective_mapping<I extends number, J extends number>(self: readonly J[]): I[] {
  // debug_assert_eq!(
  //     self.iter().map(|x| x.index() as u128).sum::<u128>(),
  //     (0..self.len() as u128).sum::<u128>(),
  //     "The values aren't 0..N in input {self:?}",
  // );

  const inverse: I[] = new Array<I>(self.length).fill(0 as I);
  for (let i1 = 0; i1 < self.length; i1++) {
    const i2 = self[i1]!;
    inverse[i2] = i1 as I;
  }

  // debug_assert_eq!(
  //     inverse.iter().map(|x| x.index() as u128).sum::<u128>(),
  //     (0..inverse.len() as u128).sum::<u128>(),
  //     "The values aren't 0..N in result {self:?}",
  // );
  return inverse;
}
