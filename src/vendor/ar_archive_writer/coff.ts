// Port of ar_archive_writer 0.5.3 `src/coff.rs`: the `MachineTypes` helpers `object_reader.rs` reaches.
// Derived from code in LLVM, which is:
// Part of the LLVM Project, under the Apache License v2.0 with LLVM Exceptions.
// See https://llvm.org/LICENSE.txt for license information.
// SPDX-License-Identifier: Apache-2.0 WITH LLVM-exception
//
// PORT: `MachineTypes` is the `u16` it converts from (`try_into` is checked by the names below; an unknown machine value is
// neither ARM64 nor ARM64EC, which is what `is_ok_and` gives).
const IMAGE_FILE_MACHINE_ARM64 = 0xaa64;
const IMAGE_FILE_MACHINE_ARM64EC = 0xa641;
const IMAGE_FILE_MACHINE_ARM64X = 0xa64e;

// crate: ar_archive_writer-0.5.3/src/coff.rs:40 is_arm64ec
export function is_arm64ec(machine: number): boolean {
  return machine === IMAGE_FILE_MACHINE_ARM64EC || machine === IMAGE_FILE_MACHINE_ARM64X;
}

// crate: ar_archive_writer-0.5.3/src/coff.rs:44 is_any_arm64
export function is_any_arm64(machine: number): boolean {
  return machine === IMAGE_FILE_MACHINE_ARM64 || is_arm64ec(machine);
}
