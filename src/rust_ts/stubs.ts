// Scaffolding for files that are declared but not ported yet (no upstream counterpart).
import { unported } from "../std/panic.ts";

/**
 * Installs an `unported("<path>::<name>")` placeholder for every listed method that `proto` does not
 * have yet, so a call reaches `Unported` (exit 70, reported as UNPORTED) instead of a TypeError.
 * Used by the rustc_parse parser stub files: the lane that ports a file removes each name from its
 * list as it assigns the real method (and finally the whole call).
 */
export function unported_methods(proto: object, path: string, names: readonly string[]): void {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(proto, name)) continue;
    Object.defineProperty(proto, name, {
      value: function (): never {
        return unported(`${path}::${name}`);
      },
      writable: true,
      configurable: true,
    });
  }
}
