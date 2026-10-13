// Port of pulldown-cmark-0.11.3/src/firstpass.rs.
//! The first pass resolves all block structure, generating an AST. Within a block, items
//! are in a linear chain with potential inline markup identified.
//!
//! PORT: the `#[cfg(all(target_arch = "x86_64", feature = "simd"))]` variants (the `LookupTable`
//! struct, the simd branches of `create_lut`/`iterate_special_bytes`) and `mod simd` (with its
//! tests) are not ported: the oracle host is aarch64, so the scalar `#[cfg(not(..))]` path is the
//! one compiled. firstpass.rs has no other test module.

import { is_ascii_alphabetic, is_whitespace } from "../../std/char.ts";
import type { MutRef } from "../../std/mut_ref.ts";
import { panic, unwrap } from "../../std/panic.ts";
import { decode_at, is_valid_utf8, Str, str_chars_nth } from "../../std/str.ts";
import { UniCase } from "../unicase/lib.ts";
import { type HeadingLevel, HeadingLevel_discriminant, type MetadataBlockKind, Options } from "./lib.ts";
import { type LinkLabel, scan_link_label_rest } from "./linklabel.ts";
import {
  Allocations,
  type HeadingAttributes,
  type Item,
  ItemBody,
  Item_default,
  LINK_MAX_NESTED_PARENS,
  type LinkDef,
  scan_containers,
} from "./parse.ts";
// PORT: `is_ascii_punctuation`/`is_punctuation` reach firstpass.rs through `scanners::*` (a
// re-export of puncttable.rs); imported from puncttable.ts directly.
import { is_ascii_punctuation, is_punctuation } from "./puncttable.ts";
import {
  calc_indent,
  is_ascii_whitespace,
  is_ascii_whitespace_no_nl,
  LineStart,
  scan_atx_heading,
  scan_blank_line,
  scan_blockquote_start,
  scan_ch,
  scan_ch_repeat,
  scan_closing_code_fence,
  scan_closing_metadata_block,
  scan_code_fence,
  scan_entity,
  scan_eol,
  scan_hrule,
  scan_html_type_7,
  scan_link_dest,
  scan_listitem,
  scan_metadata_block,
  scan_nextline,
  scan_rev_while,
  scan_setext_heading,
  scan_table_head,
  scan_whitespace_no_nl,
  starts_html_block_type_6,
  unescape,
} from "./scanners.ts";
import type { CowStr } from "./strings.ts";
import { Tree, type TreeIndex } from "./tree.ts";

/** `s.as_bytes()` */
function as_bytes(s: Str): Uint8Array {
  return s.b.subarray(s.lo, s.hi);
}

/** `<[u8]>::starts_with(p)` */
function bytes_starts_with(bytes: Uint8Array, p: readonly number[]): boolean {
  if (bytes.length < p.length) return false;
  for (let k = 0; k < p.length; k++) if (bytes[k] !== p[k]) return false;
  return true;
}

/** `s.chars().last()` */
function str_last_char(s: Str): number | undefined {
  if (s.len() === 0) return undefined;
  let i = s.len() - 1;
  while (i > 0 && (s.byte(i) & 0xc0) === 0x80) i--;
  return decode_at(s.b, s.lo + i);
}

/** `s.ends_with(p)` for an ASCII pattern `p`. */
function str_ends_with_ascii(s: Str, p: string): boolean {
  if (s.len() < p.length) return false;
  const off = s.len() - p.length;
  for (let k = 0; k < p.length; k++) if (s.byte(off + k) !== p.charCodeAt(k)) return false;
  return true;
}

/** `"   "[..n]` */
function spaces_prefix(n: number): string {
  if (n > 3) panic(`byte index ${n} is out of range of \`   \``);
  return "   ".slice(0, n);
}

// crate: pulldown-cmark-0.11.3/src/firstpass.rs:24 run_first_pass
/// Runs the first pass, which resolves the block structure of the document,
/// and returns the resulting tree.
export function run_first_pass(text: Str, options: Options): [Tree<Item>, Allocations] {
  // This is a very naive heuristic for the number of nodes
  // we'll need.
  const start_capacity = Math.max(128, Math.floor(text.len() / 32));
  const lookup_table = create_lut(options);
  const first_pass = new FirstPass(
    text,
    Tree.with_capacity(start_capacity, Item_default),
    undefined,
    false,
    Allocations.new(),
    options,
    lookup_table,
    undefined,
    [],
    0,
  );
  return first_pass.run();
}

// Each level of brace nesting adds another entry to a hash table.
// To limit the amount of memory consumed, do not create a new brace
// context beyond some amount deep.
//
// There are actually two limits at play here: this one,
// and the one where the maximum amount of distinct contexts passes
// the 255 item limit imposed by using `u8`. When over 255 distinct
// contexts are created, it wraps around, while this one instead makes it
// saturate, which is a better behavior.
const MATH_BRACE_CONTEXT_MAX_NESTING = 25;

/// State for the first parsing pass.
class FirstPass {
  constructor(
    public text: Str,
    public tree: Tree<Item>,
    public begin_list_item: number | undefined,
    public last_line_blank: boolean,
    public allocs: Allocations,
    public options: Options,
    public lookup_table: LookupTable,
    /// This is `Some(item)` when the next paragraph
    /// starts with a task list marker.
    public next_paragraph_task: Item | undefined,
    /// Math environment brace nesting.
    public brace_context_stack: number[],
    public brace_context_next: number,
  ) {}

  // crate: pulldown-cmark-0.11.3/src/firstpass.rs:73 run
  run(): [Tree<Item>, Allocations] {
    let ix = 0;
    while (ix < this.text.len()) {
      ix = this.parse_block(ix);
    }
    for (let k = 0, n = this.tree.spine_len(); k < n; k++) {
      this.pop(ix);
    }
    return [this.tree, this.allocs];
  }

  // crate: pulldown-cmark-0.11.3/src/firstpass.rs:85 parse_block
  /// Returns offset after block.
  parse_block(start_ix: number): number {
    const bytes = as_bytes(this.text);
    let line_start = LineStart.new(bytes.subarray(start_ix));

    // math spans and their braces are tracked only within a single block
    this.brace_context_stack.length = 0;
    this.brace_context_next = 0;

    const i = scan_containers(this.tree, line_start, Options.has_gfm_footnotes(this.options));
    for (let k = i, n = this.tree.spine_len(); k < n; k++) {
      this.pop(start_ix);
    }

    if (Options.contains(this.options, Options.ENABLE_OLD_FOOTNOTES)) {
      // finish footnote if it's still open and was preceded by blank line
      const node_ix = this.tree.peek_up();
      if (node_ix !== undefined) {
        if (this.tree.at(node_ix).item.body.$ === "FootnoteDefinition") {
          if (this.last_line_blank) {
            this.pop(start_ix);
          }
        }
      }

      // Footnote definitions of the form
      // [^bar]:
      // * anything really
      const container_start = start_ix + line_start.bytes_scanned();
      const bytecount = this.parse_footnote(container_start);
      if (bytecount !== undefined) {
        start_ix = container_start + bytecount;
        start_ix += scan_blank_line(bytes.subarray(start_ix)) ?? 0;
        line_start = LineStart.new(bytes.subarray(start_ix));
      }
    }

    // Process new containers
    for (;;) {
      if (Options.has_gfm_footnotes(this.options) || Options.contains(this.options, Options.ENABLE_OLD_FOOTNOTES)) {
        // Footnote definitions of the form
        // [^bar]:
        //     * anything really
        const save = line_start.clone();
        const indent = line_start.scan_space_upto(4);
        if (indent < 4) {
          const container_start = start_ix + line_start.bytes_scanned();
          const bytecount = this.parse_footnote(container_start);
          if (bytecount !== undefined) {
            start_ix = container_start + bytecount;
            line_start = LineStart.new(bytes.subarray(start_ix));
            continue;
          } else {
            line_start = save;
          }
        } else {
          line_start = save;
        }
      }
      const container_start = start_ix + line_start.bytes_scanned();
      const list_marker = line_start.scan_list_marker();
      if (list_marker !== undefined) {
        const [ch, index, indent] = list_marker;
        const after_marker_index = start_ix + line_start.bytes_scanned();
        this.continue_list(container_start, ch, index);
        this.tree.append({
          start: container_start,
          end: after_marker_index, // will get updated later if item not empty
          body: { $: "ListItem", _0: indent },
        });
        this.tree.push();
        const n = scan_blank_line(bytes.subarray(after_marker_index));
        if (n !== undefined) {
          this.begin_list_item = after_marker_index + n;
          return after_marker_index + n;
        }
        if (Options.contains(this.options, Options.ENABLE_TASKLISTS)) {
          const is_checked = line_start.scan_task_list_marker();
          const task_list_marker: Item | undefined =
            is_checked !== undefined
              ? {
                  start: after_marker_index,
                  end: start_ix + line_start.bytes_scanned(),
                  body: { $: "TaskListMarker", _0: is_checked },
                }
              : undefined;
          if (task_list_marker !== undefined) {
            const n = scan_blank_line(bytes.subarray(task_list_marker.end));
            if (n !== undefined) {
              this.tree.append(task_list_marker);
              this.begin_list_item = task_list_marker.end + n;
              return task_list_marker.end + n;
            } else {
              this.next_paragraph_task = task_list_marker;
            }
          }
        }
      } else if (line_start.scan_blockquote_marker()) {
        const kind = Options.contains(this.options, Options.ENABLE_GFM) ? line_start.scan_blockquote_tag() : undefined;
        this.finish_list(start_ix);
        this.tree.append({
          start: container_start,
          end: 0, // will get set later
          body: { $: "BlockQuote", _0: kind },
        });
        this.tree.push();
        if (kind !== undefined) {
          // blockquote tag leaves us at the end of the line
          // we need to scan through all the container syntax for the next line
          // and break out if we can't re-scan all of them
          const ix = start_ix + line_start.bytes_scanned();
          const lazy_line_start = LineStart.new(bytes.subarray(ix));
          const current_container =
            scan_containers(this.tree, lazy_line_start, Options.has_gfm_footnotes(this.options)) === this.tree.spine_len();
          if (
            !lazy_line_start.scan_space(4) &&
            this.scan_paragraph_interrupt(bytes.subarray(ix + lazy_line_start.bytes_scanned()), current_container)
          ) {
            return ix;
          } else {
            // blockquote tags act as if they were nested in a paragraph
            // so you can lazily continue the imaginary paragraph off of them
            line_start = lazy_line_start;
            line_start.scan_all_space();
            start_ix = ix;
            break;
          }
        }
      } else {
        break;
      }
    }

    const ix = start_ix + line_start.bytes_scanned();

    const n = scan_blank_line(bytes.subarray(ix));
    if (n !== undefined) {
      const node_ix = this.tree.peek_up();
      if (node_ix !== undefined) {
        const body = this.tree.at(node_ix).item.body;
        if (body.$ === "BlockQuote") {
          // ()
        } else if (body.$ === "ListItem" && this.begin_list_item !== undefined) {
          this.last_line_blank = true;
          // This is a blank list item.
          // While the list itself can be continued no matter how many blank lines
          // there are between this one and the next one, it cannot nest anything
          // else, so its indentation should not be subtracted from the line start.
          this.tree.at(node_ix).item.body = { $: "ListItem", _0: 0 };
        } else {
          this.last_line_blank = true;
        }
      }
      return ix + n;
    }

    this.finish_list(start_ix);

    // Save `remaining_space` here to avoid needing to backtrack `line_start` for HTML blocks
    const remaining_space = line_start.remaining_space();

    const indent = line_start.scan_space_upto(4);
    if (indent === 4) {
      const ix = start_ix + line_start.bytes_scanned();
      const remaining_space = line_start.remaining_space();
      return this.parse_indented_code_block(ix, remaining_space);
    }

    const ix2 = start_ix + line_start.bytes_scanned();

    // metadata blocks cannot be indented
    if (indent === 0) {
      const metadata = scan_metadata_block(
        bytes.subarray(ix2),
        Options.contains(this.options, Options.ENABLE_YAML_STYLE_METADATA_BLOCKS),
        Options.contains(this.options, Options.ENABLE_PLUSES_DELIMITED_METADATA_BLOCKS),
      );
      if (metadata !== undefined) {
        const [_n, metadata_block_ch] = metadata;
        return this.parse_metadata_block(ix2, metadata_block_ch);
      }
    }

    // HTML Blocks
    if (bytes[ix2]! === 0x3c /* < */) {
      // Types 1-5 are all detected by one function and all end with the same
      // pattern
      const html_end_tag = get_html_end_tag(bytes.subarray(ix2 + 1));
      if (html_end_tag !== undefined) {
        return this.parse_html_block_type_1_to_5(ix2, html_end_tag, remaining_space, indent);
      }

      // Detect type 6
      if (starts_html_block_type_6(bytes.subarray(ix2 + 1))) {
        return this.parse_html_block_type_6_or_7(ix2, remaining_space, indent);
      }

      // Detect type 7
      const _html_bytes = scan_html_type_7(bytes.subarray(ix2));
      if (_html_bytes !== undefined) {
        return this.parse_html_block_type_6_or_7(ix2, remaining_space, indent);
      }
    }

    const hrule = scan_hrule(bytes.subarray(ix2));
    if (hrule.$ === "Ok") {
      return this.parse_hrule(hrule._0, ix2);
    }

    const atx_size = scan_atx_heading(bytes.subarray(ix2));
    if (atx_size !== undefined) {
      return this.parse_atx_heading(ix2, atx_size);
    }

    const fence = scan_code_fence(bytes.subarray(ix2));
    if (fence !== undefined) {
      const [n, fence_ch] = fence;
      return this.parse_fenced_code_block(ix2, indent, fence_ch, n);
    }

    // parse refdef
    for (;;) {
      const refdef = this.parse_refdef_total(start_ix + line_start.bytes_scanned());
      if (refdef === undefined) break;
      const [bytecount, label, link_def] = refdef;
      this.allocs.refdefs.entry_or_insert(label, link_def);
      const container_start = start_ix + line_start.bytes_scanned();
      let ix = container_start + bytecount;
      // Refdefs act as if they were contained within a paragraph, for purposes of lazy
      // continuations. For example:
      //
      // ```
      // > [foo]: http://example.com
      // bar
      // ```
      //
      // is equivalent to
      //
      // ```
      // > bar
      //
      // [foo]: http://example.com
      // ```
      const nl = scan_blank_line(bytes.subarray(ix));
      if (nl !== undefined) {
        ix += nl;
        const lazy_line_start = LineStart.new(bytes.subarray(ix));
        const current_container =
          scan_containers(this.tree, lazy_line_start, Options.has_gfm_footnotes(this.options)) === this.tree.spine_len();
        if (
          !lazy_line_start.scan_space(4) &&
          this.scan_paragraph_interrupt(bytes.subarray(ix + lazy_line_start.bytes_scanned()), current_container)
        ) {
          return ix;
        } else {
          line_start = lazy_line_start;
          line_start.scan_all_space();
          start_ix = ix;
        }
      } else {
        return ix;
      }
    }

    const ix3 = start_ix + line_start.bytes_scanned();

    return this.parse_paragraph(ix3);
  }

