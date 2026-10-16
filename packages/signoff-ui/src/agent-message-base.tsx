'use client';

import { useMemo, type ComponentPropsWithoutRef, type ReactNode } from 'react';
import {
  ToolApprovalBatch,
  ToolApprovalCard,
  type ApprovalCardProps,
  type ToolApprovalResponse,
} from './approval-card';
import {
  getAllToolParts,
  getSourceParts,
  getToolPartName,
  isSubagentPart,
  isToolPart,
  type AnyUIPart,
  type ToolPart,
  type UIMessage,
} from './lib/ai';
import { useToolTimings, type ToolTimings } from './lib/hooks';
import { FileIcon, ImageIcon } from './lib/icons';
import { getImagePolicy, isAllowedImage, type ImagePolicy } from './lib/images';
import { Img } from './lib/primitives';
import { safeUrl } from './lib/untrusted';
import { cn } from './lib/utils';
import { CustomMarkdown, useMarkdownRenderer, type BuiltInMarkdown, type MarkdownRenderer } from './markdown-renderer';
import type { ApprovalPolicy } from './use-approval-policy';
import { agentMessageLabels, commonLabels, type SignoffLabelsInput } from './lib/labels';
import { useLabels, WithLabels } from './labels';
import { ReasoningBase } from './reasoning-base';
import { Sources } from './sources';
import { ToolCallTimeline, type ToolMeta } from './tool-call-timeline';

/** The labels' sections this module reads. */
const LABELS = { agentMessage: agentMessageLabels, common: commonLabels };

type DataPart = Extract<AnyUIPart, { type: `data-${string}` }>;
type FilePart = Extract<AnyUIPart, { type: 'file' }>;

export interface AgentMessageProps extends Omit<ComponentPropsWithoutRef<'article'>, 'children'> {
  message: Pick<UIMessage, 'id' | 'role' | 'parts'>;
  /** The message is still being generated. Text parts with an explicit `state` take precedence. */
  streaming?: boolean;
  /**
   * Whether the run can still make progress, including while it waits on the user. Default `true`.
   * Pass `false` once it has ended (stopped, failed, or an older message): tool calls that never
   * settled read "Stopped" instead of running forever, and text left streaming loses its caret.
   * See `ToolCallTimeline`'s `active`.
   */
  active?: boolean;
  /**
   * The run ended in an error (`useChat`'s `status === 'error'`, or a run restored from history that
   * ended in one). Default `false`. With `active={false}`, approved calls whose result never came back
   * then read "Stopped" too. See `ToolCallTimeline`'s `failed`.
   */
  failed?: boolean;
  tools?: Record<string, ToolMeta> | undefined;
  /**
   * Render a tool part yourself. Return `undefined` to use the default timeline,
   * or `null` to render nothing. Custom-rendered parts split the timeline. What you return is
   * your app's content: it sits in a `data-signoff-slot` element, and `styles.css` leaves it to
   * your CSS (components you render in it are styled as usual).
   */
  renderTool?: ((part: ToolPart) => ReactNode | undefined) | undefined;
  /** Enables inline approval cards. Pass `useChat().addToolApprovalResponse`. */
  onToolApproval?: ((response: ToolApprovalResponse) => void | PromiseLike<void>) | undefined;
  /** Props forwarded to every approval card, e.g. `{ autoFocus: true }`. */
  approvalProps?: Partial<Omit<ApprovalCardProps, 'toolName' | 'status' | 'onApprove' | 'onDeny'>> | undefined;
  /**
   * Approval rules from `useApprovalPolicy`: cards offer once, this session and always, a rule's
   * decisions are made without asking, and two or more waiting approvals get "Approve all".
   */
  approvalPolicy?: ApprovalPolicy | undefined;
  /**
   * Lets a person edit a call's arguments before approving it, and applies the edit. With AI SDK 7:
   * `(id, input) => setMessages((m) => setToolInput(m, id, input))`; with `useAgUiAgent`, its `editInput`.
   */
  onToolInputEdit?: ((toolCallId: string, input: unknown) => void) | undefined;
  /**
   * Render `data-*` parts. They are skipped when omitted. Your content, like `renderTool`'s. A
   * sub-agent's part (`data-signoff-subagent`) is not one of them: the timeline nests its calls.
   */
  renderData?: ((part: DataPart) => ReactNode) | undefined;
  /**
   * Renders the text parts and the reasoning instead of the built-in `Markdown`, with Streamdown
   * or your own renderer. What it returns is your content, like `renderTool`'s. Overrides
   * `MarkdownRendererProvider`. Import `AgentMessage` from `signoff-ui/custom-markdown` to leave
   * react-markdown out of your bundle. Keep the function stable: a new one renders every text part again.
   * `allowedImageHosts` is not enforced for it: restrict images in your renderer.
   */
  renderMarkdown?: MarkdownRenderer | undefined;
  showSources?: boolean;
  sourcesVariant?: 'chips' | 'cards';
  /**
   * Where images in text, reasoning and image file parts may load from: host names,
   * `'self'` for relative URLs, or `'*'` for every image. Default: none, so other images render
   * as links. File parts with `data:` and `blob:` URLs always preview. See
   * `MarkdownProps.allowedImageHosts`.
   */
  allowedImageHosts?: readonly string[] | undefined;
  /** Externally measured tool timings. Measured client-side when omitted. */
  timings?: ToolTimings | undefined;
  /** Words to use instead of the English defaults, for the message and all it renders: see `SignoffLabelsProvider`. */
  labels?: SignoffLabelsInput | undefined;
}

