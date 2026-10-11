// Port of the `unicode-ident` crate (=1.0.24). Tables are generated from the oracle.
import { in_table } from "../../std/unicode/mod.ts";
import { XID_CONTINUE, XID_START } from "./tables.ts";

export function is_xid_start(ch: number): boolean {
  if (ch < 0x80) return (ch >= 0x41 && ch <= 0x5a) || (ch >= 0x61 && ch <= 0x7a);
  return in_table(XID_START, ch);
}

export function is_xid_continue(ch: number): boolean {
  if (ch < 0x80) return (ch >= 0x30 && ch <= 0x39) || (ch >= 0x41 && ch <= 0x5a) || (ch >= 0x61 && ch <= 0x7a) || ch === 0x5f;
  return in_table(XID_CONTINUE, ch);
}