  // crate: pulldown-cmark-0.11.3/src/firstpass.rs:362 parse_table
  /// Returns the offset of the first line after the table.
  /// Assumptions: current focus is a table element and the table header
  /// matches the separator line (same number of columns).
  parse_table(table_cols: number, head_start: number, body_start: number): number | undefined {
    // filled empty cells are limited to protect against quadratic growth
    // https://github.com/raphlinus/pulldown-cmark/issues/832
    const missing_empty_cells: MutRef<number> = { value: 0 };
    // parse header. this shouldn't fail because we made sure the table header is ok
    const head = this.parse_table_row_inner(head_start, table_cols, missing_empty_cells);
    if (head === undefined) return undefined;
    const [_sep_start, thead_ix] = head;
    this.tree.at(thead_ix).item.body = ItemBody.TableHead;

    // parse body
    let ix = body_start;
    for (;;) {
      const row = this.parse_table_row(ix, table_cols, missing_empty_cells);
      if (row === undefined) break;
      const [next_ix, _row_ix] = row;
      ix = next_ix;
    }

    this.pop(ix);
    return ix;
  }

  // crate: pulldown-cmark-0.11.3/src/firstpass.rs:390 parse_table_row_inner
  /// Call this when containers are taken care of.
  /// Returns bytes scanned, row_ix
  parse_table_row_inner(ix: number, row_cells: number, missing_empty_cells: MutRef<number>): [number, TreeIndex] | undefined {
    // Limit to prevent a malicious input from causing a denial of service.
    const MAX_AUTOCOMPLETED_CELLS = 1 << 18; // = 0x40000

    const bytes = as_bytes(this.text);
    let cells = 0;
    let final_cell_ix: TreeIndex | undefined = undefined;

    const old_cur = this.tree.cur();
    const row_ix = this.tree.append({
      start: ix,
      end: 0, // set at end of this function
      body: ItemBody.TableRow,
    });
    this.tree.push();

    for (;;) {
      ix += scan_ch(bytes.subarray(ix), 0x7c /* | */);
      const start_ix = ix;
      ix += scan_whitespace_no_nl(bytes.subarray(ix));

      const eol_bytes = scan_eol(bytes.subarray(ix));
      if (eol_bytes !== undefined) {
        ix += eol_bytes;
        break;
      }

      const cell_ix = this.tree.append({
        start: start_ix,
        end: ix,
        body: ItemBody.TableCell,
      });
      this.tree.push();
      const [next_ix, _brk] = this.parse_line(ix, undefined, "Active");

      this.tree.at(cell_ix).item.end = next_ix;
      this.tree.pop();

      ix = next_ix;
      cells += 1;

      if (cells === row_cells) {
        final_cell_ix = cell_ix;
      }
    }

    if (old_cur !== undefined && cells === 0) {
      const cur = old_cur;
      this.pop(ix);
      this.tree.at(cur).next = undefined;
      return undefined;
    }

    // fill empty cells if needed
    // note: this is where GFM and commonmark-extra diverge. we follow
    // GFM here
    for (let k = cells; k < row_cells; k++) {
      if (missing_empty_cells.value >= MAX_AUTOCOMPLETED_CELLS) {
        return undefined;
      }
      missing_empty_cells.value += 1;
      this.tree.append({
        start: ix,
        end: ix,
        body: ItemBody.TableCell,
      });
    }

    // drop excess cells
    if (final_cell_ix !== undefined) {
      const cell_ix = final_cell_ix;
      this.tree.at(cell_ix).next = undefined;
    }

    this.pop(ix);

    return [ix, row_ix];
  }

  // crate: pulldown-cmark-0.11.3/src/firstpass.rs:472 parse_table_row
  /// Returns first offset after the row and the tree index of the row.
  parse_table_row(ix: number, row_cells: number, missing_empty_cells: MutRef<number>): [number, TreeIndex] | undefined {
    const bytes = as_bytes(this.text);
    const line_start = LineStart.new(bytes.subarray(ix));
    const current_container =
      scan_containers(this.tree, line_start, Options.has_gfm_footnotes(this.options)) === this.tree.spine_len();
    if (!current_container) {
      return undefined;
    }
    line_start.scan_all_space();
    ix += line_start.bytes_scanned();
    if (
      scan_paragraph_interrupt_no_table(
        bytes.subarray(ix),
        current_container,
        Options.contains(this.options, Options.ENABLE_FOOTNOTES),
        this.tree,
      )
    ) {
      return undefined;
    }

    const r = this.parse_table_row_inner(ix, row_cells, missing_empty_cells);
    if (r === undefined) return undefined;
    const [ix2, row_ix] = r;
    return [ix2, row_ix];
  }

  // crate: pulldown-cmark-0.11.3/src/firstpass.rs:504 parse_paragraph
  /// Returns offset of line start after paragraph.
  parse_paragraph(start_ix: number): number {
    const node_ix = this.tree.append({
      start: start_ix,
      end: 0, // will get set later
      body: ItemBody.Paragraph,
    });
    this.tree.push();

    if (this.next_paragraph_task !== undefined) {
      const item = this.next_paragraph_task;
      this.tree.append(item);
      this.next_paragraph_task = undefined;
    }

    const bytes = as_bytes(this.text);
    let ix = start_ix;
    for (;;) {
      const scan_mode: TableParseMode = Options.contains(this.options, Options.ENABLE_TABLES) && ix === start_ix ? "Scan" : "Disabled";
      const [next_ix, brk] = this.parse_line(ix, undefined, scan_mode);

      // break out when we find a table
      if (brk !== undefined && brk.body.$ === "Table") {
        const alignment_ix = brk.body._0;
        const table_cols = this.allocs.index_alignment(alignment_ix).length;
        this.tree.at(node_ix).item.body = { $: "Table", _0: alignment_ix };
        // this clears out any stuff we may have appended - but there may
        // be a cleaner way
        this.tree.at(node_ix).child = undefined;
        this.tree.pop();
        this.tree.push();
        const ix_table = this.parse_table(table_cols, ix, next_ix);
        if (ix_table !== undefined) {
          return ix_table;
        }
      }

      ix = next_ix;
      const line_start = LineStart.new(bytes.subarray(ix));
      const current_container =
        scan_containers(this.tree, line_start, Options.has_gfm_footnotes(this.options)) === this.tree.spine_len();
      const trailing_backslash_pos =
        brk !== undefined && brk.body.$ === "HardBreak" && brk.body._0 === true && bytes[brk.start]! === 0x5c /* \ */
          ? brk.start
          : undefined;
      if (!line_start.scan_space(4)) {
        const ix_new = ix + line_start.bytes_scanned();
        if (current_container) {
          const ix_setext = this.parse_setext_heading(ix_new, node_ix, trailing_backslash_pos !== undefined);
          if (ix_setext !== undefined) {
            if (trailing_backslash_pos !== undefined) {
              const pos = trailing_backslash_pos;
              this.tree.append_text(pos, pos + 1, false);
            }
            ix = ix_setext;
            break;
          }
        }
        // first check for non-empty lists, then for other interrupts
        const suffix = bytes.subarray(ix_new);
        if (this.scan_paragraph_interrupt(suffix, current_container)) {
          if (trailing_backslash_pos !== undefined) {
            const pos = trailing_backslash_pos;
            this.tree.append_text(pos, pos + 1, false);
          }
          break;
        }
      }
      line_start.scan_all_space();
      if (line_start.is_at_eol()) {
        if (trailing_backslash_pos !== undefined) {
          const pos = trailing_backslash_pos;
          this.tree.append_text(pos, pos + 1, false);
        }
        break;
      }
      ix = next_ix + line_start.bytes_scanned();
      if (brk !== undefined) {
        const item = brk;
        this.tree.append(item);
      }
    }

    this.pop(ix);
    return ix;
  }