type Segment =
  | { kind: 'text'; key: string; text: string; streaming: boolean }
  | { kind: 'reasoning'; key: string; text: string; streaming: boolean }
  | { kind: 'tools'; key: string; parts: AnyUIPart[] }
  | { kind: 'node'; key: string; node: ReactNode }
  | { kind: 'file'; key: string; part: FilePart };

/** `AgentMessage`, with the renderer it falls back to: `Markdown`, or plain text in `signoff-ui/custom-markdown`. */
export function AgentMessageBase({
  builtInMarkdown: BuiltIn,
  message,
  streaming = false,
  active = true,
  failed = false,
  tools,
  renderTool,
  onToolApproval,
  approvalProps,
  approvalPolicy,
  onToolInputEdit,
  renderData,
  renderMarkdown,
  showSources = true,
  sourcesVariant = 'chips',
  allowedImageHosts,
  timings: timingsProp,
  labels,
  className,
  ...props
}: AgentMessageProps & { builtInMarkdown: BuiltInMarkdown }) {
  const parts = message.parts;
  const renderer = useMarkdownRenderer(renderMarkdown);
  const measured = useToolTimings(parts);
  const timings = timingsProp ?? measured;
  const sources = useMemo(() => (showSources ? getSourceParts(parts) : []), [parts, showSources]);
  const sourcePrefix = `${message.id}-source`;
  const imagePolicy = useMemo(() => getImagePolicy(allowedImageHosts), [allowedImageHosts]);

  const segments = useMemo(() => {
    const out: Segment[] = [];
    const lastIndex = parts.length - 1;
    // Text a stopped run left streaming (`stop()` sends no end) is no longer being written.
    const isStreaming = (part: { state?: 'streaming' | 'done' | undefined }, i: number) =>
      active && (part.state ? part.state === 'streaming' : streaming && i === lastIndex);
    parts.forEach((part, i) => {
      const key = `${i}`;
      if (part.type === 'text') {
        if (!part.text) return;
        out.push({ kind: 'text', key, text: part.text, streaming: isStreaming(part, i) });
      } else if (part.type === 'reasoning') {
        if (!part.text && part.state !== 'streaming') return;
        out.push({ kind: 'reasoning', key, text: part.text, streaming: isStreaming(part, i) });
      } else if (isToolPart(part) || isSubagentPart(part)) {
        const custom = isToolPart(part) ? renderTool?.(part) : undefined;
        if (custom !== undefined) {
          out.push({ kind: 'node', key: (part as ToolPart).toolCallId, node: custom });
          return;
        }
        // A sub-agent joins the calls before it, where the one that started it is.
        const prev = out.at(-1);
        if (prev?.kind === 'tools') prev.parts.push(part);
        else
          out.push({
            kind: 'tools',
            key: isToolPart(part) ? part.toolCallId : `subagent:${part.data.subagentRunId}`,
            parts: [part],
          });
      } else if (part.type === 'file') {
        out.push({ kind: 'file', key, part });
      } else if (part.type.startsWith('data-')) {
        // Data part ids are unique per type only (the SDK reconciles parts by type and id).
        const id = (part as DataPart).id;
        if (renderData)
          out.push({
            kind: 'node',
            key: id === undefined ? key : `${part.type}:${id}`,
            node: renderData(part as DataPart),
          });
      }
    });
    return out;
  }, [parts, streaming, active, renderTool, renderData]);

  return (
    <WithLabels labels={labels}>
      <article
        data-signoff
        data-slot="signoff-agent-message"
        data-role={message.role}
        aria-busy={streaming || undefined}
        className={cn('font-signoff-sans text-signoff-fg flex min-w-0 flex-col gap-3', className)}
        {...props}
      >
        {onToolApproval && (
          <ToolApprovalBatch
            parts={getAllToolParts(parts)}
            onRespond={onToolApproval}
            policy={approvalPolicy}
            tools={tools}
          />
        )}
        {segments.map((segment) => {
          switch (segment.kind) {
            case 'text':
              return renderer ? (
                <CustomMarkdown
                  key={segment.key}
                  render={renderer}
                  streaming={segment.streaming}
                  citations={sources.length}
                  citationPrefix={sourcePrefix}
                  allowedImageHosts={allowedImageHosts}
                >
                  {segment.text}
                </CustomMarkdown>
              ) : (
                <BuiltIn
                  key={segment.key}
                  streaming={segment.streaming}
                  citations={sources.length}
                  citationPrefix={sourcePrefix}
                  allowedImageHosts={allowedImageHosts}
                >
                  {segment.text}
                </BuiltIn>
              );
            case 'reasoning':
              return (
                <ReasoningBase
                  key={segment.key}
                  text={segment.text}
                  streaming={segment.streaming}
                  allowedImageHosts={allowedImageHosts}
                  renderMarkdown={renderer}
                  builtInMarkdown={BuiltIn}
                />
              );
            case 'tools':
              return (
                <ToolCallTimeline
                  key={segment.key}
                  parts={segment.parts}
                  tools={tools}
                  timings={timings}
                  active={active}
                  failed={failed}
                  renderExtra={
                    onToolApproval
                      ? (part) =>
                          part.approval ? (
                            <ToolApprovalCard
                              part={part}
                              onRespond={onToolApproval}
                              meta={tools?.[getToolPartName(part)]}
                              policy={approvalPolicy}
                              onEditInput={onToolInputEdit}
                              {...approvalProps}
                            />
                          ) : null
                      : undefined
                  }
                />
              );
            case 'file':
              return <FileAttachment key={segment.key} part={segment.part} imagePolicy={imagePolicy} />;
            case 'node':
              return (
                <div key={segment.key} data-signoff-slot>
                  {segment.node}
                </div>
              );
          }
        })}
        {sources.length > 0 && (
          <Sources sources={sources} variant={sourcesVariant} idPrefix={sourcePrefix} className="mt-1" />
        )}
      </article>
    </WithLabels>
  );
}

