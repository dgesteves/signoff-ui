'use client';

import { useLabels } from '../labels';
import { untrustedLabels } from './labels';
import { MARK_CLASS, revealText } from './untrusted';

/** The labels' sections this module reads. */
const LABELS = { untrusted: untrustedLabels };

/**
 * Text from the agent, with marks in place of what does not show, so a command, a path or a line
 * reads as what it is: see `revealText`. `blanks` marks long runs of spaces too, for a command or a
 * path; not for code, which lines up with spaces.
 */
export function Revealed({ text, blanks = false }: { text: string; blanks?: boolean }) {
  const L = useLabels(LABELS).untrusted;
  return (
    <>
      {revealText(text, { blanks }).map((part, i) => {
        if (typeof part === 'string') return part;
        const name = part.kind === 'blank' ? L.blank(part.count) : L.invisible(part.count, part.codes);
        return (
          <span key={i} data-slot="signoff-untrusted" data-kind={part.kind} title={name} className={MARK_CLASS}>
            <span aria-hidden="true">{part.shown}</span>
            <span className="sr-only">{name}</span>
          </span>
        );
      })}
    </>
  );
}
