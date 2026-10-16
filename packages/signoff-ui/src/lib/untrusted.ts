/**
 * Text and URLs from the agent, shown to the person who decides on them. A prompt injection can
 * write them too, so the components show what would make them read as something other than what
 * runs or opens: characters that do not show, a run of spaces long enough to push the rest of a
 * command out of view, and a link whose text names another host. No React here, so servers can
 * call these too.
 */

/**
 * Characters that do not show: format characters (Default_Ignorable_Code_Point: bidi controls,
 * zero-width spaces and joiners, Unicode tags, variation selectors, fillers), the interlinear
 * annotation characters, control characters, and the line and paragraph separators. Tab, newline
 * and a carriage return that ends a line show as what they are, and are left out in `invisible` below.
 */
const INVISIBLE = /[\p{Default_Ignorable_Code_Point}\p{Cc}\p{Zl}\p{Zp}\uFFF9-\uFFFB]/u;
/** The quick test: text with none of these has nothing to show. */
const ANY_INVISIBLE = /(?![\t\n\r])[\p{Cc}\p{Default_Ignorable_Code_Point}\p{Zl}\p{Zp}\uFFF9-\uFFFB]|\r(?!\n|$)/u;
/** Spaces other than U+0020, and the blank braille pattern: they look like a space and are not one. */
const OTHER_SPACE = /[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000\u2800]/u;
const ANY_BLANK = /[ \t]{2}|[\u00A0\u1680\u2000-\u200A\u202F\u205F\u3000\u2800]/u;
const PICTOGRAPH = /\p{Extended_Pictographic}/u;
const IN_EMOJI = /[\p{Extended_Pictographic}\p{Emoji_Modifier}\uFE0F]/u;
/** A run of spaces and tabs this wide, a tab counting 8, shows as a mark: about a third of a narrow card. */
const BLANK_RUN = 16;

export interface RevealTextOptions {
  /**
   * Also mark spaces: a run of spaces and tabs 16 columns wide or more, as its count, and spaces
   * other than U+0020, as their code points. For a command or a path; not for code, which lines up
   * with spaces.
   */
  blanks?: boolean | undefined;
}

/** A run of characters to show as a mark, in place of the characters. */
export interface RevealedMark {
  /** `invisible`: characters that do not show. `blank`: a long run of spaces and tabs. */
  kind: 'invisible' | 'blank';
  /** The characters. */
  text: string;
  /** How many there are. */
  count: number;
  /** Their code points, each once, in order (`U+202E`); empty for a blank run. */
  codes: string[];
  /** What the mark shows: `U+202E`, `U+200B ×240`, `␣ ×240`. */
  shown: string;
}

/** A part of the text: as it is, or a mark. */
export type RevealedPart = string | RevealedMark;

