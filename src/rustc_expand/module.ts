// Port of compiler/rustc_expand/src/module.rs
//
// PORT: `Path`/`PathBuf` are strings (src/std/path.ts, host path rules); `path.display()` is the identity.
// `DirOwnership` is Copy: a Rust copy is `DirOwnership.clone(..)` where the copy is edited.
import type { AttrVec, Attribute, Inline, Item, ModSpans } from "../rustc_ast/lib.ts";
import { template } from "../rustc_attr_parsing/template.ts";
import { emit_malformed_attribute } from "../rustc_attr_parsing/validate_attr.ts";
import type { Diag } from "../rustc_errors/lib.ts";
import { lexer, new_parser_from_file, parser, unwrap_or_emit_fatal } from "../rustc_parse/lib.ts";
import type { ParseSess } from "../rustc_session/parse.ts";
import type { Session } from "../rustc_session/session.ts";
import { FatalError } from "../rustc_span/fatal_error.ts";
import { DUMMY_SP, type ErrorGuaranteed, type Span } from "../rustc_span/lib.ts";
import { display_Symbol, type Ident, sym } from "../rustc_span/symbol.ts";
import { path_eq, path_join, path_parent } from "../std/path.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import type { ModuleData } from "./base.ts";
import {
  ModuleCircular_diagnostic,
  ModuleFileNotFound_diagnostic,
  ModuleInBlock_diagnostic,
  ModuleMultipleCandidates_diagnostic,
} from "./diagnostics.ts";

/** `std::path::MAIN_SEPARATOR` of the host (PORT: `cfg(windows)` is the host platform, as in src/std/path.ts). */
const IS_WINDOWS = process.platform === "win32";
const MAIN_SEPARATOR = IS_WINDOWS ? "\\" : "/";

// #[derive(Copy, Clone)]
export type DirOwnership =
  | {
      readonly $: "Owned";
      // None if `mod.rs`, `Some("foo")` if we're in `foo.rs`.
      relative: Ident | undefined;
    }
  | { readonly $: "UnownedViaBlock" };

export const DirOwnership = {
  UnownedViaBlock: Object.freeze({ $: "UnownedViaBlock" as const }) as DirOwnership,

  /** `#[derive(Clone)]` (Copy): a fresh object, so edits of the copy do not reach the original. */
  clone(v: DirOwnership): DirOwnership {
    return v.$ === "Owned" ? { $: "Owned", relative: v.relative } : v;
  },
};

// Public for rustfmt usage.
export interface ModulePathSuccess {
  file_path: string;
  dir_ownership: DirOwnership;
}

export interface ParsedExternalMod {
  items: Item[];
  spans: ModSpans;
  file_path: string;
  dir_path: string;
  dir_ownership: DirOwnership;
  had_parse_error: Result<undefined, ErrorGuaranteed>;
}

export type ModError =
  | { readonly $: "CircularInclusion"; _0: string[] }
  | { readonly $: "ModInBlock"; _0: Ident | undefined }
  | { readonly $: "FileNotFound"; _0: Ident; _1: string; _2: string }
  | { readonly $: "MultipleCandidates"; _0: Ident; _1: string; _2: string }
  | { readonly $: "ParserError"; _0: Diag };

// rustc: compiler/rustc_expand/src/module.rs:52 parse_external_mod
export function parse_external_mod(
  sess: Session,
  ident: Ident,
  span: Span, // The span to blame on errors.
  module: ModuleData,
  dir_ownership: DirOwnership,
  attrs: AttrVec,
): ParsedExternalMod {
  // We bail on the first error, but that error does not cause a fatal error... (1)
  // PORT: the `try` block is an immediately-invoked closure; `?` / `do yeet` return `Err`.
  const result = ((): Result<[Item[], ModSpans, string], ModError> => {
    // Extract the file path and the new ownership.
    const mp_r = mod_file_path(sess, ident, attrs, module.dir_path, dir_ownership);
    if (mp_r.$ === "Err") return mp_r;
    const mp = mp_r._0;
    dir_ownership = mp.dir_ownership;

    // Ensure file paths are acyclic.
    const pos = module.file_path_stack.findIndex((p) => path_eq(p, mp.file_path));
    if (pos !== -1) {
      return Err({ $: "CircularInclusion", _0: module.file_path_stack.slice(pos) });
    }

    // Actually parse the external file as a module.
    const parser_ = unwrap_or_emit_fatal(
      new_parser_from_file(sess.psess, mp.file_path, lexer.StripTokens.ShebangAndFrontmatter, span),
    );
    const r = parser_.parse_mod(parser.token_type.exp.Eof);
    if (r.$ === "Err") return Err({ $: "ParserError", _0: r._0 });
    const [inner_attrs, items, inner_span] = r._0;
    attrs.push(...inner_attrs);
    return Ok([items, inner_span, mp.file_path]);
  })();

  // (1) ...instead, we return a dummy module.
  let items: Item[];
  let spans: ModSpans;
  let file_path: string;
  let had_parse_error: Result<undefined, ErrorGuaranteed>;
  switch (result.$) {
    case "Err":
      items = [];
      spans = { inner_span: DUMMY_SP, inject_use_span: DUMMY_SP };
      file_path = "";
      had_parse_error = Err(ModError.report(result._0, sess, span));
      break;
    case "Ok":
      [items, spans, file_path] = result._0;
      had_parse_error = Ok(undefined);
      break;
  }

  // Extract the directory path for submodules of the module.
  const dir_path = path_parent(file_path) ?? file_path;

  return { items, spans, file_path, dir_path, dir_ownership, had_parse_error };
}

