// Port of src/tools/miri/src/borrow_tracker/tree_borrows/diagnostics.rs (crate `miri`, plan-m6 D2). Fill lane: `miri-tb-b`
// (plan-m6 wave 38). Its types are generated into diagnostics.gen.ts (tools/codegen set `miri`); this module re-exports them.
//
// Every error text and the tree printing are byte-exact: the format strings are upstream's, and
// oracle/ holds oracle output (diagnostics.test.ts compares the tree printing against it).
//
// PORT: `impl Tree` of this file is registered with `port_methods` (C10: `Tree` is another module's class). `eprintln!` is
// a synchronous write to fd 2, as in borrow_tracker/mod.ts. `err_machine_stop!(TerminationInfo::..)` is miri-driver's
// `TerminationInfo_into_machine_stop(info)`, read through the namespace import at call time (miri-sb's note).
// PORT: `DisplayIndent::write(&self, s: &mut String)` takes a `MutRef<string>` (PORTING §8).
import { writeSync } from "node:fs";
import * as borrow_tracker from "../mod.ts";
import { type BorTag, BorTag as BorTag_, debug_BorTag, type ProtectorKind } from "../mod.ts";
import * as gen from "./diagnostics.gen.ts";
import { clone_AccessCause, clone_Event, DiagnosticInfo, DisplayFmt, DisplayIndent, DisplayRepr, type Event, History, HistoryData, NodeDebugInfo, type S, TbError, type TransitionError } from "./diagnostics.gen.ts";
import * as perms from "./perms.ts";
import { clone_PermTransition, clone_Permission, type PermTransition, type Permission } from "./perms.ts";
import { clone_LocationState, type LocationState, Tree } from "./tree.ts";
import { type UniIndex } from "./unimap.ts";
import { type DedupRange } from "../../data_structures/dedup_range_map.ts";
import * as miri_diagnostics from "../../diagnostics.ts";
import { port_methods } from "../../../rust_ts/miri_stub.ts";
import { clone_AllocRange, display_AllocRange } from "../../../rustc_middle/mir/interpret/allocation.ts";
import { type AllocId, debug_AllocId, display_AllocId, type InterpErrorKind, interp_ok, type InterpResult } from "../../../rustc_middle/mir/interpret/mod.ts";
import { type Span } from "../../../rustc_span/lib.ts";
import { ch } from "../../../std/char.ts";
import { PLAIN } from "../../../std/fmt.ts";
import { type MutRef } from "../../../std/mut_ref.ts";
import { assert, panic, unported, unreachable, unwrap } from "../../../std/panic.ts";
import { utf8_len } from "../../../std/str.ts";
export * from "./diagnostics.gen.ts";

// ---- Items of perms.rs not declared in its stub, with upstream's signatures (the stub's inventory lists them: `impl
// Permission` / `impl PermTransition` in `mod diagnostics`, `impl fmt::Display for Permission`).
declare module "./perms.gen.ts" {
  interface Permission {
    // borrow_tracker/tree_borrows/perms.rs:456
    short_name(): string;
  }
  interface PermTransition {
    // borrow_tracker/tree_borrows/perms.rs:475
    summary(): string;
    // borrow_tracker/tree_borrows/perms.rs:514
    is_relevant(err: TransitionError): boolean;
    // borrow_tracker/tree_borrows/perms.rs:617
    endpoint(): Permission;
  }
}
/** `{}` of a `Permission` (borrow_tracker/tree_borrows/perms.rs:449). */
export function fmt_Permission(self: Permission): string {
  return perms.display_Permission(self);
}
// ----

/** `eprintln!` (PORT: synchronous write to fd 2, as rustc_mir_transform/pass_manager.ts). */
function eprintln(s: string): void {
  const buf = new TextEncoder().encode(`${s}\n`);
  let off = 0;
  while (off < buf.length) off += writeSync(2, buf, off);
}

