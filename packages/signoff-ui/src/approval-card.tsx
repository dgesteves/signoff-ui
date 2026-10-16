'use client';

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentPropsWithoutRef,
  type KeyboardEvent,
  type MouseEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import {
  getApprovalRequestReason,
  getApprovalStatus,
  getToolPartName,
  isAutomaticApproval,
  type ApprovalStatus,
  type ToolPart,
} from './lib/ai';
import { humanizeToolName, safeStringify } from './lib/format';
import { approvalCardLabels, commonLabels, type SignoffLabels, type SignoffLabelsInput } from './lib/labels';
import { evaluateRules, suggestArgs, type ApprovalDecision, type ApprovalRequest } from './lib/policy';
import { useScrollRegion } from './lib/scroll-region';
import { Revealed } from './lib/revealed';
import { BanIcon, CheckIcon, ShieldIcon, TerminalIcon } from './lib/icons';
import { JsonView, Kbd, LiveRegion } from './lib/primitives';
import { useIsMac } from './lib/hooks';
import { cn, fromSlot, hasModifier, isPromiseLike, isTypingTarget, type HeadingLevel } from './lib/utils';
import type { RiskLevel, ToolMeta } from './tool-call-timeline';
import type { ApprovalOutcome, ApprovalPolicy } from './use-approval-policy';
import { useLabels, WithLabels } from './labels';

/** The labels' sections this module reads. */
const LABELS = { approvalCard: approvalCardLabels, common: commonLabels };

export type { ApprovalStatus, RiskLevel };
export type { ApprovalDecision } from './lib/policy';

/** A decision as the card makes it: what was chosen, and what goes with it. */
export interface ApprovalChoice {
  /**
   * What was chosen, and how long it holds: `allow-once`, `allow-session`, `allow-always`,
   * `deny-once` or `deny-always`.
   */
  decision: ApprovalDecision;
  /** The denial's reason, when the person gave one. */
  reason?: string | undefined;
  /** The arguments to run with, when the person edited them (`editable`). */
  input?: unknown;
  /**
   * For a session or always decision: the argument patterns its rule covers, or `undefined` for
   * every call of the tool ("Any arguments").
   */
  args?: Record<string, string> | undefined;
}

export interface ApprovalCardProps extends Omit<ComponentPropsWithoutRef<'section'>, 'title' | 'children' | 'part'> {
  /** Name of the tool or action that needs approval. */
  toolName: string;
  /** Heading. Defaults to the humanized tool name. */
  title?: ReactNode;
  /** Why the agent wants to do this, e.g. the SDK's `approval.requestReason`. */
  description?: ReactNode;
  /** Arguments the action will run with. */
  input?: unknown;
  /** How risky the action is, shown as a badge. Without it the card shows no risk level. */
  risk?: RiskLevel | undefined;
  /**
   * Custom arguments preview. Defaults to a command line for `{ command }` inputs, else JSON.
   * Your content, like `AgentMessage`'s `renderTool`: keys pressed in it, or in a menu it opens in
   * a portal, are yours, not the card's shortcuts. Once the person edits the arguments (`editable`),
   * the card shows the edited ones in its default preview instead.
   */
  preview?: ReactNode;
  /**
   * Where the approval stands: the card offers the choices while `pending`, and shows the outcome you
   * pass back. Approve and deny fire once: further presses (a double click, Y then N) are ignored
   * until `status` changes, the promise the handler returned settles, or the handler throws.
   * @default 'pending'
   */
  status?: ApprovalStatus;
  /** Reason recorded with the decision, shown once resolved. */
  reason?: string | undefined;
  /**
   * A policy, not a person, made the decision (the SDK's `approval.isAutomatic`): once resolved,
   * the card reads "Auto-approved" or "Blocked by policy" instead of "Approved" or "Denied".
   * @default false
   */
  automatic?: boolean;
  /**
   * How the resolved decision was made, to say so: `allow-session` reads "Approved for this
   * session", `deny-always` "Always denied", and so on.
   */
  decision?: ApprovalDecision | undefined;
  /** The rule that decided, in words, shown once resolved: "Allowed by your rule: …". */
  decidedByRule?: string | undefined;
  /**
   * The choices to offer, from `allow-once`, `allow-session`, `allow-always`, `deny-once` and
   * `deny-always`. Session and always decisions come to `onDecide` with the arguments their rule
   * covers.
   * @default ['allow-once', 'deny-once']
   */
  decisions?: readonly ApprovalDecision[] | undefined;
  /**
   * Every decision with what goes with it: its scope, the reason, edited arguments and the rule's
   * argument patterns. When you pass it, `onApprove` and `onDeny` are not called. May return a promise.
   */
  onDecide?: ((choice: ApprovalChoice) => void | PromiseLike<void>) | undefined;
  /** Fires once per decision: see `status`. May return a promise. Not called with `onDecide`. */
  onApprove?: () => void | PromiseLike<void>;
  /** Fires once per decision: see `status`. May return a promise. Not called with `onDecide`. */
  onDeny?: (reason?: string) => void | PromiseLike<void>;
  /**
   * Let the person edit the arguments before approving: a form for an object of strings, numbers
   * and booleans, JSON otherwise. The edited input comes to `onDecide`: "Done editing" closes the
   * editor and keeps the edit, "Undo edits" drops it. An edit is for the `input` it was made
   * against: new `input`, or a new `status`, drops it.
   * @default false
   */
  editable?: boolean;
  /** The argument patterns a session or always rule starts with. Default: from the input. */
  ruleArgs?: Record<string, string> | undefined;
  /**
   * Show which calls a session or always decision covers, editable. Pass `false` when the agent
   * keeps what "always" means, as with ACP's `allow_always`: the card then shows no argument
   * patterns, and the decision comes without `args`.
   * @default true
   */
  ruleScope?: boolean;
  /**
   * Y / N shortcuts while focus is inside the card (and S, A, Shift+N when offered), but not in a
   * custom `preview`.
   * @default true
   */
  shortcuts?: boolean;
  /**
   * Also approve with ⌘/Ctrl+Enter from anywhere on the page while pending, except a text field,
   * where the keys are the field's (a chat composer's send, say). With several cards pending, one
   * answers: the card the keys are pressed in, else the latest to ask. A critical press armed from
   * outside the card ends when focus or a click goes anywhere but the card.
   * @default false
   */
  globalShortcut?: boolean;
  /**
   * Move focus to the card when it mounts in the pending state, unless focus is in a text field:
   * the person's next keys would land on the card as shortcuts.
   * @default false
   */
  autoFocus?: boolean;
  /**
   * Offer an optional free-text reason when denying.
   * @default true
   */
  allowReason?: boolean;
  /**
   * Placeholder of the reason field. Without one, the card uses `labels.approvalCard.reasonPlaceholder`.
   * @default 'What should the agent do instead?'
   */
  reasonPlaceholder?: string;
  /**
   * The approve button's text. Without one, the card uses `labels.approvalCard.approve`.
   * @default 'Approve'
   */
  approveLabel?: string;
  /**
   * The deny button's text. Without one, the card uses `labels.approvalCard.deny`.
   * @default 'Deny'
   */
  denyLabel?: string;
  /**
   * Heading level for the title, to fit your document outline.
   * @default 3
   */
  headingLevel?: HeadingLevel;
  /** Words to use instead of the English defaults: see `SignoffLabelsProvider`. */
  labels?: SignoffLabelsInput | undefined;
}

