// Port of the `#[cfg(test)] mod test` of src/tools/rustfmt/src/config/mod.rs:550 (lane rustfmt-contract-1): the tests that
// need neither TOML parsing (vendor-toml), semver nor the test-only `mod mock` `create_config!` expansion. The others are listed
// in docs/handoff/rustfmt-contract-1.md for the lanes that bring those pieces.
import { expect, test } from "bun:test";
import { Unported } from "../../std/panic.ts";
import { install_serde_stubs } from "./serde_stubs.test_support.ts";

install_serde_stubs();
const { Config, PartialConfig, USIZE_MAX, default_Config } = await import("./mod.ts");

// rustc: src/tools/rustfmt/src/config/mod.rs:693 test_config_set
test("test_config_set", () => {
  const config = default_Config();
  config.set().verbose("Quiet");
  expect(config.verbose()).toBe("Quiet");
  config.set().verbose("Normal");
  expect(config.verbose()).toBe("Normal");
});

// rustc: src/tools/rustfmt/src/config/mod.rs:702 test_adjust_max_width
test("test_adjust_max_width", () => {
  // Regression tests for #7147, where we didn't handle overflows / integral cast outside of
  // range properly.

  // Reduce with huge amount saturates to zero instead of wraparound.
  let config = default_Config();
  config.reduce_max_width(USIZE_MAX);
  expect(config.max_width()).toBe(0);

  // Increase with huge amount saturates instead of wraparound.
  config = default_Config();
  config.set().max_width(USIZE_MAX - 1);
  // PORT: a width past 2^53 is not representable (create_config.gen.ts `usize_saturating_add_signed`): the port stops there.
  expect(() => config.increase_max_width(2)).toThrow(Unported);
});

// rustc: src/tools/rustfmt/src/config/mod.rs:719 test_config_used_to_toml
test("test_config_used_to_toml", () => {
  const config = default_Config();

  const merge_derives = config.merge_derives();
  const skip_children = config.skip_children();
  expect([merge_derives, skip_children]).toEqual([true, false]);

  const used_options = config.used_options();
  // PORT: `to_toml` serializes with `toml` (vendor-toml, wave 42): the port stops there.
  expect(() => PartialConfig.to_toml(used_options)).toThrow(Unported);
});

// rustc: src/tools/rustfmt/src/config/mod.rs:962 test_editions_2015_2018_2021_identical
test("test_editions_2015_2018_2021_identical", () => {
  // PORT: `to_toml` needs vendor-toml (see test_config_used_to_toml).
  const get_edition_toml = (style_edition: "Edition2015" | "Edition2018" | "Edition2021") =>
    PartialConfig.to_toml(Config.default_with_style_edition(style_edition).all_options());
  expect(() => get_edition_toml("Edition2015")).toThrow(Unported);
});

// #[stable_only_test]: compiled out on the nightly channel (release_channel.ts), which the oracle is.
// rustc-skip: src/tools/rustfmt/src/config/mod.rs:978 test_as_not_nightly_channel stable_only_test: not compiled on the nightly channel

// #[nightly_only_test]
// rustc: src/tools/rustfmt/src/config/mod.rs:987 test_as_nightly_channel
test("test_as_nightly_channel", () => {
  const config = default_Config();
  config.set().unstable_features(true);
  // When we don't set the config from toml or command line options it
  // doesn't get marked as set by the user.
  expect(config.was_set().unstable_features()).toBe(false);
  config.set().unstable_features(true);
  expect(config.unstable_features()).toBe(true);
});

// rustc: src/tools/rustfmt/src/config/mod.rs:1007 test_set_cli
test("test_set_cli", () => {
  const config = default_Config();
  expect(config.was_set().edition()).toBe(false);
  expect(config.was_set_cli().edition()).toBe(false);
  config.set().edition("Edition2021");
  expect(config.was_set().edition()).toBe(false);
  expect(config.was_set_cli().edition()).toBe(false);
  config.set_cli().edition("Edition2021");
  expect(config.was_set().edition()).toBe(false);
  expect(config.was_set_cli().edition()).toBe(true);
  expect(config.was_set_cli().emit_mode()).toBe(false);
});

test("not upstream: Config::default_for_possible_style_edition (mod.rs:282), version_meets_requirement (mod.rs:306)", () => {
  expect(Config.default_for_possible_style_edition(undefined, undefined, "Two").style_edition()).toBe("Edition2024");
  // `style_edition`'s own default is `Edition2024 => Edition2024, _ => Edition2015` (options.rs, StyleEditionConfig)
  expect(Config.default_for_possible_style_edition(undefined, "Edition2024", undefined).style_edition()).toBe("Edition2024");
  expect(Config.default_for_possible_style_edition(undefined, "Edition2021", undefined).style_edition()).toBe("Edition2015");
  expect(Config.default_for_possible_style_edition("Edition2024", "Edition2015", "One").style_edition()).toBe("Edition2024");
  expect(Config.default_for_possible_style_edition(undefined, "Edition2024", "One").style_edition()).toBe("Edition2015");
  expect(Config.default_for_possible_style_edition(undefined, undefined, undefined).style_edition()).toBe("Edition2015");
  // `required_version` not set: no semver check
  expect(default_Config().version_meets_requirement()).toBe(true);
  // a config file's TOML stops at vendor-toml
  expect(() => Config.from_toml("hard_tabs = true", "./rustfmt.toml")).toThrow(Unported);
});
