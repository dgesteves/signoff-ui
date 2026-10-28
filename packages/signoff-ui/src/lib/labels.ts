/**
 * Every word the components show or announce, in one object: pass a translation of it to
 * `SignoffLabelsProvider`, or part of one to a component's `labels`. Strings are fixed text;
 * functions build text from values (counts, names, line numbers), so a translation can get its
 * plurals and word order right. The English here is the default.
 */
import { formatCost, formatDuration, formatDurationLong, formatTokens } from './format';

/*
 * The states the labels name, spelled out here so this module imports nothing but the formatters:
 * a copied registry item that only shows sources does not need the diff engine. They are the same
 * unions as `AgentState`, `ToolPhase`, `FileStatus`, `HunkDecision` and `ApprovalDecision`, which
 * test/labels-types.test.ts checks.
 */
type AgentState = 'idle' | 'thinking' | 'working' | 'awaiting-approval' | 'done' | 'stopped' | 'error';
type ToolPhase = 'streaming' | 'running' | 'awaiting-approval' | 'success' | 'error' | 'denied';
type FileStatus = 'added' | 'deleted' | 'modified' | 'renamed';
type HunkDecision = 'pending' | 'accepted' | 'rejected';
type ApprovalDecision = 'allow-once' | 'allow-session' | 'allow-always' | 'deny-once' | 'deny-always';
type CommentSide = 'new' | 'old';

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

/** A rule, as its description needs it: the tool and the argument patterns. */
export interface RuleLabel {
  tool: string;
  args?: Readonly<Record<string, string>> | undefined;
}

/** Where a comment is, as its description needs it. */
export interface CommentLabel {
  target: 'lines' | 'hunk' | 'file';
  side?: CommentSide | undefined;
  startLine?: number | undefined;
  endLine?: number | undefined;
}

/** Which choices an approval card offers, for its keyboard hint. */
export interface OfferedChoices {
  approve: boolean;
  session: boolean;
  always: boolean;
  deny: boolean;
  alwaysDeny: boolean;
}

/** Lines of a hunk, as a range in one of the files. */
export interface RangeLabel {
  side: CommentSide;
  startLine: number;
  endLine: number;
}

