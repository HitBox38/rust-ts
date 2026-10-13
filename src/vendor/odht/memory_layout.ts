// Port of odht =0.3.1 `src/memory_layout.rs`.
//
// PORT: memory representation.
// - `Header` is `#[repr(C)]` with byte-array fields only (size 32, align 1). Here a `Header` is a view
//   over those 32 bytes: `&Header` / `&mut Header` into a table are views into the table's bytes, and
//   a by-value `Header { .. }` owns a fresh 32-byte array. The fields whose names clash with the
//   accessor methods (`item_count`, `slot_count`, `max_load_factor`) are `item_count_`, `slot_count_`
//   and `max_load_factor_`.
// - The `C: Config` type parameter is the `Config` dictionary (`Allocation.C`, or a first argument).
// - `M: Borrow<[u8]>` / `BorrowMut<[u8]>` (the table's storage: `Box<[u8]>`, `&[u8]`, `OwnedSlice`,
//   `Vec<u8>`, ...) is a `Uint8Array`.
// - `usize` header values are `number`s; the u64 fields are read exactly and must be < 2^53
//   (checked; larger values only occur in corrupt tables, see `u64_le_to_usize`).

import { panic, unported } from "../../std/panic.ts";
import { Error, debug_Error } from "./error.ts";
import { type Config, Factor } from "./lib.ts";
import { Entry, EntrySlice, RawTable } from "./raw_table.ts";
import { REFERENCE_GROUP_SIZE } from "./swisstable_group_query/mod.ts";
import { PLAIN } from "../../std/fmt.ts";

type Result<T> = { $: "Ok"; _0: T } | { $: "Err"; _0: Error };

const CURRENT_FILE_FORMAT_VERSION: readonly number[] = [0, 0, 0, 2];

/** `size_of::<EntryMetadata>()` (`u8`) */
const SIZE_OF_ENTRY_METADATA = 1;

// #[repr(C)]
// #[derive(Clone)]
// pub(crate) struct Header {
//     tag: [u8; 4],
//     size_of_metadata: u8,
//     size_of_key: u8,
//     size_of_value: u8,
//     size_of_header: u8,
//
//     item_count: [u8; 8],
//     slot_count: [u8; 8],
//
//     file_format_version: [u8; 4],
//     max_load_factor: [u8; 2],
//
//     // Let's keep things at least 8 byte aligned
//     padding: [u8; 2],
// }
export class Header {
  /** PORT: the header's `HEADER_SIZE` bytes (see the file header). */
  constructor(readonly bytes: Uint8Array) {}

  get tag(): Uint8Array {
    return this.bytes.subarray(0, 4);
  }
  get size_of_metadata(): number {
    return this.bytes[4]!;
  }
  get size_of_key(): number {
    return this.bytes[5]!;
  }
  get size_of_value(): number {
    return this.bytes[6]!;
  }
  get size_of_header(): number {
    return this.bytes[7]!;
  }
  get item_count_(): Uint8Array {
    return this.bytes.subarray(8, 16);
  }
  get slot_count_(): Uint8Array {
    return this.bytes.subarray(16, 24);
  }
  get file_format_version(): Uint8Array {
    return this.bytes.subarray(24, 28);
  }
  get max_load_factor_(): Uint8Array {
    return this.bytes.subarray(28, 30);
  }
  get padding(): Uint8Array {
    return this.bytes.subarray(30, 32);
  }

