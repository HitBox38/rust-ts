// Oracle check of `check_liveness` (lane mt-liveness: liveness.ts) against the pinned nightly rustc.
//
// `check_liveness` reads `mir_promoted`, whose passes are not all ported yet (`mir_built`'s list stops at
// `LintAndRemoveUninhabited`, lane mt-built-lints; `PromoteTemps`, lane mt-promote). This test overrides `mir_promoted`
// with a stand-in: `build_mir_inner_impl` (the real MIR builder), then the two ported passes of the chain that change
// the CFG, `SimplifyCfg::Initial` and `SimplifyCfg::PromoteConsts`. The skipped passes are lints, promotion and
// `LintAndRemoveUninhabited`; the fixture has nothing they would change (no promotable borrows, no uninhabited calls).
// The driver runs tydump's analysis prefix, then `check_liveness` for every body owner (as the MIR_borrow_checking loop).
//
// The diagnostics module of rustc_mir_transform is pending (lane mt-built-lints; liveness.ts "PORT(pending
// mt-built-lints)"), so `emit_node_span_lint` is intercepted for `unused_variables` / `unused_assignments` and each
// emitted lint (level from `lint_level_spec_at_node`, allowed ones dropped as rustc drops them) is turned into what
// diagnostics.rs makes of its struct: level, message, primary spans, span labels and the help / note / suggestion
// children with their suggestion parts. The oracle's `--error-format=json` diagnostics with those lint codes give the
// same shape (children / labels outside diagnostics.rs's messages, i.e. the lint-level note, are dropped), in order.
// MERGE NOTE: when the generated diagnostics replace the pending block, decorators no longer carry `pending`; switch
// this test to the rendered stderr (the decorator through the real `emit_node_span_lint`).
// Skips (visibly) if rustc is unavailable; fails instead under RUST_TS_REQUIRE_PROBES=1.
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, PIN } from "../../scripts/lib/common.ts";
import "../rustc_session/lib.ts";
import type { Crate } from "../rustc_ast/lib.ts";
import { Steal } from "../rustc_data_structures/steal.ts";
import { compiler_entrypoint } from "../rustc_driver_impl/lib.ts";
import type { Diagnostic } from "../rustc_errors/lib.ts";
import "../rustc_hir_analysis/lib.ts";
import { type Config, run_compiler } from "../rustc_interface/interface.ts";
import { create_and_enter_global_ctxt, parse } from "../rustc_interface/passes.ts";
import type { Lint } from "../rustc_lint_defs/lib.ts";
import { UNUSED_ASSIGNMENTS, UNUSED_VARIABLES } from "../rustc_lint_defs/builtin.ts";
import "../rustc_middle/lib.ts";
import type { Body } from "../rustc_middle/mir/mod.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import type { Providers } from "../rustc_middle/util/mod.ts";
import type { HirId } from "../rustc_hir_id/lib.ts";
import { run_required_analyses_prefix } from "../rust_ts/tydump_dump.ts";
import { LocalDefId } from "../rustc_span/def_id.ts";
import { Span } from "../rustc_span/lib.ts";
import { Symbol } from "../rustc_span/symbol.ts";
import "./lib.ts";
import type { PendingDiagnostic } from "./liveness.ts";
import { SimplifyCfg } from "./simplify.ts";

const REQUIRE = process.env.RUST_TS_REQUIRE_PROBES === "1";
const RUSTC = ["rustc", `+${PIN.toolchain}`];
function rustcAvailable(): boolean {
  try {
    return Bun.spawnSync([...RUSTC, "-vV"]).stdout.toString().includes(`commit-hash: ${PIN.commit}`);
  } catch {
    return false;
  }
}
const HAVE = rustcAvailable();
const SKIP = !HAVE && !REQUIRE;
if (SKIP) console.log(`SKIP: pinned rustc (${PIN.toolchain}, ${PIN.commit.slice(0, 12)}) unavailable; RUST_TS_REQUIRE_PROBES=1 makes this a failure`);

const WORK = join(DATA, "tmp", "liveness-oracle", process.env.RUST_TS_AGENT ?? "default");

