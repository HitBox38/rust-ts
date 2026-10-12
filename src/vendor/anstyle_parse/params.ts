// Port of anstyle-parse =0.2.7 `src/params.rs`.
//
//! Fixed size parameters list with optional subparameters.
//
// PORT: the field `len` collides with the method `len()` on a TS class, so the field is `len_`.
// `&[u16]` items are `Uint16Array` views (`subarray`) into `params`.

import type { Debug } from "../../std/fmt.ts";

export const MAX_PARAMS = 32;

export class Params {
  constructor(
    /// Number of subparameters for each parameter.
    ///
    /// For each entry in the `params` slice, this stores the length of the param as number of
    /// subparams at the same index as the param in the `params` slice.
    ///
    /// At the subparam positions the length will always be `0`.
    public subparams: Uint8Array,

    /// All parameters and subparameters.
    public params: Uint16Array,

    /// Number of suparameters in the current parameter.
    public current_subparams: number,

    /// Total number of parameters and subparameters.
    public len_: number,
  ) {}

  /** `#[derive(Default)]` */
  static default_(): Params {
    return new Params(new Uint8Array(MAX_PARAMS), new Uint16Array(MAX_PARAMS), 0, 0);
  }

  /** `#[derive(Clone)]` */
  clone(): Params {
    return new Params(this.subparams.slice(), this.params.slice(), this.current_subparams, this.len_);
  }

  /// Returns the number of parameters.
  // crate: anstyle-parse-0.2.7/src/params.rs:30 len
  len(): number {
    return this.len_;
  }

  /// Returns `true` if there are no parameters present.
  // crate: anstyle-parse-0.2.7/src/params.rs:36 is_empty
  is_empty(): boolean {
    return this.len_ === 0;
  }

  /// Returns an iterator over all parameters and subparameters.
  // crate: anstyle-parse-0.2.7/src/params.rs:42 iter
  iter(): ParamsIter {
    return ParamsIter.new(this);
  }

  /// Returns `true` if there is no more space for additional parameters.
  // crate: anstyle-parse-0.2.7/src/params.rs:48 is_full
  is_full(): boolean {
    return this.len_ === MAX_PARAMS;
  }

  /// Clear all parameters.
  // crate: anstyle-parse-0.2.7/src/params.rs:54 clear
  clear(): void {
    this.current_subparams = 0;
    this.len_ = 0;
  }

  /// Add an additional parameter.
  // crate: anstyle-parse-0.2.7/src/params.rs:61 push
  push(item: number): void {
    this.subparams[this.len_ - this.current_subparams] = this.current_subparams + 1;
    this.params[this.len_] = item;
    this.current_subparams = 0;
    this.len_ += 1;
  }

  /// Add an additional subparameter to the current parameter.
  // crate: anstyle-parse-0.2.7/src/params.rs:70 extend
  extend(item: number): void {
    this.subparams[this.len_ - this.current_subparams] = this.current_subparams + 1;
    this.params[this.len_] = item;
    this.current_subparams += 1;
    this.len_ += 1;
  }

  // impl<'a> IntoIterator for &'a Params
  // crate: anstyle-parse-0.2.7/src/params.rs:82 into_iter
  into_iter(): ParamsIter {
    return this.iter();
  }

  /** `for param in &params` */
  [Symbol.iterator](): Iterator<Uint16Array> {
    return this.into_iter()[Symbol.iterator]();
  }
}

/// Immutable subparameter iterator.
export class ParamsIter {
  constructor(
    public params: Params,
    public index: number,
  ) {}

  // crate: anstyle-parse-0.2.7/src/params.rs:94 new
  static new(params: Params): ParamsIter {
    return new ParamsIter(params, 0);
  }

  // crate: anstyle-parse-0.2.7/src/params.rs:102 next
  next(): Uint16Array | undefined {
    if (this.index >= this.params.len()) {
      return undefined;
    }

    // Get all subparameters for the current parameter.
    const num_subparams = this.params.subparams[this.index]!;
    const param = this.params.params.subarray(this.index, this.index + num_subparams);

    // Jump to the next parameter.
    this.index += num_subparams;

    return param;
  }

  // crate: anstyle-parse-0.2.7/src/params.rs:117 size_hint
  size_hint(): [number, number | undefined] {
    const remaining = this.params.len() - this.index;
    return [remaining, remaining];
  }

  /** Rust `Iterator` → JS iteration protocol (drives `next()`). */
  *[Symbol.iterator](): Generator<Uint16Array, void, undefined> {
    for (let p = this.next(); p !== undefined; p = this.next()) yield p;
  }
}

// impl Debug for Params
// crate: anstyle-parse-0.2.7/src/params.rs:124 fmt
export const debug_Params: Debug<Params> = (self) => {
  let f = "[";

  let i = 0;
  for (const param of self.iter()) {
    if (i !== 0) {
      f += ";";
    }

    let j = 0;
    for (const subparam of param) {
      if (j !== 0) {
        f += ":";
      }

      f += String(subparam);
      j++;
    }
    i++;
  }

  f += "]";
  return f;
};