/** No risk given: no badge, and the card's neutral colors. */
const UNRATED = { card: 'border-signoff-border', icon: 'bg-signoff-surface-2 text-signoff-fg-muted' };

const RISK: Record<RiskLevel, { badge: string; card: string; icon: string }> = {
  low: {
    badge: 'border-signoff-border-strong text-signoff-fg-muted',
    card: 'border-signoff-border',
    icon: 'bg-signoff-surface-2 text-signoff-fg-muted',
  },
  medium: {
    badge: 'border-signoff-warn/40 bg-signoff-warn/10 text-signoff-warn-fg',
    card: 'border-signoff-warn/30',
    icon: 'bg-signoff-warn/10 text-signoff-warn-fg',
  },
  high: {
    badge: 'border-signoff-hot/45 bg-signoff-hot/10 text-signoff-hot-fg',
    card: 'border-signoff-hot/40',
    icon: 'bg-signoff-hot/12 text-signoff-hot-fg',
  },
  critical: {
    badge: 'border-signoff-hot bg-signoff-hot text-signoff-on-hot',
    card: 'border-signoff-hot/70 shadow-[0_0_0_3px_color-mix(in_oklab,var(--signoff-hot)_14%,transparent)]',
    icon: 'bg-signoff-hot/15 text-signoff-hot-fg',
  },
};

/** The key for each decision, as printed and as `aria-keyshortcuts` names it. */
const CHOICE: Record<ApprovalDecision, { key: string; keys: string }> = {
  'allow-once': { key: 'Y', keys: 'Y' },
  'allow-session': { key: 'S', keys: 'S' },
  'allow-always': { key: 'A', keys: 'A' },
  'deny-once': { key: 'N', keys: 'N' },
  'deny-always': { key: '⇧N', keys: 'Shift+N' },
};

/** Styling hooks for the buttons; the once buttons keep the names they always had. */
const SLOT: Record<ApprovalDecision, string> = {
  'allow-once': 'signoff-approval-approve',
  'allow-session': 'signoff-approval-session',
  'allow-always': 'signoff-approval-always',
  'deny-once': 'signoff-approval-deny',
  'deny-always': 'signoff-approval-deny-always',
};

/**
 * A command wraps, so no part of it sits out of view to the side, whatever comes before it; a long
 * run of spaces shows as its count, and what does not show as a mark (`Revealed`). Should something
 * still be wider than the box, such as a mark in a very narrow one, it scrolls sideways, and while
 * it does, the keyboard can reach it.
 */
function CommandPreview({ command, cwd, label }: { command: string; cwd: string | undefined; label: string }) {
  const scrollRef = useScrollRegion<HTMLDivElement>(label);
  return (
    <div
      ref={scrollRef}
      className="border-signoff-border bg-signoff-bg/70 font-signoff-mono focus-visible:outline-signoff-ring overflow-x-auto rounded-lg border px-3 py-2.5 text-[13px] leading-5 focus-visible:outline-2 focus-visible:outline-offset-1"
    >
      {cwd && (
        <div className="text-signoff-fg-subtle mb-0.5 text-[11px] [overflow-wrap:anywhere] whitespace-pre-wrap">
          <Revealed text={cwd} blanks />
        </div>
      )}
      <div className="text-signoff-fg [overflow-wrap:anywhere] whitespace-pre-wrap">
        <span aria-hidden="true" className="text-signoff-accent-fg mr-2 select-none">
          $
        </span>
        <Revealed text={command} blanks />
      </div>
    </div>
  );
}

function DefaultPreview({ input, L }: { input: unknown; L: SignoffLabels['approvalCard'] }) {
  if (input && typeof input === 'object' && 'command' in input && typeof input.command === 'string') {
    const cwd = 'cwd' in input && typeof input.cwd === 'string' ? input.cwd : undefined;
    return <CommandPreview command={input.command} cwd={cwd} label={L.command} />;
  }
  if (input === undefined) return null;
  return <JsonView value={input} label={L.arguments} collapseAfter={14} />;
}

/** An object of strings, numbers and booleans, edited as a form; anything else is edited as JSON. */
function isFlatRecord(value: unknown): value is Record<string, string | number | boolean> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length > 0 &&
    entries.length <= 12 &&
    entries.every(([, v]) => typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean')
  );
}

const sameValue = (a: unknown, b: unknown) => safeStringify(a) === safeStringify(b);

const field =
  'border-signoff-border-strong bg-signoff-bg text-signoff-fg placeholder:text-signoff-fg-subtle focus-visible:outline-signoff-ring w-full rounded-lg border px-3 py-2 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-0';