/** `s.chars().count()` (the UTF-16 length of the string is not it). */
function chars_count(s: string): number {
  let n = 0;
  for (const _ of s) n += 1;
  return n;
}

/// Cause of an access: either a real access or one
/// inserted by Tree Borrows due to a reborrow or a deallocation.
export type AccessCause = gen.AccessCause;
/** PORT: the methods of `impl AccessCause` on the generated companion (PORTING §8). */
export interface AccessCause_methods {
  print_as_access(self: gen.AccessCause, is_foreign: boolean): string;
}
export const AccessCause = gen.AccessCause as typeof gen.AccessCause & AccessCause_methods;

// impl fmt::Display for AccessCause
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/diagnostics.rs:24 fmt
export function display_AccessCause(self: AccessCause): string {
  switch (self.$) {
    case "Explicit":
      return borrow_tracker.display_AccessKind(self._0);
    case "Reborrow":
      return "reborrow";
    case "Dealloc":
      return "deallocation";
    // This is dead code, since the protector release access itself can never
    // cause UB (while the protector is active, if some other access invalidates
    // further use of the protected tag, that is immediate UB).
    // Describing the cause of UB is the only time this function is called.
    case "FnExit":
      return unreachable("internal error: entered unreachable code: protector accesses can never be the source of UB");
  }
}

// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/diagnostics.rs:39 print_as_access
AccessCause.print_as_access = function (self: AccessCause, is_foreign: boolean): string {
  const rel = is_foreign ? "foreign" : "child";
  switch (self.$) {
    case "Explicit":
      return `${rel} ${borrow_tracker.display_AccessKind(self._0)}`;
    case "Reborrow":
      return `reborrow (acting as a ${rel} ${borrow_tracker.display_AccessKind(self._0)})`;
    case "Dealloc":
      return `deallocation (acting as a ${rel} write access)`;
    case "FnExit":
      return `protector release (acting as a ${rel} ${borrow_tracker.display_AccessKind(self._0)})`;
  }
};

declare module "./diagnostics.gen.ts" {
  interface DiagnosticInfo {
    // borrow_tracker/tree_borrows/diagnostics.rs:95
    create_event(transition: PermTransition, is_foreign: boolean): Event;
  }
}
/// Creates a history event.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/diagnostics.rs:95 create_event
DiagnosticInfo.prototype.create_event = function (this: DiagnosticInfo, transition: PermTransition, is_foreign: boolean): Event {
  return {
    transition,
    is_foreign,
    access_cause: clone_AccessCause(this.access_cause),
    access_range: this.access_range === undefined ? undefined : clone_AllocRange(this.access_range),
    transition_range: { start: this.transition_range.start, end: this.transition_range.end },
    span: this.span,
  };
};

declare module "./diagnostics.gen.ts" {
  interface History {
    // borrow_tracker/tree_borrows/diagnostics.rs:125
    push(event: Event): void;
    // borrow_tracker/tree_borrows/diagnostics.rs:279
    forget(): History;
    // borrow_tracker/tree_borrows/diagnostics.rs:285
    extract_relevant(error_offset: bigint, error_kind: TransitionError): History;
  }
}
/// Record an additional event to the history.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/diagnostics.rs:125 push
History.prototype.push = function (this: History, event: Event): void {
  this.events.push(event);
};

