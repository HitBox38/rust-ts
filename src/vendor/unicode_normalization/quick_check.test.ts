// Port of the `#[cfg(test)] mod tests` of unicode-normalization =0.1.25 `src/quick_check.rs`.
import { expect, test } from "bun:test";
import { Str } from "../../std/str.ts";
import { is_nfc_stream_safe_quick, is_nfd_stream_safe_quick, IsNormalized } from "./quick_check.ts";

// crate: unicode-normalization-0.1.25/src/quick_check.rs:174 test_stream_safe_nfd
test("test_stream_safe_nfd", () => {
  const okay = "Da\u{031b}\u{0316}\u{0317}\u{0318}\u{0319}\u{031c}\u{031d}\u{0300}\u{0301}\u{0302}\u{0303}\u{0304}\u{0305}\u{0306}\u{0307}\u{0308}\u{0309}\u{030a}\u{030b}\u{030c}\u{030d}\u{030e}\u{030f}\u{0310}\u{0311}\u{0312}\u{0313}\u{0314}\u{0315}\u{031a}ngerzone";
  expect(is_nfd_stream_safe_quick(Str.from(okay).chars())).toBe(IsNormalized.Yes);

  const too_much = "Da\u{031b}\u{0316}\u{0317}\u{0318}\u{0319}\u{031c}\u{031d}\u{031e}\u{0300}\u{0301}\u{0302}\u{0303}\u{0304}\u{0305}\u{0306}\u{0307}\u{0308}\u{0309}\u{030a}\u{030b}\u{030c}\u{030d}\u{030e}\u{030f}\u{0310}\u{0311}\u{0312}\u{0313}\u{0314}\u{0315}\u{031a}ngerzone";
  expect(is_nfd_stream_safe_quick(Str.from(too_much).chars())).toBe(IsNormalized.No);
});

// crate: unicode-normalization-0.1.25/src/quick_check.rs:183 test_stream_safe_nfc
test("test_stream_safe_nfc", () => {
  const okay = "ok\u{e0}\u{031b}\u{0316}\u{0317}\u{0318}\u{0319}\u{031c}\u{031d}\u{0301}\u{0302}\u{0303}\u{0304}\u{0305}\u{0306}\u{0307}\u{0308}\u{0309}\u{030a}\u{030b}\u{030c}\u{030d}\u{030e}\u{030f}\u{0310}\u{0311}\u{0312}\u{0313}\u{0314}\u{0315}\u{031a}y";
  expect(is_nfc_stream_safe_quick(Str.from(okay).chars())).toBe(IsNormalized.Maybe);

  const too_much = "not ok\u{e0}\u{031b}\u{0316}\u{0317}\u{0318}\u{0319}\u{031c}\u{031d}\u{031e}\u{0301}\u{0302}\u{0303}\u{0304}\u{0305}\u{0306}\u{0307}\u{0308}\u{0309}\u{030a}\u{030b}\u{030c}\u{030d}\u{030e}\u{030f}\u{0310}\u{0311}\u{0312}\u{0313}\u{0314}\u{0315}\u{031a}y";
  expect(is_nfc_stream_safe_quick(Str.from(too_much).chars())).toBe(IsNormalized.No);
});