/** The arguments, editable: a field per argument for a flat object, JSON for anything else. */
function ArgumentsEditor({
  original,
  value,
  onChange,
  idPrefix,
  L,
}: {
  original: unknown;
  value: EditorValue;
  onChange: (value: EditorValue) => void;
  idPrefix: string;
  L: SignoffLabels['approvalCard'];
}) {
  if (value.kind === 'form') {
    const record = value.record;
    return (
      <fieldset className="flex flex-col gap-2.5">
        <legend className="text-signoff-fg-muted mb-1 text-xs font-medium">{L.arguments}</legend>
        {Object.entries(record).map(([key, v]) => {
          const id = `${idPrefix}-arg-${key}`;
          const kind = typeof (original as Record<string, unknown>)[key];
          if (kind === 'boolean') {
            return (
              <label key={key} htmlFor={id} className="text-signoff-fg flex items-center gap-2 text-[13px]">
                <input
                  id={id}
                  type="checkbox"
                  checked={v === true}
                  onChange={(e) => onChange({ kind: 'form', record: { ...record, [key]: e.target.checked } })}
                  className="accent-signoff-accent focus-visible:outline-signoff-ring size-3.5 focus-visible:outline-2 focus-visible:outline-offset-2"
                />
                <span className="font-signoff-mono">{key}</span>
              </label>
            );
          }
          const text = String(v);
          const long = kind === 'string' && (text.includes('\n') || text.length > 80);
          return (
            <div key={key} className="flex flex-col gap-1">
              <label htmlFor={id} className="font-signoff-mono text-signoff-fg-muted text-[11px]">
                {key}
              </label>
              {long ? (
                <textarea
                  id={id}
                  rows={3}
                  value={text}
                  onChange={(e) => onChange({ kind: 'form', record: { ...record, [key]: e.target.value } })}
                  className={cn(field, 'font-signoff-mono resize-y')}
                />
              ) : (
                <input
                  id={id}
                  type={kind === 'number' ? 'number' : 'text'}
                  value={text}
                  onChange={(e) =>
                    onChange({
                      kind: 'form',
                      record: { ...record, [key]: kind === 'number' ? Number(e.target.value) : e.target.value },
                    })
                  }
                  className={cn(field, 'font-signoff-mono')}
                />
              )}
            </div>
          );
        })}
      </fieldset>
    );
  }
  const errorId = `${idPrefix}-json-error`;
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={`${idPrefix}-json`} className="text-signoff-fg-muted text-xs font-medium">
        {L.argumentsJson}
      </label>
      <textarea
        id={`${idPrefix}-json`}
        rows={Math.min(14, Math.max(4, value.text.split('\n').length))}
        value={value.text}
        spellCheck={false}
        aria-invalid={value.error ? true : undefined}
        aria-describedby={value.error ? errorId : undefined}
        onChange={(e) => onChange(parseJson(e.target.value))}
        className={cn(field, 'font-signoff-mono resize-y text-xs leading-5')}
      />
      {value.error && (
        <p id={errorId} className="text-signoff-hot-fg text-xs">
          {L.notValidJson(value.error)}
        </p>
      )}
    </div>
  );
}

type EditorValue =
  | { kind: 'form'; record: Record<string, string | number | boolean> }
  | { kind: 'json'; text: string; parsed?: unknown; error?: string | undefined };

function parseJson(text: string): EditorValue {
  try {
    return { kind: 'json', text, parsed: JSON.parse(text) as unknown };
  } catch (error) {
    return { kind: 'json', text, error: error instanceof Error ? error.message : String(error) };
  }
}

function editorFor(input: unknown): EditorValue {
  return isFlatRecord(input) ? { kind: 'form', record: { ...input } } : parseJson(safeStringify(input ?? {}));
}

/** The editor's arguments, or `undefined` while the JSON does not parse. */
function editorInput(value: EditorValue): { ok: true; input: unknown } | { ok: false } {
  if (value.kind === 'form') return { ok: true, input: value.record };
  return value.error ? { ok: false } : { ok: true, input: value.parsed };
}

/** How long a decision stays in the live region: long enough to be read, then gone from the card. */
const ANNOUNCEMENT_MS = 3000;

/** A pending card with `globalShortcut`: its element, and what it does when a newer card joins. */
interface GlobalCard {
  ref: RefObject<HTMLElement | null>;
  displaced: () => void;
}

/**
 * The pending cards with `globalShortcut`, oldest first. ⌘/Ctrl+Enter outside them answers only
 * the last, the latest to ask (the last of parallel calls), not each card or the first to mount.
 */
const globalCards: GlobalCard[] = [];

/**
 * What a critical action's first press armed. It holds until the second press, Escape, or focus
 * or a click going outside `ref`'s element, with no timer to beat: the person confirms at their
 * own pace, after a screen reader has read the request (WCAG 2.2.1). It belongs to the `call` it
 * was armed on, so new arguments, or new calls waiting, start disarmed.
 */
function useArmed<T>(ref: RefObject<HTMLElement | null>, call: unknown) {
  const [armed, setArmed] = useState<{ value: T; call: unknown }>();
  const stale = armed !== undefined && !sameValue(armed.call, call);
  // Adjusting state during render, not in an effect, as for a stale edit.
  if (stale) setArmed(undefined);
  // The same function on every render, so an effect can hold it without running again.
  const disarm = useCallback(() => setArmed(undefined), []);
  useEffect(() => {
    if (armed === undefined) return;
    const element = ref.current;
    // Anywhere on the page, as ⌘/Ctrl+Enter may have armed it from there; not an Escape a field or
    // a menu took for itself, such as the one that closes the reason field.
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape' && !event.defaultPrevented) disarm();
    };
    // Focus moving between the element's own controls keeps it.
    const onFocusOut = (event: globalThis.FocusEvent) => {
      if (!element?.contains(event.relatedTarget as Node | null)) disarm();
    };
    // Armed by ⌘/Ctrl+Enter from outside, focus was never in here to leave: focus or a click going
    // anywhere else ends it, so typing in a composer and sending doesn't leave one press to go.
    // The click is for Safari, where a click on a button doesn't focus it. The path, not the
    // target, as the target out here of a card in a shadow root is its host.
    const onOutside = (event: Event) => {
      if (!(element && event.composedPath().includes(element))) disarm();
    };
    window.addEventListener('keydown', onKey);
    element?.addEventListener('focusout', onFocusOut);
    // Capturing, so a handler that stops the event on its way doesn't keep the press armed.
    document.addEventListener('focusin', onOutside, true);
    document.addEventListener('pointerdown', onOutside, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      element?.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('focusin', onOutside, true);
      document.removeEventListener('pointerdown', onOutside, true);
    };
  }, [armed, ref, disarm]);
  const arm = (value: T | undefined) => setArmed(value === undefined ? undefined : { value, call });
  return [stale ? undefined : armed?.value, arm, disarm] as const;
}

/** The focused element, inside open shadow roots too: in a web component, the document sees only its host. */
function focusedElement(): Element | null {
  let active = document.activeElement;
  while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;
  return active;
}

/**
 * Human-in-the-loop approval for a pending agent action. Shows what will run,
 * how risky it is, and lets the user approve or deny by mouse or keyboard, once,
 * for the session or always, with the arguments edited first when `editable`.
 * Critical actions require a second confirming press: the first stays armed, with no time limit,
 * until Escape, or focus or a click goes outside the card.
 *
 * The card is a group named by its title, not a landmark, so a run with many approvals doesn't
 * fill landmark navigation; pass `role="region"` to make it one.
 */
