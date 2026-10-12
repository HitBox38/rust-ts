// Port of the `#[cfg(test)] mod tests` of unicode-normalization =0.1.25 `src/stream_safe.rs`.
import { expect, test } from "bun:test";
import { from_u32 } from "../../std/char.ts";
import { Str } from "../../std/str.ts";
import { canonical_combining_class } from "./lookups.ts";
import { decompose_compatible } from "./normalize.ts";
import { classify_nonstarters, StreamSafe } from "./stream_safe.ts";

// crate: unicode-normalization-0.1.25/src/stream_safe.rs:125 stream_safe
function stream_safe(s: string): string {
  let out = "";
  const it = StreamSafe.new(Str.from(s).chars());
  for (let c = it.next(); c !== undefined; c = it.next()) out += String.fromCodePoint(c);
  return out;
}

// crate: unicode-normalization-0.1.25/src/stream_safe.rs:130 test_simple
test("test_simple", () => {
  const technically_okay = "Da\u{0300}\u{0301}\u{0302}\u{0303}\u{0304}\u{0305}\u{0306}\u{0307}\u{0308}\u{0309}\u{030a}\u{030b}\u{030c}\u{030d}\u{030e}\u{030f}\u{0310}\u{0311}\u{0312}\u{0313}\u{0314}\u{0315}\u{0316}\u{0317}\u{0318}\u{0319}\u{031a}\u{031b}\u{031c}\u{031d}ngerzone";
  expect(stream_safe(technically_okay)).toBe(technically_okay);

  const too_much = "Da\u{0300}\u{0301}\u{0302}\u{0303}\u{0304}\u{0305}\u{0306}\u{0307}\u{0308}\u{0309}\u{030a}\u{030b}\u{030c}\u{030d}\u{030e}\u{030f}\u{0310}\u{0311}\u{0312}\u{0313}\u{0314}\u{0315}\u{0316}\u{0317}\u{0318}\u{0319}\u{031a}\u{031b}\u{031c}\u{031d}\u{032e}ngerzone";
  const fixed_it = "Da\u{0300}\u{0301}\u{0302}\u{0303}\u{0304}\u{0305}\u{0306}\u{0307}\u{0308}\u{0309}\u{030a}\u{030b}\u{030c}\u{030d}\u{030e}\u{030f}\u{0310}\u{0311}\u{0312}\u{0313}\u{0314}\u{0315}\u{0316}\u{0317}\u{0318}\u{0319}\u{031a}\u{031b}\u{031c}\u{031d}\u{034f}\u{032e}ngerzone";
  expect(stream_safe(too_much)).toBe(fixed_it);

  const woah_nelly = "Da\u{0300}\u{0301}\u{0302}\u{0303}\u{0304}\u{0305}\u{0306}\u{0307}\u{0308}\u{0309}\u{030a}\u{030b}\u{030c}\u{030d}\u{030e}\u{030f}\u{0310}\u{0311}\u{0312}\u{0313}\u{0314}\u{0315}\u{0316}\u{0317}\u{0318}\u{0319}\u{031a}\u{031b}\u{031c}\u{031d}\u{032e}\u{0300}\u{0301}\u{0302}\u{0303}\u{0304}\u{0305}\u{0306}\u{0307}\u{0308}\u{0309}\u{030a}\u{030b}\u{030c}\u{030d}\u{030e}\u{030f}\u{0310}\u{0311}\u{0312}\u{0313}\u{0314}\u{0315}\u{0316}\u{0317}\u{0318}\u{0319}\u{031a}\u{031b}\u{031c}\u{031d}\u{032e}ngerzone";
  const its_cool = "Da\u{0300}\u{0301}\u{0302}\u{0303}\u{0304}\u{0305}\u{0306}\u{0307}\u{0308}\u{0309}\u{030a}\u{030b}\u{030c}\u{030d}\u{030e}\u{030f}\u{0310}\u{0311}\u{0312}\u{0313}\u{0314}\u{0315}\u{0316}\u{0317}\u{0318}\u{0319}\u{031a}\u{031b}\u{031c}\u{031d}\u{034f}\u{032e}\u{0300}\u{0301}\u{0302}\u{0303}\u{0304}\u{0305}\u{0306}\u{0307}\u{0308}\u{0309}\u{030a}\u{030b}\u{030c}\u{030d}\u{030e}\u{030f}\u{0310}\u{0311}\u{0312}\u{0313}\u{0314}\u{0315}\u{0316}\u{0317}\u{0318}\u{0319}\u{031a}\u{031b}\u{031c}\u{034f}\u{031d}\u{032e}ngerzone";
  expect(stream_safe(woah_nelly)).toBe(its_cool);
});

// crate: unicode-normalization-0.1.25/src/stream_safe.rs:144 test_all_nonstarters
test("test_all_nonstarters", () => {
  const s = "\u{0300}\u{0300}\u{0300}\u{0300}\u{0300}\u{0300}\u{0300}\u{0300}\u{0300}\u{0300}\u{0300}\u{0300}\u{0300}\u{0300}\u{0300}\u{0300}\u{0300}\u{0300}\u{0300}\u{0300}\u{0300}\u{0300}\u{0300}\u{0300}\u{0300}\u{0300}\u{0300}\u{0300}\u{0300}\u{0300}\u{0300}\u{0300}\u{0300}\u{0300}\u{0300}\u{0300}\u{0300}\u{0300}\u{0300}\u{0300}";
  const expected = "\u{300}\u{300}\u{300}\u{300}\u{300}\u{300}\u{300}\u{300}\u{300}\u{300}\u{300}\u{300}\u{300}\u{300}\u{300}\u{300}\u{300}\u{300}\u{300}\u{300}\u{300}\u{300}\u{300}\u{300}\u{300}\u{300}\u{300}\u{300}\u{300}\u{300}\u{034F}\u{300}\u{300}\u{300}\u{300}\u{300}\u{300}\u{300}\u{300}\u{300}\u{300}";
  expect(stream_safe(s)).toBe(expected);
});

// crate: unicode-normalization-0.1.25/src/stream_safe.rs:151 test_classify_nonstarters
test("test_classify_nonstarters", () => {
  // Highest character in the `compat_fully_decomp` table is 2FA1D
  for (let ch = 0; ch < 0x2fa1e; ch++) {
    if (from_u32(ch) === undefined) continue;
    const c = classify_nonstarters(ch);
    const s: number[] = [];
    decompose_compatible(ch, (c) => s.push(c));

    expect(s.length).toBe(c.decomposition_len);

    let num_leading = 0;
    while (num_leading < s.length && canonical_combining_class(s[num_leading]!) !== 0) num_leading++;
    let num_trailing = 0;
    while (num_trailing < s.length && canonical_combining_class(s[s.length - 1 - num_trailing]!) !== 0) num_trailing++;

    expect(num_leading).toBe(c.leading_nonstarters);
    expect(num_trailing).toBe(c.trailing_nonstarters);
  }
});