  // crate: odht-0.3.1/src/memory_layout.rs:40 sanity_check
  sanity_check<K, V>(C: Config<K, V>, raw_bytes_len: number): Result<undefined> {
    // assert!(align_of::<Header>() == 1);
    // assert!(HEADER_SIZE % 8 == 0);

    if (!bytes_eq(this.tag, HEADER_TAG)) {
      return Err(new Error(`Expected header tag ${debug_bytes(HEADER_TAG)} but found ${debug_bytes(this.tag)}`));
    }

    if (!bytes_eq(this.file_format_version, CURRENT_FILE_FORMAT_VERSION)) {
      return Err(
        new Error(`Expected file format version ${debug_bytes(CURRENT_FILE_FORMAT_VERSION)} but found ${debug_bytes(this.file_format_version)}`),
      );
    }

    let r = check_expected_size(SIZE_OF_ENTRY_METADATA, "EntryMetadata", this.size_of_metadata);
    if (r.$ === "Err") return r;
    r = check_expected_size(C.EncodedKey.LEN, "Config::EncodedKey", this.size_of_key);
    if (r.$ === "Err") return r;
    r = check_expected_size(C.EncodedValue.LEN, "Config::EncodedValue", this.size_of_value);
    if (r.$ === "Err") return r;
    r = check_expected_size(HEADER_SIZE, "Header", this.size_of_header);
    if (r.$ === "Err") return r;

    if (raw_bytes_len !== bytes_needed(C, this.slot_count())) {
      return Err(
        new Error(
          `Provided allocation has wrong size for slot count ${this.slot_count()}. ` +
            `The allocation's size is ${raw_bytes_len} but the expected size is ${bytes_needed(C, this.slot_count())}.`,
        ),
      );
    }

    // This should never actually be a problem because it should be impossible to
    // create the underlying memory slice in the first place:
    // assert!(u64::from_le_bytes(self.slot_count) <= usize::MAX as u64);  (64-bit host: always true)

    if (!is_power_of_two(this.slot_count())) {
      return Err(new Error(`Slot count of hashtable should be a power of two but is ${this.slot_count()}`));
    }

    return { $: "Ok", _0: undefined };

    // crate: odht-0.3.1/src/memory_layout.rs:86 check_expected_size
    function check_expected_size(size_of_T: number, name: string, expected_size: number): Result<undefined> {
      if (expected_size !== size_of_T) {
        return Err(
          new Error(
            `Expected size of ${name} to be ${size_of_T} but the encoded ` + `table specifies ${expected_size}. This indicates an encoding mismatch.`,
          ),
        );
      } else {
        return { $: "Ok", _0: undefined };
      }
    }
  }

  // crate: odht-0.3.1/src/memory_layout.rs:102 item_count
  item_count(): number {
    return u64_le_to_usize(this.item_count_);
  }

  // crate: odht-0.3.1/src/memory_layout.rs:107 set_item_count
  set_item_count(item_count: number): void {
    this.item_count_.set(u64_to_le_bytes(item_count));
  }

  // crate: odht-0.3.1/src/memory_layout.rs:112 slot_count
  slot_count(): number {
    return u64_le_to_usize(this.slot_count_);
  }

  // crate: odht-0.3.1/src/memory_layout.rs:117 max_load_factor
  max_load_factor(): Factor {
    const b = this.max_load_factor_;
    return new Factor(b[0]! | (b[1]! << 8));
  }

  // crate: odht-0.3.1/src/memory_layout.rs:122 metadata_offset
  metadata_offset<K, V>(C: Config<K, V>): number {
    return this.entry_data_offset() + this.entry_data_size_in_bytes(C);
  }

  // crate: odht-0.3.1/src/memory_layout.rs:127 entry_data_size_in_bytes
  entry_data_size_in_bytes<K, V>(C: Config<K, V>): number {
    const slot_count = this.slot_count();
    const size_of_entry = size_of_Entry(C);
    return slot_count * size_of_entry;
  }

  // crate: odht-0.3.1/src/memory_layout.rs:134 entry_data_offset
  entry_data_offset(): number {
    return HEADER_SIZE;
  }

  // crate: odht-0.3.1/src/memory_layout.rs:138 initialize
  static initialize<K, V>(C: Config<K, V>, raw_bytes: Uint8Array, slot_count: number, item_count: number, max_load_factor: Factor): void {
    assert_eq_usize(raw_bytes.length, bytes_needed(C, slot_count));

    const header = new Header(new Uint8Array(HEADER_SIZE));
    header.tag.set(HEADER_TAG);
    header.bytes[4] = u8_try_from(SIZE_OF_ENTRY_METADATA);
    header.bytes[5] = u8_try_from(C.EncodedKey.LEN);
    header.bytes[6] = u8_try_from(C.EncodedValue.LEN);
    header.bytes[7] = u8_try_from(HEADER_SIZE);
    header.item_count_.set(u64_to_le_bytes(item_count));
    header.slot_count_.set(u64_to_le_bytes(slot_count));
    header.file_format_version.set(CURRENT_FILE_FORMAT_VERSION);
    header.max_load_factor_.set([max_load_factor._0 & 0xff, max_load_factor._0 >>> 8]);
    header.padding.set([0, 0]);

    // assert_eq!(header.sanity_check::<C>(raw_bytes.len()), Ok(()));
    const check = header.sanity_check(C, raw_bytes.length);
    if (check.$ === "Err") {
      panic(`assertion \`left == right\` failed\n  left: Err(${debug_Error(check._0, PLAIN)})\n right: Ok(())`);
    }

    // `*(raw_bytes.as_mut_ptr() as *mut Header) = header;`
    raw_bytes.set(header.bytes, 0);
  }
}

const HEADER_TAG: readonly number[] = Array.from("ODHT", (c) => c.charCodeAt(0));
// const HEADER_SIZE: usize = size_of::<Header>();
const HEADER_SIZE = 32;