export function ApprovalCard({
  toolName,
  title,
  description,
  input,
  risk,
  preview,
  status = 'pending',
  reason,
  automatic = false,
  decision: resolvedDecision,
  decidedByRule,
  decisions: offered = DEFAULT_DECISIONS,
  onDecide,
  onApprove,
  onDeny,
  editable = false,
  ruleArgs,
  ruleScope = true,
  shortcuts = true,
  globalShortcut = false,
  autoFocus = false,
  allowReason = true,
  reasonPlaceholder,
  approveLabel,
  denyLabel,
  headingLevel = 3,
  labels,
  className,
  ...props
}: ApprovalCardProps) {
  const all = useLabels(LABELS, labels);
  const L = all.approvalCard;
  const Heading = `h${headingLevel}` as const;
  const ids = useId();
  const titleId = `${ids}-title`;
  const descId = `${ids}-desc`;
  const hintId = `${ids}-hint`;
  const reasonId = `${ids}-reason`;
  const cardRef = useRef<HTMLElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const [reasonOpen, setReasonOpen] = useState(false);
  const [reasonText, setReasonText] = useState('');
  const [announcement, setAnnouncement] = useState('');
  const [editing, setEditing] = useState(false);
  // The person's edit and the arguments it was made against, kept when the editor closes;
  // `undefined` until they change something.
  const [edit, setEdit] = useState<{ base: unknown; value: EditorValue }>();
  // An edit counts only for the arguments it was made against: new `input` is a new call.
  const stale = edit !== undefined && !sameValue(edit.base, input);
  // It also belongs to the pending period it was made in, so a card that asks again does not carry
  // the last answer's edit. Either drops it, adjusting state during render, not in an effect.
  const [period, setPeriod] = useState(status);
  if (period !== status) {
    setPeriod(status);
    setEdit(undefined);
    setEditing(false);
  } else if (stale) {
    setEdit(undefined);
  }
  const edited = stale ? undefined : edit?.value;
  const editToggleRef = useRef<HTMLButtonElement>(null);
  const pending = status === 'pending';
  const r = risk ? RISK[risk] : UNRATED;
  const heading = title ?? humanizeToolName(toolName);
  const mac = useIsMac();
  const mod = all.common.modKey(mac);
  const has = (d: ApprovalDecision) => offered.includes(d);
  const remembers = ruleScope && (has('allow-session') || has('allow-always') || has('deny-always'));

  // The arguments a decision runs with: the edited ones, once valid and different, editor open or not.
  const editedInput = editable && edited ? editorInput(edited) : undefined;
  const invalid = editedInput?.ok === false;
  const finalInput = editedInput?.ok && !sameValue(editedInput.input, input) ? editedInput.input : undefined;
  // `null` is an edit like any other (JSON edited to `null`), so not `finalInput ?? input`.
  const runInput = finalInput !== undefined ? finalInput : input;
  // A critical press is for the arguments it would approve, in this pending period: new ones from
  // the agent, an edit made after it, or a card that asks again start disarmed.
  const [confirming, setConfirming, disarm] = useArmed<ApprovalDecision>(cardRef, [status, input, runInput]);

  // The rule's scope, suggested from the arguments the call will run with.
  const suggested = useMemo(() => ruleArgs ?? suggestArgs(runInput), [ruleArgs, runInput]);
  const [scope, setScope] = useState<{ any: boolean; args: Record<string, string> } | undefined>();
  const scopeArgs = scope ?? { any: !suggested, args: suggested ?? {} };

  // One decision per pending period, so a double click cannot send two (see `status`).
  const decided = useRef(false);
  useEffect(() => {
    decided.current = false;
  }, [status]);
  const decide = (handler: () => unknown) => {
    decided.current = true;
    let result: unknown;
    try {
      result = handler();
    } catch (error) {
      // A failed handler sent nothing: let the user try again.
      decided.current = false;
      throw error;
    }
    if (isPromiseLike(result)) {
      // Released when it settles either way; a rejection stays unhandled, as it would without the card.
      void Promise.resolve(result).finally(() => {
        decided.current = false;
      });
    }
  };

  const choose = (decision: ApprovalDecision, withReason?: string) => {
    if (!pending || decided.current || !has(decision)) return;
    const approving = decision.startsWith('allow');
    if (approving && invalid) {
      setAnnouncement(L.invalidJson);
      return;
    }
    if (approving && risk === 'critical' && confirming !== decision) {
      setConfirming(decision);
      setAnnouncement(L.critical);
      return;
    }
    setConfirming(undefined);
    setAnnouncement(L.resolved[decision]);
    cardRef.current?.focus();
    const why = withReason?.trim() ? withReason.trim() : undefined;
    const lasting = decision !== 'allow-once' && decision !== 'deny-once';
    const choice: ApprovalChoice = {
      decision,
      ...(why ? { reason: why } : {}),
      ...(approving && finalInput !== undefined ? { input: finalInput } : {}),
      ...(lasting && remembers && !scopeArgs.any ? { args: { ...scopeArgs.args } } : {}),
    };
    decide(() => (onDecide ? onDecide(choice) : approving ? onApprove?.() : onDeny?.(why)));
  };
  const approve = () => choose('allow-once');
  const deny = (withReason?: string) => choose('deny-once', withReason);

  const openReason = () => setReasonOpen(true);
  useEffect(() => {
    if (reasonOpen) reasonRef.current?.focus();
  }, [reasonOpen]);

  // Once read, clear the announcement: left in place, a decided card reads "Approved, Approved".
  useEffect(() => {
    if (!announcement) return;
    const id = setTimeout(() => setAnnouncement(''), ANNOUNCEMENT_MS);
    return () => clearTimeout(id);
  }, [announcement]);

  useEffect(() => {
    // Not out of a text field: the next letter the person types there would land on the card as a shortcut.
    if (autoFocus && pending && !isTypingTarget(focusedElement())) cardRef.current?.focus();
    // Only on mount: re-focusing on every render would steal focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const approveRef = useRef(approve);
  useEffect(() => {
    approveRef.current = approve;
  });
  useEffect(() => {
    if (!globalShortcut || !pending) return;
    const entry: GlobalCard = {
      ref: cardRef,
      // Keys pressed outside the cards are now the new card's. A press they armed here would
      // otherwise wait, out of sight, and the next one, once that card is answered, would confirm
      // it. One armed with focus in here stays: the keys pressed in here are still this card's.
      displaced: () => {
        if (!cardRef.current?.matches(':focus-within')) disarm();
      },
    };
    for (const card of globalCards) card.displaced();
    globalCards.push(entry);
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Enter' && (event.metaKey || event.ctrlKey) && !event.defaultPrevented) {
        const path = event.composedPath();
        // In a text field, the card's own included, ⌘/Ctrl+Enter is the field's: a composer's send.
        // Out here a web component's field shows as its host, so ask the path where the key began.
        if (isTypingTarget(path[0] ?? event.target)) return;
        // One card answers: the one the keys were pressed in (its custom preview, say), else the
        // latest to ask, wherever focus is.
        const owner =
          globalCards.find((card) => card.ref.current && path.includes(card.ref.current)) ?? globalCards.at(-1);
        if (owner !== entry) return;
        event.preventDefault();
        // A held key repeats its keydown: one press, one decision.
        if (!event.repeat) approveRef.current();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      const index = globalCards.indexOf(entry);
      if (index !== -1) globalCards.splice(index, 1);
    };
  }, [globalShortcut, pending, disarm]);

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // Keys on your controls in `preview`, or in a menu it opens in a portal, are theirs.
    if (!pending || fromSlot(event)) return;
    // A held key repeats its keydown, and a repeated Enter clicks the focused button again: one press
    // makes one decision, so holding a key cannot confirm a critical action or answer twice.
    if (event.repeat && event.key === 'Enter' && !isTypingTarget(event.target)) {
      event.preventDefault();
      return;
    }
    if (!shortcuts) return;
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      approve();
      return;
    }
    if (isTypingTarget(event.target) || hasModifier(event)) return;
    const key = event.key.toLowerCase();
    if (event.shiftKey) {
      if (key === 'n' && has('deny-always')) {
        event.preventDefault();
        if (!event.repeat) choose('deny-always', reasonOpen ? reasonText : undefined);
      }
      return;
    }
    const byKey: Record<string, ApprovalDecision> = {
      y: 'allow-once',
      s: 'allow-session',
      a: 'allow-always',
      n: 'deny-once',
    };
    const decision = byKey[key];
    if (decision && has(decision)) {
      event.preventDefault();
      if (!event.repeat) choose(decision);
    }
  };

  const keyHint = L.keyboardHint(
    {
      approve: has('allow-once'),
      session: has('allow-session'),
      always: has('allow-always'),
      deny: has('deny-once'),
      alwaysDeny: has('deny-always'),
    },
    mod,
  );

  const resolvedText = decidedByRule
    ? status === 'approved'
      ? L.allowedByRule
      : L.deniedByRule
    : automatic
      ? status === 'approved'
        ? L.autoApproved
        : L.blockedByPolicy
      : resolvedDecision && resolvedDecision.startsWith(status === 'approved' ? 'allow' : 'deny')
        ? L.resolved[resolvedDecision]
        : status === 'approved'
          ? L.approved
          : L.denied;

  // Four or five choices wrap unevenly in a narrow card, Approve alone on the last row: under 40rem,
  // they form two columns as wide as their labels need, the last taking its row when it would be
  // alone, and one column under 16rem. In the DOM's order, so the tab order is what the eye reads.
  const choiceGroup =
    'flex flex-wrap items-center justify-end gap-2 @max-[40rem]:has-[>:nth-child(4)]:grid @max-[40rem]:has-[>:nth-child(4)]:w-full @max-[40rem]:has-[>:nth-child(4)]:grid-cols-[repeat(2,minmax(min-content,1fr))] @max-[16rem]:has-[>:nth-child(4)]:grid-cols-1 @max-[40rem]:[&>*]:justify-center @max-[40rem]:[&>:last-child:nth-child(odd)]:col-span-full';
  const secondary =
    'border-signoff-border-strong bg-signoff-surface-2 text-signoff-fg hover:border-signoff-fg-subtle hover:bg-signoff-bg focus-visible:outline-signoff-ring inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg border px-3 text-[13px] font-medium whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-60';
  const primary = (armed: boolean) =>
    cn(
      'focus-visible:outline-signoff-ring inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg px-3 text-[13px] font-semibold whitespace-nowrap transition-[background-color,box-shadow] focus-visible:outline-2 focus-visible:outline-offset-2 aria-disabled:cursor-not-allowed aria-disabled:opacity-60',
      armed
        ? 'bg-signoff-hot text-signoff-on-hot hover:bg-signoff-hot/90'
        : 'bg-signoff-accent text-signoff-on-accent hover:bg-signoff-accent/90 shadow-[0_0_0_1px_color-mix(in_oklab,var(--signoff-accent)_40%,transparent),0_6px_20px_-8px_var(--signoff-accent)]',
    );
  const choiceButton = (decision: ApprovalDecision, label: string, className: string) => (
    <button
      key={decision}
      type="button"
      data-slot={SLOT[decision]}
      data-decision={decision}
      aria-keyshortcuts={
        shortcuts
          ? decision === 'allow-once'
            ? `Y ${mac ? 'Meta' : 'Control'}+Enter`
            : CHOICE[decision].keys
          : undefined
      }
      aria-disabled={decision.startsWith('allow') && invalid ? true : undefined}
      onClick={(event) => {
        // The second click of a double click is the same press: it does not confirm a critical action.
        if (event.detail > 1) return;
        choose(decision, decision.startsWith('deny') && reasonOpen ? reasonText : undefined);
      }}
      className={className}
    >
      {confirming === decision ? L.confirm : label}
      {shortcuts && (
        <Kbd
          aria-hidden="true"
          className={decision === 'allow-once' ? 'border-current/25 bg-transparent text-current/80' : undefined}
        >
          {CHOICE[decision].key}
        </Kbd>
      )}
    </button>
  );

  return (
    // Shortcuts are scoped to focus within the card (WCAG 2.1.4); the actions themselves are real buttons.
    <WithLabels labels={labels}>
      <section
        ref={cardRef}
        data-signoff
        data-slot="signoff-approval-card"
        data-status={status}
        data-risk={risk}
        role="group"
        tabIndex={-1}
        aria-labelledby={titleId}
        aria-describedby={
          pending
            ? [description ? descId : '', shortcuts ? hintId : ''].filter(Boolean).join(' ') || undefined
            : undefined
        }
        onKeyDown={onKeyDown}
        className={cn(
          'rounded-signoff bg-signoff-surface font-signoff-sans text-signoff-fg focus-visible:outline-signoff-ring relative overflow-hidden border outline-none focus-visible:outline-2 focus-visible:outline-offset-2',
          pending ? r.card : 'border-signoff-border bg-signoff-surface/60',
          pending && 'motion-safe:animate-signoff-enter',
          className,
        )}
        {...props}
      >
        <LiveRegion>{announcement}</LiveRegion>
        {pending ? (
          <>
            {(risk === 'high' || risk === 'critical') && (
              <div
                aria-hidden="true"
                className="via-signoff-hot h-px w-full bg-gradient-to-r from-transparent to-transparent"
              />
            )}
            <div className="flex flex-col gap-3.5 p-4">
              <div className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', r.icon)}
                >
                  {input && typeof input === 'object' && 'command' in input ? (
                    <TerminalIcon size={16} />
                  ) : (
                    <ShieldIcon size={16} />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-signoff-mono text-signoff-hot-fg pt-0.5 text-[10.5px] font-medium tracking-[0.08em] uppercase">
                      {L.required}
                    </p>
                    {risk && (
                      <span
                        className={cn(
                          'shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap',
                          RISK[risk].badge,
                        )}
                      >
                        {L.risk[risk]}
                      </span>
                    )}
                  </div>
                  <Heading id={titleId} className="text-signoff-fg -mt-0.5 text-[15px] leading-snug font-semibold">
                    {heading}
                  </Heading>
                  {description && (
                    <p id={descId} className="text-signoff-fg-muted mt-1 text-[13px] leading-relaxed">
                      {description}
                    </p>
                  )}
                </div>
              </div>

              {editing ? (
                <ArgumentsEditor
                  original={input}
                  value={edited ?? editorFor(input)}
                  onChange={(value) => setEdit({ base: input, value })}
                  idPrefix={ids}
                  L={L}
                />
              ) : finalInput !== undefined || preview === undefined || preview === null ? (
                // An edit shows as what will run, in place of a custom preview of the agent's arguments.
                <DefaultPreview input={runInput} L={L} />
              ) : (
                <div data-signoff-slot className="contents">
                  {preview}
                </div>
              )}
              {editable && input !== undefined && (
                <div className="-mt-1.5 flex items-center gap-2">
                  <button
                    ref={editToggleRef}
                    type="button"
                    aria-expanded={editing}
                    onClick={() => {
                      // Done editing keeps the edit; JSON that does not parse keeps the editor and its error open.
                      if (editing && invalid) setAnnouncement(L.invalidJson);
                      else setEditing((open) => !open);
                    }}
                    className="text-signoff-fg-muted hover:text-signoff-fg focus-visible:outline-signoff-ring cursor-pointer rounded-md px-1 py-0.5 text-xs underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-1"
                  >
                    {editing ? L.doneEditing : L.editArguments}
                  </button>
                  {(finalInput !== undefined || invalid) && (
                    <button
                      type="button"
                      onClick={() => {
                        setEdit(undefined);
                        // This button goes with the edit: keep focus in the card.
                        editToggleRef.current?.focus();
                      }}
                      className="text-signoff-fg-muted hover:text-signoff-fg focus-visible:outline-signoff-ring cursor-pointer rounded-md px-1 py-0.5 text-xs underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-1"
                    >
                      {L.undoEdits}
                    </button>
                  )}
                  {finalInput !== undefined && <span className="text-signoff-warn-fg text-xs">{L.edited}</span>}
                </div>
              )}

              {remembers && (
                <RuleScope
                  toolName={toolName}
                  scope={scopeArgs}
                  onChange={setScope}
                  idPrefix={ids}
                  // Arguments the call has, to narrow the rule to.
                  available={suggested}
                  L={L}
                />
              )}

              {reasonOpen && (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor={reasonId} className="text-signoff-fg-muted text-xs font-medium">
                    {L.reasonLabel}
                  </label>
                  <textarea
                    ref={reasonRef}
                    id={reasonId}
                    rows={2}
                    value={reasonText}
                    onChange={(e) => setReasonText(e.target.value)}
                    onKeyDown={(e) => {
                      // The Enter that commits an IME composition (Japanese, Chinese, Korean…) is not a submit.
                      if (e.nativeEvent.isComposing || e.keyCode === 229) return;
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        // Not a held Enter's repeat, such as the one that opened this field.
                        if (!e.repeat) deny(reasonText);
                      } else if (e.key === 'Escape') {
                        e.preventDefault();
                        setReasonOpen(false);
                        cardRef.current?.focus();
                      }
                    }}
                    placeholder={reasonPlaceholder ?? L.reasonPlaceholder}
                    className={cn(field, 'resize-none')}
                  />
                </div>
              )}

              <div className="@container flex flex-wrap items-center gap-2">
                {shortcuts && (
                  <p id={hintId} className="text-signoff-fg-subtle mr-auto hidden items-center gap-1.5 text-xs sm:flex">
                    <span className="sr-only">{keyHint}</span>
                    <span aria-hidden="true" className="flex items-center gap-1.5">
                      <Kbd>{mod}</Kbd>
                      <Kbd>↵</Kbd>
                      <span>{L.approveHint}</span>
                    </span>
                  </p>
                )}
                <div className="ml-auto flex flex-wrap items-center justify-end gap-2 @max-[40rem]:has-[>div>:nth-child(4)]:w-full">
                  {allowReason && !reasonOpen && (
                    <button
                      type="button"
                      onClick={openReason}
                      className="text-signoff-fg-muted hover:text-signoff-fg focus-visible:outline-signoff-ring cursor-pointer rounded-md px-2 py-1.5 text-xs underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-1"
                    >
                      {L.denyWithFeedback}
                    </button>
                  )}
                  <div className={choiceGroup}>
                    {has('deny-always') && choiceButton('deny-always', L.alwaysDeny, secondary)}
                    {has('deny-once') &&
                      choiceButton('deny-once', reasonOpen ? L.sendDenial : (denyLabel ?? L.deny), secondary)}
                    {has('allow-session') &&
                      choiceButton(
                        'allow-session',
                        L.session,
                        confirming === 'allow-session' ? primary(true) : secondary,
                      )}
                    {has('allow-always') &&
                      choiceButton('allow-always', L.always, confirming === 'allow-always' ? primary(true) : secondary)}
                    {has('allow-once') &&
                      choiceButton('allow-once', approveLabel ?? L.approve, primary(confirming === 'allow-once'))}
                  </div>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 px-3.5 py-2.5 text-[13px]">
            {status === 'approved' ? (
              <CheckIcon size={15} className="text-signoff-accent-fg shrink-0" />
            ) : (
              <BanIcon size={15} className="text-signoff-hot-fg shrink-0" />
            )}
            <span className="text-signoff-fg font-semibold">{resolvedText}</span>
            <Heading id={titleId} className="text-signoff-fg-muted min-w-0 truncate">
              {heading}
            </Heading>
            {decidedByRule && <span className="text-signoff-fg-subtle min-w-0 truncate">· {decidedByRule}</span>}
            {reason && <span className="text-signoff-fg-subtle min-w-0 truncate">· {reason}</span>}
          </div>
        )}
      </section>
    </WithLabels>
  );
}