const codeOf = (char: string) => `U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;

/** True when `revealText` would mark something in the text. */
export function hasHidden(text: string, options: RevealTextOptions = {}): boolean {
  return ANY_INVISIBLE.test(text) || (!!options.blanks && ANY_BLANK.test(text));
}

/**
 * The text in parts, with marks in place of what would make it read as something it is not:
 * characters that do not show, such as a bidi override (`U+202E`), which shows the text after it
 * reversed, or a zero-width space, and with `blanks`, long runs of spaces. Text with none of them
 * is one part, the text itself. The joiners and variation selectors in an emoji are left as they are.
 */
export function revealText(text: string, options: RevealTextOptions = {}): RevealedPart[] {
  if (!hasHidden(text, options)) return [text];
  const chars = Array.from(text);
  const parts: RevealedPart[] = [];
  let plain = '';
  let mark: RevealedMark | undefined;
  /** The spaces and tabs since the last other character, while they may still make a long run. */
  let run = '';
  let width = 0;
  const flushRun = () => {
    if (width >= BLANK_RUN) {
      if (plain) parts.push(plain);
      plain = '';
      const count = run.length;
      parts.push({ kind: 'blank', text: run, count, codes: [], shown: `␣ ×${count}` });
    } else plain += run;
    run = '';
    width = 0;
  };
  const invisible = (char: string, i: number) => {
    if (char === '\t' || char === '\n') return false;
    if (char === '\r') return i < chars.length - 1 && chars[i + 1] !== '\n';
    // The joiner between two emoji that make one (woman, joiner, laptop), and a variation selector
    // after a character that shows, such as the one that makes a heart an emoji. Compared by code
    // point: a bundler may print the escape in a string as the character itself, which does not show.
    const code = char.codePointAt(0);
    if (code === 0x200d) return !(IN_EMOJI.test(chars[i - 1] ?? '') && PICTOGRAPH.test(chars[i + 1] ?? ''));
    if (code === 0xfe0e || code === 0xfe0f) return i === 0 || INVISIBLE.test(chars[i - 1]!);
    return INVISIBLE.test(char) || (!!options.blanks && OTHER_SPACE.test(char));
  };
  chars.forEach((char, i) => {
    if (invisible(char, i)) {
      if (run) flushRun();
      if (!mark) {
        if (plain) parts.push(plain);
        plain = '';
        mark = { kind: 'invisible', text: '', count: 0, codes: [], shown: '' };
        parts.push(mark);
      }
      mark.text += char;
      mark.count++;
      const code = codeOf(char);
      if (!mark.codes.includes(code)) mark.codes.push(code);
      return;
    }
    mark = undefined;
    if (options.blanks && (char === ' ' || char === '\t')) {
      run += char;
      width += char === '\t' ? 8 : 1;
      return;
    }
    if (run) flushRun();
    plain += char;
  });
  if (run) flushRun();
  if (plain) parts.push(plain);
  for (const part of parts) {
    if (typeof part === 'string' || part.kind === 'blank') continue;
    const { codes, count } = part;
    part.shown =
      codes.length <= 2 && count === codes.length
        ? codes.join(' ')
        : `${codes[0]}${codes.length > 1 ? ' …' : ''} ×${count}`;
  }
  return parts;
}

/** The classes of a mark: a small badge in the warning color, on one line with the text. */
export const MARK_CLASS =
  'bg-signoff-warn/12 font-signoff-mono text-signoff-warn-fg ring-signoff-warn/40 mx-px inline-block rounded-[3px] px-0.5 text-[0.85em] leading-none whitespace-pre ring-1 ring-inset';

export interface SafeUrlOptions {
  /** Also allow `data:` and `blob:` URLs, which an attached file or an image can have. */
  files?: boolean | undefined;
}

/**
 * The URL when a link may use it: http, https, mailto, a relative URL, and with `files`, `data:`
 * and `blob:`. Anything else, `javascript:` first, is `undefined`, to render as text instead: React
 * 18 renders a `javascript:` link as it is, and React 19 only replaces it with one that throws.
 */
export function safeUrl(url: string | null | undefined, options: SafeUrlOptions = {}): string | undefined {
  if (!url) return undefined;
  // A scheme ends at the first colon, before any slash, question mark or hash; without one, the URL
  // is relative. Browsers skip leading spaces and control characters, so this does too.
  const scheme = /^[\p{Cc} ]*([^:/?#]*):/u.exec(url)?.[1]?.toLowerCase();
  if (scheme === undefined || scheme === 'http' || scheme === 'https' || scheme === 'mailto') return url;
  return options.files && (scheme === 'data' || scheme === 'blob') ? url : undefined;
}

/** A host link text names: in a URL (`https://github.com/x`), after `www.`, or in an email address. */
const NAMED_HOST =
  /(?:[a-z][a-z\d+.-]*:\/\/(?:[^\s/@]*@)?|\bwww\.|[^\s@<>()[\]]@)([\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*)/iu;
/** Link text that is a domain, with or without a path: `github.com`, `github.com/x`. */
const DOMAIN_TEXT = /^((?:[\p{L}\p{N}-]+\.)+\p{L}[\p{L}\p{N}-]+)\.?(?:[/?#:]\S*)?$/u;
/** A file's or a product's name, which reads like a domain and is not one: `README.md`, `Next.js`. */
const FILE_NAME =
  /\.(?:[cm]?[jt]sx?|json|mdx?|s?css|html?|py|rb|go|rs|sh|txt|ya?ml|toml|lock|vue|svelte|php|java|kt|swift|cpp|cs|sql|xml|csv|log|zip|pdf|png|jpe?g|gif|svg|webp)$/i;

/** A host as the browser resolves it (lowercase, look-alike letters in punycode), without `www.`. */
function normalHost(host: string): string | undefined {
  try {
    return new URL(`http://${host}`).hostname.replace(/^www\./, '').replace(/\.$/, '');
  } catch {
    return undefined;
  }
}

/**
 * The host a link goes to, when its text could make a person think it goes elsewhere: the text
 * names another host, or names one in look-alike letters (the host is in punycode, `xn--`), or has
 * characters that do not show. Otherwise `undefined`, and the link needs nothing beside it.
 */
export function linkHostMismatch(text: string, href: string): string | undefined {
  let target: string | undefined;
  try {
    // Against a base of its own, so that a relative URL, which stays on the page's site, has no host
    // to show, and `//evil.example/x` has evil.example.
    const url = new URL(href, 'https://self.invalid');
    if (url.host === 'self.invalid') return undefined;
    if (url.protocol === 'http:' || url.protocol === 'https:') target = normalHost(url.hostname);
    else if (url.protocol === 'mailto:') target = normalHost(url.pathname.split('@').pop() ?? '');
  } catch {
    return undefined;
  }
  if (!target) return undefined;
  const trimmed = text.trim();
  if (hasHidden(trimmed)) return target;
  const domain = DOMAIN_TEXT.exec(trimmed)?.[1];
  const named = NAMED_HOST.exec(trimmed)?.[1] ?? (domain && !FILE_NAME.test(domain) ? domain : undefined);
  if (named === undefined) return undefined;
  return normalHost(named) !== target || target.split('.').some((label) => label.startsWith('xn--'))
    ? target
    : undefined;
}
