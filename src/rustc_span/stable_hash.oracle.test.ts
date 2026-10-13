// rust-ts: rustc_span's stable hashing against the oracle (fixtures from the rustc-dev probe in
// src/rustc_data_structures/stable_hash_probe/main.rs):
//   - stable_crate_id_oracle.json: `StableCrateId::new` for names x crate types x `-C metadata` x
//     version strings (`direct`), and the stable crate id of real rustc sessions (`driver`: the
//     probe runs rustc with `args` and prints `tcx.stable_crate_id(LOCAL_CRATE)`), recomputed here
//     from the crate name, crate type, `-C metadata` values and rust-ts's `CFG_VERSION`.
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { CFG_VERSION } from "../rustc_interface/util.ts";
import { StableCrateId } from "./def_id.ts";
import { create_default_session_globals_then } from "./lib.ts";
import { Symbol } from "./symbol.ts";

interface CrateIdCase {
  name: string;
  is_exe: boolean;
  metadata: string[];
  cfg_version: string;
  id: string;
}
interface DriverCase {
  args: string;
  crate_name: string;
  is_exe: boolean;
  metadata: string[];
  cfg_version: string;
  id: string;
}
const CRATE_IDS: { direct: CrateIdCase[]; driver: DriverCase[] } = JSON.parse(readFileSync(join(import.meta.dir, "stable_crate_id_oracle.json"), "utf8"));

test("StableCrateId::new matches the oracle", () => {
  expect(process.env.RUSTC_FORCE_RUSTC_VERSION).toBeUndefined();
  create_default_session_globals_then(() => {
    expect(CRATE_IDS.direct.length).toBeGreaterThan(100);
    const bad: string[] = [];
    for (const c of CRATE_IDS.direct) {
      const id = StableCrateId.new(Symbol.intern(c.name), c.is_exe, c.metadata, c.cfg_version);
      if (String(StableCrateId.as_u64(id)) !== c.id) bad.push(`${JSON.stringify(c)}: got ${StableCrateId.as_u64(id)}`);
    }
    expect(bad).toEqual([]);
  });
});

test("StableCrateId of real rustc sessions (rust-ts CFG_VERSION)", () => {
  create_default_session_globals_then(() => {
    expect(CRATE_IDS.driver.length).toBeGreaterThan(4);
    for (const c of CRATE_IDS.driver) {
      expect(c.cfg_version).toBe(CFG_VERSION);
      const id = StableCrateId.new(Symbol.intern(c.crate_name), c.is_exe, c.metadata, CFG_VERSION);
      expect([c.args, String(StableCrateId.as_u64(id))]).toEqual([c.args, c.id]);
    }
  });
});