const DEFAULT_DECISIONS: readonly ApprovalDecision[] = ['allow-once', 'deny-once'];

/** Which calls a session or always decision covers: the tool, narrowed to argument patterns or not. */
function RuleScope({
  toolName,
  scope,
  onChange,
  available,
  idPrefix,
  L,
}: {
  toolName: string;
  scope: { any: boolean; args: Record<string, string> };
  onChange: (scope: { any: boolean; args: Record<string, string> }) => void;
  available: Record<string, string> | undefined;
  idPrefix: string;
  L: SignoffLabels['approvalCard'];
}) {
  const names = Object.keys(available ?? scope.args);
  const remembered = L.rememberedFor(scope.any);
  return (
    <fieldset className="border-signoff-border bg-signoff-bg/40 flex flex-col gap-2 rounded-lg border px-3 py-2.5">
      <legend className="sr-only">{L.ruleLegend}</legend>
      <p className="text-signoff-fg-muted text-xs">
        {remembered.before}
        <span className="font-signoff-mono text-signoff-fg">{toolName}</span>
        {remembered.after}
      </p>
      {!scope.any &&
        names.map((name) => {
          const id = `${idPrefix}-rule-${name}`;
          return (
            <div key={name} className="flex items-center gap-2">
              <label htmlFor={id} className="font-signoff-mono text-signoff-fg-muted shrink-0 text-[11px]">
                {L.argumentMatches(name)}
              </label>
              <input
                id={id}
                type="text"
                value={scope.args[name] ?? ''}
                onChange={(e) => onChange({ ...scope, args: { ...scope.args, [name]: e.target.value } })}
                className={cn(field, 'font-signoff-mono py-1 text-xs')}
              />
            </div>
          );
        })}
      {names.length > 0 && (
        <label className="text-signoff-fg-muted flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={scope.any}
            onChange={(e) => onChange({ ...scope, any: e.target.checked })}
            className="accent-signoff-accent focus-visible:outline-signoff-ring size-3.5 focus-visible:outline-2 focus-visible:outline-offset-2"
          />
          {L.anyArguments}
        </label>
      )}
      {!scope.any && <p className="text-signoff-fg-subtle text-[11px]">{L.globHelp}</p>}
    </fieldset>
  );
}