  // crate: pulldown-cmark-0.11.3/src/firstpass.rs:600 parse_setext_heading
  /// Returns end ix of setext_heading on success.
  parse_setext_heading(ix: number, node_ix: TreeIndex, has_trailing_content: boolean): number | undefined {
    const bytes = as_bytes(this.text);
    const setext = scan_setext_heading(bytes.subarray(ix));
    if (setext === undefined) return undefined;
    const [n, level] = setext;
    let attrs: HeadingAttributes | undefined = undefined;

    const cur_ix = this.tree.cur();
    if (cur_ix !== undefined) {
      const parent_ix = unwrap(this.tree.peek_up());
      const header_start = this.tree.at(parent_ix).item.start;
      // Note that `self.tree[parent_ix].item.end` might be zero at this point.
      // Use the end position of the current node (i.e. the last known child
      // of the parent) instead.
      const header_end = this.tree.at(cur_ix).item.end;

      // extract the trailing attribute block
      const [content_end, attrs_] = this.extract_and_parse_heading_attribute_block(header_start, header_end);
      attrs = attrs_;

      // strip trailing whitespace
      let new_end: number;
      if (has_trailing_content) {
        new_end = content_end;
      } else {
        const trailing_ws = scan_rev_while(bytes.subarray(header_start, content_end), is_ascii_whitespace_no_nl);
        new_end = content_end - trailing_ws;
      }

      if (attrs !== undefined) {
        // remove trailing block attributes
        this.tree.truncate_siblings(new_end);
      }

      const cur_ix2 = this.tree.cur();
      if (cur_ix2 !== undefined) {
        this.tree.at(cur_ix2).item.end = new_end;
      }
    }

    this.tree.at(node_ix).item.body = {
      $: "Heading",
      _0: level,
      _1: attrs !== undefined ? this.allocs.allocate_heading(attrs) : undefined,
    };

    return ix + n;
  }

  // crate: pulldown-cmark-0.11.3/src/firstpass.rs:653 parse_line
  /// Parse a line of input, appending text and items to tree.
  ///
  /// Returns: index after line and an item representing the break.
  parse_line(start: number, end: number | undefined, mode: TableParseMode): [number, Item | undefined] {
    const bytes0 = as_bytes(this.text);
    const bytes = end !== undefined ? bytes0.subarray(0, end) : bytes0;
    const bytes_len = bytes.length;
    let pipes = 0;
    let last_pipe_ix = start;
    let begin_text = start;
    let backslash_escaped = false;

    const [final_ix, brk] = iterate_special_bytes<Item>(this.lookup_table, bytes, start, (ix, byte) => {
      if (byte === 0x0a /* \n */ || byte === 0x0d /* \r */) {
        if (mode === "Active") {
          return { $: "BreakAtWith", _0: ix, _1: undefined };
        }

        let i = ix;
        const eol_bytes = unwrap(scan_eol(bytes.subarray(ix)));

        const end_ix = ix + eol_bytes;
        const trailing_backslashes = scan_rev_while(bytes.subarray(0, ix), (b) => b === 0x5c /* \ */);
        if (trailing_backslashes % 2 === 1 && end_ix < bytes_len) {
          i -= 1;
          this.tree.append_text(begin_text, i, backslash_escaped);
          backslash_escaped = false;
          return {
            $: "BreakAtWith",
            _0: end_ix,
            _1: {
              start: i,
              end: end_ix,
              body: { $: "HardBreak", _0: true },
            },
          };
        }

        if (mode === "Scan" && pipes > 0) {
          // check if we may be parsing a table
          const next_line_ix = ix + eol_bytes;
          const line_start = LineStart.new(bytes.subarray(next_line_ix));
          if (scan_containers(this.tree, line_start, Options.has_gfm_footnotes(this.options)) === this.tree.spine_len()) {
            const table_head_ix = next_line_ix + line_start.bytes_scanned();
            const [table_head_bytes, alignment] = scan_table_head(bytes.subarray(table_head_ix));

            if (table_head_bytes > 0) {
              // computing header count from number of pipes
              const header_count = count_header_cols(bytes, pipes, start, last_pipe_ix);

              // make sure they match the number of columns we find in separator line
              if (alignment.length === header_count) {
                const alignment_ix = this.allocs.allocate_alignment(alignment);
                const end_ix = table_head_ix + table_head_bytes;
                return {
                  $: "BreakAtWith",
                  _0: end_ix,
                  _1: {
                    start: i,
                    end: end_ix, // must update later
                    body: { $: "Table", _0: alignment_ix },
                  },
                };
              }
            }
          }
        }

        const trailing_whitespace = scan_rev_while(bytes.subarray(0, ix), is_ascii_whitespace_no_nl);
        if (trailing_whitespace >= 2) {
          i -= trailing_whitespace;
          this.tree.append_text(begin_text, i, backslash_escaped);
          backslash_escaped = false;
          return {
            $: "BreakAtWith",
            _0: end_ix,
            _1: {
              start: i,
              end: end_ix,
              body: { $: "HardBreak", _0: false },
            },
          };
        }

        this.tree.append_text(begin_text, ix - trailing_whitespace, backslash_escaped);
        backslash_escaped = false;

        return {
          $: "BreakAtWith",
          _0: end_ix,
          _1: {
            start: i,
            end: end_ix,
            body: ItemBody.SoftBreak,
          },
        };
      } else if (byte === 0x5c /* \ */) {
        if (ix + 1 < bytes_len && is_ascii_punctuation(bytes[ix + 1]!)) {
          this.tree.append_text(begin_text, ix, backslash_escaped);
          if (bytes[ix + 1]! === 0x60 /* ` */) {
            const count = 1 + scan_ch_repeat(bytes.subarray(ix + 2), 0x60 /* ` */);
            this.tree.append({
              start: ix + 1,
              end: ix + count + 1,
              body: { $: "MaybeCode", _0: count, _1: true },
            });
            begin_text = ix + 1 + count;
            backslash_escaped = false;
            return { $: "ContinueAndSkip", _0: count };
          } else if (bytes[ix + 1]! === 0x7c /* | */ && "Active" === mode) {
            // Yeah, it's super weird that backslash escaped pipes in tables aren't "real"
            // backslash escapes.
            //
            // This tree structure is intended for the benefit of inline analysis, and it
            // is supposed to operate as-if backslash escaped pipes were stripped out in a
            // separate pass.
            begin_text = ix + 1;
            backslash_escaped = false;
            return { $: "ContinueAndSkip", _0: 1 };
          } else if (ix + 2 < bytes_len && bytes[ix + 1]! === 0x5c /* \ */ && bytes[ix + 2]! === 0x7c /* | */ && "Active" === mode) {
            // To parse `\\|`, discard the backslashes and parse the `|` that follows it.
            begin_text = ix + 2;
            backslash_escaped = true;
            return { $: "ContinueAndSkip", _0: 2 };
          } else {
            begin_text = ix + 1;
            backslash_escaped = true;
            return { $: "ContinueAndSkip", _0: 1 };
          }
        } else {
          return { $: "ContinueAndSkip", _0: 0 };
        }
      } else if (byte === 0x2a /* * */ || byte === 0x5f /* _ */ || byte === 0x7e /* ~ */) {
        const c = byte;
        const string_suffix = this.text.slice(ix);
        const count = 1 + scan_ch_repeat(as_bytes(string_suffix).subarray(1), c);
        const can_open = delim_run_can_open(this.text.slice(start), string_suffix, count, ix - start, mode);
        const can_close = delim_run_can_close(this.text.slice(start), string_suffix, count, ix - start, mode);
        const is_valid_seq = c !== 0x7e /* ~ */ || count <= 2;

        if ((can_open || can_close) && is_valid_seq) {
          this.tree.append_text(begin_text, ix, backslash_escaped);
          backslash_escaped = false;
          for (let i = 0; i < count; i++) {
            this.tree.append({
              start: ix + i,
              end: ix + i + 1,
              body: { $: "MaybeEmphasis", _0: count - i, _1: can_open, _2: can_close },
            });
          }
          begin_text = ix + count;
        }
        return { $: "ContinueAndSkip", _0: count - 1 };
      } else if (byte === 0x24 /* $ */) {
        const string_suffix = this.text.slice(ix);
        const first = string_suffix.len() > 1 ? string_suffix.byte(1) : undefined;
        const can_open = !(first === undefined ? true : is_ascii_whitespace(first));
        const last = ix > 0 ? this.text.byte(ix - 1) : undefined;
        const can_close = ix > start && !(last === undefined ? true : is_ascii_whitespace(last));

        // 0xFFFF_FFFF... represents the root brace context. Using None would require
        // storing Option<u8>, which is bigger than u8.
        //
        // These shouldn't conflict unless you have 255 levels of nesting, which is
        // past the intended limit anyway.
        //
        // Unbalanced braces will cause the root to be changed, which is why it gets
        // stored here.
        let brace_context: number;
        if (this.brace_context_stack.length > MATH_BRACE_CONTEXT_MAX_NESTING) {
          brace_context = this.brace_context_next & 0xff;
        } else {
          const top = this.brace_context_stack[this.brace_context_stack.length - 1];
          if (top !== undefined) {
            brace_context = top;
          } else {
            this.brace_context_stack.push(0xff /* !0u8 */);
            brace_context = 0xff;
          }
        }

        this.tree.append_text(begin_text, ix, backslash_escaped);
        this.tree.append({
          start: ix,
          end: ix + 1,
          body: { $: "MaybeMath", _0: can_open, _1: can_close, _2: brace_context },
        });
        begin_text = ix + 1;
        return { $: "ContinueAndSkip", _0: 0 };
      } else if (byte === 0x7b /* { */) {
        if (this.brace_context_stack.length === MATH_BRACE_CONTEXT_MAX_NESTING) {
          this.brace_context_stack.push(this.brace_context_next & 0xff);
          this.brace_context_next = MATH_BRACE_CONTEXT_MAX_NESTING;
        } else if (this.brace_context_stack.length > MATH_BRACE_CONTEXT_MAX_NESTING) {
          // When we reach the limit of nesting, switch from actually matching
          // braces to just counting them.
          this.brace_context_next += 1;
        } else if (this.brace_context_stack.length !== 0) {
          // Store nothing if no math environment has been reached yet.
          this.brace_context_stack.push(this.brace_context_next & 0xff);
          this.brace_context_next += 1;
        }
        return { $: "ContinueAndSkip", _0: 0 };
      } else if (byte === 0x7d /* } */) {
        if (this.brace_context_stack.length === 1) {
          // Unbalanced Braces
          //
          // The initial, root top-level brace context is -1, but this is changed whenever an unbalanced
          // close brace is encountered:
          //
          //     This is not a math environment: $}$
          //     ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^|^
          //     -1                               |-2
          //
          // To ensure this can't get parsed as math, each side of the unbalanced
          // brace is an irreversibly separate brace context. As long as the math
          // environment itself contains balanced braces, they should share a top level context.
          //
          //     Math environment contains 2+2: $}$2+2$
          //                                       ^^^ this is a math environment
          this.brace_context_stack[0] = (this.brace_context_stack[0]! - 1) & 0xff; // wrapping_sub(1)
        } else if (this.brace_context_stack.length > MATH_BRACE_CONTEXT_MAX_NESTING) {
          // When we exceed 25 levels of nesting, switch from accurately balancing braces
          // to just counting them. When we dip back below the limit, switch back.
          if (this.brace_context_next <= MATH_BRACE_CONTEXT_MAX_NESTING) {
            this.brace_context_stack.pop();
          } else {
            this.brace_context_next -= 1;
          }
        } else {
          this.brace_context_stack.pop();
        }
        return { $: "ContinueAndSkip", _0: 0 };
      } else if (byte === 0x60 /* ` */) {
        this.tree.append_text(begin_text, ix, backslash_escaped);
        backslash_escaped = false;
        const count = 1 + scan_ch_repeat(bytes.subarray(ix + 1), 0x60 /* ` */);
        this.tree.append({
          start: ix,
          end: ix + count,
          body: { $: "MaybeCode", _0: count, _1: false },
        });
        begin_text = ix + count;
        return { $: "ContinueAndSkip", _0: count - 1 };
      } else if (byte === 0x3c /* < */ && bytes[ix + 1] !== 0x5c /* \ */) {
        // Note: could detect some non-HTML cases and early escape here, but not
        // clear that's a win.
        this.tree.append_text(begin_text, ix, backslash_escaped);
        backslash_escaped = false;
        this.tree.append({
          start: ix,
          end: ix + 1,
          body: ItemBody.MaybeHtml,
        });
        begin_text = ix + 1;
        return { $: "ContinueAndSkip", _0: 0 };
      } else if (byte === 0x21 /* ! */) {
        if (ix + 1 < bytes_len && bytes[ix + 1]! === 0x5b /* [ */) {
          this.tree.append_text(begin_text, ix, backslash_escaped);
          backslash_escaped = false;
          this.tree.append({
            start: ix,
            end: ix + 2,
            body: ItemBody.MaybeImage,
          });
          begin_text = ix + 2;
          return { $: "ContinueAndSkip", _0: 1 };
        } else {
          return { $: "ContinueAndSkip", _0: 0 };
        }
      } else if (byte === 0x5b /* [ */) {
        this.tree.append_text(begin_text, ix, backslash_escaped);
        backslash_escaped = false;
        this.tree.append({
          start: ix,
          end: ix + 1,
          body: ItemBody.MaybeLinkOpen,
        });
        begin_text = ix + 1;
        return { $: "ContinueAndSkip", _0: 0 };
      } else if (byte === 0x5d /* ] */) {
        this.tree.append_text(begin_text, ix, backslash_escaped);
        backslash_escaped = false;
        this.tree.append({
          start: ix,
          end: ix + 1,
          body: { $: "MaybeLinkClose", _0: true },
        });
        begin_text = ix + 1;
        return { $: "ContinueAndSkip", _0: 0 };
      } else if (byte === 0x26 /* & */) {
        const [n, value] = scan_entity(bytes.subarray(ix));
        if (value !== undefined) {
          this.tree.append_text(begin_text, ix, backslash_escaped);
          backslash_escaped = false;
          this.tree.append({
            start: ix,
            end: ix + n,
            body: { $: "SynthesizeText", _0: this.allocs.allocate_cow(value) },
          });
          begin_text = ix + n;
          return { $: "ContinueAndSkip", _0: n - 1 };
        } else {
          return { $: "ContinueAndSkip", _0: 0 };
        }
      } else if (byte === 0x7c /* | */) {
        if (ix !== 0 && bytes[ix - 1]! === 0x5c /* \ */) {
          return { $: "ContinueAndSkip", _0: 0 };
        } else if (mode === "Active") {
          return { $: "BreakAtWith", _0: ix, _1: undefined };
        } else {
          last_pipe_ix = ix;
          pipes += 1;
          return { $: "ContinueAndSkip", _0: 0 };
        }
      } else if (byte === 0x2e /* . */) {
        if (ix + 2 < bytes.length && bytes[ix + 1]! === 0x2e /* . */ && bytes[ix + 2]! === 0x2e /* . */) {
          this.tree.append_text(begin_text, ix, backslash_escaped);
          backslash_escaped = false;
          this.tree.append({
            start: ix,
            end: ix + 3,
            body: { $: "SynthesizeChar", _0: 0x2026 /* … */ },
          });
          begin_text = ix + 3;
          return { $: "ContinueAndSkip", _0: 2 };
        } else {
          return { $: "ContinueAndSkip", _0: 0 };
        }
      } else if (byte === 0x2d /* - */) {
        const count = 1 + scan_ch_repeat(bytes.subarray(ix + 1), 0x2d /* - */);
        if (count === 1) {
          return { $: "ContinueAndSkip", _0: 0 };
        } else {
          let itembody: ItemBody;
          if (count === 2) {
            itembody = { $: "SynthesizeChar", _0: 0x2013 /* – */ };
          } else if (count === 3) {
            itembody = { $: "SynthesizeChar", _0: 0x2014 /* — */ };
          } else {
            let ems: number;
            let ens: number;
            switch (count % 6) {
              case 0:
              case 3:
                [ems, ens] = [Math.floor(count / 3), 0];
                break;
              case 2:
              case 4:
                [ems, ens] = [0, Math.floor(count / 2)];
                break;
              case 1:
                [ems, ens] = [Math.floor(count / 3) - 1, 2];
                break;
              default:
                [ems, ens] = [Math.floor(count / 3), 1];
                break;
            }
            // – and — are 3 bytes each in utf8
            let buf = "";
            for (let k = 0; k < ems; k++) {
              buf += "—";
            }
            for (let k = 0; k < ens; k++) {
              buf += "–";
            }
            itembody = { $: "SynthesizeText", _0: this.allocs.allocate_cow(buf) };
          }

          this.tree.append_text(begin_text, ix, backslash_escaped);
          backslash_escaped = false;
          this.tree.append({
            start: ix,
            end: ix + count,
            body: itembody,
          });
          begin_text = ix + count;
          return { $: "ContinueAndSkip", _0: count - 1 };
        }
      } else if (byte === 0x27 /* ' */ || byte === 0x22 /* " */) {
        const c = byte;
        const string_suffix = this.text.slice(ix);
        const can_open = delim_run_can_open(this.text.slice(start), string_suffix, 1, ix - start, mode);
        const can_close = delim_run_can_close(this.text.slice(start), string_suffix, 1, ix - start, mode);

        this.tree.append_text(begin_text, ix, backslash_escaped);
        backslash_escaped = false;
        this.tree.append({
          start: ix,
          end: ix + 1,
          body: { $: "MaybeSmartQuote", _0: c, _1: can_open, _2: can_close },
        });
        begin_text = ix + 1;

        return { $: "ContinueAndSkip", _0: 0 };
      } else {
        return { $: "ContinueAndSkip", _0: 0 };
      }
    });

    if (brk === undefined) {
      const trailing_whitespace = scan_rev_while(bytes.subarray(begin_text, final_ix), is_ascii_whitespace_no_nl);
      // need to close text at eof
      this.tree.append_text(begin_text, final_ix - trailing_whitespace, backslash_escaped);
    }
    return [final_ix, brk];
  }

