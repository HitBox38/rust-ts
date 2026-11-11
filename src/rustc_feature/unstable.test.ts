// `Features::dump_feature_usage_metrics`'s writer (docs/reviews/driver-cli-2.md N5): upstream serializes with
// `serde_json::to_writer` into a `BufWriter<File>` (8 KiB) and never flushes, so a write error reaches the caller only
// when the JSON outgrows the buffer; the drop's flush ignores it. Not upstream tests.
import { expect, test } from "bun:test";
import { metrics_writer, serde_json_tokens } from "./unstable.ts";

const EIO = Object.assign(new Error("EIO: i/o error, write"), { code: "EIO", errno: -5, syscall: "write" });

/** A `FeatureUsage` whose compact JSON is exactly `len` bytes long (`len` >= 66), with one lib feature. */
function usage_of_len(len: number) {
  const base = { lib_features: [{ timestamp: 1n, symbol: "" }], lang_features: [] };
  const pad = len - serde_json_tokens(base).join("").length;
  return { lib_features: [{ timestamp: 1n, symbol: "x".repeat(pad) }], lang_features: [] };
}

test("serde_json_tokens: serde_json's compact text, one token per write_all", () => {
  const fu = {
    lib_features: [{ timestamp: 1730000000000000000n, symbol: 'a"b\\c\u0001\u001f\u007fé' }],
    lang_features: [
      { timestamp: 2n, symbol: "x\ty", since: undefined },
      { timestamp: 3n, symbol: "z", since: "1.0.0" },
    ],
  };
  const tokens = serde_json_tokens(fu);
  expect(tokens.join("")).toBe(
    '{"lib_features":[{"timestamp":1730000000000000000,"symbol":"a\\"b\\\\c\\u0001\\u001f\u007fé"}],' +
      '"lang_features":[{"timestamp":2,"symbol":"x\\ty","since":null},{"timestamp":3,"symbol":"z","since":"1.0.0"}]}',
  );
  // `format_escaped_str`: `"`, the runs between escapes and each escape are separate writes.
  expect(serde_json_tokens({ lib_features: [{ timestamp: 0n, symbol: 'a"b' }], lang_features: [] }).slice(17, 22)).toEqual(['"', "a", '\\"', "b", '"']);
  // An empty `Vec` is `[` then `]`.
  expect(serde_json_tokens({ lib_features: [], lang_features: [] })).toEqual(["{", '"', "lib_features", '"', ":", "[", "]", ",", '"', "lang_features", '"', ":", "[", "]", "}"]);
});

test("metrics_writer: an error writing JSON of at most 8 KiB is lost in the drop's flush, as upstream", () => {
  for (const len of [66, 8191, 8192]) {
    const fu = usage_of_len(len);
    expect(serde_json_tokens(fu).join("").length).toBe(len);
    let calls = 0;
    const r = metrics_writer(serde_json_tokens(fu), () => {
      calls++;
      throw EIO;
    });
    expect([len, r.$, calls]).toEqual([len, "Ok", 1]);
  }
});

test("metrics_writer: an error while the JSON outgrows the buffer is returned", () => {
  for (const len of [8193, 20000]) {
    const r = metrics_writer(serde_json_tokens(usage_of_len(len)), () => {
      throw EIO;
    });
    expect([len, r.$, r.$ === "Err" ? r._0 : undefined]).toEqual([len, "Err", { $: "Os", errno: 5, code: "EIO" }]);
  }
});

test("metrics_writer: every byte reaches the file, in order, through short writes", () => {
  for (const len of [66, 8192, 8193, 30000]) {
    const tokens = serde_json_tokens(usage_of_len(len));
    let out = "";
    const r = metrics_writer(tokens, (b) => {
      const n = Math.min(b.length, 1000);
      out += new TextDecoder().decode(b.subarray(0, n));
      return n;
    });
    expect(r.$).toBe("Ok");
    expect(out).toBe(tokens.join(""));
  }
});
