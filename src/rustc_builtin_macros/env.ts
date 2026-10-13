// Port of compiler/rustc_builtin_macros/src/env.rs
// The compiler code necessary to support the env! extension. Eventually this
// should all get sucked into either the compiler syntax extension plugin
// interface.
//

import type { TokenStream } from "../rustc_ast/tokenstream.ts";
import { ast } from "../rustc_ast/lib.ts";
import * as pprust from "../rustc_ast_pretty/pprust/mod.ts";
import { DummyResult, type ExtCtxt, MacEager, type MacroExpanderResult } from "../rustc_expand/base.ts";
import { edit_distance } from "../rustc_span/edit_distance.ts";
import type { Span } from "../rustc_span/lib.ts";
import { Ident, kw, sym, Symbol } from "../rustc_span/symbol.ts";
import { escape_char } from "../std/fmt.ts";
import { Err, Ok, type Result } from "../std/result.ts";
import * as diagnostics from "./diagnostics.ts";
import { expr_to_string, get_exprs_from_tts, get_single_expr_from_tts } from "./util.ts";

/**
 * `std::env::VarError`. PORT: `NotUnicode(OsString)` cannot arise: the host environment is read through
 * `process.env`, whose values are already decoded strings.
 */
type VarError = { readonly $: "NotPresent" } | { readonly $: "NotUnicode"; _0: Uint8Array };

// rustc: compiler/rustc_builtin_macros/src/env.rs:20 lookup_env
function lookup_env(var_: Symbol): Result<Symbol, VarError> {
  const var_s = Symbol.as_str(var_);
  // Try to retrieve the environment variable from rustc's environment.
  const v = env_var(var_s);
  if (v.$ === "Err") return v;
  return Ok(Symbol.intern(v._0));
}

// rustc: compiler/rustc_builtin_macros/src/env.rs:26 expand_option_env
export function expand_option_env(cx: ExtCtxt, sp_: Span, tts: TokenStream): MacroExpanderResult {
  const r = get_single_expr_from_tts(cx, sp_, tts, "option_env!");
  if (r.$ !== "Ready") {
    return { $: "Retry", _0: null };
  }
  const mac_expr = r._0;
  if (mac_expr.$ === "Err") return { $: "Ready", _0: DummyResult.any(sp_, mac_expr._0) };
  const var_expr = mac_expr._0;
  const r2 = expr_to_string(cx, var_expr, "argument must be a string literal");
  if (r2.$ !== "Ready") {
    return { $: "Retry", _0: null };
  }
  const mac = r2._0;
  if (mac.$ === "Err") return { $: "Ready", _0: DummyResult.any(sp_, mac._0) };
  const var_ = mac._0[0];

  const sp = cx.with_def_site_ctxt(sp_);
  const value = lookup_env(var_);
  env_depinfo_insert(cx, var_, value.$ === "Ok" ? value._0 : undefined);
  let e: ast.Expr;
  if (value.$ === "Err" && value._0.$ === "NotPresent") {
    const lt = cx.lifetime(sp, Ident.new(kw.StaticLifetime, sp));
    e = cx.expr_path(
      cx.path_all(sp, true, cx.std_path([sym.option, sym.Option, sym.None]), [
        { $: "Type", _0: cx.ty_ref(sp, cx.ty_ident(sp, Ident.new(sym.str, sp)), lt, ast.Mutability.Not) },
      ]),
    );
  } else if (value.$ === "Err") {
    const escaped_var = str_escape_debug(Symbol.as_str(var_));
    const guar = cx.dcx().emit_err(diagnostics.EnvNotUnicode_diagnostic({ span: sp, var: escaped_var }));
    return { $: "Ready", _0: DummyResult.any(sp, guar) };
  } else {
    e = cx.expr_call_global(sp, cx.std_path([sym.option, sym.Option, sym.Some]), [cx.expr_str(sp, value._0)]);
  }
  return { $: "Ready", _0: MacEager.expr(e) };
}