export interface SignoffLabels {
  /** How values read. Swap these for your locale's number formats. */
  format: {
    /** "120ms", "1.20s", "2m 05s". */
    duration: (ms: number | undefined | null) => string;
    /** For screen readers: "1.2 seconds". */
    durationLong: (ms: number | undefined | null) => string;
    /** "980", "1.20k", "1.25M". */
    tokens: (n: number | undefined | null) => string;
    /** "$0.0123". */
    cost: (usd: number | undefined | null) => string;
    /** "42%", from a fraction. */
    percent: (fraction: number) => string;
  };
  common: {
    /** A copy button's name for a moment after it copied. */
    copied: string;
    /** A copy button for something named: "Copy arguments". */
    copyThe: (what: string) => string;
    showAllLines: (count: number) => string;
    showLess: string;
    /** After a link that opens a new tab, for screen readers. */
    opensInNewTab: string;
    /** The modifier key as printed on the keyboard: ⌘ on a Mac, Ctrl elsewhere. */
    modKey: (mac: boolean) => string;
  };
  agentStatus: {
    states: Record<AgentState, string>;
    /** What a pill says along with its state and detail, for screen readers. */
    spoken: (state: string, detail: string | undefined) => string;
    /** `deriveAgentState`'s detail while the model writes. */
    writingResponse: string;
  };
  toolCallTimeline: {
    list: string;
    phases: Record<ToolPhase, string>;
    stopped: string;
    finished: (name: string, durationLong: string) => string;
    failed: (name: string, error: string | undefined) => string;
    blockedByPolicy: (name: string) => string;
    denied: (name: string) => string;
    input: string;
    inputStreaming: string;
    output: string;
    outputPartial: string;
    error: string;
    deniedBy: (automatic: boolean) => string;
    waitingForInput: string;
    /** A sub-agent nested under the call that started it. */
    subagent: {
      /** Its name, when the agent gave none. */
      name: string;
      /** How many tool calls it made. */
      calls: (count: number) => string;
      /** The name of the list of its calls. */
      list: (name: string) => string;
      /** Paused until a later run (AG-UI's `suspended`). */
      paused: string;
    };
  };
  approvalCard: {
    required: string;
    risk: Record<RiskLevel, string>;
    /** What a pending card's preview of a command is called, while it scrolls sideways. */
    command: string;
    arguments: string;
    approve: string;
    session: string;
    always: string;
    deny: string;
    alwaysDeny: string;
    sendDenial: string;
    confirm: string;
    denyWithFeedback: string;
    reasonLabel: string;
    reasonPlaceholder: string;
    approveHint: string;
    keyboardHint: (offered: OfferedChoices, mod: string) => string;
    /**
     * What a pending card says after its reason, for screen readers: the risk, what will run (the
     * arguments' `command` and `cwd`, or else their first names and values), and the calls a
     * lasting decision covers, as `describeRule` words them. Each is `undefined` or empty when the
     * card has none.
     */
    summary: (card: {
      risk: string | undefined;
      command: string | undefined;
      cwd: string | undefined;
      args: readonly (readonly [name: string, value: string])[];
      rule: string | undefined;
    }) => string;
    /** What a resolved card says of a person's decision. */
    resolved: Record<ApprovalDecision, string>;
    /** A lasting decision, announced with the calls its rule covers: `resolved`'s text and `describeRule`'s. */
    resolvedFor: (resolved: string, rule: string) => string;
    approved: string;
    denied: string;
    autoApproved: string;
    blockedByPolicy: string;
    allowedByRule: string;
    deniedByRule: string;
    /** A rule in words: "run_command with command npm test*". */
    describeRule: (rule: RuleLabel) => string;
    critical: string;
    /** Announced when a critical action's first press is let go: Escape, or focus going elsewhere. */
    confirmCancelled: string;
    invalidJson: string;
    editArguments: string;
    doneEditing: string;
    undoEdits: string;
    edited: string;
    argumentsJson: string;
    notValidJson: (error: string) => string;
    ruleLegend: string;
    /** Around the tool's name: "Remembered for ", run_command, " calls where:". */
    rememberedFor: (anyArguments: boolean) => { before: string; after: string };
    argumentMatches: (name: string) => string;
    anyArguments: string;
    globHelp: string;
    batch: {
      group: string;
      waiting: (count: number) => string;
      approveAll: string;
      denyAll: string;
      confirm: string;
      critical: string;
      answered: (count: number, approved: boolean) => string;
    };
  };
  diffReview: {
    title: string;
    layout: string;
    views: { unified: string; split: string };
    files: (count: number) => string;
    hunks: (count: number, comparing: boolean) => string;
    status: Record<FileStatus, { letter: string; name: string }>;
    navigator: string;
    /** A file in the navigator, after its path, for screen readers. */
    navigatorState: (decided: number, total: number, viewed: boolean) => string;
    comparingShort: string;
    /** Between a renamed file's old and new path, for screen readers (the screen shows an arrow). */
    renamedTo: string;
    toggleFile: (collapsed: boolean, path: string) => string;
    viewed: string;
    rejectFile: string;
    acceptFile: string;
    comparing: string;
    fallback: string;
    noChanges: string;
    /** A whole file, decided as one: what the card in its place says. */
    wholeFile: (status: FileStatus, binary: boolean, oldPath: string | undefined) => string;
    accept: string;
    reject: string;
    /** "hunk 2" or "change 5", in the decision buttons' names. */
    itemName: (kind: 'hunk' | 'file', n: number) => string;
    acceptItem: (item: string) => string;
    rejectItem: (item: string) => string;
    resetItem: (item: string) => string;
    commentOn: (what: string) => string;
    /** The badge on a decided hunk. */
    badge: Record<Exclude<HunkDecision, 'pending'>, string>;
    /** A hunk's name: where it is and how it was decided. */
    hunk: (n: number, total: number, path: string, from: number, to: number, decision: HunkDecision) => string;
    /** A whole-file item's name; `what` is `describeFile`'s. */
    fileItem: (n: number, total: number, path: string, what: string, decision: HunkDecision) => string;
    describeFile: (status: FileStatus, binary: boolean, oldPath: string | undefined) => string;
    hunkCode: (n: number, path: string) => string;
    added: string;
    removed: string;
    decided: (kind: 'hunk' | 'file', n: number, total: number, decision: HunkDecision, remaining: number) => string;
    decidedAll: (total: number, decision: Exclude<HunkDecision, 'pending'>) => string;
    decidedFile: (count: number, path: string, decision: Exclude<HunkDecision, 'pending'>) => string;
    viewedAnnouncement: (path: string, viewed: number, total: number) => string;
    notViewedAnnouncement: (path: string) => string;
    lines: (range: RangeLabel) => string;
    selected: (line: string, range: RangeLabel) => string;
    where: (comment: CommentLabel) => string;
    /** Over a comment: what it is on, and before that, for screen readers only, what it is. */
    commentHeading: (where: string) => { hidden: string; visible: string };
    commentField: (where: string) => string;
    commentPlaceholder: string;
    editComment: (where: string) => string;
    deleteComment: (where: string) => string;
    edit: string;
    delete: string;
    cancel: string;
    saveComment: string;
    addComment: string;
    commentAdded: (where: string, path: string) => string;
    commentUpdated: string;
    commentDeleted: string;
    unchangedLines: (count: number) => string;
    /** The gap buttons: what shows, then what only screen readers hear after it. */
    moreAfter: (count: number, hunk: number) => { visible: string; hidden: string };
    moreBefore: (count: number, hunk: number) => { visible: string; hidden: string };
    showAll: (count: number) => { visible: string; hidden: string };
    expanded: (count: number) => string;
    /** After "3/5". */
    reviewed: string;
    filesViewed: (viewed: number, total: number) => string;
    comments: (count: number) => string;
    comparingFiles: string;
    skipped: string;
    apply: (accepted: number, total: number) => string;
    /** Announced when the review is sent: items accepted of all, and the comments sent with them. */
    submitted: (accepted: number, total: number, comments: number) => string;
    acceptAll: string;
    rejectAll: string;
    keyHints: { move: string; accept: string; reject: string; comment: string; apply: string };
    keyboardHelp: (mod: string) => string;
  };
  markdown: {
    code: (language: string | undefined) => string;
    /** The badge on a code block with no language. */
    codeBadge: string;
    copyCode: string;
    table: string;
    image: string;
    imageFallback: string;
    citation: (n: number | string) => string;
    /** The name of a task list's checkbox (`- [x] done`), read with its state. */
    task: string;
  };
  reasoning: {
    thinking: string;
    thoughtFor: (duration: string) => string;
    reasoning: string;
  };
  runMeter: {
    title: string;
    metrics: (live: boolean) => string;
    summary: (values: {
      input: string;
      output: string;
      cost: string | undefined;
      ttft: string | undefined;
      total: string | undefined;
    }) => string;
    inputTokens: string;
    outputTokens: string;
    estimatedCost: string;
    timeToFirstToken: string;
    totalTime: string;
    ttft: string;
    live: string;
    tokens: string;
    estCost: string;
    breakdown: string;
    split: (input: string, output: string) => string;
    input: string;
    output: string;
    cached: (n: string) => string;
    reasoningTokens: (n: string) => string;
    total: string;
    cacheHit: string;
    costSplit: (input: string, output: string) => string;
    rates: (input: number, output: number) => string;
  };
  approvalPolicy: {
    /** The reason a deny rule sends the agent when it has none of its own; resolved cards show it. */
    ruleDenial: string;
  };
  sources: { label: string; document: string };
  agentMessage: { attachedImage: string };
  /** The marks on text from the agent, where it could read as something it is not. */
  untrusted: {
    /** A mark in place of characters that do not show, such as a bidi control or a zero-width space; `codes` lists each once. */
    invisible: (count: number, codes: readonly string[]) => string;
    /**
     * A mark in place of a long run of spaces and tabs, or of blank lines, in a command or a path:
     * `lines` is how many line breaks a run of blank lines has, which its mark shows, and 0 for spaces.
     */
    blank: (count: number, lines: number) => string;
    /** Beside a link whose text names another host than the one it goes to. */
    linksTo: (host: string) => string;
  };
}

