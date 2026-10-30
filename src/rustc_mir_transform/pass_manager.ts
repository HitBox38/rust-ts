// Port of compiler/rustc_mir_transform/src/pass_manager.rs (lane mt-skeleton).
//
// PORT: the traits `MirPass` and `MirLint` are abstract classes (precedent: rustc_middle mir/visit.ts, plan-m4 D4): a
// pass `extends MirPass` (a lint `extends MirLint`) and overrides; the provided methods (`name`, `profiler_name`,
// `is_mir_dump_enabled`) are the base class's methods. `&dyn MirPass<'tcx>` is a `MirPass`; a unit-struct pass value
// (`&simplify::SanityCheck`) is `new SanityCheck()`; a pass enum (`SimplifyCfg::Initial`) is a class with one frozen
// instance per variant, tagged `$` (`SimplifyCfg.Initial`), so `match self` is `switch (this.$)`.
// PORT: `std::any::type_name::<Self>()` (read by the provided `name`) is the abstract `type_name` property: every
// implementor declares its upstream path (`"rustc_mir_transform::sanity_check::SanityCheck"`), generic adapters
// compose it (`Lint<T>`).
//
// Init order: every pass module imports this module (for `MirPass` / `MirLint` / `PassPolicy`), so this module must not
// import a pass module (or lib.ts) at load: `crate::PASS_NAMES`, `crate::validate` and `crate::lint` are read lazily
// (`require`) inside the fns that use them.
import { writeSync } from "node:fs";
import type { Session } from "../rustc_session/session.ts";
import { OptLevel } from "../rustc_session/config.ts";
import type { DefId } from "../rustc_span/def_id.ts";
import type { CodegenFnAttrs } from "../rustc_middle/middle/codegen_fn_attrs.ts";
import { type Body, debug_MirPhase, MirPhase, MirPhase_cmp } from "../rustc_middle/mir/mod.ts";
import { MirDumper } from "../rustc_middle/mir/pretty.ts";
import type { TyCtxt } from "../rustc_middle/ty/context.ts";
import { DefKind } from "../rustc_hir/def.ts";
import { bug } from "../rustc_span/macros.ts";
import { panic, unported } from "../std/panic.ts";
import { PLAIN } from "../std/fmt.ts";
import { DiagSymbolList_from } from "../rustc_errors/diagnostic_impls.ts";
import * as diagnostics from "./diagnostics.ts";

// thread_local! {
/// Maps MIR pass names to a snake case form to match profiling naming style
const PASS_TO_PROFILER_NAMES: Map<string, string> = new Map();
// }

/// Converts a MIR pass name into a snake case form to match the profiling naming style.
// rustc: compiler/rustc_mir_transform/src/pass_manager.rs:26 to_profiler_name
function to_profiler_name(type_name: string): string {
  const e = PASS_TO_PROFILER_NAMES.get(type_name);
  if (e !== undefined) {
    return e;
  }
  let snake_case = "";
  for (const c of type_name) {
    if (c >= "A" && c <= "Z") {
      snake_case += "_" + c.toLowerCase();
    } else if (c === "-") {
      snake_case += "_";
    } else {
      snake_case += c;
    }
  }
  const result = `mir_pass${snake_case}`;
  PASS_TO_PROFILER_NAMES.set(type_name, result);
  return result;
}

// A function that simplifies a pass's type_name. E.g. `Baz`, `Baz<'_>`,
// `foo::bar::Baz`, and `foo::bar::Baz<'a, 'b>` all become `Baz`.
//
// It's `const` for perf reasons: it's called a lot, and doing the string
// operations at runtime causes a non-trivial slowdown. If
// `split_once`/`rsplit_once` become `const` its body could be simplified to
// this:
// ```ignore (fragment)
// let name = if let Some((_, tail)) = name.rsplit_once(':') { tail } else { name };
// let name = if let Some((head, _)) = name.split_once('<') { head } else { name };
// name
// ```
// rustc: compiler/rustc_mir_transform/src/pass_manager.rs:61 simplify_pass_type_name
export function simplify_pass_type_name(name: string): string {
  // FIXME(const-hack) Simplify the implementation once more `str` methods get const-stable.

  // Work backwards from the end. If a ':' is hit, strip it and everything before it.
  // PORT: `name.as_bytes()`: the scanned bytes ':' / '<' are ASCII, so UTF-16 indices split at the same places.
  let bytes = name;
  let i = bytes.length;
  while (i > 0 && bytes[i - 1] !== ":") {
    i -= 1;
  }
  bytes = bytes.slice(i);

  // Work forwards from the start of what's left. If a '<' is hit, strip it and everything after
  // it.
  i = 0;
  while (i < bytes.length && bytes[i] !== "<") {
    i += 1;
  }
  bytes = bytes.slice(0, i);

  // `std::str::from_utf8(bytes)`: always `Ok` (split at ASCII bytes).
  return bytes;
}

