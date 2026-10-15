// The `Deref` registry (PORTING §8 "A Deref/DerefMut impl realised as a field"), generalised by lane fnctxt-contract for
// rustc_hir_typeck (`TypeckRootCtxt -> InferCtxt`, `FnCtxt -> TypeckRootCtxt`, ...) and shared since errctxt-contract with
// rustc_trait_selection (`TypeErrCtxt -> InferCtxt`). Not a port of an upstream file.
//
// A defining module calls `register_deref(Outer, "field", Inner)` at top level; the crate root calls `install_derefs()` once
// every module of the crate (and so every prototype method / placeholder of the inner and outer types) is loaded. A later
// `install_derefs()` (another crate's root) adds forwarders for members the inner types gained since (e.g. extension
// methods assigned by a crate loaded later); members already forwarded or own are left alone.

interface DerefEntry {
  outer: Function;
  field: string;
  inner: Function;
}
const DEREFS: DerefEntry[] = [];

/**
 * Registers `impl Deref for <outer> { type Target = <inner>; fn deref(&self) { &self.<field> } }`. Every member the
 * inner type has and the outer one does not (the inner instance fields, the inner prototype's methods and accessors,
 * including the inner type's own deref forwarders) becomes a forwarding member of `outer.prototype` when
 * `install_derefs()` runs: a field is a getter/setter on `this.<field>.<name>`, a method calls
 * `this.<field>.<name>(..args)` (so `this` inside it is the inner value, as after Rust's auto-deref). A member that the
 * outer type declares itself (its own fields, its methods, its `unported_methods` placeholders) shadows the inner one,
 * as Rust's method lookup tries the outer type first. The TS side is `interface Outer extends Omit<Inner, shadowed>`.
 * Called at module top level by the module that defines `outer`; lib.ts calls `install_derefs()` once every module
 * (and so every prototype method and placeholder of the crate) is loaded.
 */
export function register_deref(outer: Function, field: string, inner: Function): void {
  DEREFS.push({ outer, field, inner });
}

/**
 * Installs the forwarders of every `register_deref` (inner types first). Idempotent; a repeated call adds forwarders only
 * for inner members that have none yet.
 */
export function install_derefs(): void {
  const done = new Set<DerefEntry>();
  for (const e of DEREFS) install_deref(e, done);
}

function install_deref(e: DerefEntry, done: Set<DerefEntry>): void {
  if (done.has(e)) return;
  done.add(e);
  const inner_entry = DEREFS.find((x) => x.outer === e.inner);
  if (inner_entry) install_deref(inner_entry, done);
  const proto = e.outer.prototype as Record<string, unknown>;
  const field = e.field;
  const own = (name: string) => Object.prototype.hasOwnProperty.call(proto, name);
  // The inner type's instance fields: its constructor assigns every parameter property, so a no-argument
  // construction lists them (the constructors of these classes only store their arguments).
  const fields = Object.keys(Reflect.construct(e.inner, []) as object);
  for (const name of fields) {
    if (name === field || own(name)) continue;
    Object.defineProperty(proto, name, {
      get(this: Record<string, Record<string, unknown>>) {
        return this[field]![name];
      },
      set(this: Record<string, Record<string, unknown>>, v: unknown) {
        this[field]![name] = v;
      },
      configurable: true,
    });
  }
  for (let p = e.inner.prototype as object | null; p !== null && p !== Object.prototype; p = Object.getPrototypeOf(p)) {
    for (const name of Object.getOwnPropertyNames(p)) {
      if (name === "constructor" || name === "deref" || own(name)) continue;
      const desc = Object.getOwnPropertyDescriptor(p, name)!;
      if (desc.get || desc.set) {
        Object.defineProperty(proto, name, {
          get(this: Record<string, Record<string, unknown>>) {
            return this[field]![name];
          },
          set(this: Record<string, Record<string, unknown>>, v: unknown) {
            this[field]![name] = v;
          },
          configurable: true,
        });
      } else if (typeof desc.value === "function") {
        Object.defineProperty(proto, name, {
          value: function (this: Record<string, Record<string, (...a: unknown[]) => unknown>>, ...args: unknown[]): unknown {
            return this[field]![name]!(...args);
          },
          writable: true,
          configurable: true,
        });
      }
    }
  }
}

/** The registered derefs (contract.test.ts). */
export function registered_derefs(): readonly { outer: Function; field: string; inner: Function }[] {
  return DEREFS;
}