declare module "./diagnostics.gen.ts" {
  interface HistoryData {
    // borrow_tracker/tree_borrows/diagnostics.rs:132
    extend(new_history: History, tag_name: string, show_initial_state: boolean): void;
  }
}
// Format events from `new_history` into those recorded by `self`.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/diagnostics.rs:132 extend
HistoryData.prototype.extend = function (this: HistoryData, new_history: History, tag_name: string, show_initial_state: boolean): void {
  const { tag, created, events } = new_history;
  const this_ = `the ${tag_name} tag ${debug_BorTag(tag, PLAIN)}`;
  const msg_initial_state = `, in the initial state ${fmt_Permission(created[1])}`;
  const msg_creation = `${this_} was created here${show_initial_state ? msg_initial_state : ""}`;

  this.events.push([created[0], msg_creation]);
  for (const { transition, is_foreign, access_cause, access_range, span } of events) {
    // NOTE: `transition_range` is explicitly absent from the error message, it has no significance
    // to the user. The meaningful one is `access_range`.
    const access = AccessCause.print_as_access(access_cause, is_foreign);
    const access_range_text = access_range !== undefined ? `at offsets ${display_AllocRange(access_range)}` : "on every location previously accessed by this tag";
    this.events.push([span, `${this_} later transitioned to ${fmt_Permission(transition.endpoint())} due to a ${access} ${access_range_text}`]);
    this.events.push([undefined, `this transition corresponds to ${transition.summary()}`]);
  }
};

declare module "./diagnostics.gen.ts" {
  interface NodeDebugInfo {
    // borrow_tracker/tree_borrows/diagnostics.rs:202
    add_name(name: string): void;
  }
  namespace NodeDebugInfo {
    // borrow_tracker/tree_borrows/diagnostics.rs:195
    function new_(tag: BorTag, initial: Permission, span: Span): NodeDebugInfo;
    export { new_ as new };
  }
}
/// Information for a new node. By default it has no
/// name and an empty history.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/diagnostics.rs:195 new
NodeDebugInfo.new = function (tag: BorTag, initial: Permission, span: Span): NodeDebugInfo {
  const history = new History(tag, [span, initial], []);
  return new NodeDebugInfo(tag, undefined, history);
};

/// Add a name to the tag. If a same tag is associated to several pointers,
/// it can have several names which will be separated by commas.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/diagnostics.rs:202 add_name
NodeDebugInfo.prototype.add_name = function (this: NodeDebugInfo, name: string): void {
  if (this.name !== undefined) {
    this.name += ", ";
    this.name += name;
  } else {
    this.name = name;
  }
};

// impl fmt::Display for NodeDebugInfo
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/diagnostics.rs:213 fmt
export function display_NodeDebugInfo(self: NodeDebugInfo): string {
  if (self.name !== undefined) {
    return `${debug_BorTag(self.tag, PLAIN)} (${self.name})`;
  } else {
    return debug_BorTag(self.tag, PLAIN);
  }
}

declare module "./tree.gen.ts" {
  interface Tree {
    // borrow_tracker/tree_borrows/diagnostics.rs:227
    nth_parent(tag: BorTag, nth_parent: number): BorTag | undefined;
    // borrow_tracker/tree_borrows/diagnostics.rs:237
    give_pointer_debug_name(tag: BorTag, nth_parent: number, name: string): InterpResult;
    // borrow_tracker/tree_borrows/diagnostics.rs:254
    is_allocation_of(tag: BorTag): boolean;
    // borrow_tracker/tree_borrows/diagnostics.rs:876
    print_tree(protected_tags: Map<BorTag, ProtectorKind>, show_unnamed: boolean): InterpResult;
  }
}
port_methods("miri::borrow_tracker::tree_borrows::diagnostics::Tree", () => Tree.prototype, {
  /// Climb the tree to get the tag of a distant ancestor.
  /// Allows operations on tags that are unreachable by the program
  /// but still exist in the tree. Not guaranteed to perform consistently
  /// if `provenance-gc=1`.
  // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/diagnostics.rs:227 nth_parent
  nth_parent(this: Tree, tag: BorTag, nth_parent: number): BorTag | undefined {
    let idx = unwrap(this.tag_mapping.get(tag));
    for (let _ = 0; _ < nth_parent; _++) {
      const node = unwrap(this.nodes.get(idx));
      if (node.parent === undefined) return undefined;
      idx = node.parent;
    }
    return unwrap(this.nodes.get(idx)).tag;
  },

  /// Debug helper: assign name to tag.
  // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/diagnostics.rs:237 give_pointer_debug_name
  give_pointer_debug_name(this: Tree, tag_: BorTag, nth_parent: number, name: string): InterpResult {
    const tag = unwrap(this.nth_parent(tag_, nth_parent));
    const idx = unwrap(this.tag_mapping.get(tag));
    const node = this.nodes.get_mut(idx);
    if (node !== undefined) {
      node.debug_info.add_name(name);
    } else {
      eprintln(`Tag ${debug_BorTag(tag, PLAIN)} (to be named '${name}') not found!`);
    }
    return interp_ok(undefined);
  },

  /// Debug helper: determines if the tree contains a tag.
  // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/diagnostics.rs:254 is_allocation_of
  is_allocation_of(this: Tree, tag: BorTag): boolean {
    return this.tag_mapping.contains_key(tag);
  },
});

