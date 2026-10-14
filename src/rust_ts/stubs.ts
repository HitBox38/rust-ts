// Scaffolding for files that are declared but not ported yet (no upstream counterpart).
import { unported } from "../std/panic.ts";

/**
 * Installs an `unported("<path>::<name>")` placeholder for every listed method that `proto` does not
 * have as an own property yet, so a call reaches `Unported` (exit 70, reported as UNPORTED) instead
 * of a TypeError or a base-class default (a `Visitor` method the upstream type overrides).
 * Used by the contract-first stub files (rustc_resolve): the lane that ports a file removes each
 * name from its list as it assigns the real method (and finally the whole call).
 */
export function unported_methods(proto: object, path: string, names: readonly string[]): void {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(proto, name)) continue;
    const stub = function (): never {
      return unported(`${path}::${name}`);
    };
    STUBS.set(stub, path);
    Object.defineProperty(proto, name, {
      value: stub,
      writable: true,
      configurable: true,
    });
  }
}

const STUBS = new WeakMap<object, string>();

/** The `path` of a placeholder installed by `unported_methods`, or `undefined` for any other value. */
export function unported_stub_path(f: unknown): string | undefined {
  return typeof f === "function" ? STUBS.get(f) : undefined;
}
