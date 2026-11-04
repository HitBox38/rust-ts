// Unit tests of tree_borrows/diagnostics.rs (lane miri-tb-b) that need nothing of lane miri-tb-a: the tree printing compared
// byte for byte with the oracle (oracle/print_state.stderr), and the texts that hold no `Permission`. Upstream has no
// `#[cfg(test)]` tests for this file. The tests of real trees and of the error texts with permissions are
// tree_scenarios.test.ts.pending-tb-a (docs/handoff/miri-tb-b.md).
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type BorTag } from "../mod.ts";
import {
  AccessCause,
  DEFAULT_FORMATTER,
  DiagnosticInfo,
  display_AccessCause,
  display_NodeDebugInfo,
  DisplayFmt,
  DisplayIndent,
  type Event,
  History,
  NodeDebugInfo,
  no_valid_exposed_references_error,
} from "./diagnostics.ts";
import { Permission, PermissionPriv, PermTransition } from "./perms.ts";
import { AccessRelatedness, LocationState } from "./tree.ts";
import { TerminationInfoStop } from "../../diagnostics.ts";
import { type AllocId, type InterpErrorKind } from "../../../rustc_middle/mir/interpret/mod.ts";
import { type Span } from "../../../rustc_span/lib.ts";
import { Panic } from "../../../std/panic.ts";

const ORACLE = join(dirname(import.meta.path), "oracle");
const T = (n: number) => n as BorTag;
const SPAN = 11 as Span;
/** Stands in for a `Permission`: the printing only asks for `short_name()` (lane miri-tb-a). */
const P = (short_name: string) => ({ short_name: () => short_name }) as unknown as Permission;

/** The stderr lines of `name`'s UB report: title, then every `= help:` / `help:` text except the two fixed ones. */
function ub_lines(name: string): string[] {
  const lines = readFileSync(join(ORACLE, `${name}.stderr`), "utf8").split("\n");
  const start = lines.findIndex((l) => l.startsWith("error: Undefined Behavior: "));
  const out = [lines[start]!.slice("error: Undefined Behavior: ".length)];
  for (const l of lines.slice(start + 1)) {
    const m = /^(?:\s*= )?help: (.*)$/.exec(l);
    if (m === null || m[1]!.startsWith("this indicates a potential bug") || m[1]!.startsWith("see https://github.com/rust-lang/unsafe-code-guidelines")) continue;
    out.push(m[1]!);
  }
  return out;
}

function tb_ub(kind: InterpErrorKind): { title: string; details: string[]; history: [Span | undefined, string][] } {
  if (kind.$ !== "MachineStop") throw new Error(`expected MachineStop, got ${kind.$}`);
  const info = (kind._0 as TerminationInfoStop).info;
  if (info.$ !== "TreeBorrowsUb") throw new Error(`expected TreeBorrowsUb, got ${info.$}`);
  return { title: info.title, details: info.details, history: info.history.events };
}

test("AccessRelatedness::is_foreign", () => {
  expect(AccessRelatedness.is_foreign("ForeignAccess")).toBe(true);
  expect(AccessRelatedness.is_foreign("LocalAccess")).toBe(false);
});

test("Display of AccessCause and print_as_access", () => {
  const read: AccessCause = { $: "Explicit", _0: "Read" };
  const write: AccessCause = { $: "Explicit", _0: "Write" };
  expect(display_AccessCause(read)).toBe("read access");
  expect(display_AccessCause(write)).toBe("write access");
  expect(display_AccessCause({ $: "Reborrow", _0: "Read" })).toBe("reborrow");
  expect(display_AccessCause(AccessCause.Dealloc)).toBe("deallocation");
  expect(() => display_AccessCause({ $: "FnExit", _0: "Read" })).toThrow(Panic);
  expect(AccessCause.print_as_access(read, true)).toBe("foreign read access");
  expect(AccessCause.print_as_access(write, false)).toBe("child write access");
  expect(AccessCause.print_as_access({ $: "Reborrow", _0: "Read" }, false)).toBe("reborrow (acting as a child read access)");
  expect(AccessCause.print_as_access(AccessCause.Dealloc, true)).toBe("deallocation (acting as a foreign write access)");
  expect(AccessCause.print_as_access({ $: "FnExit", _0: "Write" }, true)).toBe("protector release (acting as a foreign write access)");
});