// rustc: compiler/rustc_expand/src/module.rs:96 mod_dir_path
export function mod_dir_path(
  sess: Session,
  ident: Ident,
  attrs: readonly Attribute[],
  module: ModuleData,
  dir_ownership: DirOwnership,
  inline: Inline,
): [string, DirOwnership] {
  // PORT: `mut dir_ownership` is a by-value Copy parameter; edit a copy.
  dir_ownership = DirOwnership.clone(dir_ownership);
  if (inline.$ === "Yes") {
    const file_path = mod_file_path_from_attr(sess, attrs, module.dir_path);
    if (file_path !== undefined) {
      // For inline modules file path from `#[path]` is actually the directory path
      // for historical reasons, so we don't pop the last segment here.
      return [file_path, { $: "Owned", relative: undefined }];
    }
  }
  switch (inline.$) {
    case "Yes": {
      // We have to push on the current module name in the case of relative
      // paths in order to ensure that any additional module paths from inline
      // `mod x { ... }` come after the relative extension.
      //
      // For example, a `mod z { ... }` inside `x/y.rs` should set the current
      // directory path to `/x/y/z`, not `/x/z` with a relative offset of `y`.
      let dir_path = module.dir_path;
      if (dir_ownership.$ === "Owned") {
        const ident = dir_ownership.relative;
        dir_ownership.relative = undefined;
        if (ident !== undefined) {
          // Remove the relative offset.
          dir_path = path_join(dir_path, ident.as_str());
        }
      }
      dir_path = path_join(dir_path, ident.as_str());

      return [dir_path, dir_ownership];
    }
    case "No": {
      // FIXME: This is a subset of `parse_external_mod` without actual parsing,
      // check whether the logic for unloaded, loaded and inline modules can be unified.
      const r = mod_file_path(sess, ident, attrs, module.dir_path, dir_ownership);
      let file_path: string;
      if (r.$ === "Ok") {
        const mp = r._0;
        dir_ownership = mp.dir_ownership;
        file_path = mp.file_path;
      } else {
        // PORT: `Result::map(..).unwrap_or_default()` drops the error (a `Diag` is never built here:
        // `ModError::ParserError` only comes from parsing).
        file_path = "";
      }

      // Extract the directory path for submodules of the module.
      const dir_path = path_parent(file_path) ?? file_path;

      return [dir_path, dir_ownership];
    }
  }
}

// rustc: compiler/rustc_expand/src/module.rs:148 mod_file_path
function mod_file_path(
  sess: Session,
  ident: Ident,
  attrs: readonly Attribute[],
  dir_path: string,
  dir_ownership: DirOwnership,
): Result<ModulePathSuccess, ModError> {
  const file_path = mod_file_path_from_attr(sess, attrs, dir_path);
  if (file_path !== undefined) {
    // All `#[path]` files are treated as though they are a `mod.rs` file.
    // This means that `mod foo;` declarations inside `#[path]`-included
    // files are siblings,
    //
    // Note that this will produce weirdness when a file named `foo.rs` is
    // `#[path]` included and contains a `mod foo;` declaration.
    // If you encounter this, it's your own darn fault :P
    const dir_ownership: DirOwnership = { $: "Owned", relative: undefined };
    return Ok({ file_path, dir_ownership });
  }

  let relative: Ident | undefined;
  switch (dir_ownership.$) {
    case "Owned":
      relative = dir_ownership.relative;
      break;
    case "UnownedViaBlock":
      relative = undefined;
      break;
  }
  const result = default_submod_path(sess.psess, ident, relative, dir_path);
  switch (dir_ownership.$) {
    case "Owned":
      return result;
    case "UnownedViaBlock":
      return Err({
        $: "ModInBlock",
        _0: result.$ === "Ok" || result._0.$ === "MultipleCandidates" ? ident : undefined,
      });
  }
}

