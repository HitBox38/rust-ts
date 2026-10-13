// Port of the `#[cfg(test)] mod test` of pulldown-cmark-0.11.3/src/scanners.rs.
import { expect, test } from "bun:test";
import { Str, utf8 } from "../../std/str.ts";
import { scan_email, scan_listitem } from "./scanners.ts";

// crate: pulldown-cmark-0.11.3/src/scanners.rs:1483 overflow_list
test("overflow_list", () => {
  expect(scan_listitem(utf8("4444444444444444444444444444444444444444444444444444444444!"))).toBeUndefined();
});

// crate: pulldown-cmark-0.11.3/src/scanners.rs:1490 overflow_by_addition
test("overflow_by_addition", () => {
  expect(scan_listitem(utf8("1844674407370955161615!"))).toBeUndefined();
});

// crate: pulldown-cmark-0.11.3/src/scanners.rs:1495 good_emails
test("good_emails", () => {
  const EMAILS: readonly string[] = [
    "<a@b.c>",
    "<a@b>",
    "<a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-@example.com>",
    "<a@sixty-three-letters-in-this-identifier-----------------------63>",
  ];
  for (const email of EMAILS) {
    expect(scan_email(Str.from(email), 1)).toBeDefined();
  }
});

// crate: pulldown-cmark-0.11.3/src/scanners.rs:1508 bad_emails
test("bad_emails", () => {
  const EMAILS: readonly string[] = [
    "<@b.c>",
    "<foo@-example.com>",
    "<foo@example-.com>",
    "<a@notrailingperiod.>",
    "<a(noparens)@example.com>",
    '<"noquotes"@example.com>',
    "<a@sixty-four-letters-in-this-identifier-------------------------64>",
  ];
  for (const email of EMAILS) {
    expect(scan_email(Str.from(email), 1)).toBeUndefined();
  }
});
