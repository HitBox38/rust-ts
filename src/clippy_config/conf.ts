// rust-ts port of src/tools/clippy/clippy_config/src/conf.rs, the hand-written part.
//
// `define_Conf! { .. }` is expanded by tools/codegen/clippy.ts into conf.gen.ts (plan-m8 D5): `enum ConfField` and its
// impl now; `struct Conf`'s fields, `impl Default for Conf`, `Conf::get_metadata` and `Conf::deserialize` with the
// follow-up batch codegen-clippy-conf (root's decision "codegen-clippy-macros (D5)"), which targets the names below and
// in de.ts/types.ts (docs/handoff/clippy-contract-b1.md).

import { ConfMetadata } from "./metadata.ts";
import { type DeTable, DiagCtxt, DeTable as DeTable_ } from "./de.ts";
import { type RustcVersion, RustcVersion_eq, display_RustcVersion } from "../rustc_ast/attr/version.ts";
import { parse_version } from "../rustc_attr_parsing/attributes/util.ts";
import { type Session } from "../rustc_session/session.ts";
import { BytePos, type SourceFile } from "../rustc_span/lib.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import { os_string_into_string, var_, var_os } from "../std/env.ts";
import { canonicalize, metadata } from "../std/fs.ts";
import { IoError_kind, display_IoError } from "../std/io.ts";
import { path_join, path_parent } from "../std/path.ts";
import { panic, unported } from "../std/panic.ts";
import { str_lines } from "../std/str.ts";

// #[rustfmt::skip]
export const DEFAULT_DOC_VALID_IDENTS: readonly string[] = [
    "KiB", "MiB", "GiB", "TiB", "PiB", "EiB",
    "MHz", "GHz", "THz",
    "AccessKit",
    "CoAP", "CoreFoundation", "CoreGraphics", "CoreText",
    "DevOps",
    "Direct2D", "Direct3D", "DirectWrite", "DirectX",
    "ECMAScript",
    "GPLv2", "GPLv3",
    "GitHub", "GitLab",
    "IPv4", "IPv6",
    "InfiniBand", "RoCE",
    "ClojureScript", "CoffeeScript", "JavaScript", "PostScript", "PureScript", "TypeScript",
    "PowerPC", "PowerShell", "WebAssembly",
    "NaN", "NaNs",
    "OAuth", "GraphQL",
    "SQLite", "MySQL", "PostgreSQL", "MariaDB", "MongoDB",
    "OCaml",
    "OpenAL", "OpenDNS", "OpenGL", "OpenMP", "OpenSSH", "OpenSSL", "OpenStreetMap", "OpenTelemetry",
    "OpenType",
    "WebAuthn", "WebGL", "WebGL2", "WebGPU", "WebRTC", "WebSocket", "WebTransport",
    "WebP", "OpenExr", "YCbCr", "sRGB",
    "TensorFlow",
    "TrueType",
    "iOS", "macOS", "FreeBSD", "NetBSD", "OpenBSD", "NixOS",
    "TeX", "LaTeX", "BibTeX", "BibLaTeX",
    "MinGW",
    "CamelCase",
    "x86_64",
    "CommonMark", "IntelliJ",
];
export const DEFAULT_DISALLOWED_NAMES: readonly string[] = ["foo", "baz", "quux"];
export const DEFAULT_ALLOWED_IDENTS_BELOW_MIN_CHARS: readonly string[] = ["i", "j", "x", "y", "z", "w", "n"];
export const DEFAULT_ALLOWED_PREFIXES: readonly string[] = ["to", "as", "into", "from", "try_into", "try_from"];
export const DEFAULT_ALLOWED_TRAITS_WITH_RENAMED_PARAMS: readonly string[] = [
  "core::convert::From",
  "core::convert::TryFrom",
  "core::str::FromStr",
];

export const DEFAULT_ALLOWED_SCRIPTS: readonly string[] = ["Latin"];
export const DEFAULT_IGNORE_INTERIOR_MUTABILITY: readonly string[] = ["bytes::Bytes"];

// `macro_rules! first_expr`, `macro_rules! filtered_names`, `macro_rules! define_Conf` and the `define_Conf! { .. }`
// invocation (conf.rs:60–833): expanded into conf.gen.ts by tools/codegen/clippy.ts.

