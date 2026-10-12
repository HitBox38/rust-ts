// rust-ts: intl_pluralrules + unic-langid against the oracle (the `plurals` probe, built from
// intl_pluralrules =7.0.2 / unic-langid =0.9.6 with `likelysubtags`). Every probe line is rebuilt
// from the TS port and compared: plural operands, the category of every input for every locale in
// PRS_CARDINAL / PRS_ORDINAL, and LanguageIdentifier parse / Display / Debug / canonicalize /
// maximize / minimize / character_direction / PluralRules::create / matches / Ord.
// Skips if the probe isn't built (bun scripts/probes.ts build plurals).
//
// f64 operands: `TryFrom<f64>` is `try_from(&f64.to_string())`; `<f64 as Display>` belongs to
// src/std (not part of these crates), so the test feeds the probe's own `to_string` to
// `PluralOperands.try_from_convert`, checking everything after the formatting. If src/std/fmt.ts
// exports `display_f64`, it is also checked against the probe's `to_string` of every f64 input.
import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { DATA } from "../../../scripts/lib/common.ts";
import * as std_fmt from "../../std/fmt.ts";
import { debug_str, PLAIN } from "../../std/fmt.ts";
import { debug_result, Ok, type Result } from "../../std/result.ts";
import {
  canonicalize,
  debug_LanguageIdentifier,
  debug_LanguageIdentifierError,
  display_LanguageIdentifier,
  display_LanguageIdentifierError,
  FEATURES,
  LanguageIdentifier,
  likelysubtags,
} from "../unic_langid/lib.ts";
import { CLDR_VERSION, type PluralCategory, PluralRules, PluralRuleType } from "./lib.ts";
import { debug_PluralOperands, PluralOperands } from "./operands.ts";

const PROBE = join(DATA, "target", "probes", "release", "plurals" + (process.platform === "win32" ? ".exe" : ""));

type Input = { kind: "u64" | "i64"; v: bigint } | { kind: "f64"; v: number; s: string } | { kind: "str"; v: string };