  // crate: pulldown-cmark-0.11.3/src/firstpass.rs:1107 parse_html_block_type_1_to_5
  /// When start_ix is at the beginning of an HTML block of type 1 to 5,
  /// this will find the end of the block, adding the block itself to the
  /// tree and also keeping track of the lines of HTML within the block.
  ///
  /// The html_end_tag is the tag that must be found on a line to end the block.
  parse_html_block_type_1_to_5(start_ix: number, html_end_tag: string, remaining_space: number, indent: number): number {
    this.tree.append({
      start: start_ix,
      end: 0, // set later
      body: ItemBody.HtmlBlock,
    });
    this.tree.push();

    const bytes = as_bytes(this.text);
    let ix = start_ix;
    let end_ix: number;
    for (;;) {
      const line_start_ix = ix;
      ix += scan_nextline(bytes.subarray(ix));
      this.append_html_line(Math.max(remaining_space, indent), line_start_ix, ix);

      const line_start = LineStart.new(bytes.subarray(ix));
      const n_containers = scan_containers(this.tree, line_start, Options.has_gfm_footnotes(this.options));
      if (n_containers < this.tree.spine_len()) {
        end_ix = ix;
        break;
      }

      if (this.text.slice(line_start_ix, ix).find(html_end_tag) !== undefined) {
        end_ix = ix;
        break;
      }

      const next_line_ix = ix + line_start.bytes_scanned();
      if (next_line_ix === this.text.len()) {
        end_ix = next_line_ix;
        break;
      }
      ix = next_line_ix;
      remaining_space = line_start.remaining_space();
      indent = 0;
    }
    this.pop(end_ix);
    return ix;
  }

  // crate: pulldown-cmark-0.11.3/src/firstpass.rs:1161 parse_html_block_type_6_or_7
  /// When start_ix is at the beginning of an HTML block of type 6 or 7,
  /// this will consume lines until there is a blank line and keep track of
  /// the HTML within the block.
  parse_html_block_type_6_or_7(start_ix: number, remaining_space: number, indent: number): number {
    this.tree.append({
      start: start_ix,
      end: 0, // set later
      body: ItemBody.HtmlBlock,
    });
    this.tree.push();

    const bytes = as_bytes(this.text);
    let ix = start_ix;
    let end_ix: number;
    for (;;) {
      const line_start_ix = ix;
      ix += scan_nextline(bytes.subarray(ix));
      this.append_html_line(Math.max(remaining_space, indent), line_start_ix, ix);

      const line_start = LineStart.new(bytes.subarray(ix));
      const n_containers = scan_containers(this.tree, line_start, Options.has_gfm_footnotes(this.options));
      if (n_containers < this.tree.spine_len() || line_start.is_at_eol()) {
        end_ix = ix;
        break;
      }

      const next_line_ix = ix + line_start.bytes_scanned();
      if (next_line_ix === this.text.len() || scan_blank_line(bytes.subarray(next_line_ix)) !== undefined) {
        end_ix = next_line_ix;
        break;
      }
      ix = next_line_ix;
      remaining_space = line_start.remaining_space();
      indent = 0;
    }
    this.pop(end_ix);
    return ix;
  }

  // crate: pulldown-cmark-0.11.3/src/firstpass.rs:1207 parse_indented_code_block
  parse_indented_code_block(start_ix: number, remaining_space: number): number {
    this.tree.append({
      start: start_ix,
      end: 0, // will get set later
      body: ItemBody.IndentCodeBlock,
    });
    this.tree.push();
    const bytes = as_bytes(this.text);
    let last_nonblank_child: TreeIndex | undefined = undefined;
    let last_nonblank_ix = 0;
    let end_ix = 0;
    this.last_line_blank = false;

    let ix = start_ix;
    for (;;) {
      const line_start_ix = ix;
      ix += scan_nextline(bytes.subarray(ix));
      this.append_code_text(remaining_space, line_start_ix, ix);
      // TODO(spec clarification): should we synthesize newline at EOF?

      if (!this.last_line_blank) {
        last_nonblank_child = this.tree.cur();
        last_nonblank_ix = ix;
        end_ix = ix;
      }

      const line_start = LineStart.new(bytes.subarray(ix));
      const n_containers = scan_containers(this.tree, line_start, Options.has_gfm_footnotes(this.options));
      if (n_containers < this.tree.spine_len() || !(line_start.scan_space(4) || line_start.is_at_eol())) {
        break;
      }
      const next_line_ix = ix + line_start.bytes_scanned();
      if (next_line_ix === this.text.len()) {
        break;
      }
      ix = next_line_ix;
      remaining_space = line_start.remaining_space();
      this.last_line_blank = scan_blank_line(bytes.subarray(ix)) !== undefined;
    }

    // Trim trailing blank lines.
    if (last_nonblank_child !== undefined) {
      const child = last_nonblank_child;
      this.tree.at(child).next = undefined;
      this.tree.at(child).item.end = last_nonblank_ix;
    }
    this.pop(end_ix);
    return ix;
  }

