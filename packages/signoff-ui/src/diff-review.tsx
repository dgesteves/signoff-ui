'use client';

import * as ToggleGroup from '@radix-ui/react-toggle-group';
import {
  createContext,
  Fragment,
  memo,
  useContext,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react';
import type { DiffHunk, DiffLine, HunkDecision, ParsedFileDiff } from './lib/diff';
import { gapLines, type ContextGap, type DiffReviewComment } from './lib/review';
import { mergeTokensWithSegments, TOKEN_CLASS, tokenizeLine } from './lib/highlight';
import { useScrollRegion } from './lib/scroll-region';
import { Revealed } from './lib/revealed';
import { hasHidden } from './lib/untrusted';
import { ArrowDownIcon, ArrowUpIcon, CheckIcon, ChevronIcon, CommentIcon, UndoIcon, XIcon } from './lib/icons';
import { Kbd, LiveRegion } from './lib/primitives';
import { cn, type HeadingLevel } from './lib/utils';
import { diffReviewLabels, commonLabels } from './lib/labels';
import { useLabels, WithLabels } from './labels';
import {
  CONTEXT_STEP,
  useDiffReview,
  type DiffReviewDraft,
  type DiffReviewFileState,
  type ShownContext,
  type UseDiffReviewOptions,
  type UseDiffReviewResult,
} from './use-diff-review';

/** The labels' sections this module reads. */
const LABELS = { diffReview: diffReviewLabels, common: commonLabels };

export type { DiffWorkerFactory } from './lib/diff-async';
export type { FileChange, HunkDecision } from './lib/diff';
export type {
  DiffReviewComment,
  DiffReviewFileResult,
  DiffReviewRejectedHunk,
  DiffReviewResult,
  DiffReviewResultComment,
  FileDecision,
} from './lib/review';
export type DiffViewMode = 'unified' | 'split';

export interface DiffReviewProps
  extends
    Omit<ComponentPropsWithoutRef<'section'>, 'title' | 'onSubmit' | 'children'>,
    Omit<UseDiffReviewOptions, 'readOnly' | 'context' | 'maxEditLength' | 'autoAdvance' | 'collapseViewed'> {
  /**
   * Heading. Without one, the review uses `labels.diffReview.title`.
   * @default 'Review changes'
   */
  title?: ReactNode;
  /**
   * Your own controls in the header, next to the layout toggle, e.g. a "Copy as a patch" button.
   * Your content, like `AgentMessage`'s `renderTool`: it sits in a `data-signoff-slot` element, and
   * keys pressed in it are yours, not the review's shortcuts.
   */
  actions?: ReactNode;
  /**
   * The layout, controlled: `unified`, one column, or `split`, the original and the proposed file
   * side by side. Pass `onViewChange` with it to follow the layout toggle.
   */
  view?: DiffViewMode | undefined;
  /**
   * The layout to start with, when the review keeps its own.
   * @default 'unified'
   */
  defaultView?: DiffViewMode;
  /** Called with the layout the reviewer picks with the layout toggle. */
  onViewChange?: ((view: DiffViewMode) => void) | undefined;
  /** The apply button's text. Default "Apply 2 of 5", or "Apply changes" before any is accepted (`labels.diffReview.apply`). */
  submitLabel?: string;
  /**
   * Hide review controls, e.g. once the review has been submitted.
   * @default false
   */
  readOnly?: boolean;
  /**
   * Lines of context around each change.
   * @default 3
   */
  context?: number;
  /**
   * Past this many lines added plus lines removed in one file, its changed region (from the first
   * changed line to the last) is shown as one hunk that replaces it, and the review says so. Diffing
   * costs about the square of this number.
   * @default 2000
   */
  maxEditLength?: number;
  /**
   * After accepting or rejecting with the keyboard, move to the next undecided hunk.
   * @default true
   */
  autoAdvance?: boolean;
  /**
   * Fold a file away once it is marked viewed.
   * @default true
   */
  collapseViewed?: boolean;
  /**
   * Heading level for the title, to fit your document outline.
   * @default 3
   */
  headingLevel?: HeadingLevel;
}

const STATUS_BADGE: Record<ParsedFileDiff['status'], string> = {
  modified: 'border-signoff-warn/40 text-signoff-warn-fg',
  added: 'border-signoff-accent/45 text-signoff-accent-fg',
  deleted: 'border-signoff-hot/45 text-signoff-hot-fg',
  renamed: 'border-signoff-border-strong text-signoff-fg-muted',
};

const useIsoLayoutEffect = typeof window === 'undefined' ? useEffect : useLayoutEffect;

/*
 * Long reviews render only what is near the screen. Each hunk's rows are cut into chunks; a chunk
 * far from the viewport keeps its height and its lines as visually hidden text, so the page does not
 * jump, find-in-page and screen readers still have every line, and the DOM stays small. Unchanged
 * lines shown between hunks are cut into chunks the same way. Hunks themselves always render: focus,
 * J/K and their names never depend on what is on screen. Past the first hundred, they render a
 * hundred per task, so the page keeps responding while they arrive.
 */
/** Reviews with more rows than this are virtualized; smaller ones render every row. */
const VIRTUALIZE_ROWS = 400;
const CHUNK_ROWS = 50;
/** Rendered in full on the first render (and on the server), before anything is measured. */
const INITIAL_ROWS = 100;
/** How far beyond the viewport chunks render, so scrolling rarely meets an empty one. */
const NEAR_MARGIN = '800px 0px';
/** One row of 12.5px text at line-height 1.6, until a rendered row is measured. */
const ROW_HEIGHT = 20;
/** Hunks (and whole-file items) in the first render, and in each task after it. */
const ITEMS_BATCH = 100;
/**
 * Past this many characters a line is plain text: no syntax colors, so one element rather than one
 * per token. A minified bundle's line has hundreds of thousands of tokens.
 */
const HIGHLIGHT_MAX_LINE = 2_000;

interface Virtualizer {
  /** Calls `listener` whenever the element comes near the viewport or leaves; returns an unsubscribe. */
  observe(el: Element, listener: (near: boolean, height: number) => void): () => void;
  /**
   * Measured heights of a hunk's chunks that have rendered (or of unchanged lines shown), by chunk key;
   * a new parse starts afresh.
   */
  heights: WeakMap<Pick<DiffHunk, 'lines'>, Map<string, number>>;
  rowHeight: number;
}

function createVirtualizer(rowHeight: number, heights: Virtualizer['heights']): Virtualizer {
  let observer: IntersectionObserver | undefined;
  const listeners = new Map<Element, (near: boolean, height: number) => void>();
  return {
    heights,
    rowHeight,
    observe(el, listener) {
      // Without IntersectionObserver (old browsers, jsdom), everything renders.
      if (typeof IntersectionObserver === 'undefined') {
        listener(true, 0);
        return () => {};
      }
      observer ??= new IntersectionObserver(
        (entries) => {
          for (const entry of entries)
            listeners.get(entry.target)?.(entry.isIntersecting, entry.boundingClientRect.height);
        },
        // `scrollMargin` extends the margin into scrolling containers, such as a chat panel, where supported.
        { rootMargin: NEAR_MARGIN, scrollMargin: NEAR_MARGIN } as IntersectionObserverInit,
      );
      listeners.set(el, listener);
      observer.observe(el);
      return () => {
        listeners.delete(el);
        observer?.unobserve(el);
      };
    },
  };
}

const VirtualizerContext = createContext<Virtualizer | null>(null);

/** What memoized hunks call: stable functions that always reach the latest render of the review. */
interface ReviewActions {
  register(id: string, el: HTMLElement | null): void;
  activate(index: number): void;
  decide(id: string, decision: HunkDecision): void;
  comment(itemId: string): void;
  edit(commentId: string): void;
  remove(commentId: string): void;
  lineNumber: UseDiffReviewResult['getLineNumberProps'];
  registerDraft(el: HTMLTextAreaElement | null): void;
  setText(text: string): void;
  save(): void;
  cancel(): void;
  showContext: UseDiffReviewResult['showContext'];
}

/**
 * Review agent file edits hunk by hunk, in unified or split view, with word-level highlights, and
 * send back what was accepted, what was rejected and what the reviewer said about it.
 *
 * Keyboard: J/K or the arrows move between hunks and Shift+J/K between files; A accepts, R rejects,
 * U resets, Alt+A / Alt+R decide the file and Shift+A / Shift+R everything; Shift+arrows select lines
 * and C comments on them (or on the hunk); E shows more context; V marks the file viewed;
 * ⌘/Ctrl+Enter applies.
 *
 * Large files stay responsive: a big diff is computed in a worker while the file shows
 * "Comparing…", one past `maxEditLength` becomes a single replacing hunk, and long reviews
 * render only the rows near the screen. For your own markup, `useDiffReview` is this component's
 * state and keyboard without it.
 */
export function DiffReview({
  files,
  title: titleProp,
  actions: actionsProp,
  view: viewProp,
  defaultView = 'unified',
  onViewChange,
  decisions,
  defaultDecisions,
  onDecisionsChange,
  comments,
  defaultComments,
  onCommentsChange,
  viewed,
  defaultViewed,
  onViewedChange,
  onSubmit,
  submitLabel,
  readOnly = false,
  context = 3,
  maxEditLength,
  diffWorker,
  autoAdvance = true,
  collapseViewed = true,
  headingLevel = 3,
  labels,
  className,
  ...props
}: DiffReviewProps) {
  const L = useLabels(LABELS, labels);
  const T = L.diffReview;
  const title = titleProp ?? T.title;
  const Heading = `h${headingLevel}` as const;
  // What Apply sent, said until the review has something else to say.
  const [sent, setSent] = useState<{ text: string; after: string }>();
  const review = useDiffReview({
    files,
    decisions,
    defaultDecisions,
    onDecisionsChange,
    comments,
    defaultComments,
    onCommentsChange,
    viewed,
    defaultViewed,
    onViewedChange,
    onSubmit:
      onSubmit &&
      ((result, helpers) => {
        const returned = onSubmit(result, helpers);
        const total = result.accepted + result.rejected + result.pending;
        setSent({
          text: T.submitted(result.accepted, total, result.comments.length),
          after: latest.current.announcement,
        });
        return returned;
      }),
    readOnly,
    context,
    maxEditLength,
    diffWorker,
    autoAdvance,
    collapseViewed,
    labels,
  });
  const { items, counts, comparing, isMac } = review;

  const [viewState, setViewState] = useState<DiffViewMode>(defaultView);
  const view = viewProp ?? viewState;
  const setView = (v: DiffViewMode) => {
    if (viewProp === undefined) setViewState(v);
    onViewChange?.(v);
  };

  // Rows per hunk in the current view, and where each hunk's rows start in the review.
  const layout = useMemo(() => {
    const offsets = new Map<string, number>();
    let rows = 0;
    for (const item of items) {
      if (!item.hunk) continue;
      offsets.set(item.id, rows);
      rows += view === 'split' ? splitRowCount(item.hunk.lines) : item.hunk.lines.length;
    }
    return { offsets, rows };
  }, [items, view]);
  const virtualize = layout.rows > VIRTUALIZE_ROWS;
  const rootRef = useRef<HTMLElement>(null);
  const [rowHeight, setRowHeight] = useState(ROW_HEIGHT);
  // One observer per review and row height; chunks keep their measured heights across views.
  const [heights] = useState<Virtualizer['heights']>(() => new WeakMap());
  const virtualizer = useMemo(() => createVirtualizer(rowHeight, heights), [rowHeight, heights]);
  useIsoLayoutEffect(() => {
    if (!virtualize) return;
    const row = rootRef.current?.querySelector('[data-slot="signoff-diff-hunk"] [data-line]');
    const measured = row?.getBoundingClientRect().height ?? 0;
    if (measured > 0 && Math.abs(measured - rowHeight) > 0.5) setRowHeight(measured);
  }, [virtualize, view, rowHeight]);

  const latest = useRef(review);
  useIsoLayoutEffect(() => {
    latest.current = review;
  });
  const [actions] = useState<ReviewActions>(() => ({
    register: review.registerItem,
    activate: review.activate,
    decide: (id, decision) => latest.current.decide(id, decision),
    comment: (itemId) => latest.current.startComment({ itemId }),
    edit: (commentId) => latest.current.startComment({ commentId }),
    remove: (commentId) => latest.current.removeComment(commentId),
    lineNumber: (index, line) => latest.current.getLineNumberProps(index, line),
    registerDraft: review.registerDraft,
    setText: (text) => latest.current.setDraftText(text),
    save: () => latest.current.saveDraft(),
    cancel: () => latest.current.cancelDraft(),
    showContext: (...args) => latest.current.showContext(...args),
  }));

  // Past the first hundred, hunks render a hundred per task: a thousand in one task blocked the page
  // for a quarter of a second. The item J, K or V moves to renders at once, with its batch, and focus
  // follows it. The count only grows: moving back, or past folded files, unmounts nothing.
  const [batches, setBatches] = useState(1);
  const reached = Math.ceil((review.activeIndex + 1) / ITEMS_BATCH);
  if (reached > batches) setBatches(reached);
  const rendered = Math.max(batches, reached) * ITEMS_BATCH;
  useEffect(() => {
    if (batches * ITEMS_BATCH >= items.length) return;
    const timer = setTimeout(() => setBatches((n) => n + 1));
    return () => clearTimeout(timer);
  }, [batches, items.length]);
  const renderedBefore = useRef(rendered);
  useIsoLayoutEffect(() => {
    const hunk = document.activeElement?.closest('[data-slot="signoff-diff-hunk"]') ?? null;
    if (review.activeIndex >= renderedBefore.current && rootRef.current?.contains(hunk))
      latest.current.focusItem(review.activeIndex);
    renderedBefore.current = rendered;
  }, [rendered, review.activeIndex]);

  // Comments by the hunk (or whole-file item) they are on, kept per array so memoized hunks keep theirs.
  const commentsByItem = useMemo(() => {
    const map = new Map<string, DiffReviewComment[]>();
    for (const comment of review.comments) {
      const key = comment.hunkId ?? `${comment.fileId}:file`;
      map.set(key, [...(map.get(key) ?? []), comment]);
    }
    return map;
  }, [review.comments]);

  const additions = review.files.reduce((n, f) => n + (f.parsed?.additions ?? 0), 0);
  const deletions = review.files.reduce((n, f) => n + (f.parsed?.deletions ?? 0), 0);
  const hunkCount = items.filter((item) => item.hunk).length;
  const viewedCount = review.files.filter((f) => f.viewed).length;
  // What React renders as nothing gets no slot: undefined, null, booleans and the empty string.
  const hasActions = actionsProp != null && typeof actionsProp !== 'boolean' && actionsProp !== '';
  const label = submitLabel ?? T.apply(counts.accepted, counts.total);
  const mod = L.common.modKey(isMac);
  const indexOf = useMemo(() => new Map(items.map((item, i) => [item.id, i])), [items]);

  return (
    // Review shortcuts are scoped to focus within the diff (WCAG 2.1.4); every action is also a button.
    <WithLabels labels={labels}>
      <section
        ref={rootRef}
        data-signoff
        data-slot="signoff-diff-review"
        aria-label={typeof title === 'string' ? title : T.title}
        // tabIndex -1: a click on a button in Safari, or on text, focuses the review rather than the page.
        {...review.getRootProps()}
        className={cn(
          'rounded-signoff border-signoff-border bg-signoff-surface font-signoff-sans text-signoff-fg overflow-hidden border outline-none',
          className,
        )}
        {...props}
      >
        <div className="border-signoff-border flex flex-wrap items-center gap-x-4 gap-y-2 border-b px-4 py-3">
          {/* With actions, the title keeps 12rem: past that, the controls wrap under it. */}
          <div className={cn('min-w-0 flex-1', hasActions && 'basis-48')}>
            <Heading className="text-signoff-fg text-sm font-semibold">{title}</Heading>
            <p className="font-signoff-mono text-signoff-fg-subtle mt-0.5 text-xs">
              {T.files(review.files.length)} · {T.hunks(hunkCount, comparing)} ·{' '}
              <span className="whitespace-nowrap">
                <span className="text-signoff-accent-fg">+{additions}</span>{' '}
                <span className="text-signoff-hot-fg">−{deletions}</span>
              </span>
            </p>
          </div>
          {hasActions && (
            <div data-signoff-slot className="flex flex-wrap items-center gap-2">
              {actionsProp}
            </div>
          )}
          <ToggleGroup.Root
            type="single"
            value={view}
            onValueChange={(v) => v && setView(v as DiffViewMode)}
            aria-label={T.layout}
            className="border-signoff-border bg-signoff-bg/50 inline-flex rounded-lg border p-0.5"
          >
            {(['unified', 'split'] as const).map((mode) => (
              <ToggleGroup.Item
                key={mode}
                value={mode}
                className="text-signoff-fg-muted hover:text-signoff-fg focus-visible:outline-signoff-ring data-[state=on]:bg-signoff-surface-2 data-[state=on]:text-signoff-fg cursor-pointer rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 data-[state=on]:shadow-[inset_0_0_0_1px_var(--signoff-border-strong)] forced-colors:data-[state=on]:underline forced-colors:data-[state=on]:decoration-2 forced-colors:data-[state=on]:underline-offset-4"
              >
                {T.views[mode]}
              </ToggleGroup.Item>
            ))}
          </ToggleGroup.Root>
        </div>

        {review.files.length > 1 && <FileNavigator review={review} />}

        <VirtualizerContext.Provider value={virtualize ? virtualizer : null}>
          {review.files.map((file) => (
            <FileSection key={file.id} file={file} review={review}>
              {file.items.map((item) => {
                const index = indexOf.get(item.id)!;
                if (index >= rendered) return null;
                const itemProps = review.getItemProps(index);
                const selection = review.selection?.item.id === item.id ? review.selection : undefined;
                const draft = review.draft && draftItem(review.draft) === item.id ? review.draft : undefined;
                if (!item.hunk) {
                  return (
                    <WholeFile
                      key={item.id}
                      file={file}
                      index={index}
                      name={itemProps['aria-label']}
                      active={itemProps.tabIndex === 0}
                      decision={itemProps['data-decision']}
                      readOnly={readOnly}
                      comments={commentsByItem.get(item.id)}
                      draft={draft}
                      actions={actions}
                    />
                  );
                }
                const parsed = file.parsed!;
                // The gap before this hunk, or after it, the last: numbered by the hunk below it.
                const gap = (before: number, number: number) => {
                  const found = gapsOf(file).get(before);
                  return (
                    found && (
                      <ContextGapView
                        key={`gap-${before}`}
                        fileId={file.id}
                        parsed={parsed}
                        gap={found}
                        view={view}
                        shown={review.shown[`${file.id}:${before}`]}
                        readOnly={readOnly}
                        number={number}
                        virtualizer={virtualizer}
                        actions={actions}
                      />
                    )
                  );
                };
                const hunk = item.hunk;
                const last = hunk.index === parsed.hunks.length - 1;
                return (
                  <Fragment key={item.id}>
                    {gap(hunk.index, index + 1)}
                    <Hunk
                      hunk={hunk}
                      file={parsed}
                      index={index}
                      name={itemProps['aria-label']}
                      view={view}
                      decision={itemProps['data-decision']}
                      active={itemProps.tabIndex === 0}
                      readOnly={readOnly}
                      rowOffset={layout.offsets.get(item.id) ?? 0}
                      selection={selection && { from: selection.from, to: selection.to, head: selection.head }}
                      comments={commentsByItem.get(item.id)}
                      draft={draft}
                      actions={actions}
                    />
                    {last && gap(hunk.index + 1, index + 2)}
                  </Fragment>
                );
              })}
            </FileSection>
          ))}
        </VirtualizerContext.Provider>

        {!readOnly && (
          <div className="border-signoff-border bg-signoff-surface-2/30 flex flex-wrap items-center gap-x-4 gap-y-3 border-t px-4 py-3">
            <div className="flex min-w-0 flex-col gap-1.5">
              <p className="text-signoff-fg-muted text-xs">
                <span className="text-signoff-fg font-semibold tabular-nums">
                  {counts.accepted + counts.rejected}/{counts.total}
                </span>{' '}
                {T.reviewed}
                {review.files.length > 1 && (
                  <span className="text-signoff-fg-subtle"> · {T.filesViewed(viewedCount, review.files.length)}</span>
                )}
                {review.comments.length > 0 && (
                  <span className="text-signoff-fg-subtle"> · {T.comments(review.comments.length)}</span>
                )}
                {comparing ? (
                  <span className="text-signoff-fg-subtle"> · {T.comparingFiles}</span>
                ) : (
                  counts.pending > 0 &&
                  counts.accepted + counts.rejected > 0 && (
                    <span className="text-signoff-fg-subtle"> · {T.skipped}</span>
                  )
                )}
              </p>
              <div aria-hidden="true" className="flex h-1 w-40 gap-0.5 overflow-hidden rounded-full">
                {items.map((item) => {
                  const d = review.decisions[item.id] ?? 'pending';
                  return (
                    <span
                      key={item.id}
                      className={cn(
                        'h-full flex-1 transition-colors',
                        d === 'accepted'
                          ? 'bg-signoff-accent'
                          : d === 'rejected'
                            ? 'bg-signoff-hot'
                            : 'bg-signoff-border-strong',
                      )}
                    />
                  );
                })}
              </div>
            </div>
            <p
              className="text-signoff-fg-subtle hidden flex-wrap items-center gap-1 text-[11px] lg:flex pointer-coarse:hidden"
              aria-hidden="true"
            >
              <Kbd>J</Kbd>
              <Kbd>K</Kbd>
              <span className="mr-1.5">{T.keyHints.move}</span>
              <Kbd>A</Kbd>
              <span className="mr-1.5">{T.keyHints.accept}</span>
              <Kbd>R</Kbd>
              <span className="mr-1.5">{T.keyHints.reject}</span>
              <Kbd>C</Kbd>
              <span className="mr-1.5">{T.keyHints.comment}</span>
              <Kbd>{mod}</Kbd>
              <Kbd>↵</Kbd>
              <span>{T.keyHints.apply}</span>
            </p>
            <p className="sr-only">{T.keyboardHelp(mod)}</p>
            {/* Longer labels, as in a translation, wrap the buttons onto more rows, never their words. */}
            <div className="ml-auto flex flex-wrap items-center justify-end gap-2">
              {/* aria-disabled rather than disabled while comparing: the buttons keep focus. */}
              <button
                type="button"
                aria-disabled={comparing || undefined}
                aria-keyshortcuts="Shift+R"
                onClick={() => review.decideAll('rejected')}
                className={secondaryButton}
              >
                {T.rejectAll}
              </button>
              <button
                type="button"
                aria-disabled={comparing || undefined}
                aria-keyshortcuts="Shift+A"
                onClick={() => review.decideAll('accepted')}
                className={secondaryButton}
              >
                {T.acceptAll}
              </button>
              {onSubmit && (
                <button
                  data-slot="signoff-diff-submit"
                  {...review.getSubmitProps()}
                  className="bg-signoff-accent text-signoff-on-accent hover:bg-signoff-accent/90 focus-visible:outline-signoff-ring inline-flex h-8 cursor-pointer items-center rounded-lg px-3 text-[13px] font-semibold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-60 forced-colors:border"
                >
                  {label}
                </button>
              )}
            </div>
          </div>
        )}
        <LiveRegion>{sent?.after === review.announcement ? sent.text : review.announcement}</LiveRegion>
      </section>
    </WithLabels>
  );
}

const gapsByParse = new WeakMap<ParsedFileDiff, Map<number, ContextGap>>();

/**
 * A file's gaps by the hunk they go before, made once per parse: the review makes them again with
 * every decision, and a gap that keeps its identity lets its memoized view skip the render.
 */
function gapsOf(file: DiffReviewFileState) {
  let gaps = gapsByParse.get(file.parsed!);
  if (!gaps) gapsByParse.set(file.parsed!, (gaps = new Map(file.gaps.map((gap) => [gap.before, gap]))));
  return gaps;
}

/** The item a draft is written on: its hunk, or for a file comment, the file's whole-file item or first hunk. */
function draftItem(draft: DiffReviewDraft) {
  return draft.hunkId ?? `${draft.fileId}:file`;
}

const secondaryButton =
  'inline-flex h-8 cursor-pointer items-center rounded-lg border border-signoff-border-strong px-3 text-[13px] font-medium whitespace-nowrap text-signoff-fg-muted transition-colors hover:bg-signoff-surface-2 hover:text-signoff-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signoff-ring aria-disabled:cursor-not-allowed aria-disabled:opacity-60';

const smallButton =
  'inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-md border px-2 text-xs font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-signoff-ring';

/** A pressed toggle in forced colours, which replace the tint that shows it: a thicker border. */
const pressed = 'forced-colors:aria-pressed:border-2';

function PathLabel({ path, oldPath }: { path: string; oldPath?: string | undefined }) {
  const T = useLabels(LABELS).diffReview;
  const slash = path.lastIndexOf('/');
  return (
    <span dir="ltr" className="min-w-0 truncate">
      {oldPath && oldPath !== path && (
        <>
          <span className="text-signoff-fg-subtle">
            <Revealed text={oldPath} blanks />
          </span>
          <span className="text-signoff-fg-subtle" aria-hidden="true">
            {' → '}
          </span>
          <span className="sr-only">{` ${T.renamedTo} `}</span>
        </>
      )}
      {slash > 0 && (
        <span className="text-signoff-fg-subtle">
          <Revealed text={path.slice(0, slash + 1)} blanks />
        </span>
      )}
      <span className="text-signoff-fg font-medium">
        <Revealed text={path.slice(slash + 1)} blanks />
      </span>
    </span>
  );
}

function StatusBadge({ status }: { status: ParsedFileDiff['status'] }) {
  const badge = useLabels(LABELS).diffReview.status[status];
  return (
    <span
      className={cn(
        'inline-flex size-[18px] shrink-0 items-center justify-center rounded border text-[10px] font-bold',
        STATUS_BADGE[status],
      )}
      title={badge.name}
    >
      <span aria-hidden="true">{badge.letter}</span>
      <span className="sr-only">{badge.name}:</span>
    </span>
  );
}

/** Every file of a multi-file review, to jump to: one tab stop, ↑ and ↓ between files. */
function FileNavigator({ review }: { review: UseDiffReviewResult }) {
  const T = useLabels(LABELS).diffReview;
  return (
    <nav
      aria-label={T.navigator}
      data-slot="signoff-diff-files"
      className="border-signoff-border bg-signoff-bg/30 border-b px-2 py-1.5"
    >
      <ol className="flex max-h-48 flex-col overflow-y-auto">
        {review.files.map((file) => {
          const total = file.items.length;
          return (
            <li key={file.id}>
              <button
                {...review.getNavigatorItemProps(file.id)}
                disabled={total === 0}
                className="font-signoff-mono hover:bg-signoff-surface-2 focus-visible:outline-signoff-ring aria-[current=true]:bg-signoff-surface-2 flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-left text-xs focus-visible:outline-2 focus-visible:-outline-offset-2 disabled:cursor-default"
              >
                {file.parsed && <StatusBadge status={file.parsed.status} />}
                <PathLabel path={file.path} oldPath={file.parsed?.oldPath} />
                <span className="text-signoff-fg-subtle ml-auto shrink-0 tabular-nums">
                  {file.parsed ? (
                    <>
                      <span aria-hidden="true">
                        {file.decided}/{total}
                      </span>
                      <span className="sr-only">{T.navigatorState(file.decided, total, file.viewed)}</span>
                    </>
                  ) : (
                    T.comparingShort
                  )}
                </span>
                <span className="text-signoff-accent-fg w-3.5 shrink-0">{file.viewed && <CheckIcon size={13} />}</span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** A file's header and body: its hunks, or "Comparing…" while it is diffed in the background. */
function FileSection({
  file,
  review,
  children,
}: {
  file: DiffReviewFileState;
  review: UseDiffReviewResult;
  children: ReactNode;
}) {
  const T = useLabels(LABELS).diffReview;
  const parsed = file.parsed;
  const decidable = file.items.length > 0 && !review.readOnly;
  const bodyId = `${useId()}-body`;
  return (
    <div
      data-slot="signoff-diff-file"
      data-fallback={parsed?.fallback}
      data-viewed={file.viewed || undefined}
      data-decision={file.decision}
      aria-busy={parsed ? undefined : true}
      className="border-signoff-border border-b last:border-b-0"
    >
      <div className="border-signoff-border bg-signoff-surface-2/60 font-signoff-mono flex flex-wrap items-center gap-x-2.5 gap-y-1.5 border-b px-4 py-2 text-xs">
        {file.items.length > 0 && (
          <button
            type="button"
            aria-expanded={!file.collapsed}
            aria-controls={bodyId}
            aria-label={T.toggleFile(file.collapsed, file.path)}
            onClick={() => review.setCollapsed(file.id, !file.collapsed)}
            className="text-signoff-fg-subtle hover:text-signoff-fg focus-visible:outline-signoff-ring -ml-1.5 inline-flex size-6 cursor-pointer items-center justify-center rounded focus-visible:outline-2"
          >
            <ChevronIcon size={13} className={cn('transition-transform', !file.collapsed && 'rotate-90')} />
          </button>
        )}
        {parsed && <StatusBadge status={parsed.status} />}
        <PathLabel path={file.path} oldPath={parsed?.oldPath} />
        {/* Shrinks and wraps, its buttons too, so longer labels stay inside a narrow review. */}
        <span className="ml-auto flex flex-wrap items-center justify-end gap-x-2.5 gap-y-1.5">
          {parsed && parsed.hunks.length > 0 && (
            <span className="whitespace-nowrap tabular-nums">
              <span className="text-signoff-accent-fg">+{parsed.additions}</span>{' '}
              <span className="text-signoff-hot-fg">−{parsed.deletions}</span>
            </span>
          )}
          {decidable && (
            <span className="flex flex-wrap items-center justify-end gap-1.5 font-sans">
              <label className="text-signoff-fg-muted hover:text-signoff-fg flex cursor-pointer items-center gap-1.5 px-1 text-xs">
                <input
                  {...review.getViewedProps(file.id)}
                  className="accent-signoff-accent focus-visible:outline-signoff-ring size-3.5 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2"
                />
                {T.viewed}
                <span className="sr-only"> {file.path}</span>
              </label>
              <button
                {...review.getFileDecisionProps(file.id, 'rejected')}
                className={cn(
                  smallButton,
                  'border-signoff-border text-signoff-fg-muted hover:border-signoff-hot/50 hover:text-signoff-hot-fg',
                )}
              >
                {T.rejectFile}
                <span className="sr-only"> {file.path}</span>
              </button>
              <button
                {...review.getFileDecisionProps(file.id, 'accepted')}
                className={cn(
                  smallButton,
                  'border-signoff-border text-signoff-fg-muted hover:border-signoff-accent/50 hover:text-signoff-accent-fg',
                )}
              >
                {T.acceptFile}
                <span className="sr-only"> {file.path}</span>
              </button>
            </span>
          )}
        </span>
      </div>
      <div id={bodyId} hidden={file.collapsed}>
        {!parsed && <p className="text-signoff-fg-subtle px-4 py-3 text-xs">{T.comparing}</p>}
        {parsed?.fallback === 'replace' && (
          <p data-slot="signoff-diff-fallback" className="text-signoff-fg-muted px-4 pt-3 pb-1 text-xs">
            {T.fallback}
          </p>
        )}
        {parsed && file.items.length === 0 && <p className="text-signoff-fg-subtle px-4 py-3 text-xs">{T.noChanges}</p>}
        {children}
      </div>
    </div>
  );
}

const ROW_BG: Record<DiffLine['type'], string> = {
  context: '',
  add: 'bg-signoff-add',
  del: 'bg-signoff-del',
};
const SIGN: Record<DiffLine['type'], { glyph: string; className: string }> = {
  context: { glyph: ' ', className: '' },
  add: { glyph: '+', className: 'text-signoff-accent-fg' },
  del: { glyph: '−', className: 'text-signoff-hot-fg' },
};

/** What a screen reader hears before a line: "Added: ", "Removed: " or nothing. */
function useLinePrefix() {
  const { added, removed } = useLabels(LABELS).diffReview;
  return (type: DiffLine['type']) => (type === 'add' ? added : type === 'del' ? removed : '');
}

/** Decision buttons for an item: Reset (once decided), Reject and Accept, each a toggle. */
function DecisionButtons({
  id,
  label,
  decision,
  actions,
  commentLabel,
}: {
  id: string;
  /** "hunk 2" or "change 3", for the buttons' names. */
  label: string;
  decision: HunkDecision;
  actions: ReviewActions;
  commentLabel: string;
}) {
  const T = useLabels(LABELS).diffReview;
  const rejected = decision === 'rejected';
  const accepted = decision === 'accepted';
  return (
    <span className="ml-auto flex shrink-0 items-center gap-1">
      <button
        type="button"
        onClick={() => actions.comment(id)}
        aria-label={commentLabel}
        aria-keyshortcuts="C"
        className="text-signoff-fg-subtle hover:bg-signoff-surface-2 hover:text-signoff-fg focus-visible:outline-signoff-ring inline-flex size-7 cursor-pointer items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-1"
      >
        <CommentIcon size={13} />
      </button>
      {decision !== 'pending' && (
        <button
          type="button"
          onClick={() => actions.decide(id, 'pending')}
          aria-label={T.resetItem(label)}
          aria-keyshortcuts="U"
          className="text-signoff-fg-subtle hover:bg-signoff-surface-2 hover:text-signoff-fg focus-visible:outline-signoff-ring inline-flex size-7 cursor-pointer items-center justify-center rounded-md focus-visible:outline-2 focus-visible:outline-offset-1"
        >
          <UndoIcon size={13} />
        </button>
      )}
      <button
        type="button"
        aria-pressed={rejected}
        aria-label={T.rejectItem(label)}
        aria-keyshortcuts="R"
        onClick={() => actions.decide(id, rejected ? 'pending' : 'rejected')}
        className={cn(
          smallButton,
          pressed,
          rejected
            ? 'border-signoff-hot/60 bg-signoff-hot/15 text-signoff-hot-fg'
            : 'border-signoff-border text-signoff-fg-muted hover:border-signoff-hot/50 hover:text-signoff-hot-fg',
        )}
      >
        <XIcon size={12} strokeWidth={2.5} />
        {T.reject}
      </button>
      <button
        type="button"
        aria-pressed={accepted}
        aria-label={T.acceptItem(label)}
        aria-keyshortcuts="A"
        onClick={() => actions.decide(id, accepted ? 'pending' : 'accepted')}
        className={cn(
          smallButton,
          pressed,
          accepted
            ? 'border-signoff-accent/60 bg-signoff-accent/15 text-signoff-accent-fg'
            : 'border-signoff-border text-signoff-fg-muted hover:border-signoff-accent/50 hover:text-signoff-accent-fg',
        )}
      >
        <CheckIcon size={12} strokeWidth={2.5} />
        {T.accept}
      </button>
    </span>
  );
}

function DecisionBadge({ decision }: { decision: HunkDecision }) {
  const badge = useLabels(LABELS).diffReview.badge;
  if (decision === 'pending') return null;
  return (
    <span
      className={cn(
        'font-signoff-mono rounded-full px-1.5 py-px text-[10px] font-semibold tracking-wide uppercase',
        decision === 'accepted'
          ? 'bg-signoff-accent/15 text-signoff-accent-fg'
          : 'bg-signoff-hot/15 text-signoff-hot-fg',
      )}
    >
      {badge[decision]}
    </span>
  );
}

const itemClass = (decision: HunkDecision) =>
  cn(
    'border-signoff-border/70 focus-visible:outline-signoff-ring relative border-b last:border-b-0 focus-visible:z-10 focus-visible:outline-2 focus-visible:-outline-offset-2',
    "before:absolute before:inset-y-0 before:left-0 before:z-[1] before:w-[3px] before:content-['']",
    decision === 'accepted' && 'before:bg-signoff-accent',
    decision === 'rejected' && 'before:bg-signoff-hot',
  );

/** A file with nothing to diff but something to decide: binary, a rename, or created or deleted empty. */
const WholeFile = memo(function WholeFile({
  file,
  index,
  name,
  active,
  decision,
  readOnly,
  comments,
  draft,
  actions,
}: {
  file: DiffReviewFileState;
  index: number;
  name: string;
  active: boolean;
  decision: HunkDecision;
  readOnly: boolean;
  comments: DiffReviewComment[] | undefined;
  draft: DiffReviewDraft | undefined;
  actions: ReviewActions;
}) {
  const T = useLabels(LABELS).diffReview;
  const parsed = file.parsed!;
  const id = `${file.id}:file`;
  const notePath = parsed.oldPath ?? file.path;
  const note = T.wholeFile(parsed.status, !!parsed.binary, notePath);
  return (
    // A roving-tabindex item: focus tracking only, all actions are buttons.
    <div
      ref={(el) => actions.register(id, el)}
      role="group"
      aria-label={name}
      tabIndex={active ? 0 : -1}
      data-slot="signoff-diff-hunk"
      data-decision={decision}
      onFocus={() => actions.activate(index)}
      className={itemClass(decision)}
    >
      <div className="bg-signoff-bg/35 flex min-h-9 items-center gap-2 py-1 pr-2 pl-4">
        <span className="text-signoff-fg-muted min-w-0 truncate text-xs">
          {/* The path in it is the agent's: it shows marks as the header does, when it has any. */}
          {hasHidden(notePath) ? <Revealed text={note} /> : note}
        </span>
        <DecisionBadge decision={decision} />
        {!readOnly && (
          <DecisionButtons
            id={id}
            label={T.itemName('file', index + 1)}
            decision={decision}
            actions={actions}
            commentLabel={T.commentOn(file.path)}
          />
        )}
      </div>
      {comments?.map((comment) => (
        <CommentView key={comment.id} comment={comment} actions={actions} readOnly={readOnly} editing={draft} />
      ))}
      {draft && !draft.commentId && <CommentEditor draft={draft} actions={actions} />}
    </div>
  );
});

/** Inside a hunk's code, a comment stays put while the code scrolls sideways, as wide as what shows. */
const inCode = 'sticky left-0 col-span-3 w-[100cqw]';

interface HunkProps {
  hunk: DiffHunk;
  file: ParsedFileDiff;
  index: number;
  name: string;
  view: DiffViewMode;
  decision: HunkDecision;
  active: boolean;
  readOnly: boolean;
  /** Rows of the review before this hunk's, for which chunks render at first. */
  rowOffset: number;
  /** Lines selected in this hunk, by index. */
  selection: { from: number; to: number; head: number } | undefined;
  comments: DiffReviewComment[] | undefined;
  draft: DiffReviewDraft | undefined;
  actions: ReviewActions;
}

/** What renders after a row: the comments that end on it, and the editor when its range ends there. */
interface Annotations {
  after: Map<number, ReactNode>;
  /** Rows a chunk must keep rendered: a selected line, a comment or the editor. */
  pinned: Set<number>;
}

/** Memoized: a decision re-renders the hunk it changed and the ones gaining or losing focus. */
const Hunk = memo(function Hunk({
  hunk,
  file,
  index,
  name,
  view,
  decision,
  active,
  readOnly,
  rowOffset,
  selection,
  comments,
  draft,
  actions,
}: HunkProps) {
  const T = useLabels(LABELS).diffReview;
  const codeRef = useScrollRegion<HTMLDivElement>(T.hunkCode(index + 1, file.path));
  const ref = useRef<HTMLDivElement | null>(null);
  const virtualizer = useContext(VirtualizerContext);
  const rejected = decision === 'rejected';
  const head = selection?.head;

  // The selected line in view as the keyboard moves it.
  useEffect(() => {
    if (head === undefined) return;
    ref.current?.querySelector(`[data-line-index="${head}"]`)?.scrollIntoView?.({ block: 'nearest' });
  }, [head]);

  const annotations = useMemo<Annotations>(() => {
    const after = new Map<number, ReactNode[]>();
    const pinned = new Set<number>();
    const add = (row: number, node: ReactNode) => {
      after.set(row, [...(after.get(row) ?? []), node]);
      pinned.add(row);
    };
    const end = hunk.lines.length - 1;
    for (const comment of comments ?? []) {
      const span = comment.target === 'lines' ? spanOf(hunk, comment) : undefined;
      add(
        span?.[1] ?? end,
        <CommentView
          key={comment.id}
          comment={comment}
          actions={actions}
          readOnly={readOnly}
          editing={draft}
          className={inCode}
        />,
      );
    }
    if (draft && !draft.commentId) {
      const span =
        draft.target === 'lines' && draft.range ? spanOf(hunk, { target: 'lines', ...draft.range }) : undefined;
      add(span?.[1] ?? end, <CommentEditor key="draft" draft={draft} actions={actions} className={inCode} />);
    }
    if (selection) for (let i = selection.from; i <= selection.to; i++) pinned.add(i);
    return { after: new Map([...after].map(([row, nodes]) => [row, <Fragment key={row}>{nodes}</Fragment>])), pinned };
  }, [hunk, comments, draft, selection, actions, readOnly]);

  const selectionLabel = selection ? T.lines(rangeOf(hunk, selection.from, selection.to)) : undefined;

  return (
    // A roving-tabindex item: focus tracking only, all actions are buttons.
    <div
      ref={(el) => {
        ref.current = el;
        actions.register(hunk.id, el);
      }}
      role="group"
      aria-label={name}
      tabIndex={active ? 0 : -1}
      data-slot="signoff-diff-hunk"
      data-decision={decision}
      onFocus={() => actions.activate(index)}
      className={itemClass(decision)}
    >
      {/* Under 30rem, the decision badge goes under the range rather than beside it, so the range keeps its room;
          where the buttons leave it too little, they wrap to a line of their own rather than cut it short. */}
      <div className="bg-signoff-bg/35 @container flex min-h-9 flex-wrap items-center gap-2 py-1 pr-2 pl-4">
        <span className="flex min-w-0 items-center gap-2 @max-[30rem]:flex-col @max-[30rem]:items-start @max-[30rem]:gap-0.5">
          <span dir="ltr" className="font-signoff-mono text-signoff-fg-subtle max-w-full min-w-0 truncate text-[11px]">
            {hunk.header}
          </span>
          <DecisionBadge decision={decision} />
        </span>
        {!readOnly && (
          <DecisionButtons
            id={hunk.id}
            label={T.itemName('hunk', index + 1)}
            decision={decision}
            actions={actions}
            commentLabel={T.commentOn(selectionLabel ?? T.itemName('hunk', index + 1))}
          />
        )}
      </div>
      {/* Long lines scroll sideways, or wrap under 30rem; while they scroll, the code is a named group the keyboard can reach. */}
      <div
        ref={codeRef}
        // Code reads left to right in a right-to-left page too, so bidi cannot reorder it.
        dir="ltr"
        className="focus-visible:outline-signoff-ring @container overflow-x-auto focus-visible:outline-2 focus-visible:-outline-offset-2"
      >
        {view === 'unified' ? (
          <UnifiedRows
            hunk={hunk}
            index={index}
            language={file.language}
            rejected={rejected}
            virtualizer={virtualizer}
            rowOffset={rowOffset}
            selection={selection}
            annotations={annotations}
            actions={actions}
            readOnly={readOnly}
          />
        ) : (
          <SplitRows
            hunk={hunk}
            index={index}
            language={file.language}
            rejected={rejected}
            virtualizer={virtualizer}
            rowOffset={rowOffset}
            selection={selection}
            annotations={annotations}
            actions={actions}
            readOnly={readOnly}
          />
        )}
      </div>
    </div>
  );
});

/** Indices of the lines a comment or draft covers. */
function spanOf(
  hunk: DiffHunk,
  where: {
    target: DiffReviewComment['target'];
    side?: 'new' | 'old' | undefined;
    startLine?: number;
    endLine?: number;
  },
): [number, number] | undefined {
  const { side, startLine, endLine } = where;
  if (!side || startLine === undefined || endLine === undefined) return undefined;
  const num = (l: DiffLine) => (side === 'new' ? l.newNumber : l.oldNumber);
  const from = hunk.lines.findIndex((l) => num(l) === startLine);
  let to = -1;
  hunk.lines.forEach((l, i) => {
    if (num(l) === endLine) to = i;
  });
  return from === -1 || to < from ? undefined : [from, to];
}

/** The lines selected, numbered as a comment on them would be: in the new file, else the original. */
function rangeOf(hunk: DiffHunk, from: number, to: number) {
  const lines = hunk.lines.slice(from, to + 1);
  const numbers = (side: 'new' | 'old') =>
    lines.map((l) => (side === 'new' ? l.newNumber : l.oldNumber)).filter((n): n is number => n !== undefined);
  const news = numbers('new');
  const [list, side] = news.length ? [news, 'new' as const] : [numbers('old'), 'old' as const];
  return { side, startLine: list[0] ?? 0, endLine: list.at(-1) ?? 0 };
}

function CommentView({
  comment,
  actions,
  readOnly,
  editing,
  className,
}: {
  comment: DiffReviewComment;
  actions: ReviewActions;
  readOnly: boolean;
  editing: DiffReviewDraft | undefined;
  className?: string;
}) {
  const T = useLabels(LABELS).diffReview;
  if (editing?.commentId === comment.id)
    return <CommentEditor draft={editing} actions={actions} className={className} />;
  const where = T.where(comment);
  const heading = T.commentHeading(where);
  return (
    <div
      data-slot="signoff-diff-comment"
      className={cn('border-signoff-border bg-signoff-surface font-signoff-sans border-y px-4 py-2.5', className)}
    >
      <div className="flex items-start gap-2">
        <CommentIcon size={13} className="text-signoff-fg-subtle mt-0.5 shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-signoff-fg-subtle text-[11px]">
            <span className="sr-only">{heading.hidden}</span>
            {heading.visible}
          </p>
          <p dir="auto" className="text-signoff-fg mt-0.5 text-[13px] leading-relaxed whitespace-pre-wrap">
            {comment.text}
          </p>
        </div>
        {!readOnly && (
          <span className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => actions.edit(comment.id)}
              className="text-signoff-fg-muted hover:text-signoff-fg focus-visible:outline-signoff-ring cursor-pointer rounded px-1.5 py-0.5 text-xs focus-visible:outline-2"
              aria-label={T.editComment(where)}
            >
              {T.edit}
            </button>
            <button
              type="button"
              onClick={() => actions.remove(comment.id)}
              className="text-signoff-fg-muted hover:text-signoff-hot-fg focus-visible:outline-signoff-ring cursor-pointer rounded px-1.5 py-0.5 text-xs focus-visible:outline-2"
              aria-label={T.deleteComment(where)}
            >
              {T.delete}
            </button>
          </span>
        )}
      </div>
    </div>
  );
}

function CommentEditor({
  draft,
  actions,
  className,
}: {
  draft: DiffReviewDraft;
  actions: ReviewActions;
  className?: string | undefined;
}) {
  const T = useLabels(LABELS).diffReview;
  const id = `${useId()}-comment`;
  const where = T.where({
    target: draft.target,
    side: draft.range?.side,
    startLine: draft.range?.startLine,
    endLine: draft.range?.endLine,
  });
  const empty = draft.text.trim() === '';
  return (
    <div
      data-slot="signoff-diff-comment-editor"
      className={cn(
        'border-signoff-border bg-signoff-surface font-signoff-sans flex flex-col gap-2 border-y px-4 py-3',
        className,
      )}
    >
      <label htmlFor={id} className="text-signoff-fg-muted text-xs font-medium">
        {T.commentField(where)}
      </label>
      <textarea
        ref={(el) => actions.registerDraft(el)}
        id={id}
        dir="auto"
        rows={3}
        value={draft.text}
        onChange={(event) => actions.setText(event.target.value)}
        onKeyDown={(event) => {
          // The Enter that commits an IME composition (Japanese, Chinese, Korean…) is not a submit.
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            event.stopPropagation();
            actions.save();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            actions.cancel();
          }
        }}
        placeholder={T.commentPlaceholder}
        className="border-signoff-border-strong bg-signoff-bg text-signoff-fg placeholder:text-signoff-fg-subtle focus-visible:outline-signoff-ring w-full resize-y rounded-lg border px-3 py-2 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-0 pointer-coarse:text-[length:max(16px,1rem)]"
      />
      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={() => actions.cancel()}
          aria-keyshortcuts="Escape"
          className="text-signoff-fg-muted hover:text-signoff-fg focus-visible:outline-signoff-ring cursor-pointer rounded-md px-2 py-1.5 text-xs focus-visible:outline-2"
        >
          {T.cancel}
        </button>
        <button
          type="button"
          onClick={() => actions.save()}
          aria-disabled={empty || undefined}
          className="bg-signoff-accent text-signoff-on-accent hover:bg-signoff-accent/90 focus-visible:outline-signoff-ring inline-flex h-7 cursor-pointer items-center rounded-md px-2.5 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-60 forced-colors:border"
        >
          {draft.commentId ? T.saveComment : T.addComment}
        </button>
      </div>
    </div>
  );
}

/**
 * Rows of a virtualized hunk, `CHUNK_ROWS` at a time. Near the viewport a chunk renders its rows;
 * away from it, only its height (measured once it has rendered) and its lines as hidden text.
 * A chunk that holds focus, a selected line, a comment or the editor stays rendered.
 */
function Chunk({
  hunk,
  id,
  rows,
  initiallyNear,
  pinned,
  virtualizer,
  text,
  className,
  children,
}: {
  /** The hunk, or the unchanged lines, whose rows it holds. */
  hunk: Pick<DiffHunk, 'lines'>;
  /** The chunk within its hunk, by view and first row. */
  id: string;
  rows: number;
  initiallyNear: boolean;
  pinned: boolean;
  virtualizer: Virtualizer;
  text: () => string;
  className?: string;
  children: () => ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [nearState, setNear] = useState(initiallyNear);
  const near = nearState || pinned;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    return virtualizer.observe(el, (isNear, height) => {
      if (!isNear && el.contains(document.activeElement)) return;
      if (!isNear && height > 0 && el.hasAttribute('data-rendered')) {
        let measured = virtualizer.heights.get(hunk);
        if (!measured) virtualizer.heights.set(hunk, (measured = new Map()));
        measured.set(id, height);
      }
      setNear(isNear);
    });
  }, [virtualizer, hunk, id]);
  if (near) {
    return (
      <div ref={ref} data-slot="signoff-diff-chunk" data-rendered="" className={className}>
        {children()}
      </div>
    );
  }
  const height = virtualizer.heights.get(hunk)?.get(id) ?? rows * virtualizer.rowHeight;
  return (
    <div ref={ref} data-slot="signoff-diff-chunk" className="relative" style={{ height }}>
      <div className="sr-only whitespace-pre">{text()}</div>
    </div>
  );
}

/** Chunk boundaries for `count` rows: [start, end) pairs. */
function chunks(count: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let start = 0; start < count; start += CHUNK_ROWS) out.push([start, Math.min(count, start + CHUNK_ROWS)]);
  return out;
}

const pinnedIn = (annotations: Annotations, start: number, end: number) => {
  for (const row of annotations.pinned) if (row >= start && row < end) return true;
  return false;
};

function LineContent({
  line,
  language,
  rejected,
  wrap = false,
}: {
  line: DiffLine;
  language: string;
  rejected: boolean;
  wrap?: boolean;
}) {
  const prefix = useLinePrefix();
  const pieces = useMemo(
    () =>
      mergeTokensWithSegments(
        tokenizeLine(line.content, line.content.length > HIGHLIGHT_MAX_LINE ? 'text' : language),
        line.segments,
      ),
    [line, language],
  );
  // A bidi control can make code read as other code (Trojan Source): such characters show as marks.
  const reveal = useMemo(() => hasHidden(line.content), [line]);
  return (
    <span
      className={cn(
        wrap
          ? 'min-w-0 flex-1 pr-3 break-all whitespace-pre-wrap'
          : 'pr-6 whitespace-pre @max-[30rem]:min-w-0 @max-[30rem]:flex-1 @max-[30rem]:pr-3 @max-[30rem]:break-all @max-[30rem]:whitespace-pre-wrap',
        // A rejected hunk's lines are muted, with no syntax colors or word highlights, and its added
        // lines struck through: muted rather than faded, so the text keeps its 4.5:1 contrast.
        rejected && 'text-signoff-fg-muted',
        rejected && line.type === 'add' && 'decoration-signoff-hot/50 line-through',
      )}
    >
      <span className="sr-only">{prefix(line.type)}</span>
      {pieces.map((p, i) => (
        <span
          key={i}
          className={
            rejected
              ? undefined
              : cn(
                  TOKEN_CLASS[p.kind],
                  p.changed && 'rounded-[3px]',
                  p.changed && (line.type === 'add' ? 'bg-signoff-add-strong' : 'bg-signoff-del-strong'),
                )
          }
        >
          {reveal ? <Revealed text={p.text} /> : p.text}
        </span>
      ))}
      {line.content === '' && ' '}
    </span>
  );
}

/**
 * A line number. Click selects the line, Shift-click extends the selection; the keyboard selects with
 * Shift and the arrows from the hunk, so the numbers stay out of the tab order and the reading.
 */
function LineNumber({
  value,
  onSelect,
  className,
}: {
  value: number | undefined;
  onSelect: ((event: MouseEvent) => void) | undefined;
  className: string;
}) {
  if (!onSelect || value === undefined)
    return (
      <span aria-hidden="true" className={className}>
        {value ?? ''}
      </span>
    );
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-hidden="true"
      onClick={onSelect}
      className={cn(className, 'hover:text-signoff-fg cursor-pointer')}
    >
      {value}
    </button>
  );
}

interface RowOptions {
  /** The hunk's item index, for the line numbers' selection; `undefined` for unchanged context lines. */
  index?: number | undefined;
  actions?: ReviewActions | undefined;
  selected?: boolean;
  head?: boolean;
}

const gutter = 'text-signoff-fg-subtle shrink-0 pr-2 text-right select-none';

function UnifiedRow({
  line,
  lineIndex,
  language,
  rejected,
  index,
  actions,
  selected = false,
  head = false,
}: { line: DiffLine; lineIndex?: number; language: string; rejected: boolean } & RowOptions) {
  const sign = SIGN[line.type];
  const select =
    actions && index !== undefined && lineIndex !== undefined
      ? (event: MouseEvent) => actions.lineNumber(index, lineIndex).onClick(event)
      : undefined;
  return (
    <div
      data-line={line.type}
      data-line-index={lineIndex}
      data-selected={selected || undefined}
      className={cn(
        // Wrapped lines (under 30rem) keep their numbers by their first line.
        'flex @max-[30rem]:items-start',
        ROW_BG[line.type],
        selected && 'shadow-[inset_3px_0_0_var(--signoff-ring)]',
        selected && !ROW_BG[line.type] && 'bg-signoff-accent/8',
        head && 'outline-signoff-ring outline-1 -outline-offset-1',
      )}
    >
      <LineNumber value={line.oldNumber} onSelect={select} className={cn(gutter, 'w-11')} />
      <LineNumber value={line.newNumber} onSelect={select} className={cn(gutter, 'w-11')} />
      <span aria-hidden="true" className={cn('w-5 shrink-0 text-center select-none', sign.className)}>
        {sign.glyph}
      </span>
      <LineContent line={line} language={language} rejected={rejected} />
    </div>
  );
}

interface RowsProps {
  /** The hunk, or unchanged lines shown around hunks: those have no `index`, selection or `actions`. */
  hunk: Pick<DiffHunk, 'lines'>;
  index?: number;
  language: string;
  rejected: boolean;
  /** Set when the review is long enough to render only what is near the screen. */
  virtualizer: Virtualizer | null;
  rowOffset: number;
  selection?: { from: number; to: number; head: number } | undefined;
  annotations: Annotations;
  actions?: ReviewActions;
  readOnly: boolean;
}

function UnifiedRows({
  hunk,
  index,
  language,
  rejected,
  virtualizer,
  rowOffset,
  selection,
  annotations,
  actions,
  readOnly,
}: RowsProps) {
  const prefix = useLinePrefix();
  const lines = hunk.lines;
  // Unrendered rows have no width: keep the widest line's, so the sideways scroll does not change.
  const widest = useMemo(() => lines.reduce((n, l) => Math.max(n, l.content.length), 0), [lines]);
  const row = (line: DiffLine, i: number) => (
    <Fragment key={i}>
      <UnifiedRow
        line={line}
        lineIndex={i}
        language={language}
        rejected={rejected}
        index={index}
        actions={readOnly ? undefined : actions}
        selected={!!selection && i >= selection.from && i <= selection.to}
        head={selection?.head === i}
      />
      {annotations.after.get(i)}
    </Fragment>
  );
  return (
    // Under 30rem wide, the lines wrap instead (LineContent), so nothing holds the rows wider.
    <div className="font-signoff-mono min-w-max py-1 text-[12.5px] leading-[1.6] @max-[30rem]:min-w-0">
      {virtualizer ? (
        <div
          className="min-w-(--signoff-widest) @max-[30rem]:min-w-0"
          style={{ '--signoff-widest': `calc(${widest}ch + 8.25rem)` } as CSSProperties}
        >
          {chunks(lines.length).map(([start, end]) => (
            <Chunk
              key={start}
              hunk={hunk}
              id={`u${start}`}
              rows={end - start}
              initiallyNear={rowOffset + start < INITIAL_ROWS}
              pinned={pinnedIn(annotations, start, end)}
              virtualizer={virtualizer}
              text={() =>
                lines
                  .slice(start, end)
                  .map((line) => prefix(line.type) + line.content)
                  .join('\n')
              }
            >
              {() => lines.slice(start, end).map((line, i) => row(line, start + i))}
            </Chunk>
          ))}
        </div>
      ) : (
        lines.map(row)
      )}
    </div>
  );
}

type SplitRow = {
  left?: DiffLine | undefined;
  right?: DiffLine | undefined;
  /** Indices into the hunk's lines. */
  leftIndex?: number | undefined;
  rightIndex?: number | undefined;
};

function toSplitRows(lines: readonly DiffLine[]): SplitRow[] {
  const rows: SplitRow[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.type === 'context') {
      rows.push({ left: line, right: line, leftIndex: i, rightIndex: i });
      i++;
      continue;
    }
    const dels: number[] = [];
    const adds: number[] = [];
    while (lines[i]?.type === 'del') dels.push(i++);
    while (lines[i]?.type === 'add') adds.push(i++);
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) {
      const [l, r] = [dels[k], adds[k]];
      rows.push({
        left: l === undefined ? undefined : lines[l],
        right: r === undefined ? undefined : lines[r],
        leftIndex: l,
        rightIndex: r,
      });
    }
  }
  return rows;
}

