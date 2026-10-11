# PORTING.md — the porting contract

rust-ts is a **line-by-line port** of rustc at the commit pinned in `UPSTREAM.json`.
It is not a redesign. Diagnostics, their order, and every debug dump must be byte-identical
to the oracle, so the code must do what upstream does, in the order upstream does it.

The upstream checkout is at `$RUST_TS_DATA/rust` (see `.env.local`; `bun scripts/upstream.ts status`).

## 1. Ownership

- A porting lane owns **exactly the files it was assigned**. Never edit other ported files,
  `src/std/`, `harness/`, `scripts/`, `tools/`, `package.json`, `tsconfig.json`, or this file.
  If you need a change there, write it in your handoff file and stop.
- Porting lanes do not run the gate or full difftest suites. They may run `bun test` on
  their own crate and `bunx tsc --noEmit -p .`. The root integrator runs everything else.

## 2. Files

- One upstream file → one TS file at the mirrored path:
  `compiler/<crate>/src/<path>.rs` → `src/<crate>/<path>.ts`
  (`lib.rs` → `lib.ts`, `mod.rs` → `mod.ts`, `tests.rs` → `tests.test.ts`).
- External crates: `src/vendor/<crate_name>/...`. Rust std/core/alloc: `src/std/...`.
- Our own non-ported code (driver glue, dumps, test helpers): `src/rust_ts/`.
- Keep upstream doc comments (`///`, `//!`) and ordinary comments.

## 3. Functions

- Port **every** function in the file, **in upstream order**, keeping upstream logic,
  control flow and comments. Do not simplify, "improve", reorder or deduplicate.
- Each ported fn carries a marker on the line directly above it:
  `// rustc: compiler/<crate>/src/<path>.rs:<line> <fn_name>`
  `<line>` is the line of the `fn` keyword at the pin. `bun scripts/coverage.ts --check`
  rejects markers that point at no upstream fn; `--missing <path>` lists what is left.
- Cannot port something yet? Call `unported("crate::path::what")` from `src/std/panic.ts`.
  **Never return a guessed value.** Unported code exits 70, which the harness reports as
  UNPORTED, not as a mismatch.
- Judgment calls the rules don't cover get a `// PORT: <why>` comment.
- `debug_assert!` / `debug_assert_eq!` → keep as a comment (`// debug_assert!(...)`); rustc ships
  without debug assertions. `assert!` → `assert(cond, msg)`. `panic!`/`bug!`/`unreachable!` →
  `panic(...)`/`unreachable(...)` (become an ICE, exit 101, like rustc).

## 4. Names

- Keep Rust names **exactly**: snake_case functions, fields and locals; PascalCase types and
  variants. This keeps the port greppable against upstream and gives derive(Debug) its
  field names for free.
- Locals/params that are reserved in JS (`default`, `new`, `delete`, `this`, `in`, `function`,
  `var`, `class`, `enum`, `export`, `import`, `super`, `switch`, `case`, `with`, `yield`,
  `void`, `null`, `typeof`, `instanceof`, `package`, `interface`, `private`, `protected`,
  `public`, `static`, `let`, `const`, `catch`, `finally`, `throw`, `try`, `do`, `debugger`)
  get a trailing underscore: `default_`. Fields keep their name (property names are fine).
- Raw identifiers `r#foo` → `foo` (or `foo_` per the rule above).

## 5. Types

| Rust | TypeScript |
|---|---|
| `u8..u32`, `i8..i32`, `usize`, `isize`, `f64` | `number` |
| `u64`/`i64` | `number` if values provably stay < 2^53 (offsets, counts); else `bigint` + `// PORT:` |
| `u128`/`i128` | `bigint` (const eval, layout, literal values) |
| `char` | `number` (Unicode scalar); literals via `ch("x")` or a named `const C_X` |
| `bool` | `boolean` |
| `&str` / `String` holding **source text or anything byte-offset-indexed** | `Str` (`src/std/str.ts`, UTF-8 bytes) |
| other `&str` / `String` | `string`; `s.len()` → `utf8_len(s)` (never `.length`) |
| `Option<T>` | `T \| undefined`. `Option<Option<T>>` or `Option<undefined-able T>` → `{ $: "Some", _0 } \| undefined` + `// PORT:` |
| `Result<T, E>` | `Result<T, E>` from `src/std/result.ts`; `Ok(x)`, `Err(e)`; `?` → `if (r.$ === "Err") return r;` |
| `Vec<T>`, `&[T]`, `[T; N]`, `SmallVec`, `ThinVec` | `T[]` (readonly where upstream is `&[T]`) |
| `Box<T>`, `P<T>`, `Rc<T>`, `Arc<T>`, `&T`, `&mut T` | `T` |
| `Cell<T>`, `RefCell<T>`, `Lock<T>` | the field itself (mutable) |
| `FxHashMap<K,V>`/`HashMap` | `Map<K, V>` (key must be a primitive or interned handle) |
| `IndexMap`/`FxIndexMap` | `Map` (JS Maps are insertion-ordered) |
| `FxHashSet`/`IndexSet` | `Set` |
| tuples `(A, B)` | `[A, B]` |
| lifetimes, `PhantomData`, marker traits | erased |