/// Clippy lint configuration
// PORT: define_Conf!'s `pub struct Conf { $($(pub $name: $ty,)?)* }` is a data struct (PORTING §5: an interface, built
// as an object literal). codegen-clippy-conf declares its fields in conf.gen.ts by augmenting this interface
// (`declare module "./conf.ts" { interface Conf { .. } }`); `msrv` (conf.rs:731, `Option<RustcVersion>`) is declared
// here too because `load_inner` below reads and writes it. Its associated fns live on the companion const: `load` and
// `load_inner` are ported in this file; `default` (`impl Default for Conf`), `get_metadata` and `deserialize` come from the
// macro and are assigned by conf.gen.ts when codegen-clippy-conf writes them (lib.ts imports conf.gen.ts after this
// module), so until then they stop.
export interface Conf {
  msrv: RustcVersion | undefined;
}

/** The associated fns of `Conf`, on its companion const. */
interface ConfFns {
  default(): Conf;
  get_metadata(): ConfMetadata[];
  deserialize(dcx: DiagCtxt, table: DeTable): Conf;
  load(sess: Session): Conf;
  load_inner(sess: Session): Conf;
}

// PORT: `impl Conf { load, load_inner }` (conf.rs:934) follows `sanitize_explanation` and `load_conf_file` upstream, so
// those two fns are assigned to the companion at that place below (as conf.gen.ts assigns the macro's fns); the
// companion is complete once this module has run, before any caller can reach it.
export const Conf = {
  /** `<Conf as Default>::default` (conf.rs:122, define_Conf!) */
  default: (): Conf => unported("codegen-clippy-conf: <Conf as Default>::default (define_Conf!)"),
  /** `Conf::get_metadata` (conf.rs:130, define_Conf!) */
  get_metadata: (): ConfMetadata[] => unported("codegen-clippy-conf: Conf::get_metadata (define_Conf!)"),
  /** `Conf::deserialize` (conf.rs:146, define_Conf!) */
  deserialize: (_dcx: DiagCtxt, _table: DeTable): Conf => unported("codegen-clippy-conf: Conf::deserialize (define_Conf!)"),
} as ConfFns;

// Remove code tags and code behind '# 's, as they are not needed for the lint docs and --explain
// rustc: src/tools/clippy/clippy_config/src/conf.rs:836 sanitize_explanation
export function sanitize_explanation(raw_docs: string): string {
  // Remove tags and hidden code:
  let explanation = "";
  let in_code = false;
  for (const line_ of str_lines(raw_docs)) {
    const line = line_.startsWith(" ") ? line_.slice(1) : line_;

    if (line.startsWith("```")) {
      const lang = line.slice(3);
      const comma = lang.indexOf(",");
      const tag = comma < 0 ? lang : lang.slice(0, comma);
      if (!in_code && (tag === "" || tag === "rust" || tag === "ignore" || tag === "should_panic" || tag === "no_run" || tag === "compile_fail")) {
        explanation += "```rust\n";
      } else {
        explanation += line;
        explanation += "\n";
      }
      in_code = !in_code;
    } else if (!(in_code && line.startsWith("# "))) {
      explanation += line;
      explanation += "\n";
    }
  }

  return explanation;
}