// rustc: compiler/rustc_builtin_macros/src/env.rs:80 expand_env
export function expand_env(cx: ExtCtxt, sp: Span, tts: TokenStream): MacroExpanderResult {
  const r = get_exprs_from_tts(cx, tts);
  if (r.$ !== "Ready") {
    return { $: "Retry", _0: null };
  }
  const mac = r._0;
  if (mac.$ === "Ok" && (mac._0.length === 0 || mac._0.length > 2)) {
    const guar = cx.dcx().emit_err(diagnostics.EnvTakesArgs_diagnostic({ span: sp }));
    return { $: "Ready", _0: DummyResult.any(sp, guar) };
  } else if (mac.$ === "Err") {
    return { $: "Ready", _0: DummyResult.any(sp, mac._0) };
  }
  const exprs = mac._0[Symbol_iterator]();

  const var_expr = exprs.next().value!;
  // FIXME: `get_exprs_from_tts()` already performed macro expansion...
  const r2 = expr_to_string(cx, ast.clone_Expr(var_expr), "expected string literal");
  if (r2.$ !== "Ready") {
    return { $: "Retry", _0: null };
  }
  const mac2 = r2._0;
  if (mac2.$ === "Err") return { $: "Ready", _0: DummyResult.any(sp, mac2._0) };
  const var_ = mac2._0[0];

  let custom_msg: Symbol | undefined;
  const second = exprs.next();
  if (second.done) {
    custom_msg = undefined;
  } else {
    const r3 = expr_to_string(cx, second.value, "expected string literal");
    if (r3.$ !== "Ready") {
      return { $: "Retry", _0: null };
    }
    const mac3 = r3._0;
    if (mac3.$ === "Ok") {
      custom_msg = mac3._0[0];
    } else {
      return { $: "Ready", _0: DummyResult.any(sp, mac3._0) };
    }
  }

  const span = cx.with_def_site_ctxt(sp);
  const value = lookup_env(var_);
  env_depinfo_insert(cx, var_, value.$ === "Ok" ? value._0 : undefined);
  let e: ast.Expr;
  if (value.$ === "Err" && value._0.$ === "NotPresent") {
    const var_str = Symbol.as_str(var_);
    const escaped_var = str_escape_debug(var_str);
    let guar;
    let suggested_var: string | undefined;
    if (custom_msg !== undefined) {
      const msg_from_user = custom_msg;
      guar = cx.dcx().emit_err(diagnostics.EnvNotDefinedWithUserMessage_diagnostic({ span, msg_from_user }));
    } else if ((suggested_var = find_similar_cargo_var(var_str)) !== undefined && suggested_var !== var_str) {
      guar = cx.dcx().emit_err(
        diagnostics.EnvNotDefined_diagnostic({
          $: "CargoEnvVarTypo",
          span,
          var: escaped_var,
          suggested_var: Symbol.intern(suggested_var),
        }),
      );
    } else if (is_cargo_env_var(var_str)) {
      guar = cx.dcx().emit_err(
        diagnostics.EnvNotDefined_diagnostic({
          $: "CargoEnvVar",
          span,
          var: escaped_var,
          var_expr: pprust.expr_to_string(var_expr),
        }),
      );
    } else {
      guar = cx.dcx().emit_err(
        diagnostics.EnvNotDefined_diagnostic({
          $: "CustomEnvVar",
          span,
          var: escaped_var,
          var_expr: pprust.expr_to_string(var_expr),
        }),
      );
    }
    return { $: "Ready", _0: DummyResult.any(sp, guar) };
  } else if (value.$ === "Err") {
    const escaped_var = str_escape_debug(Symbol.as_str(var_));
    const guar = cx.dcx().emit_err(diagnostics.EnvNotUnicode_diagnostic({ span, var: escaped_var }));
    return { $: "Ready", _0: DummyResult.any(sp, guar) };
  } else {
    e = cx.expr_str(span, value._0);
  }
  return { $: "Ready", _0: MacEager.expr(e) };
}

/// Returns `true` if an environment variable from `env!` could be one used by Cargo.
// rustc: compiler/rustc_builtin_macros/src/env.rs:165 is_cargo_env_var
function is_cargo_env_var(var_: string): boolean {
  return (
    var_.startsWith("CARGO_") ||
    var_.startsWith("DEP_") ||
    var_ === "OUT_DIR" ||
    var_ === "OPT_LEVEL" ||
    var_ === "PROFILE" ||
    var_ === "HOST" ||
    var_ === "TARGET"
  );
}