// rustc-type: compiler/rustc_mir_transform/src/pass_manager.rs:88 PassPolicy
/// Rules outlining when this pass may be overridden or suppressed.
export type PassPolicy =
  /// This pass implements a mandatory lowering step, either to implement parts of the MIR semantics
  /// or to bring MIR into a shape that is easier to deal with for later passes/codegen.
  /// Passes using this cannot be disabled via any means. They must not remove any UB, as they will
  /// run in Miri. They must also come with a comment justifying why they must always run.
  | { readonly $: "Required" }
  /// An optional pass that may be configured by `-Zmir-enable-passes`.
  | {
      readonly $: "Optional";
      /// Whether this pass should be enabled in the absence of an explicit
      /// `-Zmir-enable-passes` override.
      enabled_by_default: boolean;
    };
export const PassPolicy = {
  Required: Object.freeze({ $: "Required" as const }),

  /// Create a [`PassPolicy::Optional`] enabled by default under the given condition.
  // rustc: compiler/rustc_mir_transform/src/pass_manager.rs:104 optional
  optional(enabled_by_default: boolean): PassPolicy {
    return { $: "Optional", enabled_by_default };
  },
};

// rustc-trait: compiler/rustc_mir_transform/src/pass_manager.rs:112 MirPass
/// A streamlined trait that you can implement to create a pass; the
/// pass will be named after the type, and it will consist of a main
/// loop that goes over each available MIR and applies `run_pass`.
export abstract class MirPass {
  /** PORT: `std::any::type_name::<Self>()` (see the header). */
  abstract readonly type_name: string;

  // rustc: compiler/rustc_mir_transform/src/pass_manager.rs:113 name
  name(): string {
    return simplify_pass_type_name(this.type_name);
  }

  // rustc: compiler/rustc_mir_transform/src/pass_manager.rs:117 profiler_name
  profiler_name(): string {
    return to_profiler_name(this.name());
  }

  /// Describes how this pass is enabled and which mechanisms may disable it.
  // rustc: compiler/rustc_mir_transform/src/pass_manager.rs:122 policy
  abstract policy(ctx: PassCtx): PassPolicy;

  // rustc: compiler/rustc_mir_transform/src/pass_manager.rs:124 run_pass
  abstract run_pass(tcx: TyCtxt, body: Body): void;

  // rustc: compiler/rustc_mir_transform/src/pass_manager.rs:126 is_mir_dump_enabled
  is_mir_dump_enabled(): boolean {
    return true;
  }
}

// rustc-type: compiler/rustc_mir_transform/src/pass_manager.rs:132 PassCtx
// #[derive(Copy, Clone)]
export class PassCtx {
  constructor(
    /// Prefer [`Self::mir_opt_level`] to [`Session::mir_opt_level`] to account for overrides.
    public session: Session,
    /// The MIR optimization level for this body; may be overridden by `#[optimize]`.
    public body_mir_opt_level: number,
  ) {}

  // rustc: compiler/rustc_mir_transform/src/pass_manager.rs:140 for_body
  static for_body(tcx: TyCtxt, def_id: DefId): PassCtx {
    let body_mir_opt_level: number;
    if (!DefKind.has_codegen_attrs(tcx.def_kind(def_id))) {
      body_mir_opt_level = tcx.sess.mir_opt_level();
    } else {
      // PORT: the `codegen_fn_attrs` query value is `unknown` in queries.gen.ts.
      switch ((tcx.codegen_fn_attrs(def_id) as CodegenFnAttrs).optimize) {
        case "Default":
          body_mir_opt_level = tcx.sess.mir_opt_level();
          break;
        case "DoNotOptimize":
          body_mir_opt_level = OptLevel.mir_opt_level(OptLevel.No);
          break;
        case "Speed":
          body_mir_opt_level = OptLevel.mir_opt_level(OptLevel.Aggressive);
          break;
        case "Size":
          body_mir_opt_level = OptLevel.mir_opt_level(OptLevel.Size);
          break;
      }
    }
    return new PassCtx(tcx.sess, body_mir_opt_level);
  }

