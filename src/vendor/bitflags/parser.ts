// Port of bitflags-2.10.0/src/parser.rs (formatting only; parsing flags from text is not needed yet).
import { Flags_iter_names, write_hex, type Flags } from "./traits.ts";

// crate: bitflags-2.10.0/src/parser.rs:42 to_writer
/**
Write a flags value as text.

Any bits that aren't part of a contained flag will be formatted as a hex number.
*/
// PORT: returns the written text instead of writing to `impl Write`.
export function to_writer<B extends number>(F: Flags<B>, flags: B): string {
  let writer = "";
  // A formatter for bitflags that produces text output like:
  //
  // A | B | 0xf6
  //
  // The names of set flags are written in a bar-separated-format,
  // followed by a hex number of any remaining bits that are set
  // but don't correspond to any flags.

  // Iterate over known flag values
  let first = true;
  const iter = Flags_iter_names(F, flags);
  let next;
  while ((next = iter.next()) !== undefined) {
    const [name] = next;
    if (!first) {
      writer += " | ";
    }

    first = false;
    writer += name;
  }

  // Append any extra bits that correspond to flags to the end of the format
  const remaining = iter.remaining();
  if (remaining !== 0) {
    if (!first) {
      writer += " | ";
    }

    writer += "0x";
    writer += write_hex(remaining);
  }

  return writer;
}