class CaptureConfig extends Error {}
function config_from_args(args: string[]): Config {
  let config: Config | undefined;
  try {
    compiler_entrypoint(["rustc", ...args], {
      config(c: Config) {
        config = c;
        throw new CaptureConfig();
      },
    });
  } catch (e) {
    if (!(e instanceof CaptureConfig)) throw e;
  }
  if (config === undefined) throw new Error("ERROR: no config");
  return config;
}

/** One lint as diagnostics.rs renders it (the comparable parts). */
interface Shape {
  level: string;
  message: string;
  primary: string[];
  labels: string[];
  children: string[];
}

// The messages of diagnostics.rs (compiler/rustc_mir_transform/src/diagnostics.rs:186-330).
const M = {
  interp_label: "you might have meant to use string interpolation in this string literal",
  interp_sugg: "string interpolation only works in `format!` invocations",
  try_ignore: "try ignoring the field",
  try_prefix: "if this is intentional, prefix it with an underscore",
  typo: (kind: string, item: string) => `you might have meant to pattern match on the similarly named ${kind} \`${item}\``,
  no_sugg: (name: string) => `\`${name}\` is captured in macro and introduced a unused variable`,
  assigned_only_note: (name: string) => `consider using \`_${name}\` instead`,
  overwrite_assigned: "this value is reassigned later and never used",
  overwrite_here: (name: string) => `\`${name}\` is overwritten here before the previous value is read`,
  mut_sugg: "you might have meant to mutate the pointed at value being passed in, instead of changing the reference in the local binding",
  overwritten_help: "maybe it is overwritten before being read?",
  capture_help: "did you mean to capture by reference instead?",
};
const KNOWN_CHILD = (m: string) =>
  [M.interp_sugg, M.try_ignore, M.try_prefix, M.mut_sugg, M.overwritten_help, M.capture_help].includes(m) ||
  m.startsWith("you might have meant to pattern match on the similarly named ") ||
  / is captured in macro and introduced a unused variable$/.test(m) ||
  /^consider using `_.*` instead$/.test(m);
const KNOWN_LABEL = (m: string) => m === M.interp_label || m === M.overwrite_assigned || / is overwritten here before the previous value is read$/.test(m);

// ---- the oracle side: rustc's JSON diagnostics ----------------------------------------------------------------------
interface JSpan {
  line_start: number;
  column_start: number;
  line_end: number;
  column_end: number;
  is_primary: boolean;
  label: string | null;
  suggested_replacement: string | null;
}
interface JDiag {
  message: string;
  code: { code: string } | null;
  level: string;
  spans: JSpan[];
  children: JDiag[];
}
const jrange = (s: JSpan) => `${s.line_start}:${s.column_start}-${s.line_end}:${s.column_end}`;
function child_text(message: string, parts: string[]): string {
  return parts.length === 0 ? message : `${message} [${parts.sort().join(", ")}]`;
}
function oracle_shapes(stderr: string): Shape[] {
  const out: Shape[] = [];
  for (const line of stderr.split("\n")) {
    if (!line.startsWith("{")) continue;
    const d = JSON.parse(line) as JDiag;
    if (d.code === null || !["unused_variables", "unused_assignments"].includes(d.code.code)) continue;
    out.push({
      level: d.level,
      message: d.message,
      primary: d.spans.filter((s) => s.is_primary).map(jrange).sort(),
      labels: d.spans.filter((s) => s.label !== null && KNOWN_LABEL(s.label)).map((s) => `${jrange(s)} ${s.label}`).sort(),
      children: d.children
        .filter((c) => KNOWN_CHILD(c.message))
        .map((c) => child_text(c.message, c.spans.filter((s) => s.suggested_replacement !== null).map((s) => `${jrange(s)}=>${s.suggested_replacement}`)))
        .sort(),
    });
  }
  return out;
}