/** The answer to one approval request, as the AI SDK's `addToolApprovalResponse` takes it. */
export interface ToolApprovalResponse {
  /** The approval request's id, `part.approval.id`: not the tool call's id. */
  id: string;
  /** `true` to run the call, `false` to deny it. */
  approved: boolean;
  /** The reason given with the decision, such as the one the person typed when denying. */
  reason?: string;
}

export interface ToolApprovalCardProps extends Omit<
  ApprovalCardProps,
  | 'toolName'
  | 'input'
  | 'status'
  | 'onApprove'
  | 'onDeny'
  | 'onDecide'
  | 'reason'
  | 'automatic'
  | 'decision'
  | 'decidedByRule'
  | 'decisions'
  | 'editable'
> {
  /**
   * The AI SDK tool part to answer, from `message.parts` (`isToolPart` finds them). The card reads
   * the tool's name, input, approval request and outcome from it, and renders nothing for a part
   * with no approval request.
   */
  part: ToolPart;
  /** Matches `useChat().addToolApprovalResponse`, so you can pass it directly. */
  onRespond: (response: ToolApprovalResponse) => void | PromiseLike<void>;
  /**
   * How to show this tool, as in `AgentMessage`'s `tools`: without `title`, the card takes its
   * `label` (after the part's own `title`), and without `risk`, its `risk`, a level or a function
   * of the input.
   */
  meta?: ToolMeta | undefined;
  /**
   * Approval rules from `useApprovalPolicy`. The card then offers once, this session and always
   * (unless `decisions` says otherwise), answers a request a rule already decides without asking,
   * and records every decision.
   */
  policy?: ApprovalPolicy | undefined;
  /**
   * The choices to offer, from `allow-once`, `allow-session`, `allow-always`, `deny-once` and
   * `deny-always`. Without it, all five with a `policy`, else `allow-once` and `deny-once`.
   */
  decisions?: readonly ApprovalDecision[] | undefined;
  /**
   * Apply edited arguments before the approval goes out; the card offers editing only with it.
   * With AI SDK 7: `(id, input) => setMessages((m) => setToolInput(m, id, input))`. With
   * `useAgUiAgent`: its `editInput`.
   */
  onEditInput?: ((toolCallId: string, input: unknown) => void) | undefined;
  /**
   * Let the person edit the arguments before approving, as on `ApprovalCard`. Only with
   * `onEditInput`, which applies the edit: without it the card never offers editing, and with it
   * `false` turns editing off.
   * @default true
   */
  editable?: boolean;
}