/// Keep only the tag and creation
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/diagnostics.rs:279 forget
History.prototype.forget = function (this: History): History {
  return new History(this.tag, [this.created[0], clone_Permission(this.created[1])], []);
};

/// Reconstruct the history relevant to `error_offset` by filtering
/// only events whose range contains the offset we are interested in.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/diagnostics.rs:285 extract_relevant
History.prototype.extract_relevant = function (this: History, error_offset: bigint, error_kind: TransitionError): History {
  return new History(
    this.tag,
    [this.created[0], clone_Permission(this.created[1])],
    this.events
      .filter((e) => e.transition_range.start <= error_offset && error_offset < e.transition_range.end)
      .filter((e) => e.transition.is_relevant(error_kind))
      .map(clone_Event),
  );
};

declare module "./diagnostics.gen.ts" {
  interface TbError {
    // borrow_tracker/tree_borrows/diagnostics.rs:319
    build(): InterpErrorKind;
  }
}
/// Produce a UB error.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/diagnostics.rs:319 build
TbError.prototype.build = function (this: TbError): InterpErrorKind {
  const cause = this.access_info.access_cause;
  const error_offset = this.access_info.transition_range.start;
  const accessed = this.accessed_node_info;
  const accessed_str = this.accessed_node_info !== undefined ? display_NodeDebugInfo(this.accessed_node_info) : "<wildcard>";
  const conflicting = this.conflicting_node_info;
  const conflicting_str = display_NodeDebugInfo(conflicting);
  // An access is considered conflicting if it happened through a
  // different tag than the one who caused UB.
  // When doing a wildcard access (where `accessed` is `None`) we
  // do not know which precise tag the accessed happened from,
  // however we can be certain that it did not come from the
  // conflicting tag.
  // This is because the wildcard data structure already removes
  // all tags through which an access would cause UB.
  const accessed_is_conflicting = accessed !== undefined && accessed.tag === conflicting.tag;
  const title = `${display_AccessCause(cause)} through ${accessed_str} at ${display_AllocId(this.access_info.alloc_id)}[0x${error_offset.toString(16)}] is forbidden`;
  let details: string[];
  let conflicting_tag_name: string;
  switch (this.error_kind.$) {
    case "ChildAccessForbidden": {
      const perm = this.error_kind._0;
      conflicting_tag_name = accessed_is_conflicting ? "accessed" : "conflicting";
      details = [];
      if (!accessed_is_conflicting) {
        details.push(`the accessed tag ${accessed_str} is a child of the conflicting tag ${conflicting_str}`);
      }
      const access = AccessCause.print_as_access(cause, /* is_foreign */ false);
      details.push(`the ${conflicting_tag_name} tag ${conflicting_str} has state ${fmt_Permission(perm)} which forbids this ${access}`);
      break;
    }
    case "ProtectedDisabled": {
      const before_disabled = this.error_kind._0;
      conflicting_tag_name = "protected";
      const access = AccessCause.print_as_access(cause, /* is_foreign */ true);
      details = [
        `the accessed tag ${accessed_str} is foreign to the ${conflicting_tag_name} tag ${conflicting_str} (i.e., it is not a child)`,
        `this ${access} would cause the ${conflicting_tag_name} tag ${conflicting_str} (currently ${fmt_Permission(before_disabled)}) to become Disabled`,
        `protected tags must never be Disabled`,
      ];
      break;
    }
    case "ProtectedDealloc": {
      conflicting_tag_name = "strongly protected";
      details = [
        `the allocation of the accessed tag ${accessed_str} also contains the ${conflicting_tag_name} tag ${conflicting_str}`,
        `the ${conflicting_tag_name} tag ${conflicting_str} disallows deallocations`,
      ];
      break;
    }
  }
  const history = new HistoryData([]);
  if (this.accessed_node_info !== undefined && !accessed_is_conflicting) {
    history.extend(this.accessed_node_info.history.forget(), "accessed", false);
  }
  history.extend(this.conflicting_node_info.history.extract_relevant(error_offset, this.error_kind), conflicting_tag_name, true);
  // err_machine_stop!(TerminationInfo::TreeBorrowsUb { title, details, history })
  return miri_diagnostics.TerminationInfo_into_machine_stop({ $: "TreeBorrowsUb", title, details, history });
};