/** `size_of::<Entry<C::EncodedKey, C::EncodedValue>>()` (`#[repr(C)]` of two byte arrays: no padding) */
function size_of_Entry<K, V>(C: Config<K, V>): number {
  return C.EncodedKey.LEN + C.EncodedValue.LEN;
}

/// An allocation holds a byte array that is guaranteed to conform to the
/// hash table's binary layout.
// #[derive(Clone, Copy)]
export class Allocation<K, V> {
  constructor(
    readonly C: Config<K, V>,
    readonly bytes: Uint8Array,
  ) {}

  // crate: odht-0.3.1/src/memory_layout.rs:183 from_raw_bytes
  static from_raw_bytes<K, V>(C: Config<K, V>, raw_bytes: Uint8Array): Result<Allocation<K, V>> {
    const allocation = new Allocation(C, raw_bytes);

    const r = allocation.header().sanity_check(C, allocation.bytes.length);
    if (r.$ === "Err") return r;

    // Check that the hash function provides the expected hash values.
    {
      const [entry_metadata, entry_data] = allocation.data_slices();
      const r = RawTable.new(C.H, entry_metadata, entry_data).sanity_check_hashes(10);
      if (r.$ === "Err") return r;
    }

    return { $: "Ok", _0: allocation };
  }

  // crate: odht-0.3.1/src/memory_layout.rs:204 from_raw_bytes_unchecked
  static from_raw_bytes_unchecked<K, V>(C: Config<K, V>, raw_bytes: Uint8Array): Allocation<K, V> {
    return new Allocation(C, raw_bytes);
  }

  // crate: odht-0.3.1/src/memory_layout.rs:212 header
  header(): Header {
    const raw_bytes = this.bytes;
    // debug_assert!(raw_bytes.len() >= HEADER_SIZE);
    if (raw_bytes.length < HEADER_SIZE) {
      // PORT: upstream reads the header out of bounds here (undefined behaviour; only the debug
      // assertion above guards it).
      return unported("odht::memory_layout::Allocation::header of a table shorter than the header (out-of-bounds read upstream)");
    }

    const header = new Header(raw_bytes.subarray(0, HEADER_SIZE));

    // debug_assert_eq!(header.sanity_check::<C>(raw_bytes.len()), Ok(()));

    return header;
  }

  // crate: odht-0.3.1/src/memory_layout.rs:224 data_slices
  data_slices(): [Uint8Array, EntrySlice] {
    const raw_bytes = this.bytes;
    const slot_count = this.header().slot_count();
    const entry_data_offset = this.header().entry_data_offset();
    const metadata_offset = this.header().metadata_offset(this.C);

    const entry_metadata = raw_bytes.subarray(metadata_offset, metadata_offset + slot_count + REFERENCE_GROUP_SIZE);

    const entry_data = new EntrySlice(
      this.C.EncodedKey,
      this.C.EncodedValue,
      raw_bytes.subarray(entry_data_offset, entry_data_offset + slot_count * size_of_Entry(this.C)),
      slot_count,
    );

    // debug_assert_eq!(entry_data.as_ptr_range().start as usize, raw_bytes.as_ptr_range().start as usize + HEADER_SIZE);
    // debug_assert_eq!(entry_data.as_ptr_range().end as usize, entry_metadata.as_ptr_range().start as usize);
    // debug_assert_eq!(raw_bytes.as_ptr_range().end as usize, entry_metadata.as_ptr_range().end as usize);

    return [entry_metadata, entry_data];
  }

  // crate: odht-0.3.1/src/memory_layout.rs:264 raw_bytes
  raw_bytes(): Uint8Array {
    return this.bytes;
  }

  // crate: odht-0.3.1/src/memory_layout.rs:275 with_mut_parts
  with_mut_parts<R>(f: (header: Header, entry_metadata: Uint8Array, entry_data: EntrySlice) => R): R {
    const raw_bytes = this.bytes;

    // Copy the address as an integer so we can use it for the debug_assertion
    // below without accessing `raw_bytes` again.
    // let _raw_bytes_end_addr = raw_bytes.as_ptr_range().end as usize;

    // `raw_bytes.split_at_mut(HEADER_SIZE)` (panics when `HEADER_SIZE > len`)
    if (HEADER_SIZE > raw_bytes.length) panic("mid > len");
    const header = new Header(raw_bytes.subarray(0, HEADER_SIZE));
    const rest = raw_bytes.subarray(HEADER_SIZE);

    const slot_count = header.slot_count();
    const entry_data_size_in_bytes = header.entry_data_size_in_bytes(this.C);

    if (entry_data_size_in_bytes > rest.length) panic("mid > len");
    const entry_data_bytes = rest.subarray(0, entry_data_size_in_bytes);
    const metadata_bytes = rest.subarray(entry_data_size_in_bytes);

    const entry_metadata = metadata_bytes.subarray(0, slot_count + REFERENCE_GROUP_SIZE);

    const entry_data = new EntrySlice(this.C.EncodedKey, this.C.EncodedValue, entry_data_bytes, slot_count);

    // debug_assert_eq!(entry_data.as_ptr_range().start as usize, header as *mut Header as usize + HEADER_SIZE);
    // debug_assert_eq!(entry_data.as_ptr_range().end as usize, entry_metadata.as_ptr_range().start as usize);
    // debug_assert_eq!(_raw_bytes_end_addr, entry_metadata.as_ptr_range().end as usize);

    return f(header, entry_metadata, entry_data);
  }
}

