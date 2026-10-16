import { AbstractAgent, EventType, type BaseEvent, type Message, type RunAgentInput } from '@ag-ui/client';
import { Observable } from 'rxjs';

/*
 * A scripted AG-UI agent, so the example runs with no model and no API key. It reads the last
 * message and streams one of these, each call's arguments in chunks, as a model does:
 *
 * - "run the tests": a run_command call, a frontend tool that waits for a person's approval
 * - "add rate limiting": a review_changes call with two files, for review in DiffReview
 * - "deploy": a deploy call the agent runs itself once a person approves it (an AG-UI interrupt)
 * - a tool's result, or the answer to an interrupt: a reply that says what it got
 *
 * Set AGENT_URL to use your own agent instead: app/api/copilotkit/[[...slug]]/route.ts then runs an
 * HttpAgent pointed at it.
 */

/** An event to send, or a pause in milliseconds. */
type Step = BaseEvent | number;

const ROUTE = 'export async function POST(req: Request) {\n  // ...\n}\n';
const LIMITED = [
  "import { ratelimit } from '@/lib/ratelimit';",
  '',
  'export async function POST(req: Request) {',
  "  const { success } = await ratelimit.limit(req.headers.get('x-forwarded-for') ?? 'anonymous');",
  "  if (!success) return new Response('Too many requests', { status: 429 });",
  '  // ...',
  '}',
  '',
].join('\n');
const LIMITER = [
  "import { Ratelimit } from '@upstash/ratelimit';",
  "import { Redis } from '@upstash/redis';",
  '',
  '/** 10 requests per 10 seconds per caller, sliding window. */',
  'export const ratelimit = new Ratelimit({',
  '  redis: Redis.fromEnv(),',
  "  limiter: Ratelimit.slidingWindow(10, '10 s'),",
  '});',
  '',
].join('\n');

const event = (type: EventType, fields: Record<string, unknown> = {}) => ({ type, ...fields }) as BaseEvent;

function text(messageId: string, value: string): Step[] {
  return [
    event(EventType.TEXT_MESSAGE_START, { messageId, role: 'assistant' }),
    ...value.split(/(?<= )/).map((delta) => event(EventType.TEXT_MESSAGE_CONTENT, { messageId, delta })),
    event(EventType.TEXT_MESSAGE_END, { messageId }),
  ];
}

/** A tool call, its arguments streamed in three chunks. */
function call(toolCallId: string, toolCallName: string, args: object, parentMessageId?: string): Step[] {
  const json = JSON.stringify(args);
  const third = Math.ceil(json.length / 3);
  return [
    event(EventType.TOOL_CALL_START, { toolCallId, toolCallName, parentMessageId }),
    ...[0, 1, 2].flatMap((i) => [
      120,
      event(EventType.TOOL_CALL_ARGS, { toolCallId, delta: json.slice(i * third, (i + 1) * third) }),
    ]),
    event(EventType.TOOL_CALL_END, { toolCallId }),
  ];
}

function parse(content: unknown) {
  try {
    return typeof content === 'string' ? (JSON.parse(content) as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/** The name of the call a tool message answers. */
function toolNameOf(messages: Message[], toolCallId: string) {
  for (const message of messages)
    if (message.role === 'assistant')
      for (const toolCall of message.toolCalls ?? []) if (toolCall.id === toolCallId) return toolCall.function.name;
  return undefined;
}

function plan({ runId, messages, tools, resume }: RunAgentInput): { steps: Step[]; outcome?: unknown } {
  const id = (name: string) => `${name}-${runId}`;
  const last = messages.at(-1);

  // The answer to the deploy interrupt: deploy, then tell the team if the run offers a way to.
  const answer = resume?.[0];
  if (answer) {
    const toolCallId = answer.interruptId.replace(/^approve-/, '');
    const payload = (answer.payload ?? {}) as { approved?: boolean; reason?: string };
    const approved = answer.status === 'resolved' && payload.approved === true;
    const url = 'https://my-app.example.com';
    const steps: Step[] = [300];
    // The call's result. CopilotKit's useInterrupt adds the answer as the call's tool message before it
    // resumes; useAgUiAgent leaves the result to the agent.
    if (!messages.some((m) => m.role === 'tool' && m.toolCallId === toolCallId))
      steps.push(
        event(EventType.TOOL_CALL_RESULT, {
          messageId: id('result'),
          toolCallId,
          content: JSON.stringify(approved ? { url } : { deployed: false }),
        }),
      );
    if (!approved) steps.push(...text(id('reply'), `Not deploying${payload.reason ? `: ${payload.reason}` : '.'}`));
    // A frontend tool reaches the agent only in the run's `tools`: a resume that left them out can't call it.
    else if (tools.some((tool) => tool.name === 'notify'))
      steps.push(...call(id('notify'), 'notify', { channel: '#releases', text: `Deployed to ${url}` }, id('reply')));
    else steps.push(...text(id('reply'), `Deployed to ${url}.`));
    return { steps };
  }

  // A frontend tool's result: say what came back.
  if (last?.role === 'tool') {
    const result = parse(last.content);
    switch (toolNameOf(messages, last.toolCallId)) {
      case 'run_command':
        return {
          steps: text(
            id('reply'),
            result?.approved
              ? 'Ran npm test: 42 tests passed.'
              : `Not running it${typeof result?.reason === 'string' ? `: ${result.reason}` : '.'}`,
          ),
        };
      case 'review_changes':
        return { steps: text(id('reply'), `Your review: ${String(result?.summary ?? last.content)}`) };
      case 'notify':
        return { steps: text(id('reply'), `Deployed to https://my-app.example.com. ${last.content}.`) };
    }
  }

  const said = typeof last?.content === 'string' ? last.content.toLowerCase() : '';
  if (said.includes('deploy')) {
    const toolCallId = id('deploy');
    return {
      steps: [
        ...text(id('text'), 'Deploying to production needs your approval.'),
        ...call(toolCallId, 'deploy', { environment: 'production' }, id('text')),
      ],
      outcome: {
        type: 'interrupt',
        interrupts: [
          { id: `approve-${toolCallId}`, reason: 'tool_call', toolCallId, message: 'Deploy to production?' },
        ],
      },
    };
  }
  if (said.includes('rate limit'))
    return {
      steps: call(id('review'), 'review_changes', {
        files: [
          { path: 'app/api/chat/route.ts', oldContent: ROUTE, newContent: LIMITED },
          { path: 'lib/ratelimit.ts', newContent: LIMITER },
        ],
      }),
    };
  if (said.includes('test')) return { steps: call(id('command'), 'run_command', { command: 'npm test' }) };
  return { steps: text(id('reply'), 'Ask me to run the tests, add rate limiting, or deploy.') };
}

export class ScriptedAgent extends AbstractAgent {
  run(input: RunAgentInput): Observable<BaseEvent> {
    return new Observable<BaseEvent>((subscriber) => {
      let stopped = false;
      const { threadId, runId } = input;
      void (async () => {
        const { steps, outcome } = plan(input);
        subscriber.next(event(EventType.RUN_STARTED, { threadId, runId }));
        for (const step of steps) {
          if (stopped) return;
          if (typeof step === 'number') await new Promise((resolve) => setTimeout(resolve, step));
          else subscriber.next(step);
        }
        subscriber.next(event(EventType.RUN_FINISHED, { threadId, runId, ...(outcome ? { outcome } : {}) }));
        subscriber.complete();
      })().catch((error: unknown) => subscriber.error(error));
      return () => {
        stopped = true;
      };
    });
  }
}