const plural = (n: number, one: string, many = `${one}s`) => (n === 1 ? one : many);

const lines = (range: RangeLabel) =>
  `${range.startLine === range.endLine ? `line ${range.startLine}` : `lines ${range.startLine} to ${range.endLine}`}${range.side === 'old' ? ' of the original' : ''}`;

const DECISION: Record<HunkDecision, string> = { pending: 'not reviewed', accepted: 'accepted', rejected: 'rejected' };

/*
 * Each section on its own, so a component's bundle keeps the sections it reads and no others.
 */
export const formatLabels: SignoffLabels['format'] = {
  duration: formatDuration,
  durationLong: formatDurationLong,
  tokens: formatTokens,
  cost: formatCost,
  percent: (fraction) => `${Math.round(fraction * 100)}%`,
};

export const commonLabels: SignoffLabels['common'] = {
  copied: 'Copied',
  copyThe: (what) => `Copy ${what.toLowerCase()}`,
  showAllLines: (count) => `Show all ${count} lines`,
  showLess: 'Show less',
  opensInNewTab: '(opens in a new tab)',
  modKey: (mac) => (mac ? '⌘' : 'Ctrl'),
};

export const agentStatusLabels: SignoffLabels['agentStatus'] = {
  states: {
    idle: 'Idle',
    thinking: 'Thinking',
    working: 'Working',
    'awaiting-approval': 'Waiting for approval',
    done: 'Done',
    stopped: 'Stopped',
    error: 'Error',
  },
  spoken: (state, detail) => (detail ? `${state}: ${detail}` : state),
  writingResponse: 'Writing response',
};

