// Incremental NDJSON concept parsing.
//
// The proof waited 121 s for one 25 KB JSON array before it could start the
// first image. Here each concept is a self-contained line, so the moment a
// line closes it is validated on its own and artwork starts — the fourth
// concept's tokens no longer block the first concept's image.
//
// Robust to the things models actually do: markdown fences, a stray array
// wrapper, trailing commas between objects, and blank lines.

import { parseAiFirstConcept, type AiFirstConcept } from "@shared/aiFirstInvite";

export interface ParsedConceptLine {
  index: number;
  concept: AiFirstConcept;
  /** Recoverable drift the validator repaired. Empty on a clean line. */
  normalized: string[];
}

export interface RejectedConceptLine {
  index: number;
  raw: string;
  errors: string[];
}

/**
 * Feed it decoded text as it arrives; it emits whole concepts as soon as they
 * are complete and valid. Stateful — one instance per generation run.
 */
export class ConceptStreamParser {
  private buffer = "";
  private emitted = 0;
  private rejected: RejectedConceptLine[] = [];

  /** Concepts that parsed but failed validation, for the report. */
  get rejections(): RejectedConceptLine[] {
    return this.rejected;
  }

  get count(): number {
    return this.emitted;
  }

  /**
   * Appends a chunk and returns every concept that became complete because of
   * it. Usually zero or one.
   */
  push(chunk: string): ParsedConceptLine[] {
    this.buffer += chunk;
    return this.drain(false);
  }

  /** Call once the model has finished; drains any unterminated final object. */
  flush(): ParsedConceptLine[] {
    return this.drain(true);
  }

  private drain(final: boolean): ParsedConceptLine[] {
    const out: ParsedConceptLine[] = [];

    for (;;) {
      const span = this.nextObjectSpan();
      if (!span) break;
      const raw = this.buffer.slice(span.start, span.end);
      this.buffer = this.buffer.slice(span.end);
      const parsed = this.validate(raw);
      if (parsed) out.push(parsed);
    }

    if (final) {
      const remainder = stripNoise(this.buffer).trim();
      this.buffer = "";
      if (remainder.startsWith("{")) {
        const parsed = this.validate(remainder);
        if (parsed) out.push(parsed);
      }
    }

    return out;
  }

  private validate(raw: string): ParsedConceptLine | null {
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      this.rejected.push({ index: this.emitted, raw: raw.slice(0, 400), errors: ["line is not valid JSON"] });
      return null;
    }
    const result = parseAiFirstConcept(value);
    if (!result.ok) {
      this.rejected.push({ index: this.emitted, raw: raw.slice(0, 400), errors: result.errors });
      return null;
    }
    const line = { index: this.emitted, concept: result.concept, normalized: result.normalized };
    this.emitted += 1;
    return line;
  }

  /**
   * Finds the next balanced top-level `{...}` in the buffer, ignoring braces
   * inside strings. Returns null while the object is still arriving.
   */
  private nextObjectSpan(): { start: number; end: number } | null {
    const start = this.buffer.indexOf("{");
    if (start === -1) return null;

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = start; i < this.buffer.length; i += 1) {
      const ch = this.buffer[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        if (inString) escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;
      if (ch === "{") depth += 1;
      else if (ch === "}") {
        depth -= 1;
        if (depth === 0) return { start, end: i + 1 };
      }
    }
    return null;
  }
}

/** Removes markdown fences and array punctuation a model may wrap lines in. */
function stripNoise(text: string): string {
  return text
    .replace(/```(?:json|ndjson)?/gi, "")
    .replace(/^[\s,\[\]]+/, "")
    .replace(/[\s,\[\]]+$/, "");
}