// ---- our side: the pending structs of liveness.ts -------------------------------------------------------------------
type V = Record<string, unknown>;
function our_shape(tcx: TyCtxt, level: string, span: Span | Span[], pending: PendingDiagnostic["pending"]): Shape {
  const sm = tcx.sess.source_map();
  const pos = (sp: Span) => {
    const lo = sm.lookup_char_pos(Span.lo(sp));
    const hi = sm.lookup_char_pos(Span.hi(sp));
    return `${lo.line}:${lo.col + 1}-${hi.line}:${hi.col + 1}`;
  };
  const sym = (s: unknown) => Symbol.as_str(s as Symbol);
  const v = pending.value as V;
  const name = sym(v.name);
  const labels: string[] = [];
  const children: string[] = [];
  const typo = (t: unknown) => {
    if (t === undefined) return;
    const tv = t as V;
    children.push(child_text(M.typo(tv.kind as string, sym(tv.item_name)), [`${pos(tv.span as Span)}=>${tv.code as string}`]));
  };
  let message: string;
  switch (pending.type) {
    case "UnusedVariable": {
      message = `unused variable: \`${name}\``;
      for (const si of v.string_interp as V[]) {
        const lit = si.lit as Span;
        labels.push(`${pos(lit)} ${M.interp_label}`);
        children.push(child_text(M.interp_sugg, [`${pos(Span.shrink_to_lo(lit))}=>format!(`, `${pos(Span.shrink_to_hi(lit))}=>)`]));
      }
      const sugg = v.sugg as V & { $: string };
      if (sugg.$ === "TryIgnore") {
        const sname = sugg.name as string;
        children.push(
          child_text(M.try_ignore, [
            ...(sugg.shorthands as Span[]).map((s) => `${pos(s)}=>${sname}: _`),
            ...(sugg.non_shorthands as Span[]).map((s) => `${pos(s)}=>_`),
          ]),
        );
      } else if (sugg.$ === "TryPrefix") {
        children.push(child_text(M.try_prefix, (sugg.spans as Span[]).map((s) => `${pos(s)}=>_${sym(sugg.name)}`)));
        typo(sugg.typo);
      } else {
        children.push(M.no_sugg(sym(sugg.name)));
      }
      break;
    }
    case "UnusedVarAssignedOnly":
      message = `variable \`${name}\` is assigned to, but never used`;
      children.push(M.assigned_only_note(name));
      typo(v.typo);
      break;
    case "UnusedAssign": {
      message = `value assigned to \`${name}\` is never read`;
      const o = v.overwrite as V | undefined;
      if (o !== undefined) {
        labels.push(`${pos(o.assigned_span as Span)} ${M.overwrite_assigned}`);
        labels.push(`${pos(o.overwrite_span as Span)} ${M.overwrite_here(sym(o.name))}`);
      }
      const s = v.suggestion as V | undefined;
      if (s !== undefined) {
        const parts = [`${pos(s.ty_ref_span as Span)}=>`, `${pos(s.pre_lhs_span as Span)}=>*`, `${pos(s.rhs_borrow_span as Span)}=>`];
        if (s.ty_span !== undefined) parts.push(`${pos(s.ty_span as Span)}=>${s.pre as string}mut `);
        children.push(child_text(M.mut_sugg, parts));
      }
      if (v.help === true) children.push(M.overwritten_help);
      break;
    }
    case "UnusedAssignPassed":
      message = `value passed to \`${name}\` is never read`;
      children.push(M.overwritten_help);
      break;
    case "UnusedCaptureMaybeCaptureRef":
      message = `value captured by \`${name}\` is never read`;
      children.push(M.capture_help);
      break;
    default:
      throw new Error(`ERROR: unknown pending diagnostic ${pending.type}`);
  }
  return {
    level,
    message,
    primary: (Array.isArray(span) ? span : [span]).map(pos).sort(),
    labels: labels.sort(),
    children: children.sort(),
  };
}

