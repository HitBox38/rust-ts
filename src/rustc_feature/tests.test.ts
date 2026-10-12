// Port of compiler/rustc_feature/src/tests.rs.
import { expect, test } from "bun:test";
import { Ok } from "../std/result.ts";
import { UnstableFeatures } from "./lib.ts";

// rustc: compiler/rustc_feature/src/tests.rs:4 rustc_bootstrap_parsing
test("rustc_bootstrap_parsing", () => {
  const is_bootstrap = (env: string, krate: string | undefined): boolean =>
    UnstableFeatures.from_environment_value(krate, Ok(env)) === UnstableFeatures.Cheat;
  expect(is_bootstrap("1", undefined)).toBe(true);
  expect(is_bootstrap("1", "x")).toBe(true);
  // RUSTC_BOOTSTRAP allows specifying a specific crate
  expect(is_bootstrap("x", "x")).toBe(true);
  // RUSTC_BOOTSTRAP allows multiple comma-delimited crates
  expect(is_bootstrap("x,y,z", "x")).toBe(true);
  expect(is_bootstrap("x,y,z", "y")).toBe(true);
  // Crate that aren't specified do not get unstable features
  expect(is_bootstrap("x", "a")).toBe(false);
  expect(is_bootstrap("x,y,z", "a")).toBe(false);
  expect(is_bootstrap("x,y,z", undefined)).toBe(false);

  // `RUSTC_BOOTSTRAP=0` is not recognized.
  expect(is_bootstrap("0", undefined)).toBe(false);

  // `RUSTC_BOOTSTRAP=-1` is force-stable, no unstable features allowed.
  const is_force_stable = (krate: string | undefined): boolean =>
    UnstableFeatures.from_environment_value(krate, Ok("-1")) === UnstableFeatures.Disallow;
  expect(is_force_stable(undefined)).toBe(true);
  // Does not support specifying any crate.
  expect(is_force_stable("x")).toBe(true);
  expect(is_force_stable("x,y,z")).toBe(true);
});
