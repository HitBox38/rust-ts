// Port of compiler/rustc_middle/src/mir/interpret/allocation/init_mask/tests.rs (lane mir-interp-a).
// PORT: `(a..b).into()` is `AllocRange_from_Range_usize({ start: a, end: b })` (`rg(a, b)`); `.count()` of the chunk
// iterator is the length of its spread; `blocks.blocks.len()` counts upstream's u64 blocks (two 32-bit words each, D6).
import { expect, test } from "bun:test";
import "../../../mod.ts";
import { Size } from "../../../../../rustc_abi/lib.ts";
import { type AllocRange, AllocRange_from_Range_usize, alloc_range, InitMask } from "../../allocation.ts";

const rg = (start: number, end: number): AllocRange => AllocRange_from_Range_usize({ start, end });

// rustc: compiler/rustc_middle/src/mir/interpret/allocation/init_mask/tests.rs:5 uninit_mask
test("uninit_mask", () => {
  const mask = InitMask.new(Size.from_bytes(500), false);
  expect(!mask.get(Size.from_bytes(499))).toBe(true);
  mask.set_range(alloc_range(Size.from_bytes(499), Size.from_bytes(1)), true);
  expect(mask.get(Size.from_bytes(499))).toBe(true);
  mask.set_range(rg(100, 256), true);
  for (let i = 0; i < 100; i++) {
    expect(`${i}: ${!mask.get(Size.from_bytes(i))}`).toBe(`${i}: true`); // {i} should not be set
  }
  for (let i = 100; i < 256; i++) {
    expect(`${i}: ${mask.get(Size.from_bytes(i))}`).toBe(`${i}: true`); // {i} should be set
  }
  for (let i = 256; i < 499; i++) {
    expect(`${i}: ${!mask.get(Size.from_bytes(i))}`).toBe(`${i}: true`); // {i} should not be set
  }
});

/// Returns the number of materialized blocks for this mask.
// rustc: compiler/rustc_middle/src/mir/interpret/allocation/init_mask/tests.rs:23 materialized_block_count
function materialized_block_count(mask: InitMask): number {
  switch (mask.blocks.$) {
    case "Lazy":
      return 0;
    case "Materialized":
      return mask.blocks._0.blocks.length / 2; // PORT (D6): two words per block
  }
}

// rustc: compiler/rustc_middle/src/mir/interpret/allocation/init_mask/tests.rs:31 materialize_mask_within_range
test("materialize_mask_within_range", () => {
  // To have spare bits, we use a mask size smaller than its block size of 64.
  const mask = InitMask.new(Size.from_bytes(16), false);
  expect(materialized_block_count(mask)).toBe(0);

  // Forces materialization, but doesn't require growth. This is case #1 documented in the
  // `set_range` method.
  mask.set_range(rg(8, 16), true);
  expect(materialized_block_count(mask)).toBe(1);

  for (let i = 0; i < 8; i++) {
    expect(`${i}: ${!mask.get(Size.from_bytes(i))}`).toBe(`${i}: true`);
  }
  for (let i = 8; i < 16; i++) {
    expect(`${i}: ${mask.get(Size.from_bytes(i))}`).toBe(`${i}: true`);
  }
});

// rustc: compiler/rustc_middle/src/mir/interpret/allocation/init_mask/tests.rs:50 grow_within_unused_bits_with_full_overwrite
test("grow_within_unused_bits_with_full_overwrite", () => {
  // To have spare bits, we use a mask size smaller than its block size of 64.
  const mask = InitMask.new(Size.from_bytes(16), true);
  for (let i = 0; i < 16; i++) {
    expect(`${i}: ${mask.get(Size.from_bytes(i))}`).toBe(`${i}: true`);
  }

  // Grow without requiring an additional block. Full overwrite.
  // This can be fully handled without materialization.
  const range = rg(0, 32);
  mask.set_range(range, true);

  for (let i = 0; i < 32; i++) {
    expect(`${i}: ${mask.get(Size.from_bytes(i))}`).toBe(`${i}: true`);
  }

  expect(materialized_block_count(mask)).toBe(0);
});

// This test checks that an initmask's spare capacity is correctly used when growing within block
// capacity. This can be fully handled without materialization.
// rustc: compiler/rustc_middle/src/mir/interpret/allocation/init_mask/tests.rs:72 grow_same_state_within_unused_bits
test("grow_same_state_within_unused_bits", () => {
  // To have spare bits, we use a mask size smaller than its block size of 64.
  const mask = InitMask.new(Size.from_bytes(16), true);
  for (let i = 0; i < 16; i++) {
    expect(`${i}: ${mask.get(Size.from_bytes(i))}`).toBe(`${i}: true`);
  }

  // Grow without requiring an additional block. The gap between the current length and the
  // range's beginning should be set to the same value as the range.
  const range = rg(24, 32);
  mask.set_range(range, true);

  // We want to make sure the unused bits in the first block are correct
  for (let i = 16; i < 24; i++) {
    expect(`${i}: ${mask.get(Size.from_bytes(i))}`).toBe(`${i}: true`);
  }

  for (let i = 24; i < 32; i++) {
    expect(`${i}: ${mask.get(Size.from_bytes(i))}`).toBe(`${i}: true`);
  }

  expect([...mask.range_as_init_chunks(rg(0, 32))].length).toBe(1);
  expect(materialized_block_count(mask)).toBe(0);
});