/** Runs the ported driver (see the header) and returns the liveness lints it emitted. */
function port_shapes(file: string, flags: string[]): Shape[] {
  const out: Shape[] = [];
  const config = config_from_args([...flags, file]);
  config.override_queries = (_sess: unknown, providers: Providers): void => {
    providers.queries.mir_promoted = (tcx, def) => {
      const body = tcx.build_mir_inner_impl(def) as Body;
      SimplifyCfg.Initial.run_pass(tcx, body);
      SimplifyCfg.PromoteConsts.run_pass(tcx, body);
      return [Steal.new(body, "mir::Body"), Steal.new<Body[]>([], "IndexVec<Promoted, mir::Body>")];
    };
  };
  let ran = false;
  run_compiler(config, (compiler) => {
    const krate: Crate = parse(compiler.sess);
    create_and_enter_global_ctxt(compiler, krate, (tcx) => {
      void tcx.resolver_for_lowering();
      run_required_analyses_prefix(tcx);
      const orig = tcx.emit_node_span_lint.bind(tcx);
      tcx.emit_node_span_lint = (lint: Lint, hir_id: HirId, span, decorator: Diagnostic): void => {
        if (lint !== UNUSED_VARIABLES && lint !== UNUSED_ASSIGNMENTS) return orig(lint, hir_id, span, decorator);
        const level = tcx.lint_level_spec_at_node(lint, hir_id).level;
        if (level === "Allow" || level === "Expect") return;
        const pending = (decorator as Partial<PendingDiagnostic>).pending;
        if (pending === undefined) throw new Error("ERROR: decorator without `pending` (see MERGE NOTE)");
        out.push(our_shape(tcx, level === "Warn" || level === "ForceWarn" ? "warning" : "error", span as Span | Span[], pending));
      };
      tcx.par_hir_body_owners((def_id) => {
        if (tcx.is_trivial_const(def_id)) return;
        void LocalDefId;
        tcx.ensure_ok().check_liveness(def_id);
      });
      ran = true;
    });
  });
  expect(ran).toBe(true);
  return out;
}

// A no_core crate with the lang items the bodies need. Bodies: an unused argument, an unused local, an assigned-only
// local, a dead store overwritten later, an argument overwritten before use, `+=` self-assignments, a binding used only
// in a match guard, an unused match binding, struct-pattern shorthands, underscore names, a loop with a dead
// assignment, a binding that looks like a unit variant (typo suggestion), and a `mut` reference argument reassigned
// with a borrow (the `annotate_mut_binding_to_immutable_binding` suggestion).
const SRC = [
  "#![feature(no_core, lang_items)]",
  "#![no_core]",
  "#![allow(internal_features, non_snake_case)]",
  "#[lang = \"pointee_sized\"] pub trait PointeeSized {}",
  "#[lang = \"meta_sized\"] pub trait MetaSized: PointeeSized {}",
  "#[lang = \"sized\"] pub trait Sized: MetaSized {}",
  "#[lang = \"copy\"] pub trait Copy {}",
  "impl Copy for u8 {}",
  "impl Copy for bool {}",
  "impl<T: ?Sized> Copy for &T {}",
  "#[lang = \"add\"] pub trait Add<Rhs = Self> { type Output; fn add(self, rhs: Rhs) -> Self::Output; }",
  "impl Add for u8 { type Output = u8; fn add(self, rhs: u8) -> u8 { self + rhs } }",
  "#[lang = \"add_assign\"] pub trait AddAssign<Rhs = Self> { fn add_assign(&mut self, rhs: Rhs); }",
  "impl AddAssign for u8 { fn add_assign(&mut self, rhs: u8) { *self += rhs } }",
  "#[lang = \"legacy_receiver\"] pub trait LegacyReceiver {}",
  "impl<T: ?Sized> LegacyReceiver for &T {}",
  "impl<T: ?Sized> LegacyReceiver for &mut T {}",
  "#[lang = \"eq\"] pub trait PartialEq<Rhs: ?Sized = Self> { fn eq(&self, other: &Rhs) -> bool; }",
  "impl PartialEq for u8 { fn eq(&self, other: &u8) -> bool { *self == *other } }",
  "pub fn unused_param(x: u8) {}",
  "pub fn unused_local() { let y = 5u8; }",
  "pub fn assigned_only() { let mut z = 1u8; z = 2; }",
  "pub fn dead_store(a: u8) -> u8 { let mut b = a; b = 3; b }",
  "pub fn param_overwritten(mut p: u8) -> u8 { p = 4; p }",
  "pub fn self_add(mut c: u8) -> u8 { c += 1; 0 }",
  "pub fn self_add_used(mut d: u8) -> u8 { d += 1; d }",
  "pub enum Opt { Nothing, Just(u8) }",
  "pub fn guard_only(o: Opt) -> u8 { match o { Opt::Just(v) if v == 3 => 1, _ => 0 } }",
  "pub fn unused_arm(o: Opt) -> u8 { match o { Opt::Just(w) => 1, Opt::Nothing => 0 } }",
  "pub struct P { pub a: u8, pub b: u8 }",
  "pub fn shorthand(p: P) -> u8 { let P { a, b } = p; a }",
  "pub fn underscore(_u: u8) { let _v = 1u8; }",
  "pub fn last_assign(n: u8) -> u8 { let mut i = 0u8; let mut last = 0u8; loop { last = i; i = i + 1; if i == n { break; } } i }",
  "pub fn typo(o: Opt) -> u8 { match o { Nothng => 0 } }",
  "pub fn out_param<'a>(mut r: &'a u8, s: &'a u8) { r = &*s; }",
].join("\n");