const KNOWN_CARGO_VARS: readonly string[] = [
  // List of known Cargo environment variables that are set for crates (not build scripts, OUT_DIR etc).
  // See: https://doc.rust-lang.org/cargo/reference/environment-variables.html#environment-variables-cargo-sets-for-crates
  // tidy-alphabetical-start
  "CARGO_BIN_NAME",
  "CARGO_CRATE_NAME",
  "CARGO_MANIFEST_DIR",
  "CARGO_MANIFEST_PATH",
  "CARGO_PKG_AUTHORS",
  "CARGO_PKG_DESCRIPTION",
  "CARGO_PKG_HOMEPAGE",
  "CARGO_PKG_LICENSE",
  "CARGO_PKG_LICENSE_FILE",
  "CARGO_PKG_NAME",
  "CARGO_PKG_README",
  "CARGO_PKG_REPOSITORY",
  "CARGO_PKG_RUST_VERSION",
  "CARGO_PKG_VERSION",
  "CARGO_PKG_VERSION_MAJOR",
  "CARGO_PKG_VERSION_MINOR",
  "CARGO_PKG_VERSION_PATCH",
  "CARGO_PKG_VERSION_PRE",
  "CARGO_PRIMARY_PACKAGE",
  "CARGO_TARGET_TMPDIR",
  // tidy-alphabetical-end
];

// rustc: compiler/rustc_builtin_macros/src/env.rs:198 find_similar_cargo_var
function find_similar_cargo_var(var_: string): string | undefined {
  if (!var_.startsWith("CARGO_")) {
    return undefined;
  }

  // `var.chars().count()`
  const lookup_len = [...var_].length;
  const max_dist = Math.floor(Math.max(lookup_len, 3) / 3);
  let best_match: string | undefined = undefined;
  let best_distance = Number.MAX_SAFE_INTEGER; // `usize::MAX`

  for (const known_var of KNOWN_CARGO_VARS) {
    let distance = edit_distance(var_, known_var, max_dist);
    if (distance !== undefined) {
      // assume `PACKAGE` to equals `PKG`
      // (otherwise, `d("CARGO_PACKAGE_NAME", "CARGO_PKG_NAME") == d("CARGO_PACKAGE_NAME", "CARGO_CRATE_NAME") == 4`)
      if (var_.includes("PACKAGE") && known_var.includes("PKG")) {
        distance = Math.max(distance - ("PACKAGE".length - "PKG".length), 0); // == d("PACKAGE", "PKG")
      }

      if (distance < best_distance) {
        best_distance = distance;
        best_match = known_var;
      }
    }
  }

  return best_match;
}

// ---- local helpers ---------------------------------------------------------------------------------

const Symbol_iterator: typeof globalThis.Symbol.iterator = globalThis.Symbol.iterator;

/**
 * `std::env::var(key)`. PORT: reads `process.env` (both sides of the harness run with the same
 * environment); a key that is empty or contains `=`/NUL is absent, as `getenv` reports it.
 */
function env_var(key: string): Result<string, VarError> {
  if (key === "" || key.includes("=") || key.includes("\0")) return Err({ $: "NotPresent" });
  const v = process.env[key];
  if (v === undefined) return Err({ $: "NotPresent" });
  return Ok(v);
}

/**
 * `cx.sess.env_depinfo.borrow_mut().insert((var, value))`. PORT: `Session.env_depinfo` is typed
 * `Set<string>` in session.ts (upstream `FxIndexSet<(Symbol, Option<Symbol>)>`); the pair is stored as
 * its JSON text until session.ts carries the tuple type. Only dep-info output reads it.
 */
function env_depinfo_insert(cx: ExtCtxt, var_: Symbol, value: Symbol | undefined): void {
  cx.sess.env_depinfo.add(JSON.stringify([var_, value ?? null]));
}

/** PORT: `str::escape_debug` (library/core/src/str/mod.rs:3149): `char::escape_debug` on every char. */
function str_escape_debug(s: string): string {
  let out = "";
  for (const c of s) out += escape_char(c.codePointAt(0)!, true, true);
  return out;
}
