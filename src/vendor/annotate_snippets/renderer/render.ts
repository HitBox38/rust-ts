// PLACEHOLDER for annotate-snippets =0.12.16 `src/renderer/render.rs` (lane annotate-b ports it
// and replaces this file). It declares the types and functions the other renderer files use,
// with the TS shapes fixed by the contract in docs/handoff/annotate-a.md; every function body is
// `unported(...)`.

import type { Style } from "../../anstyle/style.ts";
import type { Debug } from "../../../std/fmt.ts";
import { unported } from "../../../std/panic.ts";
import type { Level, LevelInner } from "../level.ts";
import type { AnnotationKind, Report } from "../snippet.ts";
import type { Renderer } from "./mod.ts";
import type { Loc } from "./source_map.ts";
import type { Stylesheet } from "./stylesheet.ts";

export function render(_renderer: Renderer, _groups: Report): string {
  return unported("annotate_snippets::renderer::render::render");
}

export function char_width(_ch: number): number {
  return unported("annotate_snippets::renderer::render::char_width");
}

export function num_overlap(_a_start: number, _a_end: number, _b_start: number, _b_end: number, _inclusive: boolean): boolean {
  return unported("annotate_snippets::renderer::render::num_overlap");
}

export function normalize_whitespace(_s: string): string {
  return unported("annotate_snippets::renderer::render::normalize_whitespace");
}

export type LineAnnotationType =
  /// Annotation under a single line of code
  | { readonly $: "Singleline" }
  /// Annotation marking the first character of a fully shown multiline span
  | { readonly $: "MultilineStart"; readonly _0: number }
  /// Annotation marking the last character of a fully shown multiline span
  | { readonly $: "MultilineEnd"; readonly _0: number }
  /// Line at the left enclosing the lines of a fully shown multiline span
  | { readonly $: "MultilineLine"; readonly _0: number };

export const LineAnnotationType = {
  Singleline: Object.freeze({ $: "Singleline" }) as LineAnnotationType,
} as const;

export const debug_LineAnnotationType: Debug<LineAnnotationType> = () => unported("annotate_snippets::renderer::render::LineAnnotationType: Debug");

export class LineAnnotation {
  constructor(
    /// Start column.
    public start: Loc,
    /// End column within the line (exclusive)
    public end: Loc,
    /// level
    public kind: AnnotationKind,
    /// Optional label to display adjacent to the annotation.
    public label: string | undefined,
    /// Is this a single line, multiline or multiline span minimized down to a
    /// smaller span.
    public annotation_type: LineAnnotationType,
    /// Whether the source code should be highlighted
    public highlight_source: boolean,
  ) {}

  is_primary(): boolean {
    return unported("annotate_snippets::renderer::render::LineAnnotation::is_primary");
  }

  is_line(): boolean {
    return unported("annotate_snippets::renderer::render::LineAnnotation::is_line");
  }

  len(): number {
    return unported("annotate_snippets::renderer::render::LineAnnotation::len");
  }

  has_label(): boolean {
    return unported("annotate_snippets::renderer::render::LineAnnotation::has_label");
  }

  takes_space(): boolean {
    return unported("annotate_snippets::renderer::render::LineAnnotation::takes_space");
  }
}

export const debug_LineAnnotation: Debug<LineAnnotation> = () => unported("annotate_snippets::renderer::render::LineAnnotation: Debug");

export type ElementStyle =
  | { readonly $: "MainHeaderMsg" }
  | { readonly $: "HeaderMsg" }
  | { readonly $: "LineAndColumn" }
  | { readonly $: "LineNumber" }
  | { readonly $: "Quotation" }
  | { readonly $: "UnderlinePrimary" }
  | { readonly $: "UnderlineSecondary" }
  | { readonly $: "LabelPrimary" }
  | { readonly $: "LabelSecondary" }
  | { readonly $: "NoStyle" }
  | { readonly $: "Level"; readonly _0: LevelInner }
  | { readonly $: "Addition" }
  | { readonly $: "Removal" };

const unit = <T extends ElementStyle["$"]>($: T) => Object.freeze({ $ }) as Extract<ElementStyle, { $: T }>;

export const ElementStyle = {
  MainHeaderMsg: unit("MainHeaderMsg"),
  HeaderMsg: unit("HeaderMsg"),
  LineAndColumn: unit("LineAndColumn"),
  LineNumber: unit("LineNumber"),
  Quotation: unit("Quotation"),
  UnderlinePrimary: unit("UnderlinePrimary"),
  UnderlineSecondary: unit("UnderlineSecondary"),
  LabelPrimary: unit("LabelPrimary"),
  LabelSecondary: unit("LabelSecondary"),
  NoStyle: unit("NoStyle"),
  Addition: unit("Addition"),
  Removal: unit("Removal"),

  color_spec(_self: ElementStyle, _level: Level, _stylesheet: Stylesheet): Style {
    return unported("annotate_snippets::renderer::render::ElementStyle::color_spec");
  },
} as const;

export const debug_ElementStyle: Debug<ElementStyle> = () => unported("annotate_snippets::renderer::render::ElementStyle: Debug");

export interface UnderlineParts {
  readonly style: ElementStyle;
  readonly underline: number;
  readonly label_start: number;
  readonly vertical_text_line: number;
  readonly multiline_vertical: number;
  readonly multiline_horizontal: number;
  readonly multiline_whole_line: number;
  readonly multiline_start_down: number;
  readonly bottom_right: number;
  readonly top_left: number;
  readonly top_right_flat: number;
  readonly bottom_left: number;
  readonly multiline_end_up: number;
  readonly multiline_end_same_line: number;
  readonly multiline_bottom_right_with_text: number;
}

export const debug_UnderlineParts: Debug<UnderlineParts> = () => unported("annotate_snippets::renderer::render::UnderlineParts: Debug");