/// Searches for and loads the config file into the source map.
///
/// # Errors
///
/// Returns any unexpected filesystem error encountered when searching for the config file
// rustc: src/tools/clippy/clippy_config/src/conf.rs:866 load_conf_file
function load_conf_file(sess: Session): SourceFile | undefined {
  /// Possible filename to search for.
  const CONFIG_FILE_NAMES: readonly [string, string] = [".clippy.toml", "clippy.toml"];

  // Start looking for a config file in CLIPPY_CONF_DIR, or failing that, CARGO_MANIFEST_DIR.
  // If neither of those exist, use ".". (Update documentation if this priority changes)
  const CONFIG_VARS: readonly (readonly [string, string])[] = [
    ["CLIPPY_CONF_DIR", "failed to read `CLIPPY_CONF_DIR` as a directory"],
    ["CARGO_MANIFEST_DIR", "failed to read `CARGO_MANIFEST_DIR` as a directory"],
  ];
  let found: [string, string] | undefined;
  for (const [var_name, msg] of CONFIG_VARS) {
    const p = var_os(var_name);
    if (p !== undefined) {
      // PORT: `PathBuf::from(OsString)`; a `PathBuf` is a `string` (rustc_span `PathBuf`), so a value that is not
      // UTF-8 stops rather than being changed.
      const s = os_string_into_string(p);
      if (s.$ === "Err") return unported(`clippy_config: a ${var_name} that is not UTF-8`);
      found = [s._0, msg];
      break;
    }
  }
  const [current_, msg] = found ?? [".", "failed to get the current directory"];
  const c = canonicalize(current_);
  let current: string;
  switch (c.$) {
    case "Ok":
      current = c._0;
      break;
    case "Err":
      sess.dcx().err(`${msg}: ${display_IoError(c._0)}`);
      return undefined;
  }

  let loaded_config: [string, SourceFile] | undefined;
  for (;;) {
    for (const config_file_name of CONFIG_FILE_NAMES) {
      const cp = canonicalize(path_join(current, config_file_name));
      if (cp.$ === "Ok") {
        const config_path = cp._0;
        if (loaded_config !== undefined) {
          const [loaded_path] = loaded_config;
          const m = metadata(loaded_path);
          if (m.$ === "Ok" && m._0.is_file()) {
            // Warn if `.clippy.toml` and `clippy.toml` exist
            sess.dcx().warn(`using config file \`${loaded_path}\`, \`${config_path}\` will be ignored`);
          }
        } else {
          const r = sess.source_map().load_file(config_path);
          if (r.$ === "Ok") {
            loaded_config = [config_path, r._0];
          } else {
            const e = r._0;
            const kind = IoError_kind(e);
            if (kind === "NotFound" || kind === "IsADirectory" || kind === "NotADirectory") {
              // {}
            } else {
              sess.dcx().err(`error reading \`${config_path}\`: ${display_IoError(e)}`);
              return undefined;
            }
          }
        }
      }
    }

    // Don't mention config files in parent directories.
    if (loaded_config !== undefined) {
      return loaded_config[1];
    }

    // If the current directory has no parent, we're done searching.
    const parent = path_parent(current);
    if (parent === undefined) {
      return undefined;
    }
    current = parent;
  }
}

// impl Conf {
let CONF: Conf | undefined;

// rustc: src/tools/clippy/clippy_config/src/conf.rs:935 load
Conf.load = function (sess: Session): Conf {
  // static CONF: OnceLock<Conf> = OnceLock::new();
  if (CONF === undefined) CONF = Conf.load_inner(sess);
  return CONF;
};

// rustc: src/tools/clippy/clippy_config/src/conf.rs:940 load_inner
Conf.load_inner = function (sess: Session): Conf {
  let conf: Conf;
  const src_ = load_conf_file(sess);
  if (src_ !== undefined) {
    const dcx = DiagCtxt.new(sess, BytePos.to_usize(src_.start_pos));
    // `src.src.as_ref().unwrap()`
    const src = src_.src;
    if (src === undefined) panic("called `Option::unwrap()` on a `None` value");

    const [toml, errs] = DeTable_.parse_recoverable(src);
    for (const e of errs) {
      const sp = e.span();
      if (sp !== undefined) {
        dcx.span_err(sp, e.message());
      } else {
        dcx.inner.struct_err(`error parsing \`clippy.toml\`: ${e.message()}`).emit();
      }
    }
    conf = Conf.deserialize(dcx, toml.get_ref());
  } else {
    conf = Conf.default();
  }

  const v = var_("CARGO_PKG_RUST_VERSION");
  const cargo_msrv = v.$ === "Ok" ? parse_version(Symbol.intern(v._0)) : undefined;
  if (conf.msrv === undefined && cargo_msrv !== undefined) {
    conf.msrv = cargo_msrv;
  } else if (conf.msrv !== undefined && cargo_msrv !== undefined) {
    const clippy_msrv = conf.msrv;
    if (!RustcVersion_eq(clippy_msrv, cargo_msrv)) {
      sess
        .dcx()
        .warn(`the MSRV in \`clippy.toml\` and \`Cargo.toml\` differ; using \`${display_RustcVersion(clippy_msrv)}\` from \`clippy.toml\``);
    }
  } else {
    // (_, None) => {}
  }

  return conf;
};

// }

// rustc-skip: src/tools/clippy/clippy_config/src/conf.rs:988 configs_are_tested #[cfg(test)]: parses every tests/**/clippy.toml through toml's DeTable::parse and walkdir, so it waits for vendor-toml (wave 42); conf.test.ts has the TOML-free checks