// This is the same test as `grow_same_state_within_unused_bits` but with both init and uninit
// states: this forces materialization; otherwise the mask could stay lazy even when needing to
// grow.
// rustc: compiler/rustc_middle/src/mir/interpret/allocation/init_mask/tests.rs:101 grow_mixed_state_within_unused_bits
test("grow_mixed_state_within_unused_bits", () => {
  // To have spare bits, we use a mask size smaller than its block size of 64.
  const mask = InitMask.new(Size.from_bytes(16), true);
  for (let i = 0; i < 16; i++) {
    expect(`${i}: ${mask.get(Size.from_bytes(i))}`).toBe(`${i}: true`);
  }

  // Grow without requiring an additional block. The gap between the current length and the
  // range's beginning should be set to the same value as the range. Note: since this is fully
  // out-of-bounds of the current mask, this is case #3 described in the `set_range` method.
  const range = rg(24, 32);
  mask.set_range(range, false);

  // We want to make sure the unused bits in the first block are correct
  for (let i = 16; i < 24; i++) {
    expect(`${i}: ${!mask.get(Size.from_bytes(i))}`).toBe(`${i}: true`);
  }

  for (let i = 24; i < 32; i++) {
    expect(`${i}: ${!mask.get(Size.from_bytes(i))}`).toBe(`${i}: true`);
  }

  expect([...mask.range_as_init_chunks(rg(0, 16))].length).toBe(1);
  expect([...mask.range_as_init_chunks(rg(0, 32))].length).toBe(2);
  expect(materialized_block_count(mask)).toBe(1);
});

// This is similar to `grow_mixed_state_within_unused_bits` to force materialization, but the range
// to set partially overlaps the mask, so this requires a different growth + write pattern in the
// mask.
// rustc: compiler/rustc_middle/src/mir/interpret/allocation/init_mask/tests.rs:132 grow_within_unused_bits_with_overlap
test("grow_within_unused_bits_with_overlap", () => {
  // To have spare bits, we use a mask size smaller than its block size of 64.
  const mask = InitMask.new(Size.from_bytes(16), true);
  for (let i = 0; i < 16; i++) {
    expect(`${i}: ${mask.get(Size.from_bytes(i))}`).toBe(`${i}: true`);
  }

  // Grow without requiring an additional block, but leave no gap after the current len. Note:
  // since this is partially out-of-bounds of the current mask, this is case #2 described in the
  // `set_range` method.
  const range = rg(8, 24);
  mask.set_range(range, false);

  // We want to make sure the unused bits in the first block are correct
  for (let i = 8; i < 24; i++) {
    expect(`${i}: ${!mask.get(Size.from_bytes(i))}`).toBe(`${i}: true`);
  }

  expect([...mask.range_as_init_chunks(rg(0, 8))].length).toBe(1);
  expect([...mask.range_as_init_chunks(rg(0, 24))].length).toBe(2);
  expect(materialized_block_count(mask)).toBe(1);
});

// Force materialization before a full overwrite: the mask can now become lazy.
// rustc: compiler/rustc_middle/src/mir/interpret/allocation/init_mask/tests.rs:157 grow_mixed_state_within_unused_bits_and_full_overwrite
test("grow_mixed_state_within_unused_bits_and_full_overwrite", () => {
  // To have spare bits, we use a mask size smaller than its block size of 64.
  const mask = InitMask.new(Size.from_bytes(16), true);
  let range = rg(0, 16);
  expect(mask.is_range_initialized(range).$).toBe("Ok");

  // Force materialization.
  range = rg(8, 24);
  mask.set_range(range, false);
  expect(mask.is_range_initialized(range).$).toBe("Err");
  expect(materialized_block_count(mask)).toBe(1);

  // Full overwrite, lazy blocks would be enough from now on.
  range = rg(0, 32);
  mask.set_range(range, true);
  expect(mask.is_range_initialized(range).$).toBe("Ok");

  expect([...mask.range_as_init_chunks(rg(0, 32))].length).toBe(1);
  expect(materialized_block_count(mask)).toBe(0);
});

// Check that growth outside the current capacity can still be lazy: if the init state doesn't
// change, we don't need materialized blocks.
// rustc: compiler/rustc_middle/src/mir/interpret/allocation/init_mask/tests.rs:181 grow_same_state_outside_capacity
test("grow_same_state_outside_capacity", () => {
  // To have spare bits, we use a mask size smaller than its block size of 64.
  const mask = InitMask.new(Size.from_bytes(16), true);
  for (let i = 0; i < 16; i++) {
    expect(`${i}: ${mask.get(Size.from_bytes(i))}`).toBe(`${i}: true`);
  }
  expect(materialized_block_count(mask)).toBe(0);

  // Grow to 10 blocks with the same init state.
  const range = rg(24, 640);
  mask.set_range(range, true);

  expect([...mask.range_as_init_chunks(rg(0, 640))].length).toBe(1);
  expect(materialized_block_count(mask)).toBe(0);
});
