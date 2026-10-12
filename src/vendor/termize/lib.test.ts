// rust-ts checks for termize =0.2.1 (upstream's only test, `test_shell`, compares with `stty` on a
// real terminal and is skipped; see platform/unix.ts).
import { expect, test } from "bun:test";
import { isatty } from "node:tty";
import { dimensions, dimensions_stderr, dimensions_stdin, dimensions_stdout } from "./lib.ts";

function check(d: [number, number] | undefined, fd: number | undefined): void {
  if (fd !== undefined && !isatty(fd)) expect(d).toBeUndefined();
  if (d !== undefined) {
    expect(Number.isInteger(d[0]) && d[0] > 0).toBe(true);
    expect(Number.isInteger(d[1]) && d[1] > 0).toBe(true);
  }
}

test("dimensions: None for non-terminals, positive sizes otherwise", () => {
  check(dimensions_stdout(), 1);
  check(dimensions_stdin(), 0);
  check(dimensions_stderr(), 2);
  check(dimensions(), undefined);
});
