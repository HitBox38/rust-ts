// Port of the hand-written parts of src/tools/rustfmt/src/config/config_type.rs (lane rustfmt-contract-1): the
// `ConfigType` trait, its impls for the std and config types, and `is_stable_option_and_value`. The `create_config!` macro
// (config_type.rs:67) is expanded by tools/codegen/create_config.ts into create_config.gen.ts (plan-m8 D5).
import type { FileLines } from "./file_lines.ts";
import type { MacroSelectors } from "./macro_names.gen.ts";
import type { IgnoreList, WidthHeuristics } from "./options.gen.ts";
import { type Debug, PLAIN } from "../../std/fmt.ts";
import { write_stderr } from "../../std/io.ts";
import { is_nightly_channel } from "../release_channel.ts";

/// Trait for types that can be used in `Config`.
// PORT: a table per type (PORTING §5 "Traits"); `#[config_type]` enums get theirs generated (`config_type_X`).
export interface ConfigType<T> {
  /// Returns hint text for use in `Config::print_docs()`. For enum types, this is a
  /// pipe-separated list of variants; for other types it returns `<type>`.
  // rustc: src/tools/rustfmt/src/config/config_type.rs:9 doc_hint
  doc_hint(): string;

  /// Return `true` if the variant (i.e. value of this type) is stable.
  ///
  /// By default, return true for all values. Enums annotated with `#[config_type]`
  /// are automatically implemented, based on the `#[unstable_variant]` annotation.
  stable_variant(self: T): boolean; // (provided)
}

/** The provided methods of `ConfigType` (PORTING §8). */
export const ConfigType_provided = {
  // rustc: src/tools/rustfmt/src/config/config_type.rs:15 stable_variant
  stable_variant<T>(_self: T): boolean {
    return true;
  },
};

export const config_type_bool: ConfigType<boolean> = {
  // rustc: src/tools/rustfmt/src/config/config_type.rs:21 doc_hint
  doc_hint(): string {
    return "<boolean>";
  },
  stable_variant: ConfigType_provided.stable_variant,
};

export const config_type_usize: ConfigType<number> = {
  // rustc: src/tools/rustfmt/src/config/config_type.rs:27 doc_hint
  doc_hint(): string {
    return "<unsigned integer>";
  },
  stable_variant: ConfigType_provided.stable_variant,
};

export const config_type_isize: ConfigType<number> = {
  // rustc: src/tools/rustfmt/src/config/config_type.rs:33 doc_hint
  doc_hint(): string {
    return "<signed integer>";
  },
  stable_variant: ConfigType_provided.stable_variant,
};

export const config_type_String: ConfigType<string> = {
  // rustc: src/tools/rustfmt/src/config/config_type.rs:39 doc_hint
  doc_hint(): string {
    return "<string>";
  },
  stable_variant: ConfigType_provided.stable_variant,
};

export const config_type_FileLines: ConfigType<FileLines> = {
  // rustc: src/tools/rustfmt/src/config/config_type.rs:45 doc_hint
  doc_hint(): string {
    return "<json>";
  },
  stable_variant: ConfigType_provided.stable_variant,
};

export const config_type_MacroSelectors: ConfigType<MacroSelectors> = {
  // rustc: src/tools/rustfmt/src/config/config_type.rs:51 doc_hint
  doc_hint(): string {
    return "[<string>, ...]";
  },
  stable_variant: ConfigType_provided.stable_variant,
};

export const config_type_WidthHeuristics: ConfigType<WidthHeuristics> = {
  // rustc: src/tools/rustfmt/src/config/config_type.rs:57 doc_hint
  doc_hint(): string {
    return "";
  },
  stable_variant: ConfigType_provided.stable_variant,
};

export const config_type_IgnoreList: ConfigType<IgnoreList> = {
  // rustc: src/tools/rustfmt/src/config/config_type.rs:63 doc_hint
  doc_hint(): string {
    return "[<string>,..]";
  },
  stable_variant: ConfigType_provided.stable_variant,
};

// PORT: `T: PartialEq + Debug + ConfigType`: the ConfigType and Debug impls are passed (PartialEq is not used).
// rustc: src/tools/rustfmt/src/config/config_type.rs:675 is_stable_option_and_value
export function is_stable_option_and_value<T>(
  option_name: string,
  option_stable: boolean,
  option_value: T,
  config_type_T: ConfigType<T>,
  debug_T: Debug<T>,
): boolean {
  const nightly = is_nightly_channel();
  const variant_stable = config_type_T.stable_variant(option_value);
  // Stable with an unstable option
  if (nightly === false && option_stable === false) {
    write_stderr(
      `Warning: can't set \`${option_name} = ${debug_T(option_value, PLAIN)}\`, unstable features are only available in nightly channel.\n`,
    );
    return false;
  }
  // Stable with a stable option, but an unstable variant
  if (nightly === false && option_stable === true && variant_stable === false) {
    write_stderr(
      `Warning: can't set \`${option_name} = ${debug_T(option_value, PLAIN)}\`, unstable variants are only available in nightly channel.\n`,
    );
    return false;
  }
  // Nightly: everything allowed
  // Stable with stable option and variant: allowed
  // (true, _, _) | (false, true, true)
  return true;
}