export const toolCallTimelineLabels: SignoffLabels['toolCallTimeline'] = {
  list: 'Tool calls',
  phases: {
    streaming: 'Preparing',
    running: 'Running',
    'awaiting-approval': 'Needs approval',
    success: 'Done',
    error: 'Failed',
    denied: 'Denied',
  },
  stopped: 'Stopped',
  finished: (name, duration) => `${name} finished in ${duration}`,
  failed: (name, error) => `${name} failed: ${error ?? 'unknown error'}`,
  blockedByPolicy: (name) => `${name} was blocked by policy`,
  denied: (name) => `${name} was denied`,
  input: 'Input',
  inputStreaming: 'Input (streaming)',
  output: 'Output',
  outputPartial: 'Output (partial)',
  error: 'Error',
  deniedBy: (automatic) => (automatic ? 'Blocked by policy' : 'Denied by user'),
  waitingForInput: 'Waiting for input…',
  subagent: {
    name: 'Sub-agent',
    calls: (count) => `${count} ${count === 1 ? 'call' : 'calls'}`,
    list: (name) => `${name}’s tool calls`,
    paused: 'Paused',
  },
};

export const approvalCardLabels: SignoffLabels['approvalCard'] = {
  required: 'Approval required',
  risk: { low: 'Low risk', medium: 'Medium risk', high: 'High risk', critical: 'Critical' },
  command: 'Command',
  arguments: 'Arguments',
  approve: 'Approve',
  session: 'For this session',
  always: 'Always',
  deny: 'Deny',
  alwaysDeny: 'Always deny',
  sendDenial: 'Send denial',
  confirm: 'Confirm approval',
  denyWithFeedback: 'Deny with feedback',
  reasonLabel: 'Tell the agent why (optional)',
  reasonPlaceholder: 'What should the agent do instead?',
  approveHint: 'approve',
  keyboardHint: (offered, mod) =>
    `Keyboard: press ${[
      offered.approve && 'Y to approve',
      offered.session && 'S to approve for this session',
      offered.always && 'A to always approve',
      offered.deny && 'N to deny',
      offered.alwaysDeny && 'Shift N to always deny',
    ]
      .filter(Boolean)
      .join(', ')}, or ${mod} Enter to approve.`,
  summary: ({ risk, command, cwd, args, rule }) =>
    [
      risk && `${risk}.`,
      command !== undefined
        ? `Runs ${command}${cwd ? ` in ${cwd}` : ''}.`
        : args.length > 0 && `Arguments: ${args.map((arg) => arg.join(' ')).join(', ')}.`,
      rule && `A lasting decision covers ${rule}.`,
    ]
      .filter(Boolean)
      .join(' '),
  resolved: {
    'allow-once': 'Approved',
    'allow-session': 'Approved for this session',
    'allow-always': 'Always approved',
    'deny-once': 'Denied',
    'deny-always': 'Always denied',
  },
  resolvedFor: (resolved, rule) => `${resolved}: ${rule}.`,
  approved: 'Approved',
  denied: 'Denied',
  autoApproved: 'Auto-approved',
  blockedByPolicy: 'Blocked by policy',
  allowedByRule: 'Allowed by your rule',
  deniedByRule: 'Denied by your rule',
  describeRule: (rule) => {
    const args = Object.entries(rule.args ?? {});
    const tool = rule.tool === '*' ? 'any tool' : rule.tool.replace(/\\(.)/g, '$1');
    return args.length === 0
      ? `${tool}, any arguments`
      : `${tool} with ${args.map(([name, pattern]) => `${name} ${pattern}`).join(', ')}`;
  },
  critical: 'Critical action. Press approve again to confirm.',
  confirmCancelled: 'Confirmation cancelled.',
  invalidJson: 'The arguments are not valid JSON.',
  editArguments: 'Edit arguments',
  doneEditing: 'Done editing',
  undoEdits: 'Undo edits',
  edited: 'Edited: approving runs the new arguments.',
  argumentsJson: 'Arguments, as JSON',
  notValidJson: (error) => `Not valid JSON: ${error}`,
  ruleLegend: 'Calls a lasting decision covers',
  rememberedFor: (any) => ({ before: 'Remembered for ', after: any ? ' with any arguments.' : ' calls where:' }),
  argumentMatches: (name) => `${name} matches`,
  anyArguments: 'Any arguments',
  globHelp: '* matches any text but shell operators (; & | > < and backticks); ** matches anything.',
  batch: {
    group: 'Approvals waiting',
    waiting: (count) => `${count} approvals are waiting.`,
    approveAll: 'Approve all',
    denyAll: 'Deny all',
    confirm: 'Confirm approve all',
    critical: 'One of them is critical. Press Approve all again to confirm.',
    answered: (count, approved) => `${count} approvals ${approved ? 'approved' : 'denied'}.`,
  },
};