  // crate: pulldown-cmark-0.11.3/src/firstpass.rs:1262 parse_fenced_code_block
  parse_fenced_code_block(start_ix: number, indent: number, fence_ch: number, n_fence_char: number): number {
    const bytes = as_bytes(this.text);
    let info_start = start_ix + n_fence_char;
    info_start += scan_whitespace_no_nl(bytes.subarray(info_start));
    // TODO: info strings are typically very short. wouldn't it be faster
    // to just do a forward scan here?
    let ix = info_start + scan_nextline(bytes.subarray(info_start));
    const info_end = ix - scan_rev_while(bytes.subarray(info_start, ix), is_ascii_whitespace);
    const info_string = unescape(this.text.slice(info_start, info_end).toString(), this.tree.is_in_table());
    this.tree.append({
      start: start_ix,
      end: 0, // will get set later
      body: { $: "FencedCodeBlock", _0: this.allocs.allocate_cow(info_string) },
    });
    this.tree.push();
    for (;;) {
      const line_start = LineStart.new(bytes.subarray(ix));
      const n_containers = scan_containers(this.tree, line_start, Options.has_gfm_footnotes(this.options));
      if (n_containers < this.tree.spine_len()) {
        // this line will get parsed again as not being part of the code
        // if it's blank, it should be parsed as a blank line
        this.pop(ix);
        return ix;
      }
      line_start.scan_space(indent);
      const close_line_start = line_start.clone();
      if (!close_line_start.scan_space(4 - indent)) {
        const close_ix = ix + close_line_start.bytes_scanned();
        const n = scan_closing_code_fence(bytes.subarray(close_ix), fence_ch, n_fence_char);
        if (n !== undefined) {
          ix = close_ix + n;
          this.pop(ix);
          // try to read trailing whitespace or it will register as a completely blank line
          return ix + (scan_blank_line(bytes.subarray(ix)) ?? 0);
        }
      }
      const remaining_space = line_start.remaining_space();
      ix += line_start.bytes_scanned();
      const next_ix = ix + scan_nextline(bytes.subarray(ix));
      this.append_code_text(remaining_space, ix, next_ix);
      ix = next_ix;
    }
  }

  // crate: pulldown-cmark-0.11.3/src/firstpass.rs:1316 parse_metadata_block
  parse_metadata_block(start_ix: number, metadata_block_ch: number): number {
    const bytes = as_bytes(this.text);
    let metadata_block_kind: MetadataBlockKind;
    if (metadata_block_ch === 0x2d /* - */) {
      metadata_block_kind = "YamlStyle";
    } else if (metadata_block_ch === 0x2b /* + */) {
      metadata_block_kind = "PlusesStyle";
    } else {
      return panic("Erroneous metadata block character when parsing metadata block");
    }
    // 3 delimiter characters
    let ix = start_ix + 3 + scan_nextline(bytes.subarray(start_ix + 3));
    this.tree.append({
      start: start_ix,
      end: 0, // will get set later
      body: { $: "MetadataBlock", _0: metadata_block_kind },
    });
    this.tree.push();
    for (;;) {
      const line_start = LineStart.new(bytes.subarray(ix));
      const n_containers = scan_containers(this.tree, line_start, Options.has_gfm_footnotes(this.options));
      if (n_containers < this.tree.spine_len()) {
        break;
      }
      if (calc_indent(bytes.subarray(ix), 4)[1] === 0) {
        const n = scan_closing_metadata_block(bytes.subarray(ix), metadata_block_ch);
        if (n !== undefined) {
          ix += n;
          break;
        }
      }
      const remaining_space = line_start.remaining_space();
      ix += line_start.bytes_scanned();
      const next_ix = ix + scan_nextline(bytes.subarray(ix));
      this.append_code_text(remaining_space, ix, next_ix);
      ix = next_ix;
    }

    this.pop(ix);

    // try to read trailing whitespace or it will register as a completely blank line
    return ix + (scan_blank_line(bytes.subarray(ix)) ?? 0);
  }

  // crate: pulldown-cmark-0.11.3/src/firstpass.rs:1360 append_code_text
  append_code_text(remaining_space: number, start: number, end: number): void {
    if (remaining_space > 0) {
      const cow_ix = this.allocs.allocate_cow(spaces_prefix(remaining_space));
      this.tree.append({
        start,
        end: start,
        body: { $: "SynthesizeText", _0: cow_ix },
      });
    }
    // PORT: `end - 2` underflow (a panic upstream) cannot happen here: `end` is past a line that
    // starts after at least one byte of indentation or fence.
    if (as_bytes(this.text)[end - 2] === 0x0d /* \r */) {
      // Normalize CRLF to LF
      this.tree.append_text(start, end - 2, false);
      this.tree.append_text(end - 1, end, false);
    } else {
      this.tree.append_text(start, end, false);
    }
  }

  // crate: pulldown-cmark-0.11.3/src/firstpass.rs:1379 append_html_line
  /// Appends a line of HTML to the tree.
  append_html_line(remaining_space: number, start: number, end: number): void {
    if (remaining_space > 0) {
      const cow_ix = this.allocs.allocate_cow(spaces_prefix(remaining_space));
      this.tree.append({
        start,
        end: start,
        body: { $: "SynthesizeText", _0: cow_ix },
      });
    }
    if (as_bytes(this.text)[end - 2] === 0x0d /* \r */) {
      // Normalize CRLF to LF
      this.tree.append({
        start,
        end: end - 2,
        body: ItemBody.Html,
      });
      this.tree.append({
        start: end - 1,
        end,
        body: ItemBody.Html,
      });
    } else {
      this.tree.append({
        start,
        end,
        body: ItemBody.Html,
      });
    }
  }

  // crate: pulldown-cmark-0.11.3/src/firstpass.rs:1410 pop
  /// Pop a container, setting its end.
  pop(ix: number): void {
    const cur_ix = unwrap(this.tree.pop());
    this.tree.at(cur_ix).item.end = ix;
    const body = this.tree.at(cur_ix).item.body;
    if (body.$ === "List" && body._0 === true) {
      surgerize_tight_list(this.tree, cur_ix);
      this.begin_list_item = undefined;
    }
  }

  // crate: pulldown-cmark-0.11.3/src/firstpass.rs:1421 finish_list
  /// Close a list if it's open. Also set loose if last line was blank
  /// and end current list if it's a lone, empty item
  finish_list(ix: number): void {
    this.finish_empty_list_item();
    const node_ix = this.tree.peek_up();
    if (node_ix !== undefined) {
      if (this.tree.at(node_ix).item.body.$ === "List") {
        this.pop(ix);
      }
    }
    if (this.last_line_blank) {
      const node_ix = this.tree.peek_grandparent();
      if (node_ix !== undefined) {
        const body = this.tree.at(node_ix).item.body;
        if (body.$ === "List") {
          // `*is_tight = false`
          this.tree.at(node_ix).item.body = { $: "List", _0: false, _1: body._1, _2: body._2 };
        }
      }
      this.last_line_blank = false;
    }
  }

  // crate: pulldown-cmark-0.11.3/src/firstpass.rs:1438 finish_empty_list_item
  finish_empty_list_item(): void {
    const begin_list_item = this.begin_list_item;
    if (begin_list_item !== undefined) {
      if (this.last_line_blank) {
        // A list item can begin with at most one blank line.
        const node_ix = this.tree.peek_up();
        if (node_ix !== undefined) {
          if (this.tree.at(node_ix).item.body.$ === "ListItem") {
            this.pop(begin_list_item);
          }
        }
      }
    }
    this.begin_list_item = undefined;
  }

  // crate: pulldown-cmark-0.11.3/src/firstpass.rs:1454 continue_list
  /// Continue an existing list or start a new one if there's not an open
  /// list that matches.
  continue_list(start: number, ch: number, index: number): void {
    this.finish_empty_list_item();
    const node_ix = this.tree.peek_up();
    if (node_ix !== undefined) {
      const body = this.tree.at(node_ix).item.body;
      if (body.$ === "List") {
        const existing_ch = body._1;
        if (existing_ch === ch) {
          if (this.last_line_blank) {
            // `*is_tight = false`
            this.tree.at(node_ix).item.body = { $: "List", _0: false, _1: body._1, _2: body._2 };
            this.last_line_blank = false;
          }
          return;
        }
      }
      // TODO: this is not the best choice for end; maybe get end from last list item.
      this.finish_list(start);
    }
    this.tree.append({
      start,
      end: 0, // will get set later
      body: { $: "List", _0: true, _1: ch, _2: index },
    });
    this.tree.push();
    this.last_line_blank = false;
  }

  // crate: pulldown-cmark-0.11.3/src/firstpass.rs:1481 parse_hrule
  /// Parse a thematic break.
  ///
  /// Returns index of start of next line.
  parse_hrule(hrule_size: number, ix: number): number {
    this.tree.append({
      start: ix,
      end: ix + hrule_size,
      body: ItemBody.Rule,
    });
    return ix + hrule_size;
  }

  // crate: pulldown-cmark-0.11.3/src/firstpass.rs:1493 parse_atx_heading
  /// Parse an ATX heading.
  ///
  /// Returns index of start of next line.
  parse_atx_heading(start: number, atx_level: HeadingLevel): number {
    let ix = start;
    const heading_ix = this.tree.append({
      start,
      end: 0, // set later
      body: ItemBody.Root, // set later (`ItemBody::default()`)
    });
    ix += HeadingLevel_discriminant[atx_level];
    // next char is space or eol (guaranteed by scan_atx_heading)
    const bytes = as_bytes(this.text);
    const eol_bytes = scan_eol(bytes.subarray(ix));
    if (eol_bytes !== undefined) {
      this.tree.at(heading_ix).item.end = ix + eol_bytes;
      this.tree.at(heading_ix).item.body = { $: "Heading", _0: atx_level, _1: undefined };
      return ix + eol_bytes;
    }
    // skip leading spaces
    const skip_spaces = scan_whitespace_no_nl(bytes.subarray(ix));
    ix += skip_spaces;

    // now handle the header text
    const header_start = ix;
    const header_node_idx = this.tree.push(); // so that we can set the endpoint later

    // trim the trailing attribute block before parsing the entire line, if necessary
    let end: number;
    let content_end: number;
    let attrs: HeadingAttributes | undefined;
    if (Options.contains(this.options, Options.ENABLE_HEADING_ATTRIBUTES)) {
      // the start of the next line is the end of the header since the
      // header cannot have line breaks
      const header_end = header_start + scan_nextline(bytes.subarray(header_start));
      const [content_end_, attrs_] = this.extract_and_parse_heading_attribute_block(header_start, header_end);
      this.parse_line(ix, content_end_, "Disabled");
      [end, content_end, attrs] = [header_end, content_end_, attrs_];
    } else {
      const [line_ix, line_brk] = this.parse_line(ix, undefined, "Disabled");
      ix = line_ix;
      // Backslash at end is actually hard line break
      if (line_brk !== undefined && line_brk.body.$ === "HardBreak" && line_brk.body._0 === true) {
        const { start, end } = line_brk;
        this.tree.append_text(start, end, false);
      }
      [end, content_end, attrs] = [ix, ix, undefined];
    }
    this.tree.at(header_node_idx).item.end = end;

    // remove trailing matter from header text
    let empty_text_node = false;
    const cur_ix = this.tree.cur();
    if (cur_ix !== undefined) {
      // remove closing of the ATX heading
      const header_text = bytes.subarray(header_start, content_end);
      let limit = 0;
      for (let k = header_text.length - 1; k >= 0; k--) {
        const b = header_text[k]!;
        if (!(b === 0x0a /* \n */ || b === 0x0d /* \r */ || b === 0x20 /*   */)) {
          limit = k + 1;
          break;
        }
      }
      let closer = 0;
      for (let k = limit - 1; k >= 0; k--) {
        if (header_text[k]! !== 0x23 /* # */) {
          closer = k + 1;
          break;
        }
      }
      if (closer === 0) {
        limit = closer;
      } else {
        const spaces = scan_rev_while(header_text.subarray(0, closer), (b) => b === 0x20 /*   */);
        if (spaces > 0) {
          limit = closer - spaces;
        }
      }
      // if text is only spaces, then remove them
      this.tree.at(cur_ix).item.end = limit + header_start;

      // limit = 0 when text is empty after removing spaces
      if (limit === 0) {
        empty_text_node = true;
      }
    }

    if (empty_text_node) {
      this.tree.remove_node();
    } else {
      this.tree.pop();
    }
    this.tree.at(heading_ix).item.body = {
      $: "Heading",
      _0: atx_level,
      _1: attrs !== undefined ? this.allocs.allocate_heading(attrs) : undefined,
    };

    return end;
  }