const ALL_DECISIONS: readonly ApprovalDecision[] = [
  'allow-once',
  'allow-session',
  'allow-always',
  'deny-once',
  'deny-always',
];

/** The request a tool part makes, for a policy. */
export function approvalRequestOf(part: ToolPart): ApprovalRequest | undefined {
  if (!part.approval) return undefined;
  return { id: part.approval.id, toolName: getToolPartName(part), input: part.input, toolCallId: part.toolCallId };
}

/**
 * `ApprovalCard` bound to an AI SDK tool part in the approval flow. Renders nothing for parts without
 * one, or while a policy's automatic decision is still arriving: nobody needs to act on it.
 */
export function ToolApprovalCard({
  part,
  onRespond,
  meta,
  risk,
  description,
  title,
  policy,
  onEditInput,
  decisions,
  editable,
  ...props
}: ToolApprovalCardProps) {
  const L = useLabels(LABELS, props.labels).approvalCard;
  const status = getApprovalStatus(part);
  const request = approvalRequestOf(part);
  // A rule decides this request: answer it from the policy, once, without asking anyone.
  const ruled =
    !!policy && status === 'pending' && !!request && !!evaluateRules(policy.rules, request.toolName, request.input);
  const answered = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!ruled || !request || !policy?.ready || answered.current === request.id) return;
    const outcome = policy.answer(request);
    if (!outcome) return;
    answered.current = request.id;
    void onRespond(toResponse(outcome));
  });
  if (!status || !part.approval || !request) return null;
  const automatic = isAutomaticApproval(part.approval);
  if (automatic && status === 'pending') return null;
  if (ruled) return null;
  const approvalId = part.approval.id;
  const resolvedRisk = risk ?? (typeof meta?.risk === 'function' ? meta.risk(part.input) : meta?.risk);
  const outcome = status === 'pending' ? undefined : policy?.outcomeOf(approvalId);
  const send = (choice: ApprovalChoice) => {
    if (choice.input !== undefined) onEditInput?.(part.toolCallId, choice.input);
    // Answered by a person: the rule this decision adds must not answer it again while it reads pending.
    answered.current = approvalId;
    if (policy) {
      const recorded = policy.decide(request, choice.decision, {
        reason: choice.reason,
        input: choice.input,
        args: choice.args,
      });
      return onRespond(toResponse(recorded));
    }
    const approved = choice.decision.startsWith('allow');
    return onRespond(
      choice.reason ? { id: approvalId, approved, reason: choice.reason } : { id: approvalId, approved },
    );
  };
  return (
    <ApprovalCard
      toolName={getToolPartName(part)}
      title={title ?? part.title ?? meta?.label}
      description={description ?? getApprovalRequestReason(part.approval)}
      input={part.input}
      risk={resolvedRisk}
      status={status}
      reason={part.approval.reason}
      automatic={automatic}
      decision={outcome?.decision}
      decidedByRule={outcome?.by === 'rule' && outcome.rule ? L.describeRule(outcome.rule) : undefined}
      decisions={decisions ?? (policy ? ALL_DECISIONS : undefined)}
      // Editing only where an edit can be applied: never silently dropped on the way to the agent.
      editable={!!onEditInput && (editable ?? true)}
      onDecide={send}
      {...props}
    />
  );
}

