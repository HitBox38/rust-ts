// Port of bitflags-2.10.0/src/iter.rs (`IterNames`, used by `parser::to_writer`).
import { Flags_contains, Flags_intersects, Flags_is_empty, Flags_remove, type Flags } from "./traits.ts";

/**
An iterator over flags values.

This iterator only yields flags values for contained, defined, named flags. Any remaining bits
won't be yielded, but can be found with the [`IterNames::remaining`] method.
*/
export class IterNames<B extends number> {
  constructor(
    public F: Flags<B>,
    public idx: number,
    public source: B,
    public remaining_: B,
  ) {}

  // crate: bitflags-2.10.0/src/iter.rs:75 new
  static new<B extends number>(F: Flags<B>, flags: B): IterNames<B> {
    return new IterNames(F, 0, flags, flags);
  }

  // crate: bitflags-2.10.0/src/iter.rs:102 remaining
  /// Get a flags value of any remaining bits that haven't been yielded yet.
  ///
  /// Once the iterator has finished, this method can be used to
  /// check whether or not there are any bits that didn't correspond
  /// to a contained, defined, named flag remaining.
  remaining(): B {
    return this.remaining_;
  }

  // crate: bitflags-2.10.0/src/iter.rs:110 next
  next(): [string, B] | undefined {
    let flag;
    while ((flag = this.F.FLAGS[this.idx]) !== undefined) {
      // Short-circuit if our state is empty
      if (Flags_is_empty(this.F, this.remaining_)) {
        return undefined;
      }

      this.idx += 1;

      // Skip unnamed flags
      if (flag.name().length === 0) {
        continue;
      }

      const bits = flag.value();

      // If the flag is set in the original source _and_ it has bits that haven't
      // been covered by a previous flag yet then yield it. These conditions cover
      // two cases for multi-bit flags:
      //
      // 1. When flags partially overlap, such as `0b00000001` and `0b00000101`, we'll
      // yield both flags.
      // 2. When flags fully overlap, such as in convenience flags that are a shorthand for others,
      // we won't yield both flags.
      if (Flags_contains(this.F, this.source, bits) && Flags_intersects(this.F, this.remaining_, bits)) {
        this.remaining_ = Flags_remove(this.F, this.remaining_, bits);

        return [flag.name(), bits];
      }
    }

    return undefined;
  }
}