/** How many rows `toSplitRows` makes, without making them. */
function splitRowCount(lines: readonly DiffLine[]): number {
  let rows = 0;
  let i = 0;
  while (i < lines.length) {
    if (lines[i]!.type === 'context') {
      rows++;
      i++;
      continue;
    }
    const start = i;
    while (lines[i]?.type === 'del') i++;
    const dels = i - start;
    while (lines[i]?.type === 'add') i++;
    rows += Math.max(dels, i - start - dels);
  }
  return rows;
}

function SplitCell({
  line,
  lineIndex,
  side,
  language,
  rejected,
  hidden = false,
  index,
  actions,
  selected = false,
  head = false,
}: {
  line: DiffLine | undefined;
  lineIndex?: number | undefined;
  side: 'left' | 'right';
  language: string;
  rejected: boolean;
  /** Context lines appear on both sides; hide the duplicate from assistive tech. */
  hidden?: boolean;
} & RowOptions) {
  if (!line) return <div aria-hidden="true" className="bg-signoff-bg/30" />;
  const number = side === 'left' ? line.oldNumber : line.newNumber;
  const sign = SIGN[line.type];
  const select =
    actions && index !== undefined && lineIndex !== undefined
      ? (event: MouseEvent) => actions.lineNumber(index, lineIndex).onClick(event)
      : undefined;
  return (
    <div
      data-line={line.type}
      data-line-index={hidden ? undefined : lineIndex}
      data-selected={selected || undefined}
      aria-hidden={hidden || undefined}
      className={cn(
        'flex min-w-0',
        ROW_BG[line.type],
        selected && 'shadow-[inset_3px_0_0_var(--signoff-ring)]',
        selected && !ROW_BG[line.type] && 'bg-signoff-accent/8',
        head && 'outline-signoff-ring outline-1 -outline-offset-1',
      )}
    >
      <LineNumber value={number} onSelect={select} className={cn(gutter, 'w-10')} />
      <span aria-hidden="true" className={cn('w-4 shrink-0 text-center select-none', sign.className)}>
        {sign.glyph}
      </span>
      <LineContent line={line} language={language} rejected={rejected} wrap />
    </div>
  );
}