function toResponse(outcome: ApprovalOutcome): ToolApprovalResponse {
  return outcome.reason
    ? { id: outcome.id, approved: outcome.approved, reason: outcome.reason }
    : { id: outcome.id, approved: outcome.approved };
}

export interface ToolApprovalBatchProps extends Omit<ComponentPropsWithoutRef<'div'>, 'children'> {
  /** Tool parts; those waiting on a person count. */
  parts: readonly ToolPart[];
  /**
   * Called once for each waiting call when Approve all or Deny all answers them. Matches
   * `useChat().addToolApprovalResponse`, so you can pass it directly.
   */
  onRespond: (response: ToolApprovalResponse) => void | PromiseLike<void>;
  /**
   * Approval rules from `useApprovalPolicy`, the ones the cards get: a call a rule decides isn't
   * waiting on a person, and each answer is recorded as a once decision.
   */
  policy?: ApprovalPolicy | undefined;
  /**
   * The tools' `ToolMeta`, by tool name, as in `AgentMessage`'s `tools`. Their `risk` counts: with a
   * critical call waiting, Approve all asks for a second press.
   */
  tools?: Record<string, ToolMeta> | undefined;
  /**
   * Shown from this many waiting approvals.
   * @default 2
   */
  min?: number;
  /** Words to use instead of the English defaults: see `SignoffLabelsProvider`. */
  labels?: SignoffLabelsInput | undefined;
}

/**
 * "Approve all" and "Deny all" for the approvals a run is waiting on together, such as parallel
 * calls. Each is answered once, as Approve or Deny on its own card would; with a critical one among
 * them, Approve all asks for a second press. Approve all runs each call with the agent's arguments:
 * it does not see an edit made on a card (`editable`), so approve an edited call on its own card.
 */
export function ToolApprovalBatch({
  parts,
  onRespond,
  policy,
  tools,
  min = 2,
  labels,
  className,
  ...props
}: ToolApprovalBatchProps) {
  const B = useLabels(LABELS, labels).approvalCard.batch;
  const [announcement, setAnnouncement] = useState('');
  const groupRef = useRef<HTMLDivElement>(null);
  const waiting = parts.filter((part) => {
    const request = approvalRequestOf(part);
    return (
      request &&
      getApprovalStatus(part) === 'pending' &&
      !isAutomaticApproval(part.approval) &&
      !(policy && evaluateRules(policy.rules, request.toolName, request.input))
    );
  });
  // Armed for these calls and their arguments: one more arriving, one answered on its card, or new
  // arguments need a new first press.
  const [confirming, setConfirming] = useArmed<true>(
    groupRef,
    waiting.map((part) => [part.toolCallId, part.input]),
  );
  if (waiting.length < min) return null;
  // A held Enter clicks the focused button on every repeat: one press, one answer.
  const ignoreRepeat = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.repeat && event.key === 'Enter') event.preventDefault();
  };
  const critical = waiting.some((part) => {
    const meta = tools?.[getToolPartName(part)];
    return (typeof meta?.risk === 'function' ? meta.risk(part.input) : meta?.risk) === 'critical';
  });
  const answerAll = (decision: 'allow-once' | 'deny-once') => {
    if (decision === 'allow-once' && critical && !confirming) {
      setConfirming(true);
      setAnnouncement(B.critical);
      return;
    }
    setConfirming(undefined);
    for (const part of waiting) {
      const request = approvalRequestOf(part)!;
      const outcome = policy?.decide(request, decision);
      void onRespond(outcome ? toResponse(outcome) : { id: request.id, approved: decision === 'allow-once' });
    }
    setAnnouncement(B.answered(waiting.length, decision === 'allow-once'));
  };
  // The second click of a double click is the same press: it does not confirm Approve all.
  const press = (decision: 'allow-once' | 'deny-once') => (event: MouseEvent) => {
    if (event.detail <= 1) answerAll(decision);
  };
  return (
    <div
      ref={groupRef}
      data-signoff
      data-slot="signoff-approval-batch"
      role="group"
      // A click focuses the group where it doesn't focus the button (Safari), so focus leaving it
      // can disarm Approve all there too. Not in the tab order: its buttons are.
      tabIndex={-1}
      aria-label={B.group}
      className={cn(
        'rounded-signoff border-signoff-warn/40 bg-signoff-surface font-signoff-sans text-signoff-fg flex flex-wrap items-center gap-x-3 gap-y-2 border px-3.5 py-2.5 text-[13px] outline-none',
        className,
      )}
      {...props}
    >
      <LiveRegion>{announcement}</LiveRegion>
      <ShieldIcon size={15} className="text-signoff-warn-fg shrink-0" />
      <span className="text-signoff-fg font-medium">{B.waiting(waiting.length)}</span>
      <span className="ml-auto flex items-center gap-2">
        <button
          type="button"
          onKeyDown={ignoreRepeat}
          onClick={press('deny-once')}
          className="border-signoff-border-strong text-signoff-fg hover:bg-signoff-surface-2 focus-visible:outline-signoff-ring inline-flex h-7 cursor-pointer items-center rounded-lg border px-2.5 text-xs font-medium focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {B.denyAll}
        </button>
        <button
          type="button"
          onKeyDown={ignoreRepeat}
          onClick={press('allow-once')}
          className={cn(
            'focus-visible:outline-signoff-ring inline-flex h-7 cursor-pointer items-center rounded-lg px-2.5 text-xs font-semibold focus-visible:outline-2 focus-visible:outline-offset-2',
            confirming
              ? 'bg-signoff-hot text-signoff-on-hot hover:bg-signoff-hot/90'
              : 'bg-signoff-accent text-signoff-on-accent hover:bg-signoff-accent/90',
          )}
        >
          {confirming ? B.confirm : B.approveAll}
        </button>
      </span>
    </div>
  );
}
