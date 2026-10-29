// Port of the `#[cfg(test)] mod test` of twox-hash =2.1.2 `src/xxhash3/streaming.rs`.
import "../lib.ts";
import { expect, test } from "bun:test";
import { SecretBuffer } from "./streaming.ts";

// crate: twox-hash-2.1.2/src/xxhash3/streaming.rs:548 secret_buffer_default_is_valid
test("secret_buffer_default_is_valid", () => {
  expect(SecretBuffer.default_().is_valid()).toBe(true);
});

// crate: twox-hash-2.1.2/src/xxhash3/streaming.rs:553 secret_buffer_allocate_default_is_valid
test("secret_buffer_allocate_default_is_valid", () => {
  expect(SecretBuffer.allocate_default().is_valid()).toBe(true);
});

// crate: twox-hash-2.1.2/src/xxhash3/streaming.rs:558 secret_buffer_allocate_with_seed_is_valid
test("secret_buffer_allocate_with_seed_is_valid", () => {
  expect(SecretBuffer.allocate_with_seed(0xdead_beefn).is_valid()).toBe(true);
});
