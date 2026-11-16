// Port of the hand-written parts of src/tools/rustfmt/src/config/mod.rs (lane rustfmt-contract-1).
// `create_config!` at mod.rs:33 (`Config`, `PartialConfig`, the setters and `was_set` views) is expanded by
// tools/codegen/create_config.ts into create_config.gen.ts (plan-m8 D5); the `impl PartialConfig` / `impl Config` blocks of
// mod.rs are added here (`PartialConfig` is a data-only interface, so its fns sit on a companion const; `Config`'s through
// `declare module` + `Object.assign` / prototype). The `#[cfg(test)] mod test` is config/mod.test.ts.
//
// External crates not ported yet stop with `unported("vendor-…: ...")` at the call (`toml`: vendor-toml, wave 42;
// `semver`: plan-m8 D7; `dirs`: D7, through src/std). Their surface is typed locally (`TomlValue`, `SemverVersionReq`, ...)
// as the planned paths will provide it.
// The hand modules are evaluated before the generated ones that import them back (macro_names.gen.ts imports
// `deserialize_MacroSelector` from macro_names.ts, which augments macro_names.gen.ts's classes at load): entered first, each hand
// module lets its .gen.ts finish before its own body runs. Import the config through this module, not a .gen.ts.
import "./file_lines.ts";
import "./macro_names.ts";
import "./options.ts";
import "./lists.ts";
import { closeSync, openSync, readFileSync } from "node:fs";
import * as gen from "./create_config.gen.ts";
import { Config, default_Config } from "./create_config.gen.ts";
import type { CliOptions, Edition, StyleEdition, Version } from "./options.ts";
import { Edition as Edition_ } from "./options.ts";
import { type Debug, debug_str, debug_tuple } from "../../std/fmt.ts";
import { current_dir_str } from "../../std/env.ts";
import { canonicalize, metadata } from "../../std/fs.ts";
import { type ErrorKind, type IoError, type IoResult, INVALID_UTF8, IoError_kind, io_error_from_node, write_stderr } from "../../std/io.ts";
import { path_is_absolute, path_join, path_parent } from "../../std/path.ts";
import { unported } from "../../std/panic.ts";
import { Err, Ok, type Result } from "../../std/result.ts";

export { is_stable_option_and_value, type ConfigType } from "./config_type.ts";
export { FileLines, FileName, Range } from "./file_lines.ts";
export { MacroSelector } from "./macro_names.ts";
export * from "./options.ts";
export * from "./create_config.gen.ts";

// This macro defines configuration options used in rustfmt. Each option
// is defined as follows:
//
// `name: value type, is stable, description;`
// create_config! { .. } (mod.rs:33): create_config.gen.ts

// ---- toml (vendor-toml, wave 42) -----------------------------------------------------------------------------------

/** `toml::ser::Error` */
export type TomlSerError = { readonly __toml_ser_Error: never };
/** `toml::de::Error` */
export type TomlDeError = { readonly __toml_de_Error: never };
/** `toml::Value`, as far as `from_toml_for_style_edition` uses it. */
interface TomlValue {
  as_table(): { keys(): Iterable<string> } | undefined;
  try_into_PartialConfig(): Result<gen.PartialConfig, TomlDeError>;
}
/** `toml::to_string(&PartialConfig)` */
function toml_to_string(_v: gen.PartialConfig): Result<string, TomlSerError> {
  return unported("vendor-toml: toml::to_string (PartialConfig::to_toml)");
}
/** `toml::from_str::<toml::Value>` */
function toml_from_str_Value(_s: string): Result<TomlValue, TomlDeError> {
  return unported("vendor-toml: toml::from_str (Config::from_toml_for_style_edition)");
}
/** `<toml::de::Error as Display>::fmt` */
function display_TomlDeError(_e: TomlDeError): string {
  return unported("vendor-toml: Display for toml::de::Error");
}

/** `#[derive(Error, Debug)] #[error("Could not output config: {0}")] pub struct ToTomlError(toml::ser::Error);` */
export class ToTomlError {
  constructor(public _0: TomlSerError) {}
}
export const debug_ToTomlError: Debug<ToTomlError> = (_v, f) =>
  debug_tuple(f, "ToTomlError", [unported("vendor-toml: Debug for toml::ser::Error")]);
export function display_ToTomlError(_v: ToTomlError): string {
  return unported("vendor-toml: Display for toml::ser::Error");
}

// ---- semver (plan-m8 D7) -----------------------------------------------------------------------------------------

