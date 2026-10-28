/**
 * Agent Client Protocol (ACP) to the components: a prompt turn's `session/update` notifications and
 * `session/request_permission` requests folded into one AI SDK `UIMessage` for `AgentMessage` and
 * `ToolCallTimeline`, and a tool call's diff content as `DiffReview` files. The types mirror the parts
 * of ACP that are read here, structurally, so `@agentclientprotocol/sdk` objects fit without it being
 * a dependency. The AI SDK types come from ./ai-types, so the entry needs no `ai` either. The
 * permission converters (`decisionsFromAcpOptions`, `toAcpPermissionResponse`…) are in lib/policy.ts.
 */
import type { ChatStatus, DynamicToolUIPart, UIMessage } from './ai-types';
import type { FileChange } from './diff';
import {
  acpToolName,
  type AcpPermissionOption,
  type AcpRequestPermissionRequest,
  type ApprovalDecision,
} from './policy';

/** An ACP `ContentBlock`. Text is read; images, audio and resources are left out of the message. */
export interface AcpContentBlock {
  type: string;
  text?: string;
}

/** ACP `ToolCallContent`: content, a diff, or a terminal. */
export type AcpToolCallContent =
  | { type: 'content'; content: AcpContentBlock }
  | { type: 'diff'; path: string; oldText?: string | null | undefined; newText: string }
  | { type: 'terminal'; terminalId: string };

/** ACP `ToolCallStatus`. */
export type AcpToolCallStatus = 'pending' | 'in_progress' | 'completed' | 'failed';

/** An ACP `ToolCall`, or a `ToolCallUpdate` (every field but the id optional, `null` for unchanged). */
export interface AcpToolCall {
  toolCallId: string;
  /** What the tool is doing, for people: "Edit lib/format.ts". */
  title?: string | null | undefined;
  /** The tool's programmatic name, when the agent sends one (ACP 1.8). */
  name?: string | null | undefined;
  /** `read`, `edit`, `delete`, `move`, `search`, `execute`, `think`, `fetch`, `switch_mode` or `other`. */
  kind?: string | null | undefined;
  status?: AcpToolCallStatus | null | undefined;
  content?: readonly AcpToolCallContent[] | null | undefined;
  locations?: readonly { path: string; line?: number | null | undefined }[] | null | undefined;
  rawInput?: unknown;
  rawOutput?: unknown;
}

/** An ACP `SessionUpdate`. Only `sessionUpdate` is required here; each kind's fields are read as needed. */
export interface AcpSessionUpdate {
  sessionUpdate: string;
}

/** The params of an ACP `session/update` notification. */
export interface AcpSessionNotification {
  sessionId: string;
  update: AcpSessionUpdate;
}

/** A permission the agent asked for: the options it offered, and once answered, the decision. */
export interface AcpPermission {
  options: readonly AcpPermissionOption[];
  /** Undefined while nobody has answered; `cancelled` when the request was cancelled. */
  decision?: ApprovalDecision | 'cancelled' | undefined;
}

/** A piece of the agent's reply, in the order it arrived. */
export type AcpTurnItem = { type: 'text' | 'reasoning'; text: string } | { type: 'tool'; toolCallId: string };

/** One prompt turn of an ACP session, from `session/prompt` until its response. */
export interface AcpTurn {
  /** `useChat`-style: `submitted` once the prompt is sent, `streaming` as updates arrive, `ready` once it returns. */
  status: ChatStatus;
  /** Why the turn ended: `end_turn`, `max_tokens`, `max_turn_requests`, `refusal` or `cancelled`. */
  stopReason?: string | undefined;
  /** Why it failed, when `session/prompt` returned an error. */
  error?: { message: string } | undefined;
  items: readonly AcpTurnItem[];
  /** Every tool call with its updates merged in, by id. */
  toolCalls: Readonly<Record<string, AcpToolCall>>;
  /** Permission requests by tool call id. */
  permissions: Readonly<Record<string, AcpPermission>>;
}

/** A turn that has just been prompted. */
export function createAcpTurn(): AcpTurn {
  return { status: 'submitted', items: [], toolCalls: {}, permissions: {} };
}

/** Fields read from updates, all optional so one shape covers every kind. */
type UpdateFields = AcpSessionUpdate & Partial<AcpToolCall> & { content?: unknown };