// crate: odht-0.3.1/src/memory_layout.rs:331 bytes_needed
export function bytes_needed<K, V>(C: Config<K, V>, slot_count: number): number {
  if (!is_power_of_two(slot_count)) panic("assertion failed: slot_count.is_power_of_two()");
  const size_of_entry = size_of_Entry(C);
  const size_of_metadata = SIZE_OF_ENTRY_METADATA;

  return HEADER_SIZE + slot_count * size_of_entry + (slot_count + REFERENCE_GROUP_SIZE) * size_of_metadata;
}

// crate: odht-0.3.1/src/memory_layout.rs:341 allocate
export function allocate<K, V>(C: Config<K, V>, slot_count: number, item_count: number, max_load_factor: Factor): Allocation<K, V> {
  const bytes = new Uint8Array(bytes_needed(C, slot_count));
  return init_in_place(C, bytes, slot_count, item_count, max_load_factor);
}

// crate: odht-0.3.1/src/memory_layout.rs:350 init_in_place
export function init_in_place<K, V>(C: Config<K, V>, bytes: Uint8Array, slot_count: number, item_count: number, max_load_factor: Factor): Allocation<K, V> {
  Header.initialize(C, bytes, slot_count, item_count, max_load_factor);

  const allocation = new Allocation(C, bytes);

  allocation.with_mut_parts((_, metadata, data) => {
    metadata.fill(0xff);
    data.fill(Entry.default(C.EncodedKey, C.EncodedValue));
  });

  return allocation;
}

// ---- helpers (std) ----

function Err(e: Error): { $: "Err"; _0: Error } {
  return { $: "Err", _0: e };
}

/** `usize::is_power_of_two` */
export function is_power_of_two(x: number): boolean {
  if (x <= 0 || !Number.isInteger(x)) return false;
  // PORT: exact for every `number` integer (powers of two are exact doubles).
  return 2 ** Math.round(Math.log2(x)) === x;
}

/** `{:?}` of a `[u8; N]` */
function debug_bytes(b: ArrayLike<number>): string {
  return `[${Array.from(b).join(", ")}]`;
}

function bytes_eq(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * `u64::from_le_bytes(bytes) as usize`. PORT: values ≥ 2^53 have no exact `number`; they only occur in
 * corrupt tables (upstream's size check then compares wrapped products), so they panic here.
 */
function u64_le_to_usize(b: Uint8Array): number {
  const lo = (b[0]! | (b[1]! << 8) | (b[2]! << 16) | (b[3]! << 24)) >>> 0;
  const hi = (b[4]! | (b[5]! << 8) | (b[6]! << 16) | (b[7]! << 24)) >>> 0;
  if (hi >= 0x20_0000) return unported(`odht header u64 value >= 2^53 (hi word ${hi})`);
  return hi * 0x1_0000_0000 + lo;
}

/** `(x as u64).to_le_bytes()` */
function u64_to_le_bytes(x: number): Uint8Array {
  const b = new Uint8Array(8);
  const lo = x % 0x1_0000_0000;
  const hi = Math.floor(x / 0x1_0000_0000);
  b[0] = lo & 0xff;
  b[1] = (lo >>> 8) & 0xff;
  b[2] = (lo >>> 16) & 0xff;
  b[3] = (lo >>> 24) & 0xff;
  b[4] = hi & 0xff;
  b[5] = (hi >>> 8) & 0xff;
  b[6] = (hi >>> 16) & 0xff;
  b[7] = (hi >>> 24) & 0xff;
  return b;
}

/** `u8::try_from(x).unwrap()` */
function u8_try_from(x: number): number {
  if (x > 0xff) panic("called `Result::unwrap()` on an `Err` value: TryFromIntError(())");
  return x;
}

/** `assert_eq!(left, right)` on `usize` */
function assert_eq_usize(left: number, right: number): void {
  if (left !== right) panic(`assertion \`left == right\` failed\n  left: ${left}\n right: ${right}`);
}