test("NodeDebugInfo: names and Display", () => {
  const info = NodeDebugInfo.new(T(7), P("Res "), SPAN);
  expect(info.name).toBeUndefined();
  expect(info.history.events).toEqual([]);
  expect(display_NodeDebugInfo(info)).toBe("<7>");
  info.add_name("data");
  expect(display_NodeDebugInfo(info)).toBe("<7> (data)");
  info.add_name("data");
  expect(info.name).toBe("data, data");
  expect(display_NodeDebugInfo(info)).toBe("<7> (data, data)");
});

test("History: push, forget, and the range filter of extract_relevant", () => {
  const perm = new Permission(PermissionPriv.Frozen);
  const history = new History(T(7), [SPAN, perm], []);
  const event = (start: bigint, end: bigint): Event => ({
    transition: { is_relevant: () => { throw new Error("is_relevant reached for an event out of range"); } } as unknown as PermTransition,
    access_cause: { $: "Explicit", _0: "Read" },
    is_foreign: true,
    access_range: undefined,
    transition_range: { start, end },
    span: SPAN,
  });
  history.push(event(0n, 4n));
  history.push(event(4n, 8n));
  expect(history.events.length).toBe(2);
  // Upstream filters on the range first: `4..8` does not contain 8, and `is_relevant` is not reached.
  const kept = { start: 8n, end: 9n };
  const relevant_transition = Object.assign(new PermTransition(PermissionPriv.Frozen, PermissionPriv.Frozen), { is_relevant: () => true });
  history.push({ ...event(8n, 9n), transition: relevant_transition });
  const relevant = history.extract_relevant(8n, { $: "ProtectedDealloc" });
  expect(relevant.events.map((e) => e.transition_range)).toEqual([kept]);
  expect(relevant.tag).toBe(T(7));
  // `forget` keeps the tag and creation.
  const forgotten = history.forget();
  expect(forgotten.events).toEqual([]);
  expect(forgotten.created[0]).toBe(SPAN);
  expect(forgotten.tag).toBe(T(7));
  expect(history.events.length).toBe(3);
});

test("no_valid_exposed_references_error: byte-exact against the oracle", () => {
  const lines = ub_lines("wildcard_no_exposed");
  const diagnostics = new DiagnosticInfo(205 as AllocId, SPAN, { start: 0n, end: 1n }, undefined, { $: "Explicit", _0: "Write" });
  const ub = tb_ub(no_valid_exposed_references_error(diagnostics));
  expect([ub.title, ...ub.details]).toEqual(lines);
  expect(ub.history).toEqual([]);
  // The offset is the start of the transition range, in hex.
  const at = new DiagnosticInfo(205 as AllocId, SPAN, { start: 255n, end: 256n }, undefined, AccessCause.Dealloc);
  expect(tb_ub(no_valid_exposed_references_error(at)).title).toBe("deallocation through <wildcard> at alloc205[0xff] is forbidden");
});

test("DisplayFmt: tags, protectors, exposure, cells", () => {
  const fmt: DisplayFmt = DEFAULT_FORMATTER;
  expect(fmt.print_tag(T(466), undefined)).toBe("<466>");
  expect(fmt.print_tag(T(466), "root of the allocation")).toBe("<466=root of the allocation>");
  expect(fmt.print_protector(undefined)).toBe("");
  expect(fmt.print_protector("WeakProtector")).toBe(" Weakly protected");
  expect(fmt.print_protector("StrongProtector")).toBe(" Strongly protected");
  expect(fmt.print_exposed(true)).toBe(" (exposed)");
  expect(fmt.print_exposed(false)).toBe("");
  expect(fmt.print_perm(undefined)).toBe("-----");
  expect(fmt.print_perm(new LocationState(true, P("Unq "), "None"))).toBe(" Unq ");
  expect(fmt.print_perm(new LocationState(false, P("Dis "), "None"))).toBe("?Dis ");
});

test("DisplayIndent: increment, decrement, write", () => {
  const fmt = DEFAULT_FORMATTER;
  const indent = DisplayIndent.new();
  expect(indent.curr).toBe("    ");
  indent.increment(fmt, true);
  expect(indent.curr).toBe("      ");
  indent.increment(fmt, false);
  expect(indent.curr).toBe("      │ ");
  const s = { value: "x" };
  indent.write(s);
  expect(s.value).toBe("x      │ ");
  // `indent_last.len()` is 2 bytes and `│ ` is 2 chars: the multi-byte indent pops whole.
  indent.decrement(fmt);
  expect(indent.curr).toBe("      ");
  indent.decrement(fmt);
  expect(indent.curr).toBe("    ");
});