/**
 * Fold one `session/update` (the notification's params, or its `update`) into the turn. Message and
 * thought chunks append to the reply, tool calls and their updates merge by id; plans, commands, mode
 * and usage updates, and the user's own message chunks, leave it as it was. Pure, for `useReducer` or
 * any store.
 */
export function reduceAcpTurn(turn: AcpTurn, update: AcpSessionNotification | AcpSessionUpdate): AcpTurn {
  const u = ('update' in update ? update.update : update) as UpdateFields;
  switch (u.sessionUpdate) {
    case 'agent_message_chunk':
    case 'agent_thought_chunk': {
      const block = u.content as AcpContentBlock | undefined;
      if (block?.type !== 'text' || !block.text) return streaming(turn);
      const type: 'text' | 'reasoning' = u.sessionUpdate === 'agent_message_chunk' ? 'text' : 'reasoning';
      const last = turn.items.at(-1);
      const items: AcpTurnItem[] =
        last?.type === type
          ? [...turn.items.slice(0, -1), { type, text: last.text + block.text }]
          : [...turn.items, { type, text: block.text }];
      return { ...streaming(turn), items };
    }
    case 'tool_call':
    case 'tool_call_update': {
      if (typeof u.toolCallId !== 'string') return turn;
      return withToolCall(streaming(turn), u as AcpToolCall);
    }
    default:
      return turn;
  }
}

function streaming(turn: AcpTurn): AcpTurn {
  return turn.status === 'streaming' ? turn : { ...turn, status: 'streaming' };
}

/** Merge a tool call or update into the turn: fields that are `null` or missing stay as they were. */
function withToolCall(turn: AcpTurn, call: AcpToolCall): AcpTurn {
  const id = call.toolCallId;
  const merged: AcpToolCall = { ...turn.toolCalls[id], toolCallId: id };
  for (const [key, value] of Object.entries(call))
    if (value != null && key !== 'sessionUpdate') Object.assign(merged, { [key]: value });
  const known = turn.items.some((item) => item.type === 'tool' && item.toolCallId === id);
  return {
    ...turn,
    toolCalls: { ...turn.toolCalls, [id]: merged },
    items: known ? turn.items : [...turn.items, { type: 'tool', toolCallId: id }],
  };
}

/** A `session/request_permission` request: its tool call waits on a person, with the options offered. */
export function requestAcpPermission(turn: AcpTurn, request: AcpRequestPermissionRequest): AcpTurn {
  const next = withToolCall(turn, request.toolCall);
  return {
    ...next,
    permissions: { ...next.permissions, [request.toolCall.toolCallId]: { options: request.options } },
  };
}

/**
 * Record the answer to a tool call's permission request, as the card shows it. Send the agent
 * `toAcpPermissionResponse(decision, options)` as the request's response.
 */
export function answerAcpPermission(
  turn: AcpTurn,
  toolCallId: string,
  decision: ApprovalDecision | 'cancelled',
): AcpTurn {
  const permission = turn.permissions[toolCallId];
  if (!permission) return turn;
  return { ...turn, permissions: { ...turn.permissions, [toolCallId]: { ...permission, decision } } };
}

/** The turn's end: `session/prompt`'s response, or the error it returned. */
export function endAcpTurn(turn: AcpTurn, result: { stopReason: string } | { error: { message: string } }): AcpTurn {
  if ('error' in result) return { ...turn, status: 'error', error: { message: result.error.message } };
  return { ...turn, status: 'ready', stopReason: result.stopReason };
}

type Part = UIMessage['parts'][number];

/**
 * The turn as an assistant `UIMessage`: text and reasoning parts, and a dynamic tool part per call.
 * The last text or reasoning part is `streaming` while the turn runs, and stays so once it is
 * cancelled (`stopReason: 'cancelled'`), cut off.
 * A call waiting on its permission request is `approval-requested`, with the tool call id as the
 * approval id; one denied (or whose request was cancelled) is `output-denied`. The tool's name is
 * its `name`, else its `kind`, else its `title`; the title is the part's `title`.
 */