function compare(name: string, src: string): void {
  mkdirSync(WORK, { recursive: true });
  const file = join(WORK, `${name}.rs`);
  writeFileSync(file, src);
  const flags = ["--crate-type", "lib", "--edition", "2024"];
  const o = Bun.spawnSync([...RUSTC, ...flags, "--error-format=json", "--emit=metadata", "-o", join(WORK, `lib${name}.rmeta`), file], {
    cwd: WORK,
    env: { ...process.env, RUSTC_ICE: "0", RUST_BACKTRACE: "0" },
  });
  if (o.exitCode !== 0) throw new Error(`ERROR: oracle failed: ${o.stderr.toString()}`);
  const oracle = oracle_shapes(o.stderr.toString());
  expect(oracle.length).toBeGreaterThan(3);

  const port = port_shapes(file, flags);
  const fmt = (s: Shape[]) => s.map((x) => JSON.stringify(x)).join("\n");
  if (process.env.LIVENESS_ORACLE_SHOW === "1") console.log(fmt(oracle));
  console.log(`liveness ${name}: ${oracle.length} oracle lints (${oracle.filter((x) => x.children.length + x.labels.length > 1).length} with several labels/children)`);
  expect(fmt(port)).toBe(fmt(oracle));
}

test.skipIf(SKIP)("check_liveness: unused_variables / unused_assignments as the oracle reports them", () => {
  compare("liveness", SRC);
});

// Closures (captures by value / by reference, an `FnMut` closure whose returns become `goto bb0`, dead captures passed
// back to the parent through the `check_liveness` query).
const CLOSURES = [
  "#![feature(no_core, lang_items, unboxed_closures)]",
  ...SRC.split("\n").slice(1, 19),
  "#[lang = \"tuple_trait\"] pub trait Tuple {}",
  "#[lang = \"fn_once\"] pub trait FnOnce<Args: Tuple> { #[lang = \"fn_once_output\"] type Output; extern \"rust-call\" fn call_once(self, args: Args) -> Self::Output; }",
  "#[lang = \"fn_mut\"] pub trait FnMut<Args: Tuple>: FnOnce<Args> { extern \"rust-call\" fn call_mut(&mut self, args: Args) -> Self::Output; }",
  "#[lang = \"fn\"] pub trait Fn<Args: Tuple>: FnMut<Args> { extern \"rust-call\" fn call(&self, args: Args) -> Self::Output; }",
  "pub fn move_assign(a: u8) -> u8 { let mut x = a; let f = move || { x = 5; }; a }",
  "pub fn ref_assign(a: u8) -> u8 { let mut x = a; let f = || { x = 6; }; x }",
  "pub fn unused_closures(a: u8) -> u8 { let x = a; let g = || x; let h = || 0u8; 1 }",
  "pub fn dead_capture(a: u8) -> u8 { let x = a; let k = move || { let y = x; 0u8 }; 2 }",
  "pub fn used_capture(a: u8) -> u8 { let x = a; let m = || x; 3 }",
].join("\n");

test.skipIf(SKIP)("check_liveness: closures and captures as the oracle reports them", () => {
  compare("liveness_closures", CLOSURES);
});
