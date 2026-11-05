// The alias checker's hooks into the compiler (lane mir-alias; test helper, not a port). Only the drivers in this directory
// load this file; nothing in a production path imports it. They replace, for the one process:
//
// - `MirDumper::new` / `dump_mir`: at every point where `-Zdump-mir=all` would dump a body (before and after every pass of
//   every `run_passes` list, including the ones behind `make_shim`, and at phase changes) the body is walked and nothing is
//   written;
// - `MirPatch::apply`: the body is walked after the patch lands, so a share that the pass removes again before it ends is
//   still seen.
//
// Two kinds of hit:
// - `ALIAS`: one object is reachable from two positions of one body (nested coroutine bodies included).
// - `CROSS`: an object of this body is still held by another body. Every walked object remembers its last owner. On a
//   collision the old owner is walked again, because promotion and coroutine lowering move objects, and a body that gave
//   an object away is not a share.
// - `CLONE`: `clone_Body(body)` still holds an object of `body`. `Inline` and `make_shim` edit such a clone in place, so a
//   shallow generated clone would reach back into the callee. Checked at phase changes, where the whole body is complete.
import { describe_object, find_shared_objects, is_immutable_hit, type SharedObject } from "./alias_check.ts";

export interface AliasHit extends SharedObject {
  kind: "ALIAS" | "CROSS" | "CLONE";
  /** `<pass>.<before|after>`, or `<pass>.apply` for a `MirPatch::apply` inside that pass. */
  where: string;
  def: string;
}

export interface AliasStats {
  walks: number;
  passes: Set<string>;
}

/** `[N]` and `{K}` removed: the same bug in two blocks of a body is one hit. */
export function normalize_path(path: string): string {
  return path.replace(/\[\d+\]/g, "[]").replace(/\{[^}]*\}/g, "{}");
}

export async function install_alias_hooks(on_hit: (hit: AliasHit) => void): Promise<AliasStats> {
  const { MirDumper, MirWriter } = await import("../../rustc_middle/mir/pretty.ts");
  const { MirPatch } = await import("../patch.ts");
  const { Body, clone_Body } = await import("../../rustc_middle/mir/mod.ts");

  const stats: AliasStats = { walks: 0, passes: new Set() };
  const reported = new Set<string>();
  const owner = new WeakMap<object, object>();
  /** A nested coroutine body's root: inside one root, `ALIAS` covers it. */
  const nested_in = new WeakMap<object, object>();
  /** `MirPatch::apply` receives the body but not the pass. */
  let current_pass = "?";
  let current_tcx: { def_path_str(d: unknown): string } | undefined;

  const root_of = (b: object): object => nested_in.get(b) ?? b;

  function emit(kind: AliasHit["kind"], where: string, body: { source: { def_id(): unknown } }, s: SharedObject): void {
    let def = "?";
    if (current_tcx !== undefined) {
      try {
        def = current_tcx.def_path_str(body.source.def_id());
      } catch {
        // No printable path: the hit still counts.
      }
    }
    const key = `${kind}|${def}|${s.what}|${normalize_path(s.first)}|${normalize_path(s.second)}`;
    if (reported.has(key)) return;
    reported.add(key);
    on_hit({ kind, where, def, ...s });
  }

  function check_clone(body: InstanceType<typeof Body>, where: string): void {
    const held = new Map<object, string>();
    find_shared_objects(body, "body", Number.MAX_SAFE_INTEGER, (o, path) => held.set(o, path));
    const hits: SharedObject[] = [];
    find_shared_objects(clone_Body(body), "clone", Number.MAX_SAFE_INTEGER, (o, path) => {
      const orig = held.get(o);
      if (orig !== undefined) hits.push({ what: describe_object(o), first: orig, second: path });
    });
    for (const s of hits) {
      if (is_immutable_hit(s.what, s.first, s.second)) continue;
      // The generated `clone_Body` copies this array one level. `clone_Body_with_annotations` is what the callers that run
      // before `CleanupPostBorrowck` use; the generator fix is in docs/handoff/mir-alias.md.
      if (/\.user_type_annotations\[\d+\]$/.test(s.first)) continue;
      emit("CLONE", where, body, s);
    }
  }

  function check(body: InstanceType<typeof Body>, where: string): void {
    stats.walks += 1;
    const collisions = new Map<object, [object, string][]>();
    const shared = find_shared_objects(body, "body", Number.MAX_SAFE_INTEGER, (o, path) => {
      if (o instanceof Body && o !== body) nested_in.set(o, root_of(body));
      const prev = owner.get(o);
      if (prev !== undefined && prev !== body && root_of(prev) !== root_of(body)) {
        let list = collisions.get(prev);
        if (list === undefined) collisions.set(prev, (list = []));
        list.push([o, path]);
      }
      owner.set(o, body);
    });
    for (const s of shared) {
      if (!is_immutable_hit(s.what, s.first, s.second)) emit("ALIAS", where, body, s);
    }
    for (const [other, objs] of collisions) {
      const held = new Map<object, string>();
      find_shared_objects(other, "other", Number.MAX_SAFE_INTEGER, (o, path) => held.set(o, path));
      for (const [o, path] of objs) {
        const other_path = held.get(o);
        if (other_path === undefined) continue;
        const what = describe_object(o);
        if (is_immutable_hit(what, other_path, path)) continue;
        emit("CROSS", where, body, { what, first: other_path, second: path });
      }
    }
  }

  const PHASES = new Set(["built", "analysis", "analysis-post-cleanup", "runtime", "runtime-post-cleanup", "runtime-optimized"]);
  // The borrowck / dataflow dumpers render graphviz and extra files, not through `dump_mir`.
  const NOT_DUMPED = new Set(["renumber", "nll", "polonius", "dataflow"]);
  MirDumper.new = function (tcx, pass_name, _body) {
    current_tcx = tcx as unknown as { def_path_str(d: unknown): string };
    return NOT_DUMPED.has(pass_name) ? undefined : new MirDumper(false, pass_name, "0", MirWriter.new(tcx));
  };
  MirDumper.prototype.dump_mir = function (this: InstanceType<typeof MirDumper>, body) {
    stats.passes.add(this.pass_name);
    current_pass = this.pass_name;
    check(body, `${this.pass_name}.${this.disambiguator}`);
    // `dump_mir_for_phase_change`: the pass name is the phase's.
    if (PHASES.has(this.pass_name)) check_clone(body, `${this.pass_name}.clone`);
  };
  const apply = MirPatch.prototype.apply;
  MirPatch.prototype.apply = function (this: InstanceType<typeof MirPatch>, body) {
    apply.call(this, body);
    check(body, `${current_pass}.apply`);
  };
  return stats;
}