export function toAcpMessage(turn: AcpTurn, id = 'acp-turn'): UIMessage {
  // The text or reasoning the turn is writing, or was writing when it was cancelled: that stays cut
  // off, as a stopped run's does, so `deriveAgentState` reads `stopped` rather than `done`.
  const open = turn.status === 'submitted' || turn.status === 'streaming' || turn.stopReason === 'cancelled';
  const parts = turn.items.map((item, index): Part => {
    if (item.type !== 'tool') {
      const state = open && index === turn.items.length - 1 ? 'streaming' : 'done';
      return { type: item.type, text: item.text, state };
    }
    return toolPart(turn.toolCalls[item.toolCallId]!, turn.permissions[item.toolCallId]);
  });
  return { id, role: 'assistant', parts };
}

const allows = (decision: ApprovalDecision | 'cancelled' | undefined) => !!decision?.startsWith('allow');

function toolPart(call: AcpToolCall, permission: AcpPermission | undefined): Part {
  const base = {
    type: 'dynamic-tool' as const,
    toolName: acpToolName(call),
    toolCallId: call.toolCallId,
    ...(call.title ? { title: call.title } : {}),
    input: call.rawInput ?? {},
  };
  const decision = permission?.decision;
  const approval = permission && {
    id: call.toolCallId,
    ...(decision === undefined ? {} : { approved: allows(decision) }),
    ...(decision === 'cancelled' ? { reason: 'Cancelled' } : {}),
  };
  // Denied, or the request cancelled: the agent then reports the call failed or cancelled, but it was a no.
  if (approval && decision !== undefined && !allows(decision))
    return { ...base, state: 'output-denied', approval } as Part;
  let part: DynamicToolUIPart;
  if (call.status === 'failed') {
    part = { ...base, state: 'output-error', errorText: contentText(call) ?? 'Failed' };
  } else if (call.status === 'completed') {
    part = { ...base, state: 'output-available', output: call.rawOutput ?? contentText(call) ?? null };
  } else if (approval && decision === undefined) {
    return { ...base, state: 'approval-requested', approval } as Part;
  } else if (approval) {
    return { ...base, state: 'approval-responded', approval } as Part;
  } else {
    return { ...base, state: 'input-available' };
  }
  // A call that ran after its approval keeps it, so the timeline can say it was approved.
  return approval && allows(decision) ? ({ ...part, approval } as Part) : part;
}

/** The text of a tool call's `content` blocks, or `undefined` when it has none. */
function contentText(call: AcpToolCall): string | undefined {
  const text = (call.content ?? [])
    .map((c) => (c.type === 'content' && c.content.type === 'text' ? (c.content.text ?? '') : ''))
    .filter(Boolean)
    .join('\n');
  return text || undefined;
}

/**
 * `root` ending in one `/`, however many it ended in. A loop: a regex for the slashes at the end
 * reads a long run of slashes elsewhere in `root` again from each of them.
 */
function rootPrefix(root: string): string {
  let end = root.length;
  while (end > 0 && root[end - 1] === '/') end--;
  return root.slice(0, end) + '/';
}

/**
 * A tool call's diff content as `DiffReview` files. ACP paths are absolute: pass the session's
 * `cwd` as `root` to show them relative to it. A diff with no `oldText` is a new file.
 */
export function fromAcpDiffs(
  content: readonly AcpToolCallContent[] | null | undefined,
  { root }: { root?: string | undefined } = {},
): FileChange[] {
  const prefix = root ? rootPrefix(root) : undefined;
  return (content ?? []).flatMap((c) =>
    c.type === 'diff'
      ? [
          {
            path: prefix && c.path.startsWith(prefix) ? c.path.slice(prefix.length) : c.path,
            oldContent: c.oldText ?? '',
            newContent: c.newText,
          },
        ]
      : [],
  );
}

/**
 * Files as ACP diff content, `{ type: 'diff', path, oldText, newText }`: a new file has no
 * `oldText`. With `root`, relative paths are made absolute under it.
 */
export function toAcpDiffs(
  files: readonly Pick<FileChange, 'path' | 'oldContent' | 'newContent'>[],
  { root }: { root?: string | undefined } = {},
): Extract<AcpToolCallContent, { type: 'diff' }>[] {
  const prefix = root ? rootPrefix(root) : '';
  return files.map((file) => ({
    type: 'diff',
    path: file.path.startsWith('/') ? file.path : prefix + file.path,
    ...(file.oldContent ? { oldText: file.oldContent } : {}),
    newText: file.newContent ?? '',
  }));
}