export const diffReviewLabels: SignoffLabels['diffReview'] = {
  title: 'Review changes',
  layout: 'Diff layout',
  views: { unified: 'Unified', split: 'Split' },
  files: (count) => `${count} ${plural(count, 'file')}`,
  hunks: (count, comparing) => `${count} ${plural(count, 'hunk')}${comparing ? ' so far' : ''}`,
  status: {
    modified: { letter: 'M', name: 'Modified' },
    added: { letter: 'A', name: 'Added' },
    deleted: { letter: 'D', name: 'Deleted' },
    renamed: { letter: 'R', name: 'Renamed' },
  },
  navigator: 'Files in this review',
  navigatorState: (decided, total, viewed) => `, ${decided} of ${total} decided${viewed ? ', viewed' : ''}`,
  comparingShort: 'comparing…',
  renamedTo: 'to',
  toggleFile: (collapsed, path) => `${collapsed ? 'Show' : 'Hide'} ${path}`,
  viewed: 'Viewed',
  rejectFile: 'Reject file',
  acceptFile: 'Accept file',
  comparing: 'Comparing changes…',
  fallback: 'Too many changes to compare line by line: the changed lines are shown as one hunk that replaces them.',
  noChanges: 'No textual changes.',
  wholeFile: (status, binary, oldPath) =>
    binary
      ? 'Binary file, not shown.'
      : status === 'renamed'
        ? `Renamed from ${oldPath}, without changes.`
        : status === 'deleted'
          ? 'Empty file, deleted.'
          : 'New empty file.',
  accept: 'Accept',
  reject: 'Reject',
  itemName: (kind, n) => `${kind === 'hunk' ? 'hunk' : 'change'} ${n}`,
  acceptItem: (item) => `Accept ${item}`,
  rejectItem: (item) => `Reject ${item}`,
  resetItem: (item) => `Reset ${item}`,
  commentOn: (what) => `Comment on ${what}`,
  badge: { accepted: 'accepted', rejected: 'rejected' },
  hunk: (n, total, path, from, to, decision) =>
    `Hunk ${n} of ${total}, ${path}, lines ${from} to ${to}, ${DECISION[decision]}`,
  fileItem: (n, total, path, what, decision) => `Change ${n} of ${total}, ${path}, ${what}, ${DECISION[decision]}`,
  describeFile: (status, binary, oldPath) =>
    binary
      ? 'binary file'
      : status === 'renamed'
        ? `renamed from ${oldPath}`
        : status === 'deleted'
          ? 'deleted empty file'
          : 'new empty file',
  hunkCode: (n, path) => `Hunk ${n} code, ${path}`,
  added: 'Added: ',
  removed: 'Removed: ',
  decided: (kind, n, total, decision, remaining) =>
    `${kind === 'hunk' ? 'Hunk' : 'Change'} ${n} of ${total} ${decision === 'pending' ? 'reset' : decision}. ${
      remaining === 0 ? 'All hunks reviewed.' : `${remaining} remaining.`
    }`,
  decidedAll: (total, decision) => `All ${total} hunks ${decision}.`,
  decidedFile: (count, path, decision) => `${count === 1 ? 'The hunk' : `All ${count} hunks`} in ${path} ${decision}.`,
  viewedAnnouncement: (path, viewed, total) => `${path} viewed. ${viewed} of ${total} files viewed.`,
  notViewedAnnouncement: (path) => `${path} no longer viewed.`,
  lines,
  selected: (line, range) => {
    const text = lines(range);
    return `${line}. ${text.charAt(0).toUpperCase()}${text.slice(1)} selected.`;
  },
  where: (comment) =>
    comment.target === 'file'
      ? 'the file'
      : comment.target === 'hunk'
        ? 'the hunk'
        : lines({ side: 'new', startLine: comment.startLine ?? 0, endLine: comment.endLine ?? 0 }),
  commentHeading: (where) => ({ hidden: 'Comment ', visible: `On ${where}` }),
  commentField: (where) => `Comment on ${where}, for the agent`,
  commentPlaceholder: 'What should change here?',
  editComment: (where) => `Edit comment on ${where}`,
  deleteComment: (where) => `Delete comment on ${where}`,
  edit: 'Edit',
  delete: 'Delete',
  cancel: 'Cancel',
  saveComment: 'Save comment',
  addComment: 'Comment',
  commentAdded: (where, path) => `Comment added on ${where} of ${path}.`,
  commentUpdated: 'Comment updated.',
  commentDeleted: 'Comment deleted.',
  unchangedLines: (count) => `${count} unchanged ${plural(count, 'line')}`,
  moreAfter: (count, hunk) => ({
    visible: `${count} more`,
    hidden: ` unchanged ${plural(count, 'line')} after hunk ${hunk}`,
  }),
  moreBefore: (count, hunk) => ({
    visible: `${count} more`,
    hidden: ` unchanged ${plural(count, 'line')} before hunk ${hunk}`,
  }),
  showAll: (count) => ({ visible: 'Show all', hidden: ` ${count} unchanged ${plural(count, 'line')}` }),
  expanded: (count) => `Showing ${count} more unchanged ${plural(count, 'line')}.`,
  reviewed: 'reviewed',
  filesViewed: (viewed, total) => `${viewed} of ${total} files viewed`,
  comments: (count) => `${count} ${plural(count, 'comment')}`,
  comparingFiles: 'comparing files…',
  skipped: 'unreviewed hunks are skipped',
  apply: (accepted, total) => (accepted > 0 ? `Apply ${accepted} of ${total}` : 'Apply changes'),
  submitted: (accepted, total, comments) =>
    `Review sent: ${accepted} of ${total} accepted${comments > 0 ? `, ${comments} ${plural(comments, 'comment')}` : ''}.`,
  acceptAll: 'Accept all',
  rejectAll: 'Reject all',
  keyHints: { move: 'move', accept: 'accept', reject: 'reject', comment: 'comment', apply: 'apply' },
  keyboardHelp: (mod) =>
    `Keyboard: J or K to move between hunks, Shift J or Shift K between files, A to accept, R to reject, U to reset, Alt A or Alt R for the whole file, Shift A or Shift R for every hunk, Shift with the up or down arrow to select lines, C to comment on them or on the hunk, E to show more unchanged lines, V to mark the file viewed, ${mod} Enter to apply.`,
};

