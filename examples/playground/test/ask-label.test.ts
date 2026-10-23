/*
 * The header's Ask button is named by what it shows (WCAG 2.5.3, label in name): voice control
 * users say "click Ask". An aria-label of "Ask the docs" on a button that shows "Ask ⌘K" was a
 * name the visible text was not part of, which axe's label-content-name-mismatch flags.
 *
 *   pnpm --filter playground test
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

const ask = readFileSync(join(import.meta.dirname, '../components/ask.tsx'), 'utf8');
const button = /<button[^>]*data-ask-trigger[\s\S]*?<\/button>/.exec(ask)?.[0] ?? '';

describe('the Ask button', () => {
  it('takes its name from its words, the visible one first, not from an aria-label', () => {
    assert.ok(button, 'no Ask button in components/ask.tsx');
    assert.doesNotMatch(button, /aria-label=/);
    const words = [...button.matchAll(/>([^<>{}]+)</g)].map(([, text]) => text!.trim()).filter(Boolean);
    assert.deepEqual(words, ['Ask', 'the docs']);
    // "Ask" shows from md up and is read on phones; "the docs" is for screen readers only.
    assert.match(button, /<span className="max-md:sr-only">Ask<\/span>/);
    assert.match(button, /<span className="sr-only"> the docs<\/span>/);
  });

  it('leaves its key cap out of the name, and gives the shortcut as aria-keyshortcuts', () => {
    assert.match(button, /<kbd\s+aria-hidden="true"/);
    assert.match(button, /aria-keyshortcuts=\{apple \? 'Meta\+K' : 'Control\+K'\}/);
  });
});