### Enums
- **Fieldless** enums → string-literal union plus a same-named companion const:
  `export type DocStyle = "Outer" | "Inner"; export const DocStyle = { Outer: "Outer", Inner: "Inner" } as const;`
  If upstream uses discriminants (`as u32`, `PartialOrd` across variants), add `<Enum>_discriminant`.
- **Enums with data** → union of objects tagged by `$` (the tag field is always `$`; Rust field
  names can never collide with it):
  - struct variant `Literal { kind, suffix_start }` → `{ $: "Literal", kind, suffix_start }`
  - tuple variant `Paren(expr)` → `{ $: "Paren", _0: expr }`
  - unit variant `Semi` → `{ $: "Semi" }`, shared frozen singletons on the companion const (`TokenKind.Semi`).
  - Construct struct/tuple variants with **object literals** (type-checked against the union).
  - `match` → `switch (x.$)` or an if-chain **in the same arm order** (guards make order matter).
  - `matches!(x, A | B)` → `x.$ === "A" || x.$ === "B"`.

### Structs
- Structs with inherent methods → `class`; constructor takes **all fields in declaration
  order**; `Type::new(..)` → `static new(..)`. Methods keep Rust names; `self` → `this`.
- Data-only structs → `interface` + object literals (`{ n_hashes, terminated, token_len }`).
- Methods defined in another file (`impl Parser` split over many files): module augmentation
  + prototype assignment in the file that defines them. (Pattern lands with rustc_parse.)

### Interned handles
`Ty<'tcx>`, `Symbol`, `DefId`, `LocalDefId`, `HirId`, `NodeId`, `Span`, `newtype_index!` types →
branded numbers (`type Symbol = number & { readonly __brand: "Symbol" }`) indexing interners
owned by the session/`TyCtxt`. Equality is `===`. (Lands with rustc_span / rustc_middle.)

### Traits
- `#[derive(Debug)]` → `export const debug_<Type>: Debug<Type> = (v, f) => ...` using
  `src/std/fmt.ts` builders (`debug_struct`, `debug_tuple`, `debug_option`, ...). Output must
  equal rustc's `{:?}`/`{:#?}` byte-for-byte; the harness diffs it.
- `#[derive(PartialEq)]` on handles/unit enums → `===`; on data → a `<type>_eq` function if used.
- Other derives (`Clone`, `Copy`, `Hash`, `Encodable`, `HashStable`, `TypeFoldable`, ...) →
  generated by `tools/codegen` (planned); do not hand-write them.
- `dyn Trait` → interface. Generic trait bounds → erase, pass function tables when dispatch
  depends on the type.

### Macros inside rustc
`rustc_queries!`, `symbols!`, `newtype_index!`, `declare_lint!`, `#[derive(Diagnostic)]`,
`rustc_type_ir` derives: generated from the upstream sources by `tools/codegen` (planned).
Do not port these by hand; call `unported(...)` and note it in your handoff.

## 6. Generated files
Files starting with `// GENERATED` are produced by a tool under `tools/`. Never edit them;
fix the generator. Unicode tables come from the oracle (`tools/gen-unicode.ts`), so they always
match the Unicode version of the pinned upstream deps.

## 7. Style
- TypeScript strict; no `any` except at FFI-like edges with a `// PORT:` reason.
- No new npm dependencies.
- Hot paths: no closures allocated per char/token where upstream would inline; prefer
  numeric char codes; avoid `bigint` outside const-eval/layout.