/// Cannot access this allocation with wildcard provenance, as there are no
/// valid exposed references for this access kind.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/diagnostics.rs:398 no_valid_exposed_references_error
export function no_valid_exposed_references_error({ alloc_id, transition_range, access_cause }: DiagnosticInfo): InterpErrorKind {
  const title = `${display_AccessCause(access_cause)} through <wildcard> at ${debug_AllocId(alloc_id, PLAIN)}[0x${transition_range.start.toString(16)}] is forbidden`;
  const details = [`there are no exposed tags which may perform this access here`];
  const history = new HistoryData([]);
  // err_machine_stop!(TerminationInfo::TreeBorrowsUb { title, details, history })
  return miri_diagnostics.TerminationInfo_into_machine_stop({ $: "TreeBorrowsUb", title, details, history });
}

declare module "./diagnostics.gen.ts" {
  interface DisplayFmt {
    // borrow_tracker/tree_borrows/diagnostics.rs:549
    print_perm(perm: LocationState | undefined): string;
    // borrow_tracker/tree_borrows/diagnostics.rs:563
    print_tag(tag: BorTag, name: string | undefined): string;
    // borrow_tracker/tree_borrows/diagnostics.rs:573
    print_protector(protector: ProtectorKind | undefined): string;
    // borrow_tracker/tree_borrows/diagnostics.rs:585
    print_exposed(exposed: boolean): S;
  }
}
/// Print the permission with the format
/// ` Res`/` Re*`/` Unq`/` Frz`/` Dis` for accessed locations
/// and `?Res`/`?Re*`/`?Unq`/`?Frz`/`?Dis` for unaccessed locations.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/diagnostics.rs:549 print_perm
DisplayFmt.prototype.print_perm = function (this: DisplayFmt, perm: LocationState | undefined): string {
  if (perm !== undefined) {
    const ac = perm.accessed_() ? this.accessed.yes : this.accessed.no;
    const st = perm.permission_().short_name();
    return `${ac}${st}`;
  } else {
    return `${this.accessed.meh}${this.perm.uninit}`;
  }
};

/// Print the tag with the format `<XYZ>` if the tag is unnamed,
/// and `<XYZ=name>` if the tag is named.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/diagnostics.rs:563 print_tag
DisplayFmt.prototype.print_tag = function (this: DisplayFmt, tag: BorTag, name: string | undefined): string {
  const printable_tag = BorTag_.get(tag);
  if (name !== undefined) {
    return `<${printable_tag}=${name}>`;
  } else {
    return `<${printable_tag}>`;
  }
};

/// Print extra text if the tag has a protector.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/diagnostics.rs:573 print_protector
DisplayFmt.prototype.print_protector = function (this: DisplayFmt, protector: ProtectorKind | undefined): string {
  if (protector === undefined) return "";
  switch (protector) {
    case "WeakProtector":
      return " Weakly protected";
    case "StrongProtector":
      return " Strongly protected";
  }
};