  /// The effective MIR optimization level for this body, including `#[optimize]` overrides.
  // rustc: compiler/rustc_mir_transform/src/pass_manager.rs:155 mir_opt_level
  mir_opt_level(): number {
    return this.body_mir_opt_level;
  }

  // impl std::ops::Deref for PassCtx<'_> { type Target = Session; }
  // rustc: compiler/rustc_mir_transform/src/pass_manager.rs:163 deref
  deref(): Session {
    return this.session;
  }
}

// rustc-trait: compiler/rustc_mir_transform/src/pass_manager.rs:170 MirLint
/// Just like `MirPass`, except it cannot mutate `Body`, and MIR dumping is
/// disabled (via the `Lint` adapter).
export abstract class MirLint {
  /** PORT: `std::any::type_name::<Self>()` (see the header). */
  abstract readonly type_name: string;

  // rustc: compiler/rustc_mir_transform/src/pass_manager.rs:171 name
  name(): string {
    return simplify_pass_type_name(this.type_name);
  }

  // rustc: compiler/rustc_mir_transform/src/pass_manager.rs:175 run_lint
  abstract run_lint(tcx: TyCtxt, body: Body): void;
}

// rustc-type: compiler/rustc_mir_transform/src/pass_manager.rs:180 Lint
/// An adapter for `MirLint`s that implements `MirPass`.
// #[derive(Debug, Clone)]
export class Lint<T extends MirLint = MirLint> extends MirPass {
  constructor(public _0: T) {
    super();
  }

  get type_name(): string {
    return `rustc_mir_transform::pass_manager::Lint<${this._0.type_name}>`;
  }

  // rustc: compiler/rustc_mir_transform/src/pass_manager.rs:186 name
  override name(): string {
    return this._0.name();
  }

  // rustc: compiler/rustc_mir_transform/src/pass_manager.rs:190 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    this._0.run_lint(tcx, body);
  }

  // rustc: compiler/rustc_mir_transform/src/pass_manager.rs:194 is_mir_dump_enabled
  override is_mir_dump_enabled(): boolean {
    return false;
  }

  // rustc: compiler/rustc_mir_transform/src/pass_manager.rs:198 policy
  policy(_ctx: PassCtx): PassPolicy {
    return PassPolicy.optional(true);
  }
}

// rustc-type: compiler/rustc_mir_transform/src/pass_manager.rs:203 WithMinOptLevel
export class WithMinOptLevel<T extends MirPass = MirPass> extends MirPass {
  constructor(
    public _0: number,
    public _1: T,
  ) {
    super();
  }

  get type_name(): string {
    return `rustc_mir_transform::pass_manager::WithMinOptLevel<${this._1.type_name}>`;
  }

  // rustc: compiler/rustc_mir_transform/src/pass_manager.rs:209 name
  override name(): string {
    return this._1.name();
  }

  // rustc: compiler/rustc_mir_transform/src/pass_manager.rs:213 run_pass
  run_pass(tcx: TyCtxt, body: Body): void {
    this._1.run_pass(tcx, body);
  }

  // rustc: compiler/rustc_mir_transform/src/pass_manager.rs:217 policy
  policy(ctx: PassCtx): PassPolicy {
    const policy = this._1.policy(ctx);
    switch (policy.$) {
      case "Required":
        return bug("required pass cannot be gated by an opt level");
      case "Optional":
        return { $: "Optional", enabled_by_default: policy.enabled_by_default && ctx.mir_opt_level() >= this._0 };
    }
  }
}

/// Run the sequence of passes without validating the MIR after each pass. The MIR is still
/// validated at the end.
// rustc: compiler/rustc_mir_transform/src/pass_manager.rs:230 run_passes_no_validate
export function run_passes_no_validate(tcx: TyCtxt, body: Body, passes: readonly MirPass[], phase_change: MirPhase | undefined): void {
  run_passes_inner(tcx, body, passes, phase_change, false);
}