/// Derive a submodule path from the first found `#[path = "path_string"]`.
/// The provided `dir_path` is joined with the `path_string`.
// rustc: compiler/rustc_expand/src/module.rs:183 mod_file_path_from_attr
export function mod_file_path_from_attr(sess: Session, attrs: readonly Attribute[], dir_path: string): string | undefined {
  // FIXME(154781) use a parsed attribute here
  // Extract path string from first `#[path = "path_string"]` attribute.
  const first_path = attrs.find((at) => at.has_name(sym.path));
  if (first_path === undefined) return undefined;
  const path_sym = first_path.value_str();
  if (path_sym === undefined) {
    // This check is here mainly to catch attempting to use a macro,
    // such as `#[path = concat!(...)]`. This isn't supported because
    // otherwise the `InvocationCollector` would need to defer loading
    // a module until the `#[path]` attribute was expanded, and it
    // doesn't support that (and would likely add a bit of complexity).
    // Usually bad forms are checked during semantic analysis via
    // `TyCtxt::check_mod_attrs`), but by the time that runs the macro
    // is expanded, and it doesn't give an error.
    emit_malformed_attribute(
      sess.psess,
      first_path.style,
      first_path.span,
      sym.path,
      template(
        { NameValueStr: ["file"] },
        "https://doc.rust-lang.org/reference/items/modules.html#the-path-attribute",
      ),
    );
    return new FatalError().raise();
  }

  let path_str = display_Symbol(path_sym);

  // On windows, the base path might have the form
  // `\\?\foo\bar` in which case it does not tolerate
  // mixed `/` and `\` separators, so canonicalize
  // `/` to `\`.
  // #[cfg(windows)]
  if (IS_WINDOWS) path_str = path_str.replaceAll("/", "\\");

  return path_join(dir_path, path_str);
}

/// Returns a path to a module.
// Public for rustfmt usage.
// rustc: compiler/rustc_expand/src/module.rs:227 default_submod_path
export function default_submod_path(
  psess: ParseSess,
  ident: Ident,
  relative: Ident | undefined,
  dir_path: string,
): Result<ModulePathSuccess, ModError> {
  // If we're in a foo.rs file instead of a mod.rs file,
  // we need to look for submodules in
  // `./foo/<ident>.rs` and `./foo/<ident>/mod.rs` rather than
  // `./<ident>.rs` and `./<ident>/mod.rs`.
  let relative_prefix: string;
  if (relative !== undefined) {
    const relative_prefix_string = `${display_Symbol(relative.name)}${MAIN_SEPARATOR}`;
    relative_prefix = relative_prefix_string;
  } else {
    relative_prefix = "";
  }

  const default_path_str = `${relative_prefix}${display_Symbol(ident.name)}.rs`;
  const secondary_path_str = `${relative_prefix}${display_Symbol(ident.name)}${MAIN_SEPARATOR}mod.rs`;
  const default_path = path_join(dir_path, default_path_str);
  const secondary_path = path_join(dir_path, secondary_path_str);
  const default_exists = psess.source_map().file_exists(default_path);
  const secondary_exists = psess.source_map().file_exists(secondary_path);

  if (default_exists && !secondary_exists) {
    return Ok({ file_path: default_path, dir_ownership: { $: "Owned", relative: ident } });
  } else if (!default_exists && secondary_exists) {
    return Ok({ file_path: secondary_path, dir_ownership: { $: "Owned", relative: undefined } });
  } else if (!default_exists && !secondary_exists) {
    return Err({ $: "FileNotFound", _0: ident, _1: default_path, _2: secondary_path });
  } else {
    return Err({ $: "MultipleCandidates", _0: ident, _1: default_path, _2: secondary_path });
  }
}

export const ModError = {
  // rustc: compiler/rustc_expand/src/module.rs:268 report
  report(self: ModError, sess: Session, span: Span): ErrorGuaranteed {
    switch (self.$) {
      case "CircularInclusion": {
        const file_paths = self._0;
        const path_to_string = (path: string): string => path;

        const paths = [...file_paths.map(path_to_string), path_to_string(file_paths[0]!)];

        const modules = paths.join(" -> ");

        return sess.dcx().emit_err(ModuleCircular_diagnostic({ span, modules }));
      }
      case "ModInBlock": {
        const ident = self._0;
        return sess.dcx().emit_err(
          ModuleInBlock_diagnostic({
            span,
            name: ident === undefined ? undefined : { span, name: ident },
          }),
        );
      }
      case "FileNotFound": {
        const [name, default_path, secondary_path] = [self._0, self._1, self._2];
        return sess.dcx().emit_err(
          ModuleFileNotFound_diagnostic({
            span,
            name,
            default_path: default_path,
            secondary_path: secondary_path,
          }),
        );
      }
      case "MultipleCandidates": {
        const [name, default_path, secondary_path] = [self._0, self._1, self._2];
        return sess.dcx().emit_err(
          ModuleMultipleCandidates_diagnostic({
            span,
            name,
            default_path: default_path,
            secondary_path: secondary_path,
          }),
        );
      }
      case "ParserError":
        return self._0.emit_err();
    }
  },
};
