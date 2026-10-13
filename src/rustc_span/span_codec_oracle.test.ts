// Round-trip oracle test for rustc_span's SpanEncoder / SpanDecoder / BlobDecoder, the manual and generated
// Encodable / Decodable impls of rustc_span, and hygiene encoding/decoding (lane span-decode).
//
// The `spancodec` rustc-dev probe (tools/probes/spancodec/main.rs) builds expansions and syntax contexts in
// one session, encodes span_codec_oracle/cases.ts's values with a SpanEncoder over the oracle's MemEncoder
// (rmeta's scheme without shorthands) plus HygieneEncodeContext, then decodes them in a fresh session with the
// matching SpanDecoder (hygiene::decode_syntax_context / decode_expn_id) and prints each decoded value and
// debug_hygiene_data(false / true). Its output is committed as span_codec_oracle/expected.json.
// - Always: the port builds the same session, encodes the same bytes / hygiene tables, decodes the fixture's
//   bytes in a fresh session to the same values, SyntaxContext numbering and hygiene dumps.
// - With the probe built: the fixture is current. A visible skip without the probe, a failure under
//   RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { probeBinary } from "../../scripts/probes.ts";
import { debug_hygiene_data, HygieneDecodeContext, HygieneEncodeContext } from "./hygiene.ts";
import { create_session_globals_then } from "./lib.ts";
import { MAGIC_END_BYTES } from "../rustc_serialize/opaque.ts";
import { cases, encode_hygiene, new_decoder, PROBE_NAME, ProbeEncoder, type ProbeOutput, SESSION_A_EDITION, SESSION_B_EDITION } from "./span_codec_oracle/cases.ts";

const PROBE = probeBinary(PROBE_NAME);
const REQUIRE_PROBES = process.env.RUST_TS_REQUIRE_PROBES === "1";
const SKIP = !existsSync(PROBE) && !REQUIRE_PROBES;
if (SKIP) console.log("SKIP: spancodec probe not built (bun scripts/probes.ts build spancodec); RUST_TS_REQUIRE_PROBES=1 makes this a failure");

const EXPECTED = join(import.meta.dir, "span_codec_oracle", "expected.json");
const fixture = (): ProbeOutput => JSON.parse(readFileSync(EXPECTED, "utf8"));

const hex = (b: Uint8Array): string => Buffer.from(b).toString("hex");

test("encode: the port writes the oracle's bytes and hygiene tables", () => {
  const want = fixture();
  const got = create_session_globals_then(SESSION_A_EDITION, [], undefined, () => {
    const cs = cases();
    const e = new ProbeEncoder(HygieneEncodeContext.default());
    const case_ends: [string, number][] = [];
    for (const c of cs) {
      c.encode(e);
      case_ends.push([c.name, e.opaque.position()]);
    }
    const values_end = e.opaque.position();
    const ctxts = new Map<number, number>();
    const expns = new Map<number, [number, number]>();
    encode_hygiene(e, ctxts, expns);
    return {
      hygiene_a_verbose: debug_hygiene_data(true),
      bytes: hex(e.opaque.finish()),
      values_end,
      case_ends,
      ctxts: [...ctxts].sort((a, b) => a[0] - b[0]),
      expns: [...expns].map(([i, [a, b]]) => [i, a, b]).sort((a, b) => a[0]! - b[0]!),
    };
  });
  expect(got.case_ends).toEqual(want.case_ends);
  expect(got.values_end).toBe(want.values_end);
  expect(got.ctxts).toEqual(want.ctxts);
  expect(got.expns).toEqual(want.expns);
  expect(got.bytes).toBe(want.bytes);
  expect(got.hygiene_a_verbose).toBe(want.hygiene_a_verbose);
});

test("decode: the port decodes the oracle's bytes to the same values, contexts and hygiene data", () => {
  const want = fixture();
  const data = Buffer.concat([Buffer.from(want.bytes, "hex"), Buffer.from(MAGIC_END_BYTES)]);
  const decoders = new Map(cases_names().map((c) => [c.name, c.decode]));
  const got = create_session_globals_then(SESSION_B_EDITION, [], undefined, () => {
    const d = new_decoder(new Uint8Array(data), want, HygieneDecodeContext.default());
    const decoded: [string, string][] = [];
    for (const [name, end] of want.case_ends) {
      decoded.push([name, decoders.get(name)!(d)]);
      expect({ name, position: d.position() }).toEqual({ name, position: end });
    }
    expect(d.position()).toBe(want.values_end);
    return { decoded, hygiene: debug_hygiene_data(false), hygiene_verbose: debug_hygiene_data(true) };
  });
  for (let i = 0; i < want.decoded.length; i++) expect(got.decoded[i]).toEqual(want.decoded[i]!);
  expect(got.hygiene).toBe(want.hygiene);
  expect(got.hygiene_verbose).toBe(want.hygiene_verbose);
});

/** The cases' decoders (built in a throwaway session: building the values interns symbols and contexts). */
function cases_names() {
  return create_session_globals_then(SESSION_A_EDITION, [], undefined, () => cases());
}

test.skipIf(SKIP)("live probe: the fixture is current", () => {
  const r = Bun.spawnSync([PROBE], { stdout: "pipe", stderr: "pipe" });
  expect(r.exitCode).toBe(0);
  expect(JSON.parse(r.stdout.toString())).toEqual(fixture());
});
