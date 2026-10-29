// compiler/rustc_transmute/src/layout/tree/tests.rs.
import { describe, expect, test } from "bun:test";
// Init order: rustc_middle's crate root first (as the driver loads it), then this crate.
import "../../../rustc_middle/lib.ts";
import { debug_Tree, Tree, Tree_eq, type Tree as TreeT } from "../tree.ts";
import { PLAIN, type Debug } from "../../../std/fmt.ts";

// #[derive(Debug, Hash, Eq, PartialEq, Clone, Copy)]
type Def = "NoSafetyInvariants" | "HasSafetyInvariants";
const Def = {
  NoSafetyInvariants: "NoSafetyInvariants",
  HasSafetyInvariants: "HasSafetyInvariants",
} as const;
const debug_Def: Debug<Def> = (v) => v;

// impl super::Def for Def
const Def_Def: import("../mod.ts").Def<Def> = {
  // rustc: compiler/rustc_transmute/src/layout/tree/tests.rs:10 has_safety_invariants
  has_safety_invariants(self: Def): boolean {
    return self === Def.HasSafetyInvariants;
  },
};
void Def_Def;

type L = TreeT<Def, never, never>;
type P = TreeT<never, never, never>;
const never_debug: Debug<never> = () => "!";
/** `assert_eq!(pruned, expected)` */
function assert_tree_eq(actual: P, expected: P): void {
  expect(Tree_eq(actual, expected) ? "" : `${debug_Tree(actual, PLAIN, never_debug, never_debug, never_debug)} != ${debug_Tree(expected, PLAIN, never_debug, never_debug, never_debug)}`).toBe("");
}
const has_si = (d: Def): boolean => d === Def.HasSafetyInvariants;
void debug_Def;