  // crate: pulldown-cmark-0.11.3/src/firstpass.rs:1586 parse_footnote
  /// Returns the number of bytes scanned on success.
  parse_footnote(start: number): number | undefined {
    const bytes = as_bytes(this.text).subarray(start);
    if (!bytes_starts_with(bytes, [0x5b /* [ */, 0x5e /* ^ */])) {
      return undefined;
    }
    let r: [number, CowStr] | undefined;
    if (Options.has_gfm_footnotes(this.options)) {
      // GitHub doesn't allow footnote definition labels to contain line breaks.
      // It actually does allow this for link definitions under certain circumstances,
      // but for this it's simpler to avoid it.
      r = scan_link_label_rest(this.text.slice(start + 2), (_) => undefined, this.tree.is_in_table());
    } else {
      r = this.parse_refdef_label(start + 2);
    }
    if (r === undefined) return undefined;
    let [i, label] = r;
    if (Options.has_gfm_footnotes(this.options) && (label.includes("\r") || label.includes("\n"))) {
      // GitHub doesn't allow footnote definition labels to contain line breaks,
      // even if they're escaped.
      return undefined;
    }
    i += 2;
    if (scan_ch(bytes.subarray(i), 0x3a /* : */) === 0) {
      return undefined;
    }
    i += 1;
    this.finish_list(start);
    const node_ix = this.tree.peek_up();
    if (node_ix !== undefined) {
      if (this.tree.at(node_ix).item.body.$ === "FootnoteDefinition") {
        // finish previous footnote if it's still open
        this.pop(start);
      }
    }
    if (Options.has_gfm_footnotes(this.options)) {
      i += scan_whitespace_no_nl(bytes.subarray(i));
    }
    this.allocs.footdefs.insert(UniCase.new(label), { use_count: 0 });
    this.tree.append({
      start,
      end: 0, // will get set later
      // TODO: check whether the label here is strictly necessary
      body: { $: "FootnoteDefinition", _0: this.allocs.allocate_cow(label) },
    });
    this.tree.push();
    return i;
  }

  // crate: pulldown-cmark-0.11.3/src/firstpass.rs:1635 parse_refdef_label
  /// Tries to parse a reference label, which can be interrupted by new blocks.
  /// On success, returns the number of bytes of the label and the label itself.
  parse_refdef_label(start: number): [number, CowStr] | undefined {
    return scan_link_label_rest(
      this.text.slice(start),
      (bytes) => {
        const line_start = LineStart.new(bytes);
        const current_container =
          scan_containers(this.tree, line_start, Options.has_gfm_footnotes(this.options)) === this.tree.spine_len();
        if (line_start.scan_space(4)) {
          return line_start.bytes_scanned();
        }
        const bytes_scanned = line_start.bytes_scanned();
        const suffix = bytes.subarray(bytes_scanned);
        if (this.scan_paragraph_interrupt(suffix, current_container) || (current_container && scan_setext_heading(suffix) !== undefined)) {
          return undefined;
        } else {
          return bytes_scanned;
        }
      },
      this.tree.is_in_table(),
    );
  }

  // crate: pulldown-cmark-0.11.3/src/firstpass.rs:1663 parse_refdef_total
  /// Returns number of bytes scanned, label and definition on success.
  parse_refdef_total(start: number): [number, LinkLabel, LinkDef] | undefined {
    const bytes = as_bytes(this.text).subarray(start);
    if (scan_ch(bytes, 0x5b /* [ */) === 0) {
      return undefined;
    }
    const r = this.parse_refdef_label(start + 1);
    if (r === undefined) return undefined;
    let [i, label] = r;
    i += 1;
    if (scan_ch(bytes.subarray(i), 0x3a /* : */) === 0) {
      return undefined;
    }
    i += 1;
    const d = this.scan_refdef(start, start + i);
    if (d === undefined) return undefined;
    const [bytecount, link_def] = d;
    return [bytecount + i, UniCase.new(label), link_def];
  }

  // crate: pulldown-cmark-0.11.3/src/firstpass.rs:1679 scan_refdef_space
  /// Returns number of bytes and number of newlines
  scan_refdef_space(bytes: Uint8Array, i: number): [number, number] | undefined {
    let newlines = 0;
    for (;;) {
      const whitespaces = scan_whitespace_no_nl(bytes.subarray(i));
      i += whitespaces;
      const eol_bytes = scan_eol(bytes.subarray(i));
      if (eol_bytes !== undefined) {
        i += eol_bytes;
        newlines += 1;
        if (newlines > 1) {
          return undefined;
        }
      } else {
        break;
      }
      const line_start = LineStart.new(bytes.subarray(i));
      const current_container =
        scan_containers(this.tree, line_start, Options.has_gfm_footnotes(this.options)) === this.tree.spine_len();
      if (!line_start.scan_space(4)) {
        const suffix = bytes.subarray(i + line_start.bytes_scanned());
        if (this.scan_paragraph_interrupt(suffix, current_container) || scan_setext_heading(suffix) !== undefined) {
          return undefined;
        }
      }
      i += line_start.bytes_scanned();
    }
    return [i, newlines];
  }

  // crate: pulldown-cmark-0.11.3/src/firstpass.rs:1713 scan_refdef_title
  // returns (bytelength, title_str)
  scan_refdef_title(text: Str): [number, CowStr] | undefined {
    const bytes = as_bytes(text);
    const first = bytes[0];
    if (first === undefined) return undefined;
    let closing_delim: number;
    if (first === 0x27 /* ' */) {
      closing_delim = 0x27 /* ' */;
    } else if (first === 0x22 /* " */) {
      closing_delim = 0x22 /* " */;
    } else if (first === 0x28 /* ( */) {
      closing_delim = 0x29 /* ) */;
    } else {
      return undefined;
    }
    let bytecount = 1;
    let linestart = 1;

    let linebuf: string | undefined = undefined;

    for (;;) {
      const c = bytes[bytecount];
      if (c === undefined) break;
      if (c === 0x28 /* ( */ && closing_delim === 0x29 /* ) */) {
        // https://spec.commonmark.org/0.30/#link-title
        // a sequence of zero or more characters between matching parentheses ((...)),
        // including a ( or ) character only if it is backslash-escaped.
        return undefined;
      } else if (c === 0x0a /* \n */ || c === 0x0d /* \r */) {
        // push text to line buffer
        // this is used to strip the block formatting:
        //
        // > [first]: http://example.com "
        // > second"
        //
        // should get turned into `<a href="example.com" title=" second">first</a>`
        if (linebuf === undefined) {
          linebuf = "";
        }
        linebuf += text.slice(linestart, bytecount).toString();
        linebuf += "\n"; // normalize line breaks
        // skip line break
        bytecount += 1;
        if (c === 0x0d /* \r */ && bytes[bytecount] === 0x0a /* \n */) {
          bytecount += 1;
        }
        const line_start = LineStart.new(bytes.subarray(bytecount));
        const current_container =
          scan_containers(this.tree, line_start, Options.has_gfm_footnotes(this.options)) === this.tree.spine_len();
        if (!line_start.scan_space(4)) {
          const suffix = bytes.subarray(bytecount + line_start.bytes_scanned());
          if (this.scan_paragraph_interrupt(suffix, current_container) || scan_setext_heading(suffix) !== undefined) {
            return undefined;
          }
        }
        line_start.scan_all_space();
        bytecount += line_start.bytes_scanned();
        linestart = bytecount;
        if (scan_blank_line(bytes.subarray(bytecount)) !== undefined) {
          // blank line - not allowed
          return undefined;
        }
      } else if (c === 0x5c /* \ */) {
        bytecount += 1;
        const c2 = bytes[bytecount];
        if (c2 !== undefined) {
          if (c2 !== 0x0d /* \r */ && c2 !== 0x0a /* \n */) {
            bytecount += 1;
          }
        }
      } else if (c === closing_delim) {
        let cow: CowStr;
        if (linebuf !== undefined) {
          linebuf += text.slice(linestart, bytecount).toString();
          cow = linebuf;
        } else {
          cow = text.slice(linestart, bytecount).toString();
        }
        return [bytecount + 1, cow];
      } else {
        bytecount += 1;
      }
    }
    return undefined;
  }

  // crate: pulldown-cmark-0.11.3/src/firstpass.rs:1804 scan_refdef
  /// Returns # of bytes and definition.
  /// Assumes the label of the reference including colon has already been scanned.
  scan_refdef(span_start: number, start: number): [number, LinkDef] | undefined {
    const bytes = as_bytes(this.text);

    // whitespace between label and url (including up to one newline)
    const sp = this.scan_refdef_space(bytes, start);
    if (sp === undefined) return undefined;
    let [i, _newlines] = sp;

    // scan link dest
    const ld = scan_link_dest(this.text, i, LINK_MAX_NESTED_PARENS);
    if (ld === undefined) return undefined;
    const [dest_length, dest0] = ld;
    if (dest_length === 0) {
      return undefined;
    }
    const dest = unescape(dest0.toString(), this.tree.is_in_table());
    i += dest_length;

    // no title
    const backup: [number, LinkDef] = [
      i - start,
      {
        dest,
        title: undefined,
        span: [span_start, i],
      },
    ];

    // scan whitespace between dest and label
    let i2: number;
    let newlines: number;
    const sp2 = this.scan_refdef_space(bytes, i);
    if (sp2 !== undefined) {
      const new_i = sp2[0];
      let newlines_ = sp2[1];
      if (i === this.text.len()) {
        newlines_ += 1;
      }
      if (new_i === i && newlines_ === 0) {
        return undefined;
      }
      if (newlines_ > 1) {
        return backup;
      }
      [i2, newlines] = [new_i, newlines_];
    } else {
      return backup;
    }

    // scan title
    // if this fails but newline == 1, return also a refdef without title
    const t = this.scan_refdef_title(this.text.slice(i2));
    if (t !== undefined) {
      const [title_length, title] = t;
      i2 += title_length;
      if (scan_blank_line(bytes.subarray(i2)) !== undefined) {
        backup[0] = i2 - start;
        backup[1].span = [span_start, i2];
        backup[1].title = unescape(title, this.tree.is_in_table());
        return backup;
      }
    }
    if (newlines > 0) {
      return backup;
    } else {
      return undefined;
    }
  }

