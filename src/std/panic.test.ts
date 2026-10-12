// Tests for src/std/panic.ts. Panic texts come from a scratch program built with the pinned
// nightly (rustc 1.101.0-nightly 6f5da406b), printing each panic payload from a panic hook:
//   #[derive(Debug, PartialEq)] enum Level { Bug, Fatal, Error, Warning(Option<u32>), Note }
//   let l = Note; assert_matches!(l, Error | Warning(_));
//   assert_eq!(Note, Level::Bug);
//   assert_eq!(1usize + 2, 0);
import { expect, test } from "bun:test";
import { assert_eq, assert_matches, panicking, while_unwinding } from "./panic.ts";

test("assert_eq / assert_matches texts (oracle)", () => {
  const id = (s: string): string => s;
  expect(() => assert_matches("Note", false, "Error | Warning(_)", id)).toThrow(
    "assertion `left matches right` failed\n  left: Note\n right: Error | Warning(_)",
  );
  expect(() => assert_eq("Note", "Bug", id)).toThrow("assertion `left == right` failed\n  left: Note\n right: Bug");
  expect(() => assert_eq(1 + 2, 0, String)).toThrow("assertion `left == right` failed\n  left: 3\n right: 0");
  assert_eq(2, 2, String);
  assert_matches("Error", true, "Error | Warning(_)", id);
});

test("panicking is true only inside while_unwinding", () => {
  expect(panicking()).toBe(false);
  expect(while_unwinding(() => panicking())).toBe(true);
  expect(() => while_unwinding(() => { throw new Error("x"); })).toThrow("x");
  expect(panicking()).toBe(false);
});