const SPLIT_GRID = 'grid grid-cols-[minmax(0,1fr)_1px_minmax(0,1fr)]';

/** Split view: one shared grid so the two columns stay aligned; long lines wrap. */
function SplitRows({
  hunk,
  index,
  language,
  rejected,
  virtualizer,
  rowOffset,
  selection,
  annotations,
  actions,
  readOnly,
}: RowsProps) {
  const prefix = useLinePrefix();
  const rows = useMemo(() => toSplitRows(hunk.lines), [hunk.lines]);
  const inSelection = (i: number | undefined) =>
    !!selection && i !== undefined && i >= selection.from && i <= selection.to;
  // A comment goes after the row holding the last line it covers.
  const lastRowOf = useMemo(() => {
    const map = new Map<number, number>();
    rows.forEach((row, r) => {
      if (row.leftIndex !== undefined) map.set(row.leftIndex, r);
      if (row.rightIndex !== undefined) map.set(row.rightIndex, r);
    });
    return map;
  }, [rows]);
  const afterRow = useMemo(() => {
    const map = new Map<number, ReactNode[]>();
    for (const [line, node] of annotations.after) {
      const r = lastRowOf.get(line) ?? rows.length - 1;
      map.set(r, [...(map.get(r) ?? []), node]);
    }
    return map;
  }, [annotations, lastRowOf, rows.length]);
  const pinnedRows = useMemo(
    () => new Set([...annotations.pinned].map((line) => lastRowOf.get(line) ?? rows.length - 1)),
    [annotations, lastRowOf, rows.length],
  );
  const cells = (row: SplitRow, r: number) => (
    <Fragment key={r}>
      <SplitCell
        line={row.left}
        lineIndex={row.leftIndex}
        side="left"
        language={language}
        rejected={rejected}
        index={index}
        actions={readOnly ? undefined : actions}
        selected={inSelection(row.leftIndex)}
        head={selection?.head === row.leftIndex && row.left !== undefined}
      />
      <span aria-hidden="true" className="bg-signoff-border" />
      <SplitCell
        line={row.right}
        lineIndex={row.rightIndex}
        side="right"
        language={language}
        rejected={rejected}
        hidden={row.left !== undefined && row.left === row.right}
        index={index}
        actions={readOnly ? undefined : actions}
        selected={inSelection(row.rightIndex)}
        head={selection?.head === row.rightIndex && row.left !== row.right && row.right !== undefined}
      />
      {afterRow.get(r)}
    </Fragment>
  );
  if (!virtualizer) {
    return (
      <div className={cn('font-signoff-mono py-1 text-[12.5px] leading-[1.6]', SPLIT_GRID)}>{rows.map(cells)}</div>
    );
  }
  // Read in the same order as the cells: the left line, then the right one unless it is the same.
  const text = (start: number, end: number) =>
    rows
      .slice(start, end)
      .flatMap((row) => [row.left, row.right === row.left ? undefined : row.right])
      .filter((line): line is DiffLine => line !== undefined)
      .map((line) => prefix(line.type) + line.content)
      .join('\n');
  return (
    <div className="font-signoff-mono py-1 text-[12.5px] leading-[1.6]">
      {chunks(rows.length).map(([start, end]) => (
        <Chunk
          key={start}
          hunk={hunk}
          id={`s${start}`}
          rows={end - start}
          initiallyNear={rowOffset + start < INITIAL_ROWS}
          pinned={[...pinnedRows].some((r) => r >= start && r < end)}
          virtualizer={virtualizer}
          text={() => text(start, end)}
          className={SPLIT_GRID}
        >
          {() => rows.slice(start, end).map((row, i) => cells(row, start + i))}
        </Chunk>
      ))}
    </div>
  );
}