// `DisplayRepr::print` writes to fd 2, so a child process prints what is parsed back from the oracle's own trees here, and
// its stderr must be the oracle's bytes. Every width, padding, border and connector is recomputed by the port; the parser
// only recovers the tree's data (tags, names, permissions, ranges).
const CHILD = String.raw`
import { readFileSync } from "node:fs";
import { DEFAULT_FORMATTER, DisplayIndent, DisplayRepr } from ${JSON.stringify(join(dirname(import.meta.path), "diagnostics.ts"))};
import { LocationState } from ${JSON.stringify(join(dirname(import.meta.path), "tree.ts"))};

const P = (short_name) => ({ short_name: () => short_name });
const BORDER = /^─+$/;
const WARNING = "Warning: this tree is indicative only. Some tags may have been hidden.";

function parse_node(line) {
  const cells = line.split("|");
  const tree_part = cells[cells.length - 1];
  const rperm = cells.slice(1, -1).map((c) => {
    const cell = c.slice(-5);
    return cell === "-----" ? undefined : new LocationState(cell[0] === " ", P(cell.slice(1)), "None");
  });
  const at = tree_part.search(/[└├*]/);
  const m = /^<(\d+)(?:=(.*?))?>( Strongly protected| Weakly protected)?( \(exposed\))?$/u.exec(tree_part.slice(tree_part.indexOf("<")));
  if (m === null) throw new Error("cannot parse: " + line);
  return {
    depth: (at - 4) / 2,
    wildcard: tree_part[at] === "*",
    repr: new DisplayRepr(Number(m[1]), m[2], m[4] !== undefined, rperm, []),
    protector: m[3] === " Strongly protected" ? "StrongProtector" : m[3] === " Weakly protected" ? "WeakProtector" : undefined,
  };
}

const lines = readFileSync(process.argv[1], "utf8").split("\n");
for (let i = 0; i < lines.length; i++) {
  if (!BORDER.test(lines[i])) continue;
  // One tree: border, optional warning, header, body, border.
  let j = i + 1;
  const print_warning = lines[j] === WARNING;
  if (print_warning) j++;
  let start = 0;
  const ranges = lines[j].split("..").slice(1).map((end) => {
    const r = { start, end: Number(end.trim()) };
    start = r.end;
    return r;
  });
  j++;
  let main_root;
  const wildcards = [];
  const protected_tags = new Map();
  const stack = [];
  for (; !BORDER.test(lines[j]); j++) {
    if (/^[| ]+$/.test(lines[j])) continue; // the gap line of a wildcard subtree
    const n = parse_node(lines[j]);
    if (n.protector !== undefined) protected_tags.set(n.repr.tag, n.protector);
    if (n.depth === 0) {
      if (n.wildcard) wildcards.push(n.repr);
      else main_root = n.repr;
    } else {
      stack[n.depth - 1].children.push(n.repr);
    }
    stack[n.depth] = n.repr;
  }
  DisplayRepr.print(main_root, wildcards, DEFAULT_FORMATTER, DisplayIndent.new(), protected_tags, ranges, print_warning);
  i = j;
}
`;

test("DisplayRepr::print reproduces the oracle's trees byte for byte", () => {
  const fixture = join(ORACLE, "print_state.stderr");
  const r = Bun.spawnSync([process.execPath, "-e", CHILD, fixture], { stderr: "pipe", stdout: "pipe" });
  const got = r.stderr.toString();
  expect(r.exitCode).toBe(0);
  // The oracle's stderr with everything that is not a tree (Miri's warnings) taken out.
  const expected: string[] = [];
  const lines = readFileSync(fixture, "utf8").split("\n");
  let inside = false;
  for (const l of lines) {
    const border = /^─+$/.test(l);
    if (border || inside) expected.push(l);
    if (border) inside = !inside;
  }
  expect(expected.length).toBeGreaterThan(100);
  expect(got).toBe(`${expected.join("\n")}\n`);
}, 60_000);
