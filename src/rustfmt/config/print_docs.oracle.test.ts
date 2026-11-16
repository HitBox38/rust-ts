// `Config::print_docs` (create_config!, config/config_type.rs:378, generated into create_config.gen.ts) against the pinned
// oracle's `rustfmt --help=config` (bin/main.rs: `Config::print_docs(&mut stdout(), options.unstable_features)`), without and
// with `--unstable-features`. Review codegen-fmt-serde N1 asked for this check of the `create_config!` templates.
import { expect, test } from "bun:test";
import { install_serde_stubs } from "./serde_stubs.test_support.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";

/** The oracle rustfmt's stdout for `args`, or `undefined` when the tool oracle is unavailable. */
async function oracle(args: string[]): Promise<string | undefined> {
  try {
    const O = await import("../../../scripts/lib/oracle.ts");
    O.verifyToolOracles();
    const r = Bun.spawnSync(O.toolOracleCmd("rustfmt", "rustfmt", args), { env: { ...process.env, ...O.toolOracleEnv() } });
    if (r.exitCode !== 0) throw new Error(`ERROR: oracle rustfmt ${args.join(" ")} exited ${r.exitCode}`);
    return r.stdout.toString();
  } catch (e) {
    if (REQUIRE) throw e;
    return undefined;
  }
}

install_serde_stubs();
const { Config } = await import("./mod.ts");
const { is_nightly_channel } = await import("../release_channel.ts");

function print_docs(include_unstable: boolean): string {
  let out = "";
  Config.print_docs({ write_fmt: (text: string) => ((out += text), { $: "Ok", _0: null }) }, include_unstable);
  return out;
}

for (const [name, args, include_unstable] of [
  ["--help=config", ["--help=config"], false],
  ["--unstable-features --help=config", ["--unstable-features", "--help=config"], true],
] as const) {
  test(`print_docs equals the oracle's rustfmt ${name}`, async () => {
    const expected = await oracle([...args]);
    if (expected === undefined) {
      console.log(`SKIP: rustfmt tool oracle unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);
      return;
    }
    expect(print_docs(include_unstable)).toBe(expected);
  });
}

test("the oracle's release channel is nightly, as release_channel.ts's CFG_RELEASE_CHANNEL says", async () => {
  // bin/main.rs refuses `--unstable-features` unless `is_nightly_channel!()` ("Unstable features are only available on Nightly
  // channel."): the oracle accepting it (exit 0) shows its channel is nightly or dev.
  const out = await oracle(["--unstable-features", "--help=config"]);
  if (out === undefined) {
    console.log(`SKIP: rustfmt tool oracle unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);
    return;
  }
  expect(is_nightly_channel()).toBe(true);
});