/** Inline content (`data:`) and local objects (`blob:`) need no request; other URLs follow the policy. */
const canPreview = (url: string, policy: ImagePolicy) => /^(data|blob):/i.test(url) || isAllowedImage(url, policy);

function FileAttachment({ part, imagePolicy }: { part: FilePart; imagePolicy: ImagePolicy }) {
  const L = useLabels(LABELS);
  const name = part.filename ?? part.mediaType;
  const image = part.mediaType.startsWith('image');
  // A URL a link may not use (`javascript:`) is neither linked nor loaded: the file shows as its name.
  const url = safeUrl(part.url, { files: true });
  if (image && url && canPreview(url, imagePolicy)) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="focus-visible:outline-signoff-ring block w-fit rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        <Img
          src={url}
          alt={part.filename ?? L.agentMessage.attachedImage}
          className="border-signoff-border max-h-64 rounded-lg border"
        />
      </a>
    );
  }
  const Icon = image ? ImageIcon : FileIcon;
  if (!url) {
    return (
      <span className="border-signoff-border bg-signoff-surface text-signoff-fg inline-flex w-fit items-center gap-2 rounded-lg border px-3 py-2 text-[13px]">
        <Icon size={14} className="text-signoff-fg-subtle" />
        {name}
      </span>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="border-signoff-border bg-signoff-surface text-signoff-fg hover:bg-signoff-surface-2 focus-visible:outline-signoff-ring inline-flex w-fit items-center gap-2 rounded-lg border px-3 py-2 text-[13px] focus-visible:outline-2 focus-visible:outline-offset-2"
    >
      <Icon size={14} className="text-signoff-fg-subtle" />
      {name}
      <span className="sr-only">{L.common.opensInNewTab}</span>
    </a>
  );
}