/**
 * Unchanged lines between hunks, before the first or after the last: those shown so far, and a bar
 * to show more. Its buttons are outside the tab order, like the line numbers: from a hunk, E shows
 * more lines around it; a screen reader reaches the buttons by reading. Memoized, on props that
 * keep their identity: a decision, or a message streaming around the review, does not render it.
 */
const ContextGapView = memo(function ContextGapView({
  fileId,
  parsed,
  gap,
  view,
  shown = { start: 0, end: 0 },
  readOnly,
  number,
  virtualizer,
  actions,
}: {
  fileId: string;
  parsed: ParsedFileDiff;
  gap: ContextGap;
  view: DiffViewMode;
  shown: ShownContext | undefined;
  readOnly: boolean;
  /** The number of the hunk below it, as the review numbers its items: the one above is one less. */
  number: number;
  virtualizer: Virtualizer;
  actions: ReviewActions;
}) {
  const T = useLabels(LABELS).diffReview;
  const size = gap.oldEnd - gap.oldStart + 1;
  const hidden = size - shown.start - shown.end;
  const top = useMemo(
    () => (shown.start > 0 ? gapLines(parsed, gap, gap.oldStart, gap.oldStart + shown.start - 1) : []),
    [parsed, gap, shown.start],
  );
  const bottom = useMemo(
    () => (shown.end > 0 ? gapLines(parsed, gap, gap.oldEnd - shown.end + 1, gap.oldEnd) : []),
    [parsed, gap, shown.end],
  );
  const first = gap.before === 0;
  const last = gap.before === parsed.hunks.length;
  const button =
    'text-signoff-fg-muted hover:text-signoff-fg hover:bg-signoff-surface-2 focus-visible:outline-signoff-ring inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 focus-visible:outline-2';
  return (
    <div data-slot="signoff-diff-gap" className="border-signoff-border/70 border-b">
      <ContextLines lines={top} view={view} language={parsed.language} virtualizer={virtualizer} />
      {hidden > 0 && !readOnly && (
        <div className="bg-signoff-bg/50 text-signoff-fg-subtle flex flex-wrap items-center gap-x-3 gap-y-1 py-1 pr-2 pl-4 text-[11px]">
          <span className="font-signoff-mono">{T.unchangedLines(hidden)}</span>
          {hidden > CONTEXT_STEP && !first && (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => actions.showContext(fileId, gap, 'start')}
              className={button}
            >
              <ArrowDownIcon size={11} />
              <GapLabel {...T.moreAfter(CONTEXT_STEP, number - 1)} />
            </button>
          )}
          {hidden > CONTEXT_STEP && !last && (
            <button
              type="button"
              tabIndex={-1}
              onClick={() => actions.showContext(fileId, gap, 'end')}
              className={button}
            >
              <ArrowUpIcon size={11} />
              <GapLabel {...T.moreBefore(CONTEXT_STEP, number)} />
            </button>
          )}
          <button
            type="button"
            tabIndex={-1}
            onClick={() => actions.showContext(fileId, gap, 'all')}
            className={button}
          >
            <GapLabel {...T.showAll(hidden)} />
          </button>
        </div>
      )}
      <ContextLines lines={bottom} view={view} language={parsed.language} virtualizer={virtualizer} />
    </div>
  );
});