describe("prune", () => {
  describe("should_simplify", () => {
    // rustc: compiler/rustc_transmute/src/layout/tree/tests.rs:22 seq_1
    test("seq_1", () => {
      const layout: L = Tree.then(Tree.def(Def.NoSafetyInvariants), Tree.byte(0x00));
      assert_tree_eq(Tree.prune(layout, has_si), Tree.byte(0x00));
    });

    // rustc: compiler/rustc_transmute/src/layout/tree/tests.rs:28 seq_2
    test("seq_2", () => {
      const layout: L = Tree.then(Tree.then(Tree.byte(0x00), Tree.def(Def.NoSafetyInvariants)), Tree.byte(0x01));

      assert_tree_eq(Tree.prune(layout, has_si), Tree.then(Tree.byte(0x00), Tree.byte(0x01)));
    });

    // rustc: compiler/rustc_transmute/src/layout/tree/tests.rs:39 single_retained_alternative
    test("single_retained_alternative", () => {
      const layout: L = Tree.alt([
        Tree.then(Tree.def(Def.HasSafetyInvariants), Tree.byte(0x00)),
        Tree.then(Tree.def(Def.NoSafetyInvariants), Tree.byte(0x01)),
        Tree.then(Tree.def(Def.HasSafetyInvariants), Tree.byte(0x02)),
      ]);

      assert_tree_eq(Tree.prune(layout, has_si), Tree.byte(0x01));
    });

    // rustc: compiler/rustc_transmute/src/layout/tree/tests.rs:50 mixed_nested_alternatives_in_seq
    test("mixed_nested_alternatives_in_seq", () => {
      const layout: L = Tree.seq([
        Tree.byte(0x00),
        {
          $: "Alt",
          _0: [
            Tree.then(Tree.def(Def.NoSafetyInvariants), Tree.byte(0x01)),
            {
              $: "Alt",
              _0: [Tree.then(Tree.def(Def.HasSafetyInvariants), Tree.byte(0x02)), Tree.then(Tree.def(Def.NoSafetyInvariants), Tree.byte(0x03))],
            },
          ],
        },
        Tree.byte(0x04),
      ]);

      assert_tree_eq(Tree.prune(layout, has_si), Tree.seq([Tree.byte(0x00), Tree.alt([Tree.byte(0x01), Tree.byte(0x03)]), Tree.byte(0x04)]));
    });
  });

  describe("should_reject", () => {
    // rustc: compiler/rustc_transmute/src/layout/tree/tests.rs:78 def_with_safety_invariants
    test("def_with_safety_invariants", () => {
      const layout: L = Tree.def(Def.HasSafetyInvariants);
      assert_tree_eq(Tree.prune(layout, has_si), Tree.uninhabited());
    });

    // rustc: compiler/rustc_transmute/src/layout/tree/tests.rs:87 def_with_safety_invariants_in_seq_len_2
    test("def_with_safety_invariants_in_seq_len_2", () => {
      const layout: L = Tree.then(Tree.def(Def.NoSafetyInvariants), Tree.def(Def.HasSafetyInvariants));
      assert_tree_eq(Tree.prune(layout, has_si), Tree.uninhabited());
    });

    // rustc: compiler/rustc_transmute/src/layout/tree/tests.rs:97 def_with_safety_invariants_in_seq_len_3
    test("def_with_safety_invariants_in_seq_len_3", () => {
      const layout: L = Tree.then(Tree.then(Tree.def(Def.NoSafetyInvariants), Tree.byte(0x00)), Tree.def(Def.HasSafetyInvariants));
      assert_tree_eq(Tree.prune(layout, has_si), Tree.uninhabited());
    });

    // rustc: compiler/rustc_transmute/src/layout/tree/tests.rs:108 all_alternatives_pruned
    test("all_alternatives_pruned", () => {
      const layout: L = Tree.alt([
        Tree.then(Tree.def(Def.HasSafetyInvariants), Tree.byte(0x00)),
        Tree.then(Tree.def(Def.HasSafetyInvariants), Tree.byte(0x01)),
      ]);

      assert_tree_eq(Tree.prune(layout, has_si), Tree.uninhabited());
    });

    // rustc: compiler/rustc_transmute/src/layout/tree/tests.rs:121 all_alternatives_pruned_in_seq
    test("all_alternatives_pruned_in_seq", () => {
      const layout: L = Tree.seq([
        Tree.byte(0x00),
        Tree.alt([Tree.then(Tree.def(Def.HasSafetyInvariants), Tree.byte(0x01)), Tree.then(Tree.def(Def.HasSafetyInvariants), Tree.byte(0x02))]),
        Tree.byte(0x03),
      ]);

      assert_tree_eq(Tree.prune(layout, has_si), Tree.uninhabited());
    });
  });

  describe("should_accept", () => {
    // rustc: compiler/rustc_transmute/src/layout/tree/tests.rs:142 def_without_safety_invariants
    test("def_without_safety_invariants", () => {
      const layout: L = Tree.def(Def.NoSafetyInvariants);
      assert_tree_eq(Tree.prune(layout, has_si), Tree.unit());
    });

    // rustc: compiler/rustc_transmute/src/layout/tree/tests.rs:148 def_without_safety_invariants_in_seq_len_2
    test("def_without_safety_invariants_in_seq_len_2", () => {
      const layout: L = Tree.then(Tree.def(Def.NoSafetyInvariants), Tree.def(Def.NoSafetyInvariants));
      assert_tree_eq(Tree.prune(layout, has_si), Tree.unit());
    });

    // rustc: compiler/rustc_transmute/src/layout/tree/tests.rs:155 def_without_safety_invariants_in_seq_len_3
    test("def_without_safety_invariants_in_seq_len_3", () => {
      const layout: L = Tree.then(Tree.then(Tree.def(Def.NoSafetyInvariants), Tree.byte(0x00)), Tree.def(Def.NoSafetyInvariants));
      assert_tree_eq(Tree.prune(layout, has_si), Tree.byte(0x00));
    });
  });
});