/// Print extra text if the tag is exposed.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/diagnostics.rs:585 print_exposed
DisplayFmt.prototype.print_exposed = function (this: DisplayFmt, exposed: boolean): S {
  return exposed ? " (exposed)" : "";
};

declare module "./diagnostics.gen.ts" {
  interface DisplayIndent {
    // borrow_tracker/tree_borrows/diagnostics.rs:602
    increment(formatter: DisplayFmt, is_last: boolean): void;
    // borrow_tracker/tree_borrows/diagnostics.rs:611
    decrement(formatter: DisplayFmt): void;
    // borrow_tracker/tree_borrows/diagnostics.rs:618
    write(s: MutRef<string>): void;
  }
  namespace DisplayIndent {
    // borrow_tracker/tree_borrows/diagnostics.rs:595
    function new_(): DisplayIndent;
    export { new_ as new };
  }
}
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/diagnostics.rs:595 new
DisplayIndent.new = function (): DisplayIndent {
  return new DisplayIndent("    ");
};

/// Increment the indentation by one. Note: need to know if this
/// is the last child or not because the presence of other children
/// changes the way the indentation is shown.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/diagnostics.rs:602 increment
DisplayIndent.prototype.increment = function (this: DisplayIndent, formatter: DisplayFmt, is_last: boolean): void {
  this.curr += is_last ? formatter.padding.indent_last : formatter.padding.indent_middle;
};

/// Pop the last level of indentation.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/diagnostics.rs:611 decrement
DisplayIndent.prototype.decrement = function (this: DisplayIndent, formatter: DisplayFmt): void {
  for (let _ = 0; _ < utf8_len(formatter.padding.indent_last); _++) {
    // PORT: `String::pop`: one `char`; every indentation char is in the BMP (DEFAULT_FORMATTER), so one UTF-16 unit.
    this.curr = this.curr.slice(0, -1);
  }
};

/// Print the current indentation.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/diagnostics.rs:618 write
DisplayIndent.prototype.write = function (this: DisplayIndent, s: MutRef<string>): void {
  s.value += this.curr;
};

/// Repeat a character a number of times.
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/diagnostics.rs:624 char_repeat
function char_repeat(c: number, n: number): string {
  return String.fromCodePoint(c).repeat(n);
}

declare module "./diagnostics.gen.ts" {
  namespace DisplayRepr {
    // borrow_tracker/tree_borrows/diagnostics.rs:640
    export let from: (tree: Tree, root: UniIndex, show_unnamed: boolean) => DisplayRepr | undefined;
    // borrow_tracker/tree_borrows/diagnostics.rs:691
    export let print: (main_root: DisplayRepr | undefined, wildcard_subtrees: readonly DisplayRepr[], fmt: DisplayFmt, indenter: DisplayIndent, protected_tags: Map<BorTag, ProtectorKind>, ranges: DedupRange[], print_warning: boolean) => void;
  }
}
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/diagnostics.rs:640 from
DisplayRepr.from = function (tree: Tree, root_: UniIndex, show_unnamed: boolean): DisplayRepr | undefined {
  const v: DisplayRepr[] = [];
  extraction_aux(tree, root_, show_unnamed, v);
  const root = v.pop();
  if (root === undefined) {
    if (show_unnamed) {
      return unreachable("internal error: entered unreachable code: This allocation contains no tags, not even a root. This should not happen.");
    }
    return undefined;
  }
  assert(v.length === 0, "assertion failed: v.is_empty()");
  return root;
};

// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/diagnostics.rs:654 extraction_aux
function extraction_aux(tree: Tree, idx: UniIndex, show_unnamed: boolean, acc: DisplayRepr[]): void {
  const node = unwrap(tree.nodes.get(idx));
  const name = node.debug_info.name;
  const exposed = node.is_exposed;
  const children_sorted = node.children.slice();
  children_sorted.sort((a, b) => unwrap(tree.nodes.get(a)).tag - unwrap(tree.nodes.get(b)).tag);
  if (!show_unnamed && name === undefined) {
    // We skip this node
    for (const child_idx of children_sorted) {
      extraction_aux(tree, child_idx, show_unnamed, acc);
    }
  } else {
    // We take this node
    const rperm = tree.locations.iter_all().map(([_offset, loc]) => {
      const perm = loc.perms.get(idx);
      return perm === undefined ? undefined : clone_LocationState(perm);
    });
    const children: DisplayRepr[] = [];
    for (const child_idx of children_sorted) {
      extraction_aux(tree, child_idx, show_unnamed, children);
    }
    acc.push(new DisplayRepr(node.tag, name, exposed, rperm, children));
  }
}

// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/diagnostics.rs:691 print
DisplayRepr.print = function (
  main_root: DisplayRepr | undefined,
  wildcard_subtrees: readonly DisplayRepr[],
  fmt: DisplayFmt,
  indenter: DisplayIndent,
  protected_tags: Map<BorTag, ProtectorKind>,
  ranges: DedupRange[],
  print_warning: boolean,
): void {
  const block: string[] = [];
  // Push the header and compute the required paddings for the body.
  // Header looks like this: `0.. 1.. 2.. 3.. 4.. 5.. 6.. 7.. 8`,
  // and is properly aligned with the `|` of the body.
  let header_top = "";
  header_top += "0..";
  const range_padding: number[] = [];
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i]!;
    if (i > 0) {
      header_top += fmt.perm.range_sep;
    }
    const s = range.end.toString();
    const l = chars_count(s) + chars_count(fmt.perm.range_sep);
    {
      const target_len = chars_count(fmt.perm.uninit) + chars_count(fmt.accessed.yes) + 1;
      const tot_len = Math.max(target_len, l);
      const header_top_pad_len = Math.max(0, target_len - l);
      const body_pad_len = Math.max(0, tot_len - target_len);
      header_top += `${char_repeat(ch(" "), header_top_pad_len)}${s}`;
      range_padding.push(body_pad_len);
    }
  }
  block.push(header_top);
  // This is the actual work
  if (main_root !== undefined) {
    print_aux(
      main_root,
      range_padding,
      fmt,
      indenter,
      protected_tags,
      true /* root _is_ the last child */,
      false /* not a wildcard_root*/,
      block,
    );
  }
  for (const tree of wildcard_subtrees) {
    let gap_line = "";
    gap_line += fmt.perm.open;
    for (let i = 0; i < range_padding.length; i++) {
      const pad = range_padding[i]!;
      if (i > 0) {
        gap_line += fmt.perm.sep;
      }
      gap_line += `${char_repeat(ch(" "), pad)}${"     "}`;
    }
    gap_line += fmt.perm.close;
    block.push(gap_line);

    print_aux(
      tree,
      range_padding,
      fmt,
      indenter,
      protected_tags,
      true /* root _is_ the last child */,
      true /* wildcard_root*/,
      block,
    );
  }
  // Then it's just prettifying it with a border of dashes.
  {
    const wr = fmt.wrapper;
    // `.max().unwrap()`: the block always holds the header line.
    let block_width = 0;
    for (const s of block) block_width = Math.max(block_width, chars_count(s));
    const max_width = print_warning ? Math.max(block_width, chars_count(wr.warning_text)) : block_width;
    eprintln(char_repeat(wr.top, max_width));
    if (print_warning) {
      eprintln(wr.warning_text);
    }
    for (const line of block) {
      eprintln(line);
    }
    eprintln(char_repeat(wr.bot, max_width));
  }
};