/// The optional `phase_change` is applied after executing all the passes, if present
// rustc: compiler/rustc_mir_transform/src/pass_manager.rs:240 run_passes
export function run_passes(tcx: TyCtxt, body: Body, passes: readonly MirPass[], phase_change: MirPhase | undefined): void {
  run_passes_inner(tcx, body, passes, phase_change, true);
}

// rustc: compiler/rustc_mir_transform/src/pass_manager.rs:249 should_run_pass
export function should_run_pass(pass: MirPass, ctx: PassCtx): boolean {
  const name = pass.name();
  const pass_override = (): boolean | undefined => {
    const passes = ctx.deref().opts.unstable_opts.mir_enable_passes;
    for (let i = passes.length - 1; i >= 0; i--) {
      const [name_, polarity] = passes[i]!;
      if (name === name_) {
        return polarity;
      }
    }
    return undefined;
  };

  const policy = pass.policy(ctx);
  switch (policy.$) {
    case "Required":
      return true;
    case "Optional": {
      const o = pass_override();
      if (o !== undefined) {
        // trace!(pass = %name, "{} as requested by flag", if o { "Running" } else { "Not running" });
        return o;
      } else {
        return policy.enabled_by_default;
      }
    }
  }
}

/** `crate::PASS_NAMES` (lib.ts; read lazily, see the header). */
function PASS_NAMES(): Set<string> {
  return (lib__m ??= require("./lib.ts") as typeof import("./lib.ts")).PASS_NAMES();
}
var lib__m: typeof import("./lib.ts") | undefined; // PORT: (perf) lazy-require memo (precedent: perf-intern)

/** `body.phase == phase` (`#[derive(PartialEq)]` of `MirPhase`). */
function phase_eq(a: MirPhase, b: MirPhase): boolean {
  return MirPhase_cmp(a, b) === 0;
}

// rustc: compiler/rustc_mir_transform/src/pass_manager.rs:280 run_passes_inner
function run_passes_inner(tcx: TyCtxt, body: Body, passes: readonly MirPass[], phase_change: MirPhase | undefined, validate_each: boolean): void {
  const overridden_passes = tcx.sess.opts.unstable_opts.mir_enable_passes;
  // trace!(?overridden_passes);

  const named_passes: Set<string> = new Set(overridden_passes.map(([name, _]) => name));

  let unknown_found = false;
  const pass_names = PASS_NAMES();
  for (const name of named_passes) {
    if (pass_names.has(name)) continue;
    tcx.dcx().emit_warn(diagnostics.UnknownPassName_diagnostic({ name }));
    unknown_found = true;
  }

  if (unknown_found) {
    const valid_pass_names = [...PASS_NAMES()];
    // PORT: `<[&str]>::sort` compares bytes; the pass names are ASCII, so UTF-16 order is the same.
    valid_pass_names.sort();
    tcx.dcx().emit_note(diagnostics.ValidPassNames_diagnostic({ valid_passes: DiagSymbolList_from(valid_pass_names) }));
  }

  // Verify that no passes are missing from the `declare_passes` invocation
  // #[cfg(debug_assertions)] { .. }  (rustc ships without debug assertions)

  // PORT: `tcx.sess.prof.enabled()` is `self.profiler.is_some()` (the session's `SelfProfilerRef` stand-in has no
  // `enabled`; its profiler is always `None` unless `-Z self-profile`, which is unported).
  const prof_arg = tcx.sess.prof.profiler !== undefined ? unported("rustc_data_structures::profiling::SelfProfilerRef::generic_activity_with_arg (-Z self-profile)") : undefined;

  if (!body.should_skip()) {
    const validate = validate_each && tcx.sess.opts.unstable_opts.validate_mir;
    const lint = tcx.sess.opts.unstable_opts.lint_mir;

    const ctx = PassCtx.for_body(tcx, body.source.def_id());

    for (const pass of passes) {
      const pass_name = pass.name();

      if (!should_run_pass(pass, ctx)) {
        continue;
      }

      let limit: number | undefined;
      if (
        phase_eq(body.phase, { $: "Runtime", _0: "PostCleanup" }) &&
        phase_change !== undefined &&
        phase_eq(phase_change, { $: "Runtime", _0: "Optimized" }) &&
        (limit = tcx.sess.opts.unstable_opts.mir_opt_bisect_limit) !== undefined &&
        pass.policy(ctx).$ === "Optional" &&
        limited_by_opt_bisect(tcx, tcx.def_path_debug_str(body.source.def_id()), limit, pass)
      ) {
        continue;
      }

      let dumper: MirDumper | undefined;
      let d: MirDumper | undefined;
      if (pass.is_mir_dump_enabled() && (d = MirDumper.new(tcx, pass_name, body)) !== undefined) {
        dumper = d.set_show_pass_num().set_disambiguator("before");
      } else {
        dumper = undefined;
      }

      if (dumper !== undefined) {
        dumper.dump_mir(body);
      }

      if (prof_arg !== undefined) {
        unported("rustc_data_structures::profiling::SelfProfilerRef::generic_activity_with_arg (-Z self-profile)");
      } else {
        pass.run_pass(tcx, body);
      }

      if (dumper !== undefined) {
        dumper.set_disambiguator("after").dump_mir(body);
      }

      if (validate) {
        validate_body(tcx, body, `after pass ${pass_name}`);
      }
      if (lint) {
        lint_body(tcx, body, `after pass ${pass_name}`);
      }

      body.pass_count += 1;
    }
  }

  if (phase_change !== undefined) {
    const new_phase = phase_change;
    if (MirPhase_cmp(body.phase, new_phase) >= 0) {
      panic(`Invalid MIR phase transition from ${debug_MirPhase(body.phase, PLAIN)} to ${debug_MirPhase(new_phase, PLAIN)}`);
    }

    body.phase = new_phase;
    body.pass_count = 0;

    dump_mir_for_phase_change(tcx, body);

    const validate =
      (validate_each && tcx.sess.opts.unstable_opts.validate_mir && !body.should_skip()) || phase_eq(new_phase, { $: "Runtime", _0: "Optimized" });
    const lint = tcx.sess.opts.unstable_opts.lint_mir && !body.should_skip();
    if (validate) {
      validate_body(tcx, body, `after phase change to ${MirPhase.name(new_phase)}`);
    }
    if (lint) {
      lint_body(tcx, body, `after phase change to ${MirPhase.name(new_phase)}`);
    }

    body.pass_count = 1;
  }
}