/** `semver::Op` (only the variants mod.rs names). */
type SemverOp = "Exact" | "Greater" | "GreaterEq" | "Less" | "LessEq" | "Tilde" | "Caret" | "Wildcard";
/** `semver::Comparator` */
interface SemverComparator {
  op: SemverOp;
}
/** `semver::VersionReq` */
interface SemverVersionReq {
  comparators: SemverComparator[];
  matches(version: SemverVersion): boolean;
}
/** `semver::Version` */
type SemverVersion = { readonly __semver_Version: never };
/** `semver::Error` */
type SemverError = { readonly __semver_Error: never };
function semver_VersionReq_parse(_text: string): Result<SemverVersionReq, SemverError> {
  return unported("vendor-semver: semver::VersionReq::parse (check_semver_version)");
}
function semver_Version_parse(_text: string): Result<SemverVersion, SemverError> {
  return unported("vendor-semver: semver::Version::parse (check_semver_version)");
}
function display_SemverError(_e: SemverError): string {
  return unported("vendor-semver: Display for semver::Error");
}

// ---- impl PartialConfig ------------------------------------------------------------------------------------------

export type PartialConfig = gen.PartialConfig;
export const PartialConfig = {
  // rustc: src/tools/rustfmt/src/config/mod.rs:214 to_toml
  to_toml(self: PartialConfig): Result<string, ToTomlError> {
    // Non-user-facing options can't be specified in TOML
    const cloned = gen.clone_PartialConfig(self);
    cloned.file_lines = undefined;
    cloned.verbose = undefined;
    cloned.width_heuristics = undefined;
    cloned.print_misformatted_file_names = undefined;
    cloned.merge_imports = undefined;
    cloned.fn_args_layout = undefined;
    cloned.hide_parse_errors = undefined;

    const r = toml_to_string(cloned);
    return r.$ === "Ok" ? r : Err(new ToTomlError(r._0));
  },

  // rustc: src/tools/rustfmt/src/config/mod.rs:228 to_parsed_config
  to_parsed_config(
    self: PartialConfig,
    style_edition_override: StyleEdition | undefined,
    edition_override: Edition | undefined,
    version_override: Version | undefined,
    dir: string,
  ): Config {
    return Config.default_for_possible_style_edition(
      style_edition_override ?? self.style_edition,
      edition_override ?? self.edition,
      version_override ?? self.version,
    ).fill_from_parsed_config(self, dir);
  },
};

// rustc: src/tools/rustfmt/src/config/mod.rs:244 check_semver_version
function check_semver_version(range_requirement: string, actual: string): boolean {
  const req_r = semver_VersionReq_parse(range_requirement);
  if (req_r.$ === "Err") {
    write_stderr(`Error: failed to parse required version ${debug_str(range_requirement)}: ${display_SemverError(req_r._0)}\n`);
    return false;
  }
  const version_req = req_r._0;
  const ver_r = semver_Version_parse(actual);
  if (ver_r.$ === "Err") {
    write_stderr(`Error: failed to parse current version ${debug_str(actual)}: ${display_SemverError(ver_r._0)}\n`);
    return false;
  }
  const actual_version = ver_r._0;

  range_requirement.split(",").forEach((label, i) => {
    // the label refers to the current comparator
    const comparator = version_req.comparators[i];
    if (comparator === undefined) {
      return;
    }

    // semver crate handles "1.0.0" as "^1.0.0", and we want to treat it as "=1.0.0"
    // because of this, we need to iterate over the comparators, and change each one
    // that has "default caret operator" to an exact operator
    // this condition overrides the "default caret operator" of semver create.
    if (!label.startsWith("^") && comparator.op === "Caret") {
      comparator.op = "Exact";
    }
  });

  return version_req.matches(actual_version);
}

// ---- impl Config -------------------------------------------------------------------------------------------------

/** `env!("CARGO_PKG_VERSION")` of rustfmt at the pin (src/tools/rustfmt/Cargo.toml). */
export const CARGO_PKG_VERSION = "1.11.0";