export const markdownLabels: SignoffLabels['markdown'] = {
  code: (language) => (language && language !== 'text' ? `Code, ${language}` : 'Code'),
  codeBadge: 'code',
  copyCode: 'Copy code',
  table: 'Table',
  image: 'Image:',
  imageFallback: 'image',
  citation: (n) => `Source ${n}`,
  task: 'Task',
};

export const reasoningLabels: SignoffLabels['reasoning'] = {
  thinking: 'Thinking',
  thoughtFor: (duration) => `Thought for ${duration}`,
  reasoning: 'Reasoning',
};

export const runMeterLabels: SignoffLabels['runMeter'] = {
  title: 'Run',
  metrics: (live) => `Run metrics${live ? ' (live)' : ''}`,
  summary: ({ input, output, cost, ttft, total }) =>
    [
      `${input} input tokens`,
      `${output} output tokens`,
      cost !== undefined ? `estimated cost ${cost}` : undefined,
      ttft !== undefined ? `time to first token ${ttft}` : undefined,
      total !== undefined ? `total ${total}` : undefined,
    ]
      .filter(Boolean)
      .join(', '),
  inputTokens: 'Input tokens',
  outputTokens: 'Output tokens',
  estimatedCost: 'Estimated cost',
  timeToFirstToken: 'Time to first token',
  totalTime: 'Total time',
  ttft: 'TTFT',
  live: 'Live',
  tokens: 'Tokens',
  estCost: 'Est. cost',
  breakdown: 'Token breakdown',
  split: (input, output) => `Input ${input} · Output ${output}`,
  input: 'Input',
  output: 'Output',
  cached: (n) => `(${n} cached)`,
  reasoningTokens: (n) => `(${n} reasoning)`,
  total: 'Total',
  cacheHit: 'Cache hit',
  costSplit: (input, output) => `${input} input · ${output} output`,
  rates: (input, output) => `$${input}/$${output} per 1M`,
};