/** `crate::lint::lint_body` (read lazily, see the header). */
function lint_body(tcx: TyCtxt, body: Body, when: string): void {
  (require("./lint.ts") as typeof import("./lint.ts")).lint_body(tcx, body, when);
}

// rustc: compiler/rustc_mir_transform/src/pass_manager.rs:411 validate_body
export function validate_body(tcx: TyCtxt, body: Body, when: string): void {
  const validate = require("./validate.ts") as typeof import("./validate.ts");
  new validate.Validator(when).run_pass(tcx, body);
}

// rustc: compiler/rustc_mir_transform/src/pass_manager.rs:415 dump_mir_for_phase_change
export function dump_mir_for_phase_change(tcx: TyCtxt, body: Body): void {
  if (!(body.pass_count === 0)) {
    panic(`assertion \`left == right\` failed\n  left: ${body.pass_count}\n right: 0`);
  }
  const dumper = MirDumper.new(tcx, MirPhase.name(body.phase), body);
  if (dumper !== undefined) {
    dumper.set_show_pass_num().set_disambiguator("after").dump_mir(body);
  }
}

/** `eprintln!` (PORT: synchronous write to fd 2, as rustc_query_impl/job.ts). */
function eprintln(s: string): void {
  const buf = new TextEncoder().encode(`${s}\n`);
  let off = 0;
  while (off < buf.length) off += writeSync(2, buf, off);
}

// rustc: compiler/rustc_mir_transform/src/pass_manager.rs:422 limited_by_opt_bisect
function limited_by_opt_bisect(tcx: TyCtxt, def_path: string, limit: number, pass: MirPass): boolean {
  // `fetch_add(1, Ordering::Relaxed)`
  const current_opt_bisect_count = tcx.sess.mir_opt_bisect_eval_count;
  tcx.sess.mir_opt_bisect_eval_count = current_opt_bisect_count + 1;

  const can_run = current_opt_bisect_count < limit;

  if (can_run) {
    eprintln(`BISECT: running pass (${current_opt_bisect_count + 1}) ${pass.name()} on ${def_path}`);
  } else {
    eprintln(`BISECT: NOT running pass (${current_opt_bisect_count + 1}) ${pass.name()} on ${def_path}`);
  }

  return !can_run;
}