/** A gap button's words: what shows, then what only a screen reader hears. */
function GapLabel({ visible, hidden }: { visible: string; hidden: string }) {
  return (
    <>
      {visible}
      <span className="sr-only">{hidden}</span>
    </>
  );
}

/** Nothing after a row, and no row to keep rendered: unchanged lines have no comments or selection. */
const NO_ANNOTATIONS: Annotations = { after: new Map(), pinned: new Set() };

/**
 * Unchanged lines shown around hunks, in the review's layout, rendered as a hunk's rows are: past
 * `INITIAL_ROWS` of them, cut into chunks that render only near the screen.
 */
function ContextLines({
  lines,
  view,
  language,
  virtualizer,
}: {
  lines: DiffLine[];
  view: DiffViewMode;
  language: string;
  virtualizer: Virtualizer;
}) {
  // The chunks keep their measured heights under it for as long as these lines show.
  const rows = useMemo(() => ({ lines }), [lines]);
  if (lines.length === 0) return null;
  const Rows = view === 'unified' ? UnifiedRows : SplitRows;
  return (
    <div dir="ltr" className="@container overflow-x-auto">
      <Rows
        hunk={rows}
        language={language}
        rejected={false}
        virtualizer={lines.length > INITIAL_ROWS ? virtualizer : null}
        rowOffset={0}
        annotations={NO_ANNOTATIONS}
        readOnly
      />
    </div>
  );
}