export const approvalPolicyLabels: SignoffLabels['approvalPolicy'] = { ruleDenial: 'Denied by a rule' };

export const sourcesLabels: SignoffLabels['sources'] = { label: 'Sources', document: 'Document' };

export const agentMessageLabels: SignoffLabels['agentMessage'] = { attachedImage: 'Attached image' };

export const untrustedLabels: SignoffLabels['untrusted'] = {
  invisible: (count, codes) =>
    count === 1 ? `Invisible character ${codes[0]}` : `${count} invisible characters: ${codes.join(', ')}`,
  blank: (count, lines) => (lines ? `${lines} line breaks` : `${count} blank characters`),
  linksTo: (host) => `Links to ${host}`,
};

/** The English labels, as the components read without any. */
export const defaultLabels: SignoffLabels = {
  format: formatLabels,
  common: commonLabels,
  agentStatus: agentStatusLabels,
  toolCallTimeline: toolCallTimelineLabels,
  approvalCard: approvalCardLabels,
  diffReview: diffReviewLabels,
  markdown: markdownLabels,
  reasoning: reasoningLabels,
  runMeter: runMeterLabels,
  approvalPolicy: approvalPolicyLabels,
  sources: sourcesLabels,
  agentMessage: agentMessageLabels,
  untrusted: untrustedLabels,
};

/** A part of the labels: any section, any key, at any depth. */
export type SignoffLabelsInput = {
  [K in keyof SignoffLabels]?: DeepPartial<SignoffLabels[K]>;
};

type DeepPartial<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends object
    ? { [K in keyof T]?: DeepPartial<T[K]> }
    : T;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Labels with some replaced: plain objects merge key by key, strings and functions replace. */
export function mergeLabels<T extends SignoffLabelsInput>(
  base: T,
  ...overrides: (SignoffLabelsInput | undefined)[]
): T {
  const merge = (a: unknown, b: unknown): unknown => {
    if (b === undefined) return a;
    if (!isRecord(a) || !isRecord(b)) return b;
    const out: Record<string, unknown> = { ...a };
    for (const [key, value] of Object.entries(b)) out[key] = merge(a[key], value);
    return out;
  };
  return overrides.reduce<T>((labels, next) => merge(labels, next) as T, base);
}