// Here is the function that does the heavy lifting
// rustc: src/tools/miri/src/borrow_tracker/tree_borrows/diagnostics.rs:787 print_aux
function print_aux(
  tree: DisplayRepr,
  padding: readonly number[],
  fmt: DisplayFmt,
  indent: DisplayIndent,
  protected_tags: Map<BorTag, ProtectorKind>,
  is_last_child: boolean,
  is_wildcard_root: boolean,
  acc: string[],
): void {
  const line: MutRef<string> = { value: "" };
  // Format the permissions on each range.
  // Looks like `| Unq| Res| Res| Unq|`.
  line.value += fmt.perm.open;
  for (let i = 0; i < tree.rperm.length && i < padding.length; i++) {
    const perm = tree.rperm[i];
    const pad = padding[i]!;
    if (i > 0) {
      line.value += fmt.perm.sep;
    }
    const show_perm = fmt.print_perm(perm);
    line.value += `${char_repeat(ch(" "), pad)}${show_perm}`;
  }
  line.value += fmt.perm.close;
  // Format the tree structure.
  // Main difficulty is handling the indentation properly.
  indent.write(line);
  {
    // padding
    line.value += is_wildcard_root ? fmt.padding.wildcard_root : is_last_child ? fmt.padding.join_last : fmt.padding.join_middle;
    line.value += fmt.padding.join_default;
    line.value += tree.children.length === 0 ? fmt.padding.join_default : fmt.padding.join_haschild;
    line.value += fmt.padding.join_default;
    line.value += fmt.padding.join_default;
  }
  line.value += fmt.print_tag(tree.tag, tree.name);
  const protector = protected_tags.get(tree.tag);
  line.value += fmt.print_protector(protector);
  line.value += fmt.print_exposed(tree.exposed);
  // Push the line to the accumulator then recurse.
  acc.push(line.value);
  const nb_children = tree.children.length;
  for (let i = 0; i < nb_children; i++) {
    const child = tree.children[i]!;
    indent.increment(fmt, is_last_child);
    print_aux(
      child,
      padding,
      fmt,
      indent,
      protected_tags,
      /* is_last_child */ i + 1 === nb_children,
      /* is_wildcard_root */ false,
      acc,
    );
    indent.decrement(fmt);
  }
}

export const DEFAULT_FORMATTER: DisplayFmt = new DisplayFmt(
  {
    top: ch("─"),
    bot: ch("─"),
    warning_text: "Warning: this tree is indicative only. Some tags may have been hidden.",
  },
  { open: "|", sep: "|", close: "|", uninit: "----", range_sep: ".." },
  {
    join_middle: "├",
    join_last: "└",
    indent_middle: "│ ",
    indent_last: "  ",
    join_haschild: "┬",
    join_default: "─",
    wildcard_root: "*",
  },
  { yes: " ", no: "?", meh: "-" },
);

port_methods("miri::borrow_tracker::tree_borrows::diagnostics::Tree", () => Tree.prototype, {
  /// Display the contents of the tree.
  // rustc: src/tools/miri/src/borrow_tracker/tree_borrows/diagnostics.rs:876 print_tree
  print_tree(this: Tree, protected_tags: Map<BorTag, ProtectorKind>, show_unnamed: boolean): InterpResult {
    const indenter = DisplayIndent.new();
    const ranges = this.locations.iter_all().map(([range, _loc]) => range);
    const main_tree = DisplayRepr.from(this, this.roots[0]!, show_unnamed);
    const wildcard_subtrees: DisplayRepr[] = [];
    for (const root of this.roots.slice(1)) {
      const repr = DisplayRepr.from(this, root, show_unnamed);
      if (repr !== undefined) wildcard_subtrees.push(repr);
    }

    if (main_tree === undefined && wildcard_subtrees.length === 0) {
      eprintln("This allocation does not contain named tags. Use `miri_print_borrow_state(_, true)` to also print unnamed tags.");
    }

    DisplayRepr.print(
      main_tree,
      wildcard_subtrees,
      DEFAULT_FORMATTER,
      indenter,
      protected_tags,
      ranges,
      /* print warning message about tags not shown */ !show_unnamed,
    );
    return interp_ok(undefined);
  },
});
