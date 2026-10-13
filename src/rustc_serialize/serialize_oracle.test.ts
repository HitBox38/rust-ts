// Round-trip oracle test for rustc_serialize and the generated derive(Decodable)/(Encodable) impls (lane
// serialize): the `serialize` rustc-dev probe (tools/probes/serialize/main.rs) encodes the values of
// serialize_oracle/cases.ts with the oracle's own MemEncoder and FileEncoder.
// - The committed fixture (serialize_oracle/expected.txt: sha256 + length of the probe's bytes per case)
//   is always checked: the port's MemEncoder bytes of the case's values hash to the oracle's, decoding
//   them gives the values back, and the port's FileEncoder writes the same bytes plus MAGIC_END_BYTES.
// - With the probe built, the oracle's bytes themselves are decoded by the port (every value; the data must end
//   there), compared with the case's values, re-encoded with the port's MemEncoder and
//   FileEncoder and compared byte for byte; the fixture must be current. A visible skip without the
//   probe, a failure under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { probeBinary } from "../../scripts/probes.ts";
import { test_scratch_dir } from "../rust_ts/test_scratch.ts";
import { unwrap_result } from "../std/result.ts";
import { MAGIC_END_BYTES, MemDecoder } from "./opaque.ts";
import { type Case, CASES, EXPECTED, file_encode, fixture_line, mem_encode, PROBE_NAME, type ProbeCase, run_probe, sha256 } from "./serialize_oracle/cases.ts";

const PROBE = probeBinary(PROBE_NAME);
const REQUIRE_PROBES = process.env.RUST_TS_REQUIRE_PROBES === "1";
const SKIP = !existsSync(PROBE) && !REQUIRE_PROBES;
if (SKIP) console.log("SKIP: serialize probe not built (bun scripts/probes.ts build serialize); RUST_TS_REQUIRE_PROBES=1 makes this a failure");

const SCRATCH = test_scratch_dir("serialize-oracle");

const with_magic = (b: Uint8Array): Uint8Array => {
  const out = new Uint8Array(b.length + MAGIC_END_BYTES.length);
  out.set(b);
  out.set(MAGIC_END_BYTES, b.length);
  return out;
};

/** Decode the case's number of values from `bytes` (the MemEncoder output); the data must end there. */
function decode_all(cs: Case, bytes: Uint8Array): unknown[] {
  const d = unwrap_result(MemDecoder.new(with_magic(bytes), 0));
  const out: unknown[] = [];
  for (let i = 0; i < cs.values.length; i++) out.push(cs.decode(d));
  expect({ case: cs.name, position: d.position() }).toEqual({ case: cs.name, position: d.len() });
  return out;
}

const fixture = (): Map<string, string> =>
  new Map(
    readFileSync(EXPECTED, "utf8")
      .split("\n")
      .filter((l) => l.length > 0 && !l.startsWith("#"))
      .map((l) => [l.split(" ")[0]!, l]),
  );

test("fixture: the port encodes every case to the oracle's bytes, and decodes them back", () => {
  const want = fixture();
  expect([...want.keys()]).toEqual(CASES.map((c) => c.name));
  for (const cs of CASES) {
    const mem = mem_encode(cs);
    const file = file_encode(cs, SCRATCH);
    const line = fixture_line(cs.name, { mem, file: Buffer.compare(file, with_magic(mem)) === 0 ? undefined : file });
    expect(`${line}`).toBe(want.get(cs.name)!);
    expect({ case: cs.name, values: decode_all(cs, mem) }).toEqual({ case: cs.name, values: cs.values });
  }
});

let probed: Map<string, ProbeCase> | undefined;
const probe = (): Map<string, ProbeCase> => (probed ??= run_probe(PROBE, join(SCRATCH, "probe")));

test.skipIf(SKIP)("live probe: the port decodes the oracle's bytes and re-encodes them byte for byte", () => {
  const got = probe();
  expect([...got.keys()]).toEqual(CASES.map((c) => c.name));
  for (const cs of CASES) {
    const p = got.get(cs.name)!;
    // decode the oracle's bytes
    const values = decode_all(cs, p.mem);
    expect({ case: cs.name, values }).toEqual({ case: cs.name, values: cs.values });
    // re-encode the decoded values
    const re: Case = { ...cs, values };
    expect({ case: cs.name, mem: sha256(mem_encode(re)) }).toEqual({ case: cs.name, mem: sha256(p.mem) });
    const file = file_encode(re, SCRATCH);
    expect({ case: cs.name, file: sha256(file) }).toEqual({ case: cs.name, file: sha256(p.file ?? with_magic(p.mem)) });
  }
});

test.skipIf(SKIP)("live probe: the fixture is current", () => {
  const got = probe();
  const want = fixture();
  for (const cs of CASES) expect(fixture_line(cs.name, got.get(cs.name)!)).toBe(want.get(cs.name)!);
});