declare module "./create_config.gen.ts" {
  interface Config {
    version_meets_requirement(): boolean;
  }
  namespace Config {
    export function default_for_possible_style_edition(
      style_edition: StyleEdition | undefined,
      edition: Edition | undefined,
      version: Version | undefined,
    ): Config;
    export function from_toml_path(
      file_path: string,
      edition: Edition | undefined,
      style_edition: StyleEdition | undefined,
      version: Version | undefined,
    ): IoResult<Config>;
    export function from_resolved_toml_path(
      dir: string,
      edition: Edition | undefined,
      style_edition: StyleEdition | undefined,
      version: Version | undefined,
    ): IoResult<[Config, string | undefined]>;
    export function from_toml(toml: string, file_path: string): Result<Config, string>;
    export function from_toml_for_style_edition(
      toml: string,
      file_path: string,
      edition: Edition | undefined,
      style_edition: StyleEdition | undefined,
      version: Version | undefined,
    ): Result<Config, string>;
  }
}

/** `io::Error::new(kind, String)` */
function io_error_new(kind: ErrorKind, error: string): IoError {
  return { $: "Custom", kind, error };
}

/** `File::open(path)?` + `file.read_to_string(&mut toml)?` */
function read_file_to_string(path: string): IoResult<string> {
  let file: number;
  try {
    file = openSync(path, "r");
  } catch (e) {
    return Err(io_error_from_node(e));
  }
  try {
    let bytes: Uint8Array;
    try {
      bytes = readFileSync(file);
    } catch (e) {
      return Err(io_error_from_node(e));
    }
    try {
      return Ok(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    } catch {
      return Err(INVALID_UTF8);
    }
  } finally {
    closeSync(file);
  }
}

Object.assign(Config, {
  // rustc: src/tools/rustfmt/src/config/mod.rs:282 default_for_possible_style_edition
  default_for_possible_style_edition(
    style_edition: StyleEdition | undefined,
    edition: Edition | undefined,
    version: Version | undefined,
  ): Config {
    // Ensures the configuration defaults associated with Style Editions
    // follow the precedence set in
    // https://rust-lang.github.io/rfcs/3338-style-evolution.html
    // 'version' is a legacy alias for 'style_edition' that we'll support
    // for some period of time
    // FIXME(calebcartwright) - remove 'version' at some point
    if (style_edition !== undefined) return Config.default_with_style_edition(style_edition);
    if (version === "Two") return Config.default_with_style_edition("Edition2024");
    if (version === "One") return Config.default_with_style_edition("Edition2015");
    if (edition !== undefined) return Config.default_with_style_edition(Edition_.into_StyleEdition(edition));
    return default_Config();
  },
});

// rustc: src/tools/rustfmt/src/config/mod.rs:306 version_meets_requirement
Config.prototype.version_meets_requirement = function (this: Config): boolean {
  if (this.was_set().required_version()) {
    const version = CARGO_PKG_VERSION;
    const required_version = this.required_version();
    if (!check_semver_version(required_version, version)) {
      write_stderr(`Error: rustfmt version (${version}) doesn't match the required version (${required_version})\n`);
      return false;
    }
  }

  return true;
};

Object.assign(Config, {
  /// Constructs a `Config` from the toml file specified at `file_path`.
  ///
  /// This method only looks at the provided path, for a method that
  /// searches parents for a `rustfmt.toml` see `from_resolved_toml_path`.
  ///
  /// Returns a `Config` if the config could be read and parsed from
  /// the file, otherwise errors.
  // rustc: src/tools/rustfmt/src/config/mod.rs:329 from_toml_path
  from_toml_path(
    file_path: string,
    edition: Edition | undefined,
    style_edition: StyleEdition | undefined,
    version: Version | undefined,
  ): IoResult<Config> {
    const toml = read_file_to_string(file_path);
    if (toml.$ === "Err") return toml;
    const r = Config.from_toml_for_style_edition(toml._0, file_path, edition, style_edition, version);
    return r.$ === "Ok" ? r : Err(io_error_new("InvalidData", r._0));
  },

  /// Resolves the config for input in `dir`.
  ///
  /// Searches for `rustfmt.toml` beginning with `dir`, and
  /// recursively checking parents of `dir` if no config file is found.
  /// If no config file exists in `dir` or in any parent, a
  /// default `Config` will be returned (and the returned path will be empty).
  ///
  /// Returns the `Config` to use, and the path of the project file if there was
  /// one.
  // rustc: src/tools/rustfmt/src/config/mod.rs:351 from_resolved_toml_path
  from_resolved_toml_path(
    dir: string,
    edition: Edition | undefined,
    style_edition: StyleEdition | undefined,
    version: Version | undefined,
  ): IoResult<[Config, string | undefined]> {
    let r = resolve_project_file(dir);
    if (r.$ === "Err") r = config_from_user_dirs();
    if (r.$ === "Err") return r;
    const path = r._0;
    if (path === undefined) {
      return Ok([Config.default_for_possible_style_edition(style_edition, edition, version), undefined]);
    } else {
      const c = Config.from_toml_path(path, edition, style_edition, version);
      return c.$ === "Ok" ? Ok([c._0, path]) : c;
    }
  },

  // rustc: src/tools/rustfmt/src/config/mod.rs:368 from_toml
  from_toml(toml: string, file_path: string): Result<Config, string> {
    return Config.from_toml_for_style_edition(toml, file_path, undefined, undefined, undefined);
  },

  // rustc: src/tools/rustfmt/src/config/mod.rs:372 from_toml_for_style_edition
  from_toml_for_style_edition(
    toml: string,
    file_path: string,
    edition: Edition | undefined,
    style_edition: StyleEdition | undefined,
    version: Version | undefined,
  ): Result<Config, string> {
    const parsed_r = toml_from_str_Value(toml);
    if (parsed_r.$ === "Err") return Err(`Could not parse TOML: ${display_TomlDeError(parsed_r._0)}`);
    const parsed = parsed_r._0;
    let err = "";
    const table = parsed.as_table();
    if (table === undefined) return Err("Parsed config was not table");
    for (const key of table.keys()) {
      if (!Config.is_valid_name(key)) {
        const msg = `Warning: Unknown configuration option \`${key}\`\n`;
        err += msg;
      }
    }

    const r = parsed.try_into_PartialConfig();
    if (r.$ === "Ok") {
      const parsed_config = r._0;
      if (err !== "") {
        write_stderr(err);
      }
      const dir = path_parent(file_path);
      if (dir === undefined) return Err(`failed to get parent directory for ${file_path}`);

      return Ok(PartialConfig.to_parsed_config(parsed_config, style_edition, edition, version, dir));
    } else {
      const err_msg = `The file \`${file_path}\` failed to parse.\nError details: ${display_TomlDeError(r._0)}`;
      err += err_msg;
      return Err(err_msg);
    }
  },
});

/// Looks for a configuration file in the given directory and its parents.
///
/// Returns the path of the configuration file nearest to that directory if one exists, or `None` if
/// none was found.
// rustc: src/tools/rustfmt/src/config/mod.rs:419 resolve_project_file
function resolve_project_file(dir: string): IoResult<string | undefined> {
  let current: string;
  if (!path_is_absolute(dir)) {
    const cwd = current_dir_str();
    if (cwd.$ === "Err") return cwd;
    current = path_join(cwd._0, dir);
  } else {
    current = dir;
  }

  const c = canonicalize(current);
  if (c.$ === "Err") return c;
  current = c._0;

  for (;;) {
    const r = get_toml_path(current);
    if (r.$ === "Ok" && r._0 !== undefined) return Ok(r._0);
    if (r.$ === "Err") return r;

    // If the current directory has no parent, we're done searching.
    // `PathBuf::pop`: truncates to `parent()`, false when there is none.
    const parent = path_parent(current);
    if (parent === undefined) {
      return Ok(undefined);
    }
    current = parent;
  }
}

/** `dirs::home_dir()` / `dirs::config_dir()` (plan-m8 D7: `dirs` goes through src/std, which has no `config_dir` yet). */
function dirs_home_dir(): string | undefined {
  return unported("dirs: dirs::home_dir (config_from_user_dirs; plan-m8 D7, through src/std)");
}
function dirs_config_dir(): string | undefined {
  return unported("dirs: dirs::config_dir (config_from_user_dirs; plan-m8 D7, through src/std)");
}

/// Looks for a configuration file in the user's home directory and configuration directory.
///
/// Returns the path of the first configuration file found in that order, or `None` if none was
/// found.
// rustc: src/tools/rustfmt/src/config/mod.rs:446 config_from_user_dirs
function config_from_user_dirs(): IoResult<string | undefined> {
  // `[dirs::home_dir(), dirs::config_dir().map(|d| d.join("rustfmt"))]`: evaluated in this order.
  const home_dir = dirs_home_dir();
  const config_dir = dirs_config_dir();
  for (const dir of [home_dir, config_dir === undefined ? undefined : path_join(config_dir, "rustfmt")]) {
    if (dir === undefined) continue;
    const r = get_toml_path(dir);
    if (r.$ === "Err") return r;
    if (r._0 !== undefined) {
      return Ok(r._0);
    }
  }

  return Ok(undefined);
}

/// Loads a config by checking the client-supplied options and if appropriate, the
/// file system (including searching the file system for overrides).
// rustc: src/tools/rustfmt/src/config/mod.rs:464 load_config
export function load_config(file_path: string | undefined, options: CliOptions | undefined): IoResult<[Config, string | undefined]> {
  let over_ride: string | undefined;
  let edition: Edition | undefined;
  let style_edition: StyleEdition | undefined;
  let version: Version | undefined;
  if (options !== undefined) {
    const p = config_path(options);
    if (p.$ === "Err") return p;
    over_ride = p._0;
    edition = options.edition();
    style_edition = options.style_edition();
    version = options.version();
  }

  let result: IoResult<[Config, string | undefined]>;
  if (over_ride !== undefined) {
    const p = Config.from_toml_path(over_ride, edition, style_edition, version);
    result = p.$ === "Ok" ? Ok([p._0, over_ride]) : p;
  } else if (file_path !== undefined) {
    result = Config.from_resolved_toml_path(file_path, edition, style_edition, version);
  } else {
    result = Ok([Config.default_for_possible_style_edition(style_edition, edition, version), undefined]);
  }

  if (result.$ === "Err") return result;
  const [c, p] = result._0;
  if (options !== undefined) {
    options.apply_to(c);
  }
  return Ok([c, p]);
}

// Check for the presence of known config file names (`rustfmt.toml`, `.rustfmt.toml`) in `dir`
//
// Return the path if a config file exists, empty if no file exists, and Error for IO errors
// rustc: src/tools/rustfmt/src/config/mod.rs:501 get_toml_path
function get_toml_path(dir: string): IoResult<string | undefined> {
  const CONFIG_FILE_NAMES = [".rustfmt.toml", "rustfmt.toml"];
  for (const config_file_name of CONFIG_FILE_NAMES) {
    const config_file = path_join(dir, config_file_name);
    const md = metadata(config_file);
    // Only return if it's a file to handle the unlikely situation of a directory named
    // `rustfmt.toml`.
    if (md.$ === "Ok" && md._0.is_file()) {
      const c = canonicalize(config_file);
      if (c.$ === "Err") return c;
      return Ok(c._0);
    }
    // We didn't find the project file yet, and continue searching if:
    // `NotFound` => file not found
    // `NotADirectory` => rare case where expected directory is a file
    // Otherwise, return the error
    if (md.$ === "Err") {
      const e = md._0;
      const kind = IoError_kind(e);
      if (!(kind === "NotFound" || kind === "NotADirectory")) {
        const ctx = `Failed to get metadata for config file ${debug_str(config_file)}`;
        // `let err = anyhow::Error::new(e).context(ctx); return Err(Error::new(ErrorKind::Other, err));`
        // PORT: the io::Error keeps the anyhow error as its payload, and bin/main.rs prints it with `{e:#}`, which walks the
        // source chain (`<ctx>: <os error>`). The port has no model of anyhow's context chain (nor of an io::Error's source),
        // so this arm stops instead of flattening the error to its context (review rustfmt-contract-1 N6).
        return unported(`anyhow: io::Error::new(Other, anyhow::Error::new(e).context(ctx)) with its source chain (${ctx})`);
      }
    }
  }
  return Ok(undefined);
}

// rustc: src/tools/rustfmt/src/config/mod.rs:526 config_path
function config_path(options: CliOptions): IoResult<string | undefined> {
  const config_path_not_found = (path: string): IoResult<string | undefined> =>
    Err(io_error_new("NotFound", `Error: unable to find a config file for the given path: \`${path}\``));

  // Read the config_path and convert to parent dir if a file is provided.
  // If a config file cannot be found from the given path, return error.
  const path = options.config_path();
  if (path !== undefined && !path_exists(path)) return config_path_not_found(path);
  if (path !== undefined && path_is_dir(path)) return resolve_project_file(path);
  if (path !== undefined) {
    // Canonicalize only after checking above that the `path.exists()`.
    const c = canonicalize(path);
    if (c.$ === "Err") return c;
    return Ok(c._0);
  }
  return Ok(undefined);
}

/** `Path::exists`: `fs::metadata(self).is_ok()`. */
function path_exists(path: string): boolean {
  return metadata(path).$ === "Ok";
}
/** `Path::is_dir`: `fs::metadata(self).map(|m| m.is_dir()).unwrap_or(false)`. */
function path_is_dir(path: string): boolean {
  const m = metadata(path);
  return m.$ === "Ok" && m._0.is_dir();
}
