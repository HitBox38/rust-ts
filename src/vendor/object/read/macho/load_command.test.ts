// Port of the `#[cfg(test)] mod tests` of object 0.39.1 `src/read/macho/load_command.rs`
// (`function_starts_invalid_uleb128` tests the unported `LinkeditDataCommand::function_starts`).
import { expect, test } from "bun:test";
import type { Endianness } from "../../endian.ts";
import { LoadCommandIterator } from "./load_command.ts";

// PORT: the iterator's endian parameter is typed `Endianness`; upstream's test uses `LittleEndian`.
const LittleEndian = "LittleEndian" as unknown as Endianness;

// crate: object-0.39.1/src/read/macho/load_command.rs:499 cmd_size_invalid
test("cmd_size_invalid", () => {
  let commands = LoadCommandIterator.new(LittleEndian, new Uint8Array(8), 10);
  expect(commands.next().$).toBe("Err");
  commands = LoadCommandIterator.new(LittleEndian, new Uint8Array([0, 0, 0, 0, 7, 0, 0, 0, 0]), 10);
  expect(commands.next().$).toBe("Err");
  commands = LoadCommandIterator.new(LittleEndian, new Uint8Array([0, 0, 0, 0, 8, 0, 0, 0, 0]), 10);
  expect(commands.next().$).toBe("Ok");
});
