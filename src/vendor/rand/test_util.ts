// rand =0.10.1 `src/lib.rs` `#[cfg(test)] mod test`: the RNGs the crate's unit tests use.
//
// PORT: `crate::test::rng` is `rand_pcg::Pcg32` (dev-dependency rand_pcg =0.10.2, `Lcg64Xsh32`), ported here as
// test support only (rand_pcg is not a vendored crate, so it has no markers). Import this from tests only.
import { Ok, type Result } from "../../std/result.ts";
import { Rng_for_TryRng, type Infallible, type Rng } from "../rand_core/lib.ts";
import { fill_bytes_via_next_word, next_u64_via_u32 } from "../rand_core/utils.ts";
import { Word_u32, Word_u64 } from "../rand_core/word.ts";

const M64 = 0xffff_ffff_ffff_ffffn;

/** rand_pcg 0.10.2 `src/pcg64.rs` `Lcg64Xsh32` (`Pcg32`). */
export class Pcg32 implements Rng {
  static readonly MULTIPLIER = 6364136223846793005n;

  constructor(
    public state: bigint,
    public increment: bigint,
  ) {}

  static new(state: bigint, stream: bigint): Pcg32 {
    const increment = ((stream << 1n) | 1n) & M64;
    return Pcg32.from_state_incr(state, increment);
  }

  static from_state_incr(state: bigint, increment: bigint): Pcg32 {
    const pcg = new Pcg32(state, increment);
    pcg.state = (pcg.state + pcg.increment) & M64;
    pcg.step();
    return pcg;
  }

  step(): void {
    this.state = (this.state * Pcg32.MULTIPLIER + this.increment) & M64;
  }

  try_next_u32(): Result<number, Infallible> {
    const state = this.state;
    this.step();
    const ROTATE = 59n; // 64 - 5
    const XSHIFT = 18n; // (5 + 32) / 2
    const SPARE = 27n; // 64 - 32 - 5
    const rot = Number(state >> ROTATE);
    const xsh = Number((((state >> XSHIFT) ^ state) >> SPARE) & 0xffff_ffffn);
    return Ok(((xsh >>> rot) | (xsh << ((32 - rot) & 31))) >>> 0);
  }
  try_next_u64(): Result<bigint, Infallible> {
    return next_u64_via_u32(this);
  }
  try_fill_bytes(dest: Uint8Array): Result<void, Infallible> {
    fill_bytes_via_next_word(Word_u32, dest, () => this.try_next_u32());
    return Ok(undefined);
  }
  next_u32(): number {
    return Rng_for_TryRng.next_u32(this);
  }
  next_u64(): bigint {
    return Rng_for_TryRng.next_u64(this);
  }
  fill_bytes(dst: Uint8Array): void {
    Rng_for_TryRng.fill_bytes(this, dst);
  }
}

// crate: rand-0.10.1/src/lib.rs:337 rng
export function rng(seed: bigint): Rng {
  // For tests, we want a statistically good, fast, reproducible RNG.
  // PCG32 will do fine, and will be easy to embed if we ever need to.
  const INC = 11634580027462260723n;
  return Pcg32.new(seed, INC);
}

// crate: rand-0.10.1/src/lib.rs:345 const_rng
export function const_rng(x: bigint): StepRng {
  return new StepRng(x, 0n);
}

// crate: rand-0.10.1/src/lib.rs:350 step_rng
export function step_rng(x: bigint, increment: bigint): StepRng {
  return new StepRng(x, increment);
}

export class StepRng implements Rng {
  constructor(
    public _0: bigint,
    public _1: bigint,
  ) {}

  // crate: rand-0.10.1/src/lib.rs:359 try_next_u32
  try_next_u32(): Result<number, Infallible> {
    const r = this.try_next_u64();
    return Ok(Number((r as { _0: bigint })._0 & 0xffff_ffffn));
  }

  // crate: rand-0.10.1/src/lib.rs:363 try_next_u64
  try_next_u64(): Result<bigint, Infallible> {
    const res = this._0;
    this._0 = (this._0 + this._1) & M64;
    return Ok(res);
  }

  // crate: rand-0.10.1/src/lib.rs:369 try_fill_bytes
  try_fill_bytes(dst: Uint8Array): Result<void, Infallible> {
    return fill_bytes_via_next_word(Word_u64, dst, () => this.try_next_u64());
  }

  next_u32(): number {
    return Rng_for_TryRng.next_u32(this);
  }
  next_u64(): bigint {
    return Rng_for_TryRng.next_u64(this);
  }
  fill_bytes(dst: Uint8Array): void {
    Rng_for_TryRng.fill_bytes(this, dst);
  }
}