  // crate: pulldown-cmark-0.11.3/src/firstpass.rs:1864 scan_paragraph_interrupt
  /// Checks whether we should break a paragraph on the given input.
  scan_paragraph_interrupt(bytes: Uint8Array, current_container: boolean): boolean {
    const has_footnote = Options.contains(this.options, Options.ENABLE_FOOTNOTES);
    if (scan_paragraph_interrupt_no_table(bytes, current_container, has_footnote, this.tree)) {
      return true;
    }
    // pulldown-cmark allows heavy tables, that have a `|` on the header row,
    // to interrupt paragraphs.
    //
    // ```markdown
    // This is a table
    // | a | b | c |
    // |---|---|---|
    // | d | e | f |
    //
    // This is not a table
    //  a | b | c
    // ---|---|---
    //  d | e | f
    // ```
    if (!Options.contains(this.options, Options.ENABLE_TABLES) || !bytes_starts_with(bytes, [0x7c /* | */])) {
      return false;
    }

    // Checking if something's a valid table or not requires looking at two lines.
    // First line, count unescaped pipes.
    let pipes = 0;
    let next_line_ix = 0;
    let bsesc = false;
    let last_pipe_ix = 0;
    for (let i = 0; i < bytes.length; i++) {
      const byte = bytes[i]!;
      if (byte === 0x5c /* \ */) {
        bsesc = true;
        continue;
      } else if (byte === 0x7c /* | */ && !bsesc) {
        pipes += 1;
        last_pipe_ix = i;
      } else if (byte === 0x0d /* \r */ || byte === 0x0a /* \n */) {
        next_line_ix = i + unwrap(scan_eol(bytes.subarray(i)));
        break;
      } else {
        // {}
      }
      bsesc = false;
    }

    // scan_eol can't return 0, so this can't be zero
    if (next_line_ix === 0) {
      return false;
    }

    // Scan the table head. The part that looks like:
    //
    //     |---|---|---|
    //
    // Also scan any containing items, since it's on its own line, and
    // might be nested inside a block quote or something
    //
    //     > Table: First
    //     > | first col | second col |
    //     > |-----------|------------|
    //     ^
    //     | need to skip over the `>` when checking for the table
    const line_start = LineStart.new(bytes.subarray(next_line_ix));
    if (scan_containers(this.tree, line_start, Options.has_gfm_footnotes(this.options)) !== this.tree.spine_len()) {
      return false;
    }
    const table_head_ix = next_line_ix + line_start.bytes_scanned();
    const [table_head_bytes, alignment] = scan_table_head(bytes.subarray(table_head_ix));

    if (table_head_bytes === 0) {
      return false;
    }

    // computing header count from number of pipes
    const header_count = count_header_cols(bytes, pipes, 0, last_pipe_ix);

    // make sure they match the number of columns we find in separator line
    return alignment.length === header_count;
  }

  // crate: pulldown-cmark-0.11.3/src/firstpass.rs:1958 extract_and_parse_heading_attribute_block
  /// Extracts and parses a heading attribute block if exists.
  ///
  /// Returns `(end_offset_of_heading_content, (id, classes))`.
  ///
  /// If `header_end` is less than or equal to `header_start`, the given
  /// input is considered as empty.
  extract_and_parse_heading_attribute_block(header_start: number, header_end: number): [number, HeadingAttributes | undefined] {
    if (!Options.contains(this.options, Options.ENABLE_HEADING_ATTRIBUTES)) {
      return [header_end, undefined];
    }

    // extract the trailing attribute block
    // PORT: `&bytes[header_start..header_end]` panics when `header_end < header_start`; `subarray`
    // would yield an empty view instead, so the panic is explicit.
    if (header_end < header_start) panic(`slice index starts at ${header_start} but ends at ${header_end}`);
    const header_bytes = as_bytes(this.text).subarray(header_start, header_end);
    const [content_len, attr_block_range_rel] = extract_attribute_block_content_from_header_text(header_bytes);
    const content_end = header_start + content_len;
    const attrs =
      attr_block_range_rel !== undefined
        ? parse_inside_attribute_block(this.text.slice(header_start + attr_block_range_rel[0], header_start + attr_block_range_rel[1]))
        : undefined;
    return [content_end, attrs];
  }
}

/// Scanning modes for `Parser`'s `parse_line` method.
type TableParseMode =
  /// Inside a paragraph, scanning for table headers.
  | "Scan"
  /// Inside a table.
  | "Active"
  /// Inside a paragraph, not scanning for table headers.
  | "Disabled";

// crate: pulldown-cmark-0.11.3/src/firstpass.rs:1994 count_header_cols
/// Computes the number of header columns in a table line by computing the number of dividing pipes
/// that aren't followed or preceded by whitespace.
function count_header_cols(bytes: Uint8Array, pipes: number, start: number, last_pipe_ix: number): number {
  // was first pipe preceded by whitespace? if so, subtract one
  start += scan_whitespace_no_nl(bytes.subarray(start));
  if (bytes[start]! === 0x7c /* | */) {
    pipes -= 1;
  }

  // was last pipe followed by whitespace? if so, sub one
  if (scan_blank_line(bytes.subarray(last_pipe_ix + 1)) !== undefined) {
    return pipes;
  } else {
    return pipes + 1;
  }
}

// crate: pulldown-cmark-0.11.3/src/firstpass.rs:2018 scan_paragraph_interrupt_no_table
/// Checks whether we should break a paragraph on the given input.
///
/// Use `FirstPass::scan_paragraph_interrupt` in any context that allows
/// tables to interrupt the paragraph.
function scan_paragraph_interrupt_no_table(bytes: Uint8Array, current_container: boolean, has_footnote: boolean, tree: Tree<Item>): boolean {
  const listitem_interrupts = (): boolean => {
    const li = scan_listitem(bytes);
    if (li === undefined) return false;
    const [ix, delim, index, _] = li;
    return (
      !current_container ||
      tree.is_in_table() ||
      // we don't allow interruption by either empty lists or
      // numbered lists starting at an index other than 1
      ((delim === 0x2a /* * */ || delim === 0x2d /* - */ || delim === 0x2b /* + */ || index === 1) &&
        scan_blank_line(bytes.subarray(ix)) === undefined)
    );
  };
  const footnote_interrupts = (): boolean => {
    // `std::str::from_utf8(&bytes[2..]).unwrap()`
    const rest = bytes.subarray(2);
    if (!is_valid_utf8(rest)) panic("called `Result::unwrap()` on an `Err` value");
    const r = scan_link_label_rest(Str.of_bytes(rest), (_) => undefined, tree.is_in_table());
    if (r === undefined) return false;
    const [len, _label] = r;
    return bytes[2 + len] === 0x3a /* : */;
  };
  return (
    scan_eol(bytes) !== undefined ||
    scan_hrule(bytes).$ === "Ok" ||
    scan_atx_heading(bytes) !== undefined ||
    scan_code_fence(bytes) !== undefined ||
    scan_blockquote_start(bytes) !== undefined ||
    listitem_interrupts() ||
    (bytes_starts_with(bytes, [0x3c /* < */]) &&
      (get_html_end_tag(bytes.subarray(1)) !== undefined || starts_html_block_type_6(bytes.subarray(1)))) ||
    (has_footnote && bytes_starts_with(bytes, [0x5b /* [ */, 0x5e /* ^ */]) && footnote_interrupts())
  );
}

/** `u8` slice `eq_ignore_ascii_case` */
function eq_ignore_ascii_case(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  const lower = (x: number): number => (x >= 0x41 && x <= 0x5a ? x + 0x20 : x);
  for (let k = 0; k < a.length; k++) if (lower(a[k]!) !== lower(b[k]!)) return false;
  return true;
}

const enc = new TextEncoder();
const BEGIN_TAGS: readonly Uint8Array[] = [enc.encode("pre"), enc.encode("style"), enc.encode("script"), enc.encode("textarea")];
const ST_BEGIN_TAGS: readonly Uint8Array[] = [enc.encode("!--"), enc.encode("?"), enc.encode("![CDATA[")];

// crate: pulldown-cmark-0.11.3/src/firstpass.rs:2050 get_html_end_tag
/// Assumes `text_bytes` is preceded by `<`.
function get_html_end_tag(text_bytes: Uint8Array): string | undefined {
  const end_tags = ["</pre>", "</style>", "</script>", "</textarea>"];
  for (let k = 0; k < BEGIN_TAGS.length; k++) {
    const beg_tag = BEGIN_TAGS[k]!;
    const end_tag = end_tags[k]!;
    const tag_len = beg_tag.length;

    if (text_bytes.length < tag_len) {
      // begin tags are increasing in size
      break;
    }

    if (!eq_ignore_ascii_case(text_bytes.subarray(0, tag_len), beg_tag)) {
      continue;
    }

    // Must either be the end of the line...
    if (text_bytes.length === tag_len) {
      return end_tag;
    }

    // ...or be followed by whitespace, newline, or '>'.
    const s = text_bytes[tag_len]!;
    if (is_ascii_whitespace(s) || s === 0x3e /* > */) {
      return end_tag;
    }
  }

  const st_end_tags = ["-->", "?>", "]]>"];
  for (let k = 0; k < ST_BEGIN_TAGS.length; k++) {
    const beg_tag = ST_BEGIN_TAGS[k]!;
    const end_tag = st_end_tags[k]!;
    if (bytes_starts_with(text_bytes, [...beg_tag])) {
      return end_tag;
    }
  }

  if (text_bytes.length > 1 && text_bytes[0]! === 0x21 /* ! */ && is_ascii_alphabetic(text_bytes[1]!)) {
    return ">";
  } else {
    return undefined;
  }
}

// crate: pulldown-cmark-0.11.3/src/firstpass.rs:2095 surgerize_tight_list
// https://english.stackexchange.com/a/285573
function surgerize_tight_list(tree: Tree<Item>, list_ix: TreeIndex): void {
  let list_item = tree.at(list_ix).child;
  while (list_item !== undefined) {
    const listitem_ix: TreeIndex = list_item;
    // first child is special, controls how we repoint list_item.child
    const list_item_firstborn = tree.at(listitem_ix).child;

    // Check that list item has children - this is not necessarily the case!
    if (list_item_firstborn !== undefined) {
      const firstborn_ix = list_item_firstborn;
      if (tree.at(firstborn_ix).item.body.$ === "Paragraph") {
        tree.at(listitem_ix).child = tree.at(firstborn_ix).child;
      }

      let list_item_child: TreeIndex | undefined = firstborn_ix;
      let node_to_repoint: TreeIndex | undefined = undefined;
      while (list_item_child !== undefined) {
        const child_ix: TreeIndex = list_item_child;
        // surgerize paragraphs
        let repoint_ix: TreeIndex;
        if (tree.at(child_ix).item.body.$ === "Paragraph") {
          const child_firstborn = tree.at(child_ix).child;
          if (child_firstborn !== undefined) {
            if (node_to_repoint !== undefined) {
              tree.at(node_to_repoint).next = child_firstborn;
            }
            let child_lastborn = child_firstborn;
            for (;;) {
              const lastborn_next_ix = tree.at(child_lastborn).next;
              if (lastborn_next_ix === undefined) break;
              child_lastborn = lastborn_next_ix;
            }
            repoint_ix = child_lastborn;
          } else {
            repoint_ix = child_ix;
          }
        } else {
          repoint_ix = child_ix;
        }

        node_to_repoint = repoint_ix;
        tree.at(repoint_ix).next = tree.at(child_ix).next;
        list_item_child = tree.at(child_ix).next;
      }
    }

    list_item = tree.at(listitem_ix).next;
  }
}

// crate: pulldown-cmark-0.11.3/src/firstpass.rs:2143 delim_run_can_open
/// Determines whether the delimiter run starting at given index is
/// left-flanking, as defined by the commonmark spec (and isn't intraword
/// for _ delims).
/// suffix is &s[ix..], which is passed in as an optimization, since taking
/// a string subslice is O(n).
function delim_run_can_open(s: Str, suffix: Str, run_len: number, ix: number, mode: TableParseMode): boolean {
  const next_char = str_chars_nth(suffix, run_len);
  if (next_char === undefined) {
    return false;
  }
  if (is_whitespace(next_char)) {
    return false;
  }
  if (ix === 0) {
    return true;
  }
  if (mode === "Active") {
    if (str_ends_with_ascii(s.slice(0, ix), "|") && !str_ends_with_ascii(s.slice(0, ix), "\\|")) {
      return true;
    }
    if (next_char === 0x7c /* | */) {
      return false;
    }
  }
  const delim = unwrap(str_chars_nth(suffix, 0));
  // `*` and `~~` can be intraword, `_` and `~` cannot
  if (delim === 0x2a /* * */ && !is_punctuation(next_char)) {
    return true;
  }
  if (delim === 0x7e /* ~ */ && run_len > 1) {
    return true;
  }
  const prev_char = unwrap(str_last_char(s.slice(0, ix)));
  if (delim === 0x7e /* ~ */ && prev_char === 0x7e /* ~ */ && !is_punctuation(next_char)) {
    return true;
  }

  return (
    is_whitespace(prev_char) ||
    (is_punctuation(prev_char) && (delim !== 0x27 /* ' */ || ![0x5d /* ] */, 0x29 /* ) */].includes(prev_char)))
  );
}

