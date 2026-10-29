// Oracle tests for vendored twox-hash 2.1.2 XXH3-128 (lane vendor-twox-hash), against twox-hash 2.1.2 built
// for the host with rustc_metadata's features (the `xxh3` probe, tools/probes/xxh3; on the host it takes the
// crate's SIMD path, so this also checks that the scalar port computes the same digest):
//   - oneshot of every length 0..=1100 (all the 0 / 1-3 / 4-8 / 9-16 / 17-128 / 129-240 / 241+ paths,
//     every stripe count of the first block) and of lengths around block multiples up to 6 blocks;
//   - `oneshot_with_seed`, `oneshot_with_secret` and `oneshot_with_seed_and_secret` (secrets of 135..256
//     bytes, so too-short errors too) at the boundary lengths;
//   - the streaming `Hasher` (`new`, `with_seed`, `with_seed_and_secret`) under many chunkings, with
//     `finish_128` after every write (finishing must not change the state);
//   - large generated inputs (up to 9 MiB), oneshot and streamed in FileEncoder-sized 64 KiB writes.
// Without the probe the oracle tests are a visible skip; RUST_TS_REQUIRE_PROBES=1 makes that a failure.
import "./lib.ts";
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../../scripts/lib/common.ts";
import { display_OneshotWithSecretError } from "./xxhash3.ts";
import { Hasher } from "./xxhash3_128.ts";

const REQUIRE_PROBES = process.env.RUST_TS_REQUIRE_PROBES === "1";
const PROBE = join(DATA, "target", "probes", "release", process.platform === "win32" ? "xxh3.exe" : "xxh3");
const SKIP = !existsSync(PROBE) && !REQUIRE_PROBES;
if (SKIP) console.log("SKIP: xxh3 probe not built (bun scripts/probes.ts build xxh3); RUST_TS_REQUIRE_PROBES=1 makes this a failure");

const M64 = 0xffff_ffff_ffff_ffffn;

/** The probe's `gen_data`: an xorshift64* byte stream seeded by `k`. */
function gen_data(len: number, k: bigint): Uint8Array {
  let x = ((k * 0x9e37_79b9_7f4a_7c15n) & M64) | 1n;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    x ^= x >> 12n;
    x ^= (x << 25n) & M64;
    x ^= x >> 27n;
    out[i] = Number(((x * 0x2545_f491_4f6c_dd1dn) & M64) >> 56n);
  }
  return out;
}

const hex = (b: Uint8Array) => "x" + Buffer.from(b).toString("hex");
const h32 = (h: bigint) => h.toString(16).padStart(32, "0");

/** The probe's `stream`: write `data` in pieces of the cycled `sizes`; the hashes after every write (or only the last). */
function stream(h: Hasher, sizes: number[], data: Uint8Array, all: boolean): string {
  const out: string[] = [];
  let rest = data;
  let i = 0;
  for (;;) {
    const n = Math.min(sizes[i % sizes.length]!, rest.length);
    h.write(rest.subarray(0, n));
    rest = rest.subarray(n);
    i += 1;
    if (all) out.push(h32(h.finish_128()));
    if (rest.length === 0 && (n !== 0 || i >= sizes.length)) break;
  }
  if (!all) out.push(h32(h.finish_128()));
  return out.join(" ");
}

/** One probe command and the port's answer to it. */
interface Case {
  cmd: string;
  port: () => string;
}

const res = (r: ReturnType<typeof Hasher.oneshot_with_secret>) => (r.$ === "Ok" ? h32(r._0) : `err ${display_OneshotWithSecretError(r._0)}`);

function oneshot(data: Uint8Array): Case {
  return { cmd: `oneshot ${hex(data)}`, port: () => h32(Hasher.oneshot(data)) };
}
function seeded(seed: bigint, data: Uint8Array): Case {
  return { cmd: `seed ${seed} ${hex(data)}`, port: () => h32(Hasher.oneshot_with_seed(seed, data)) };
}
function secret(s: Uint8Array, data: Uint8Array): Case {
  return { cmd: `secret ${hex(s)} ${hex(data)}`, port: () => res(Hasher.oneshot_with_secret(s, data)) };
}
function seedsecret(seed: bigint, s: Uint8Array, data: Uint8Array): Case {
  return { cmd: `seedsecret ${seed} ${hex(s)} ${hex(data)}`, port: () => res(Hasher.oneshot_with_seed_and_secret(seed, s, data)) };
}
type Ctor = { $: "new" } | { $: "seed"; seed: bigint } | { $: "seedsecret"; seed: bigint; secret: Uint8Array };
function streamed(ctor: Ctor, sizes: number[], data: Uint8Array): Case {
  const c = ctor.$ === "new" ? "new" : ctor.$ === "seed" ? `seed=${ctor.seed}` : `seedsecret=${ctor.seed},${hex(ctor.secret)}`;
  return {
    cmd: `stream ${c} ${sizes.join(",")} ${hex(data)}`,
    port: () => {
      let h: Hasher;
      if (ctor.$ === "new") h = Hasher.new();
      else if (ctor.$ === "seed") h = Hasher.with_seed(ctor.seed);
      else {
        const r = Hasher.with_seed_and_secret(ctor.seed, ctor.secret.slice());
        if (r.$ === "Err") return "err secret too short";
        h = r._0;
      }
      return stream(h, sizes, data, true);
    },
  };
}
function generated(len: number, k: number, sizes: number[]): Case {
  return {
    cmd: `gen ${len} ${k} ${sizes.join(",")}`,
    port: () => {
      const data = gen_data(len, BigInt(k));
      return `${h32(Hasher.oneshot(data))} ${stream(Hasher.new(), sizes, data, false)}`;
    },
  };
}

