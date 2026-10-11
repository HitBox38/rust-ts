// Port of the `unicode-properties` crate (=0.1.4, feature "emoji"). Tables are generated from the oracle.
import { in_table } from "../../std/unicode/mod.ts";
import { EMOJI_CHAR } from "./tables.ts";

/** `UnicodeEmoji::is_emoji_char` */
export function is_emoji_char(c: number): boolean {
  return in_table(EMOJI_CHAR, c);
}