// crate: pulldown-cmark-0.11.3/src/firstpass.rs:2189 delim_run_can_close
/// Determines whether the delimiter run starting at given index is
/// right-flanking, as defined by the commonmark spec (and isn't intraword
/// for _ delims)
function delim_run_can_close(s: Str, suffix: Str, run_len: number, ix: number, mode: TableParseMode): boolean {
  if (ix === 0) {
    return false;
  }
  const prev_char = unwrap(str_last_char(s.slice(0, ix)));
  if (is_whitespace(prev_char)) {
    return false;
  }
  const next_char = str_chars_nth(suffix, run_len);
  if (next_char === undefined) {
    return true;
  }
  if (mode === "Active") {
    if (str_ends_with_ascii(s.slice(0, ix), "|") && !str_ends_with_ascii(s.slice(0, ix), "\\|")) {
      return false;
    }
    if (next_char === 0x7c /* | */) {
      return true;
    }
  }
  const delim = unwrap(str_chars_nth(suffix, 0));
  // `*` and `~~` can be intraword, `_` and `~` cannot
  if ((delim === 0x2a /* * */ || (delim === 0x7e /* ~ */ && run_len > 1)) && !is_punctuation(prev_char)) {
    return true;
  }
  if (delim === 0x7e /* ~ */ && prev_char === 0x7e /* ~ */) {
    return true;
  }

  return is_whitespace(next_char) || is_punctuation(next_char);
}

// crate: pulldown-cmark-0.11.3/src/firstpass.rs:2228 create_lut
function create_lut(options: Options): LookupTable {
  // (the `#[cfg(all(target_arch = "x86_64", feature = "simd"))]` arm is not ported, see the header)
  return special_bytes(options);
}

// crate: pulldown-cmark-0.11.3/src/firstpass.rs:2242 special_bytes
function special_bytes(options: Options): boolean[] {
  const bytes: boolean[] = new Array<boolean>(256).fill(false);
  const standard_bytes = [
    0x0a /* \n */, 0x0d /* \r */, 0x2a /* * */, 0x5f /* _ */, 0x26 /* & */, 0x5c /* \ */, 0x5b /* [ */, 0x5d /* ] */,
    0x3c /* < */, 0x21 /* ! */, 0x60 /* ` */,
  ];

  for (const byte of standard_bytes) {
    bytes[byte] = true;
  }
  if (Options.contains(options, Options.ENABLE_TABLES)) {
    bytes[0x7c /* | */] = true;
  }
  if (Options.contains(options, Options.ENABLE_STRIKETHROUGH)) {
    bytes[0x7e /* ~ */] = true;
  }
  if (Options.contains(options, Options.ENABLE_MATH)) {
    bytes[0x24 /* $ */] = true;
    bytes[0x7b /* { */] = true;
    bytes[0x7d /* } */] = true;
  }
  if (Options.contains(options, Options.ENABLE_SMART_PUNCTUATION)) {
    for (const byte of [0x2e /* . */, 0x2d /* - */, 0x22 /* " */, 0x27 /* ' */]) {
      bytes[byte] = true;
    }
  }

  return bytes;
}

type LoopInstruction<T> =
  /// Continue looking for more special bytes, but skip next few bytes.
  | { $: "ContinueAndSkip"; _0: number }
  /// Break looping immediately, returning with the given index and value.
  | { $: "BreakAtWith"; _0: number; _1: T };

// (`#[cfg(all(target_arch = "x86_64", feature = "simd"))] struct LookupTable` is not ported, see the header)
type LookupTable = readonly boolean[];

// crate: pulldown-cmark-0.11.3/src/firstpass.rs:2297 iterate_special_bytes
/// This function walks the byte slices from the given index and
/// calls the callback function on all bytes (and their indices) that are in the following set:
/// `` ` ``, `\`, `&`, `*`, `_`, `~`, `!`, `<`, `[`, `]`, `|`, `\r`, `\n`
/// It is guaranteed not call the callback on other bytes.
/// Whenever `callback(ix, byte)` returns a `ContinueAndSkip(n)` value, the callback
/// will not be called with an index that is less than `ix + n + 1`.
/// When the callback returns a `BreakAtWith(end_ix, opt+val)`, no more callbacks will be
/// called and the function returns immediately with the return value `(end_ix, opt_val)`.
/// If `BreakAtWith(..)` is never returned, this function will return the first
/// index that is outside the byteslice bound and a `None` value.
function iterate_special_bytes<T>(
  lut: LookupTable,
  bytes: Uint8Array,
  ix: number,
  callback: (ix: number, byte: number) => LoopInstruction<T | undefined>,
): [number, T | undefined] {
  // (the simd arm is not ported, see the header)
  return scalar_iterate_special_bytes(lut, bytes, ix, callback);
}

// crate: pulldown-cmark-0.11.3/src/firstpass.rs:2316 scalar_iterate_special_bytes
function scalar_iterate_special_bytes<T>(
  lut: readonly boolean[],
  bytes: Uint8Array,
  ix: number,
  callback: (ix: number, byte: number) => LoopInstruction<T | undefined>,
): [number, T | undefined] {
  while (ix < bytes.length) {
    const b = bytes[ix]!;
    if (lut[b]!) {
      const r = callback(ix, b);
      switch (r.$) {
        case "ContinueAndSkip": {
          const skip = r._0;
          ix += skip;
          break;
        }
        case "BreakAtWith": {
          return [r._0, r._1];
        }
      }
    }
    ix += 1;
  }

  return [ix, undefined];
}

// crate: pulldown-cmark-0.11.3/src/firstpass.rs:2355 extract_attribute_block_content_from_header_text
/// Split the usual heading content range and the content inside the trailing attribute block.
///
/// Returns `(leading_content_len, Option<trailing_attr_block_range>)`.
///
/// Note that `trailing_attr_block_range` will be empty range when the block
/// is `{}`, since the range is content inside the wrapping `{` and `}`.
///
/// The closing `}` of an attribute block can have trailing whitespaces.
/// They are automatically trimmed when the attribute block is being searched.
///
/// However, this method does not trim the trailing whitespaces of heading content.
/// It is callers' responsibility to trim them if necessary.
function extract_attribute_block_content_from_header_text(heading: Uint8Array): [number, [number, number] | undefined] {
  const heading_len = heading.length;
  let ix = heading_len;
  ix -= scan_rev_while(heading, (b) => b === 0x0a /* \n */ || b === 0x0d /* \r */ || b === 0x20 /*   */ || b === 0x09 /* \t */);
  if (ix === 0) {
    return [heading_len, undefined];
  }

  const attr_block_close = ix - 1;
  if (heading[attr_block_close] !== 0x7d /* } */) {
    // The last character is not `}`. No attribute blocks found.
    return [heading_len, undefined];
  }
  // move cursor before the closing right brace (`}`)
  ix -= 1;

  ix -= scan_rev_while(heading.subarray(0, ix), (b) => {
    // Characters to be excluded:
    //  * `{` and `}`: special characters to open and close an attribute block.
    //  * `\\`: a special character to escape many characters and disable some syntaxes.
    //      + Handling of this escape character differs among markdown processors.
    //      + Escaped characters will be separate text node from neighbors, so
    //        it is not easy to handle unescaped string and trim the trailing block.
    //  * `<` and `>`: special characters to start and end HTML tag.
    //      + No known processors converts `{#<i>foo</i>}` into
    //        `id="&lt;i&gt;foo&lt;/&gt;"` as of this writing, so hopefully
    //        this restriction won't cause compatibility issues.
    //  * `\n` and `\r`: a newline character.
    //      + Setext heading can have multiple lines. However it is hard to support
    //        attribute blocks that have newline inside, since the parsing proceeds line by
    //        line and lines will be separate nodes even they are logically a single text.
    return !(
      b === 0x7b /* { */ ||
      b === 0x7d /* } */ ||
      b === 0x3c /* < */ ||
      b === 0x3e /* > */ ||
      b === 0x5c /* \ */ ||
      b === 0x0a /* \n */ ||
      b === 0x0d /* \r */
    );
  });
  if (ix === 0) {
    // `{` is not found. No attribute blocks available.
    return [heading_len, undefined];
  }
  const attr_block_open = ix - 1;
  if (heading[attr_block_open]! !== 0x7b /* { */) {
    // `{` is not found. No attribute blocks available.
    return [heading_len, undefined];
  }

  return [attr_block_open, [ix, attr_block_close]];
}

/** `u8::is_ascii_whitespace` (used by `str::split_ascii_whitespace`): `\t`, `\n`, `\x0C`, `\r`, ` `. */
function u8_is_ascii_whitespace(b: number): boolean {
  return b === 0x09 || b === 0x0a || b === 0x0c || b === 0x0d || b === 0x20;
}

// crate: pulldown-cmark-0.11.3/src/firstpass.rs:2424 parse_inside_attribute_block
/// Parses an attribute block content, such as `.class1 #id .class2`.
///
/// Returns `(id, classes)`.
///
/// It is callers' responsibility to find opening and closing characters of the attribute
/// block. Usually [`extract_attribute_block_content_from_header_text`] function does it for you.
///
/// Note that this parsing requires explicit whitespace separators between
/// attributes. This is intentional design with the reasons below:
///
/// * to keep conversion simple and easy to understand for any possible input,
/// * to avoid adding less obvious conversion rule that can reduce compatibility
///   with other implementations more, and
/// * to follow the major design of implementations with the support for the
///   attribute blocks extension (as of this writing).
///
/// See also: [`Options::ENABLE_HEADING_ATTRIBUTES`].
///
/// [`Options::ENABLE_HEADING_ATTRIBUTES`]: `crate::Options::ENABLE_HEADING_ATTRIBUTES`
function parse_inside_attribute_block(inside_attr_block: Str): HeadingAttributes | undefined {
  let id: CowStr | undefined = undefined;
  const classes: CowStr[] = [];
  const attrs: [CowStr, CowStr | undefined][] = [];

  // `inside_attr_block.split_ascii_whitespace()`
  const words: Str[] = [];
  {
    const n = inside_attr_block.len();
    let k = 0;
    while (k < n) {
      while (k < n && u8_is_ascii_whitespace(inside_attr_block.byte(k))) k++;
      const w0 = k;
      while (k < n && !u8_is_ascii_whitespace(inside_attr_block.byte(k))) k++;
      if (k > w0) words.push(inside_attr_block.slice(w0, k));
    }
  }
  for (const attr of words) {
    // iterator returned by `str::split_ascii_whitespace` never emits empty
    // strings, so taking first byte won't panic.
    if (attr.len() > 1) {
      const first_byte = attr.byte(0);
      if (first_byte === 0x23 /* # */) {
        id = attr.slice(1).toString();
      } else if (first_byte === 0x2e /* . */) {
        classes.push(attr.slice(1).toString());
      } else {
        const attr_s = attr.toString();
        // `attr.split_once('=')`
        const eq = attr_s.indexOf("=");
        if (eq !== -1) {
          const key = attr_s.slice(0, eq);
          const value = attr_s.slice(eq + 1);
          attrs.push([key, value]);
        } else {
          attrs.push([attr_s, undefined]);
        }
      }
    }
  }

  return { id, classes, attrs };
}