function unhex(h: string): Uint8Array {
  const b = new Uint8Array(h.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(h.slice(2 * i, 2 * i + 2), 16);
  return b;
}

function f64_from_bits(h: string): number {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setBigUint64(0, BigInt("0x" + h));
  return dv.getFloat64(0);
}

function operands(i: Input): Result<PluralOperands, string> {
  switch (i.kind) {
    case "u64":
      return Ok(PluralOperands.from_unsigned(i.v));
    case "i64":
      return PluralOperands.try_from_signed(i.v);
    case "f64":
      return PluralOperands.try_from_convert(i.v, () => i.s);
    case "str":
      return PluralOperands.try_from_str(i.v);
  }
}

const CAT_CHAR: Record<PluralCategory, string> = { ZERO: "Z", ONE: "O", TWO: "T", FEW: "F", MANY: "M", OTHER: "X" };

test("plural rules and language identifiers match the oracle", () => {
  if (!existsSync(PROBE)) {
    console.log("SKIP: plurals probe not built (bun scripts/probes.ts build plurals)");
    return;
  }
  const r = Bun.spawnSync([PROBE], { stdout: "pipe" });
  expect(r.exitCode).toBe(0);
  const want = r.stdout.toString().split("\n");
  if (want[want.length - 1] === "") want.pop();

  const inputs: Input[] = [];
  const tags: Uint8Array[] = [];
  for (const line of want) {
    const f = line.split("\t");
    if (f[0] === "I") {
      const kind = f[2]!;
      if (kind === "u64" || kind === "i64") inputs.push({ kind, v: BigInt(f[3]!) });
      else if (kind === "f64") inputs.push({ kind, v: f64_from_bits(f[3]!), s: f[4]! });
      else if (kind === "str") inputs.push({ kind: "str", v: new TextDecoder().decode(unhex(f[3]!)) });
      else throw new Error(`bad input kind ${kind}`);
    } else if (f[0] === "T") {
      tags.push(unhex(f[1]!));
    }
  }

  const display_f64 = (std_fmt as Record<string, unknown>)["display_f64"] as ((v: number) => string) | undefined;
  if (display_f64 !== undefined) {
    const bad_f64 = inputs.flatMap((i) => (i.kind === "f64" && display_f64(i.v) !== i.s ? [`${i.v}: ${display_f64(i.v)} vs ${i.s}`] : []));
    expect(bad_f64).toEqual([]);
  } else {
    console.log("NOTE: src/std/fmt.ts has no display_f64; f64 operands use the probe's to_string");
  }

  const got: string[] = [];
  got.push(`V\t${CLDR_VERSION}\t${likelysubtags.CLDR_VERSION}`);
  inputs.forEach((i, idx) => {
    switch (i.kind) {
      case "u64":
      case "i64":
        got.push(`I\t${idx}\t${i.kind}\t${i.v}`);
        break;
      case "f64": {
        const dv = new DataView(new ArrayBuffer(8));
        dv.setFloat64(0, i.v);
        got.push(`I\t${idx}\tf64\t${dv.getBigUint64(0).toString(16).padStart(16, "0")}\t${i.s}`);
        break;
      }
      case "str":
        got.push(`I\t${idx}\tstr\t${Buffer.from(i.v, "utf8").toString("hex")}`);
        break;
    }
  });
  inputs.forEach((i, idx) => got.push(`P\t${idx}\t${debug_result(operands(i), PLAIN, debug_PluralOperands, (e) => debug_str(e))}`));

  for (const [tag, prt] of [
    ["C", PluralRuleType.CARDINAL],
    ["O", PluralRuleType.ORDINAL],
  ] as const) {
    for (const l of PluralRules.get_locales(prt)) {
      const pr = PluralRules.create(l.clone(), prt);
      if (pr.$ === "Err") throw new Error("create failed for a listed locale");
      let chars = "";
      for (const i of inputs) {
        const c = pr._0.select(i, operands);
        chars += c.$ === "Ok" ? CAT_CHAR[c._0] : "E";
      }
      got.push(`R\t${tag}\t${display_LanguageIdentifier(l)}\t${debug_LanguageIdentifier(l, PLAIN)}\t${chars}`);
    }
  }

  const saved = FEATURES.likelysubtags;
  FEATURES.likelysubtags = true; // the probe is built with the feature
  const parsed: LanguageIdentifier[] = [];
  try {
    for (const t of tags) {
      const h = Buffer.from(t).toString("hex");
      const p = LanguageIdentifier.from_bytes(t);
      if (p.$ === "Ok") {
        const l = p._0;
        const c = canonicalize(t);
        const canon = c.$ === "Ok" ? `Ok(${c._0})` : `Err(${debug_LanguageIdentifierError(c._0, PLAIN)})`;
        const mx = l.clone();
        const mxb = mx.maximize();
        const mn = l.clone();
        const mnb = mn.minimize();
        const create = (prt: PluralRuleType) => {
          const pr = PluralRules.create(l.clone(), prt);
          return pr.$ === "Ok" ? `Ok(${display_LanguageIdentifier(pr._0.get_locale())})` : `Err(${pr._0})`;
        };
        got.push(
          `T\t${h}\tOk\t${display_LanguageIdentifier(l)}\t${debug_LanguageIdentifier(l, PLAIN)}\t${canon}\t` +
            `${mxb}:${display_LanguageIdentifier(mx)}\t${mnb}:${display_LanguageIdentifier(mn)}\t${l.character_direction()}\t` +
            `${create(PluralRuleType.CARDINAL)}\t${create(PluralRuleType.ORDINAL)}`,
        );
        parsed.push(l);
      } else {
        got.push(`T\t${h}\tErr\t${debug_LanguageIdentifierError(p._0, PLAIN)}\t${display_LanguageIdentifierError(p._0)}`);
      }
    }
  } finally {
    FEATURES.likelysubtags = saved;
  }

  const first = parsed.slice(0, 16);
  first.forEach((a, i) =>
    first.forEach((b, j) => {
      const bits = (
        [
          [false, false],
          [false, true],
          [true, false],
          [true, true],
        ] as const
      )
        .map(([x, y]) => (a.matches(b, x, y) ? "1" : "0"))
        .join("");
      got.push(`M\t${i}\t${j}\t${bits}`);
    }),
  );

  const sorted = parsed.slice().sort((a, b) => a.cmp(b));
  for (const l of sorted) got.push(`S\t${display_LanguageIdentifier(l)}`);

  const bad: string[] = [];
  for (let k = 0; k < Math.max(want.length, got.length) && bad.length < 8; k++) {
    if (want[k] !== got[k]) bad.push(`line ${k + 1}:\n  oracle: ${want[k]?.slice(0, 300)}\n  port:   ${got[k]?.slice(0, 300)}`);
  }
  expect(bad).toEqual([]);
  expect(got.length).toBe(want.length);
  // Coverage of the comparison itself.
  expect(inputs.length).toBeGreaterThan(700);
  expect(want.filter((l) => l.startsWith("R\t")).length).toBe(PluralRules.get_locales("CARDINAL").length + PluralRules.get_locales("ORDINAL").length);
});