/** Runs the commands through the probe and compares line by line with the port; returns the case count. */
function run(cases: Case[]): number {
  const r = Bun.spawnSync([PROBE], { stdin: Buffer.from(cases.map((c) => c.cmd).join("\n") + "\n"), stdout: "pipe", stderr: "pipe" });
  expect(r.stderr.toString()).toBe("");
  expect(r.exitCode).toBe(0);
  const lines = r.stdout.toString().split("\n");
  expect(lines.length).toBe(cases.length + 1);
  const bad: string[] = [];
  for (let i = 0; i < cases.length; i++) {
    const got = cases[i]!.port();
    if (got !== lines[i]) bad.push(`${cases[i]!.cmd.slice(0, 80)}: port ${got.slice(0, 80)} oracle ${lines[i]!.slice(0, 80)}`);
  }
  expect(bad.slice(0, 5)).toEqual([]);
  return cases.length;
}

const BOUNDARY_LENS = [0, 1, 2, 3, 4, 5, 8, 9, 15, 16, 17, 32, 33, 64, 65, 96, 97, 127, 128, 129, 130, 160, 192, 239, 240, 241, 255, 256, 257, 1023, 1024, 1025, 5000];
const SEEDS = [1n, 0xdead_beefn, 1n << 63n, M64, 0x0123_4567_89ab_cdefn];
const SECRET_LENS = [135, 136, 137, 191, 192, 193, 200, 256];
const CHUNKINGS = [[1], [7], [0, 5], [63, 64, 65], [64], [128], [255, 1], [256], [257], [300], [1000], [4096]];

test.skipIf(SKIP)("oneshot, every length 0..=1100 and around block multiples", () => {
  const cases: Case[] = [];
  for (let len = 0; len <= 1100; len++) cases.push(oneshot(gen_data(len, BigInt(len))));
  for (let k = 1; k <= 6; k++) {
    for (const d of [-65, -64, -63, -1, 0, 1, 63, 64, 65, 960]) cases.push(oneshot(gen_data(1024 * k + d, BigInt(k * 7919 + d))));
  }
  expect(run(cases)).toBe(1101 + 60);
});

test.skipIf(SKIP)("oneshot_with_seed / _with_secret / _with_seed_and_secret", () => {
  const cases: Case[] = [];
  for (const len of BOUNDARY_LENS) {
    const data = gen_data(len, BigInt(len + 1));
    for (const seed of SEEDS) cases.push(seeded(seed, data));
    for (const sl of SECRET_LENS) {
      const s = gen_data(sl, BigInt(sl * 31 + len));
      cases.push(secret(s, data));
      cases.push(seedsecret(SEEDS[sl % SEEDS.length]!, s, data));
    }
  }
  expect(run(cases)).toBe(BOUNDARY_LENS.length * (SEEDS.length + 2 * SECRET_LENS.length));
});

test.skipIf(SKIP)("streaming Hasher under many chunkings, finish_128 after every write", () => {
  const cases: Case[] = [];
  const lens = [0, 1, 3, 16, 17, 128, 129, 240, 241, 255, 256, 257, 300, 511, 512, 513, 1024, 1025, 3000];
  for (const len of lens) {
    const data = gen_data(len, BigInt(len + 99));
    for (const sizes of CHUNKINGS) cases.push(streamed({ $: "new" }, sizes, data));
    cases.push(streamed({ $: "seed", seed: 0xdead_beefn }, [63, 64, 65], data));
    cases.push(streamed({ $: "seed", seed: M64 }, [256], data));
    for (const sl of [135, 136, 192, 251]) cases.push(streamed({ $: "seedsecret", seed: 7n, secret: gen_data(sl, BigInt(sl)) }, [100], data));
  }
  expect(run(cases)).toBe(lens.length * (CHUNKINGS.length + 6));
});

test.skipIf(SKIP)("large inputs: oneshot and 64 KiB writes", () => {
  const cases: Case[] = [];
  for (const [len, k] of [
    [65_536, 1],
    [65_537, 2],
    [100_000, 3],
    [1_000_000, 4],
    [4 * 1024 * 1024 + 17, 5],
    [9 * 1024 * 1024 + 241, 6],
  ] as const) {
    cases.push(generated(len, k, [65_536]));
    cases.push(generated(len, k, [65_535, 1, 4097]));
  }
  expect(run(cases)).toBe(12);
}, 120_000);

// Always runs: pins one large digest of the generated data (from the probe) so the generator itself is checked.
test("pinned: gen_data(10240, 1) digest", () => {
  expect(h32(Hasher.oneshot(gen_data(10240, 1n)))).toBe("046a46644e01e6aba195adda8f81f189");
});
