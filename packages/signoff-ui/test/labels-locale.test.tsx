import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UIMessage } from 'ai';
import { useState, type ReactNode } from 'react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AgentMessage } from '../src/agent-message';
import { AgentStatus } from '../src/agent-status';
import { ApprovalCard, ToolApprovalBatch, ToolApprovalCard, type ToolApprovalResponse } from '../src/approval-card';
import { DiffReview } from '../src/diff-review';
import { SignoffLabelsProvider } from '../src/labels';
import type { AgentState, AnyUIPart, ToolPart } from '../src/lib/ai';
import type { ToolTimings } from '../src/lib/hooks';
import { defaultLabels, mergeLabels, type RuleLabel, type SignoffLabels } from '../src/lib/labels';
import { describeRule, type ApprovalDecision } from '../src/lib/policy';
import { JsonView } from '../src/lib/primitives';
import { Markdown } from '../src/markdown';
import { Reasoning } from '../src/reasoning';
import { RunMeter } from '../src/run-meter';
import { Sources } from '../src/sources';
import { ToolCallTimeline } from '../src/tool-call-timeline';
import { useApprovalPolicy } from '../src/use-approval-policy';
import { pt } from './labels-pt';

/*
 * Every label is swapped for a marker with no Latin letters in it ("Ж12Ж"), and every component is
 * rendered through the states it has, with content in Cyrillic. Whatever English is left on the page,
 * in text or in a name, a placeholder or a title, did not come from the labels: the test fails on it.
 * It also fails on a label no state shows, so the scenarios cover them all.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const markers = new Map<string, string>();
const called = new Set<string>();
let next = 0;

function pseudo(value: unknown, path: string): unknown {
  if (typeof value === 'string') {
    const marker = `Ж${++next}Ж`;
    markers.set(marker, path);
    return marker;
  }
  if (typeof value === 'function') {
    const marker = `Ж${++next}Ж`;
    markers.set(marker, path);
    return (...args: unknown[]) => {
      called.add(path);
      const result: unknown = (value as (...a: unknown[]) => unknown)(...args);
      // Markers passed in come back out, so a label given to another one still shows.
      const inner = args.filter((a): a is string => typeof a === 'string' && a.includes('Ж')).join('|');
      const wrap = (r: unknown, part: string): unknown =>
        typeof r === 'string'
          ? `${marker}${part}${inner && `(${inner})`}`
          : isRecord(r)
            ? Object.fromEntries(Object.entries(r).map(([k, v], i) => [k, wrap(v, `${part}${i}`)]))
            : r;
      return wrap(result, '');
    };
  }
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, pseudo(v, path ? `${path}.${k}` : k)]));
  }
  return value;
}

const labels = pseudo(defaultLabels, '') as SignoffLabels;
/** The marker of a string label, or what a function label's text starts with. */
const m = (path: string) => [...markers].find(([, p]) => p === path)![0];
const starts = (path: string) => new RegExp(`^${m(path)}`);

/** Text attributes people read or hear. */
const ATTRIBUTES = [
  'aria-label',
  'aria-description',
  'aria-roledescription',
  'aria-valuetext',
  'title',
  'placeholder',
  'alt',
];
const seen: string[] = [];

/** Everything on the page a person reads or hears, kept for the checks below. */
function collect() {
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) seen.push(node.textContent ?? '');
  for (const el of document.body.querySelectorAll('*'))
    for (const name of ATTRIBUTES) {
      const value = el.getAttribute(name);
      if (value) seen.push(value);
    }
}

const english = () => [...new Set(seen.filter((text) => /[A-Za-z]{2,}/.test(text)))];

const inLabels = (ui: ReactNode) => render(<SignoffLabelsProvider labels={labels}>{ui}</SignoffLabelsProvider>);

// jsdom has no layout: make every element overflow sideways, so scroll regions take their names.
const widths = {
  scroll: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollWidth'),
  client: Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth'),
};
beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'scrollWidth', { configurable: true, get: () => 1000 });
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 100 });
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn(() => Promise.resolve()) },
  });
});
afterAll(() => {
  if (widths.scroll) Object.defineProperty(HTMLElement.prototype, 'scrollWidth', widths.scroll);
  if (widths.client) Object.defineProperty(HTMLElement.prototype, 'clientWidth', widths.client);
});

const wait = (ms: number) => act(() => new Promise<void>((resolve) => setTimeout(resolve, ms)));

const TOOL = 'запуск_команды';
const part = (state: ToolPart['state'], id: string, extra: Record<string, unknown> = {}) =>
  ({ type: `tool-${TOOL}`, toolCallId: id, state, input: { путь: 'файл' }, ...extra }) as ToolPart;

describe('labels: every word comes from them', () => {
  it('AgentStatus, in every state', () => {
    const states: AgentState[] = ['idle', 'thinking', 'working', 'awaiting-approval', 'done', 'stopped', 'error'];
    inLabels(
      <>
        {states.map((state) => (
          <AgentStatus key={state} state={state} detail="подробности" elapsedMs={1500} />
        ))}
      </>,
    );
    collect();
  });

  it('ToolCallTimeline, through every phase, stopped, and its announcements', async () => {
    const parts = [
      part('input-streaming', 'a', { input: undefined }),
      part('input-streaming', 'b'),
      part('input-available', 'c'),
      part('approval-requested', 'd', { approval: { id: 'ad' } }),
      part('output-available', 'e', { output: { итог: 'да' }, preliminary: true }),
      part('output-available', 'f', { output: { итог: 'да' } }),
      part('output-error', 'g', { errorText: 'ошибка' }),
      part('output-denied', 'h', { approval: { id: 'ah', approved: false, reason: 'нет' } }),
      part('output-denied', 'i', { approval: { id: 'ai', approved: false, isAutomatic: true } }),
    ];
    const ids = parts.map((p) => p.toolCallId);
    const start: ToolTimings = Object.fromEntries(ids.map((id) => [id, { startedAt: 1000, runningAt: 1100 }]));
    const ended: ToolTimings = Object.fromEntries(
      ids.map((id) => [id, { startedAt: 1000, runningAt: 1100, endedAt: 2500 }]),
    );
    const view = (timings: ToolTimings, active = true) => (
      <SignoffLabelsProvider labels={labels}>
        <ToolCallTimeline parts={parts} timings={timings} defaultExpanded={ids} active={active} />
      </SignoffLabelsProvider>
    );
    const { rerender } = render(view(start));
    collect();
    rerender(view(ended));
    await wait(350);
    collect();
    rerender(view(start, false));
    collect();
  });

  it('ToolCallTimeline, with sub-agents unnamed, paused, open and stopped', () => {
    const subagent = (id: string, data: Record<string, unknown>) =>
      ({ type: 'data-signoff-subagent', id, data: { subagentRunId: id, parentToolCallId: 'p', ...data } }) as AnyUIPart;
    const parts = [
      part('input-available', 'p'),
      // Unnamed, open on its call waiting for approval: its list is named.
      subagent('s1', { status: 'running', parts: [part('approval-requested', 'q', { approval: { id: 'aq' } })] }),
      subagent('s2', { name: 'агент', status: 'suspended', parts: [] }),
      subagent('s3', { name: 'агент', status: 'running', parts: [part('output-available', 'r')] }),
    ];
    const view = (active: boolean) => (
      <SignoffLabelsProvider labels={labels}>
        <ToolCallTimeline parts={parts} active={active} />
      </SignoffLabelsProvider>
    );
    const { rerender } = render(view(true));
    collect();
    rerender(view(false));
    collect();
  });

  it('ApprovalCard, pending, edited, denied with a reason, and resolved every way', async () => {
    const user = userEvent.setup();
    const all: ApprovalDecision[] = ['allow-once', 'allow-session', 'allow-always', 'deny-once', 'deny-always'];
    const { unmount } = inLabels(
      <>
        {(['low', 'medium', 'high'] as const).map((risk) => (
          <ApprovalCard key={risk} toolName={TOOL} input={{ путь: 'файл' }} risk={risk} decisions={all} editable />
        ))}
        {/* A zero-width space and a long run of spaces, which show as marks. */}
        <ApprovalCard
          toolName={TOOL}
          input={{ command: `сборка\u200B --всё${' '.repeat(20)}ещё`, cwd: '~/проект' }}
          risk="critical"
        />
        <ApprovalCard toolName={TOOL} input={{ список: [1, 2] }} editable />
      </>,
    );
    collect();
    const [low, medium, , critical, nested] = screen.getAllByRole('group', { name: 'Запуск команды' });
    // A critical action asks again.
    await user.click(within(critical!).getByRole('button', { name: m('approvalCard.approve') }));
    collect();
    // Edited arguments, as a form.
    await user.click(within(low!).getByRole('button', { name: m('approvalCard.editArguments') }));
    await user.type(within(low!).getByRole('textbox', { name: 'путь' }), 'ы');
    collect();
    // Turning the rule's scope to any arguments.
    await user.click(within(low!).getByRole('checkbox', { name: m('approvalCard.anyArguments') }));
    collect();
    // Denied with a reason.
    await user.click(within(low!).getByRole('button', { name: m('approvalCard.denyWithFeedback') }));
    collect();
    // Edited arguments as JSON, invalid, then approved.
    await user.click(within(nested!).getByRole('button', { name: m('approvalCard.editArguments') }));
    await user.type(within(nested!).getByRole('textbox', { name: m('approvalCard.argumentsJson') }), '{{');
    await user.click(within(nested!).getByRole('button', { name: m('approvalCard.approve') }));
    collect();
    // A lasting decision, announced with the calls its rule covers.
    medium!.focus();
    await user.keyboard('s');
    collect();
    unmount();
    inLabels(
      <>
        {all.map((decision) => (
          <ApprovalCard
            key={decision}
            toolName={TOOL}
            status={decision.startsWith('allow') ? 'approved' : 'denied'}
            decision={decision}
          />
        ))}
        <ApprovalCard toolName={TOOL} status="approved" />
        <ApprovalCard toolName={TOOL} status="denied" reason="причина" />
        <ApprovalCard toolName={TOOL} status="approved" automatic />
        <ApprovalCard toolName={TOOL} status="denied" automatic />
        <ApprovalCard toolName={TOOL} status="approved" decidedByRule="правило" />
        <ApprovalCard toolName={TOOL} status="denied" decidedByRule="правило" />
      </>,
    );
    collect();
  });

  it('ToolApprovalBatch, with a critical call among them', async () => {
    const user = userEvent.setup();
    const parts = [
      part('approval-requested', 'x', { approval: { id: 'ax' } }),
      part('approval-requested', 'y', { approval: { id: 'ay' } }),
    ];
    inLabels(<ToolApprovalBatch parts={parts} onRespond={() => {}} tools={{ [TOOL]: { risk: 'critical' } }} />);
    collect();
    await user.click(screen.getByRole('button', { name: m('approvalCard.batch.approveAll') }));
    collect();
    await user.click(screen.getByRole('button', { name: m('approvalCard.batch.confirm') }));
    collect();
  });

  it('a call a deny rule answers, with the rule and its reason', async () => {
    function Run() {
      const policy = useApprovalPolicy({
        defaultRules: [{ id: 'r', tool: TOOL, effect: 'deny', scope: 'always' }],
      });
      const [current, setCurrent] = useState(part('approval-requested', 'z', { approval: { id: 'az' } }));
      const respond = (response: ToolApprovalResponse) =>
        setCurrent((p) => ({ ...p, state: 'output-denied', approval: { ...response } }) as ToolPart);
      return <ToolApprovalCard part={current} onRespond={respond} policy={policy} />;
    }
    inLabels(<Run />);
    await wait(0);
    expect(screen.getByRole('group')).toHaveTextContent(m('approvalCard.deniedByRule'));
    collect();
  });

  it('DiffReview, through a whole review', async () => {
    const user = userEvent.setup();
    const block = (n: number, word: string) =>
      Array.from({ length: n }, (_, i) => `${word} ${'абвгд'.repeat((i % 3) + 1)} ${i}`).join('\n') + '\n';
    const long = block(60, 'строка');
    const changed = long.replace('строка абвгд 0', 'новая абвгд 0').replace('строка абвгдабвгд 55', 'новая 55');
    const files = [
      { path: 'код/главный.ру', oldContent: long, newContent: changed },
      { path: 'код/новый.ру', oldContent: '', newContent: 'один\nдва\n' },
      { path: 'код/старый.ру', oldContent: 'один\nдва\n', newContent: '' },
      { path: 'код/имя.ру', oldPath: 'код/было.ру', oldContent: 'текст\n', newContent: 'текст\n' },
      { path: 'код/картинка.пнг', oldContent: 'ПНГ\u0000а', newContent: 'ПНГ\u0000б' },
      { path: 'код/пустой.ру', oldContent: '', newContent: '' },
      { path: 'код/тот-же.ру', oldContent: 'текст\n', newContent: 'текст\n' },
    ];
    inLabels(
      <DiffReview
        files={files}
        onSubmit={() => {}}
        defaultComments={[
          {
            id: 'c1',
            fileId: 'код/главный.ру',
            path: 'код/главный.ру',
            target: 'lines',
            hunkId: 'код/главный.ру:0',
            side: 'new',
            startLine: 1,
            endLine: 1,
            text: 'замечание',
          },
          {
            id: 'c2',
            fileId: 'код/главный.ру',
            path: 'код/главный.ру',
            target: 'hunk',
            hunkId: 'код/главный.ру:1',
            text: 'ещё',
          },
          { id: 'c3', fileId: 'код/картинка.пнг', path: 'код/картинка.пнг', target: 'file', text: 'файл' },
        ]}
      />,
    );
    collect();
    const items = () =>
      screen.getAllByRole('group', { name: /^Ж/ }).filter((el) => el.dataset.slot === 'signoff-diff-hunk');
    const first = items()[0]!;
    first.focus();
    await user.keyboard('a');
    collect();
    await user.click(within(items()[0]!).getByRole('button', { name: starts('diffReview.resetItem') }));
    items()[1]!.focus();
    await user.keyboard('r');
    items()[2]!.focus();
    await user.keyboard('a');
    collect();
    // Select a line and comment on it.
    items()[0]!.focus();
    await user.keyboard('{Shift>}{ArrowDown}{/Shift}');
    collect();
    await user.keyboard('c');
    collect();
    await user.keyboard('примечание{Control>}{Enter}{/Control}');
    collect();
    // Edit a comment, then delete one.
    await user.click(screen.getAllByRole('button', { name: starts('diffReview.editComment') })[0]!);
    collect();
    await user.keyboard('!{Control>}{Enter}{/Control}');
    collect();
    await user.click(screen.getAllByRole('button', { name: starts('diffReview.deleteComment') })[0]!);
    collect();
    // More unchanged lines.
    await user.click(screen.getAllByRole('button', { name: starts('diffReview.moreAfter'), hidden: true })[0]!);
    collect();
    await user.click(screen.getAllByRole('button', { name: starts('diffReview.showAll'), hidden: true })[0]!);
    collect();
    // A file viewed and not, then a whole file and every hunk decided.
    const viewed = screen.getAllByRole('checkbox', { name: starts('diffReview.viewed') })[1]!;
    await user.click(viewed);
    collect();
    await user.click(viewed);
    collect();
    items()[0]!.focus();
    await user.keyboard('{Alt>}a{/Alt}');
    collect();
    await user.keyboard('{Shift>}a{/Shift}');
    collect();
    await user.click(screen.getByRole('radio', { name: m('diffReview.views.split') }));
    collect();
    // Sent.
    await user.click(screen.getByRole('button', { name: starts('diffReview.apply') }));
    collect();
  });

  it('DiffReview while comparing, and past its edit length', async () => {
    const big = (word: string) => Array.from({ length: 400 }, (_, i) => `${word} ${i}`).join('\n') + '\n';
    const files = [
      { path: 'а.ру', oldContent: big('старое'), newContent: big('новое') },
      { path: 'б.ру', oldContent: 'один\n', newContent: 'два\n' },
    ];
    const { unmount } = inLabels(<DiffReview files={files} diffWorker={false} />);
    collect();
    await wait(50);
    unmount();
    inLabels(<DiffReview files={[files[0]!]} maxEditLength={10} />);
    collect();
  });

  it('Markdown, Reasoning, JsonView, RunMeter, Sources and AgentMessage', async () => {
    const user = userEvent.setup();
    const message = {
      id: 'm',
      role: 'assistant',
      parts: [
        {
          type: 'text',
          text: 'Ответ [1], [пример.рф](https://127.0.0.2/б).\n\n| а | б |\n|---|---|\n| в | г |\n\n```\nкод\n```\n\n- [x] сделано\n- [ ] потом\n\n![картинка](https://127.0.0.1/a.png) ![](https://127.0.0.1/b.png)',
        },
        { type: 'file', mediaType: 'image/png', url: 'data:image/png;base64,iVBORw0KGgo=' },
        { type: 'file', mediaType: 'image/png', url: 'https://127.0.0.1/c.png', filename: 'снимок' },
        { type: 'source-url', sourceId: 's1', url: 'https://127.0.0.1/док', title: 'Источник' },
        { type: 'source-document', sourceId: 's2', mediaType: '', title: 'Документ' },
      ],
    } as unknown as UIMessage;
    inLabels(
      <>
        <AgentMessage message={message} sourcesVariant="cards" />
        <Markdown>{'Текст'}</Markdown>
        <Reasoning text="думаю" streaming />
        <Reasoning text="думал" durationMs={2000} />
        <Reasoning text="думал" />
        <JsonView value={Array.from({ length: 30 }, (_, i) => i)} label="Данные" />
        <RunMeter
          usage={{
            inputTokens: 16_200,
            outputTokens: 2_150,
            inputTokenDetails: { cacheReadTokens: 9_000, noCacheTokens: 7_200 },
            outputTokenDetails: { reasoningTokens: 640 },
          }}
          pricing={{ input: 2.5, output: 10 }}
          ttftMs={420}
          durationMs={3200}
          live
        />
        <RunMeter
          variant="expanded"
          usage={{
            inputTokens: 16_200,
            outputTokens: 2_150,
            inputTokenDetails: { cacheReadTokens: 9_000, noCacheTokens: 7_200 },
            outputTokenDetails: { reasoningTokens: 640 },
          }}
          pricing={{ input: 2.5, output: 10 }}
          ttftMs={420}
          durationMs={3200}
          live
        />
        <Sources sources={[{ id: 'a', title: 'Источник', url: 'https://127.0.0.1/а' }]} />
        <Sources sources={[{ id: 'b', title: 'Файл' }]} variant="cards" />
      </>,
    );
    collect();
    await user.click(screen.getByRole('button', { name: starts('common.showAllLines') }));
    await user.click(screen.getByRole('button', { name: starts('common.copyThe') }));
    collect();
  });

  it('leaves no English on the page', () => {
    expect(seen.length).toBeGreaterThan(100);
    expect(english()).toEqual([]);
  });

  it('shows or says every label in some state', () => {
    const shown = new Set<string>();
    const text = seen.join('\n');
    for (const [marker, path] of markers) if (text.includes(marker) || called.has(path)) shown.add(path);
    // Not a component's: the detail `deriveAgentState` gives, for the app to pass on.
    const elsewhere = ['agentStatus.writingResponse'];
    expect([...markers.values()].filter((path) => !shown.has(path) && !elsewhere.includes(path))).toEqual([]);
  });
});

describe('a translation', () => {
  it('is complete when typed as SignoffLabels, and renders in place of the English', async () => {
    const user = userEvent.setup();
    const files = [{ path: 'src/a.ts', oldContent: 'a\n', newContent: 'b\n' }];
    render(
      <SignoffLabelsProvider labels={pt}>
        <DiffReview files={files} onSubmit={() => {}} />
        <ApprovalCard toolName="run_command" input={{ command: 'npm test' }} risk="high" />
      </SignoffLabelsProvider>,
    );
    expect(screen.getByRole('region', { name: 'Rever alterações' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Aplicar alterações' })).toBeInTheDocument();
    expect(screen.getByText('Risco alto')).toBeInTheDocument();
    screen.getByRole('group', { name: /^Bloco 1 de 1/ }).focus();
    await user.keyboard('a');
    const review = screen.getByRole('region', { name: 'Rever alterações' });
    expect(within(review).getByRole('status')).toHaveTextContent('Bloco 1 de 1 aceite. Todos os blocos revistos.');
  });

  it('can be partial, from a provider or a prop, the nearest winning', () => {
    render(
      <SignoffLabelsProvider labels={{ approvalCard: { approve: 'Freigeben' } }}>
        <SignoffLabelsProvider labels={{ approvalCard: { deny: 'Ablehnen' } }}>
          <ApprovalCard toolName="x" labels={{ approvalCard: { deny: 'Nein' } }} />
          <ApprovalCard toolName="y" />
        </SignoffLabelsProvider>
      </SignoffLabelsProvider>,
    );
    const [x, y] = screen.getAllByRole('group');
    expect(within(x!).getByRole('button', { name: 'Freigeben' })).toBeInTheDocument();
    expect(within(x!).getByRole('button', { name: 'Nein' })).toBeInTheDocument();
    expect(within(y!).getByRole('button', { name: 'Ablehnen' })).toBeInTheDocument();
    // Everything else stays English.
    expect(within(y!).getByText('Approval required')).toBeInTheDocument();
  });

  it('merges key by key, replacing strings and functions whole', () => {
    const merged = mergeLabels(defaultLabels, { diffReview: { files: () => 'files!' } }, undefined, {
      diffReview: { status: { added: { name: 'Neu' } } },
    });
    expect(merged.diffReview.files(2)).toBe('files!');
    expect(merged.diffReview.status.added).toEqual({ letter: 'A', name: 'Neu' });
    expect(merged.diffReview.status.modified).toBe(defaultLabels.diffReview.status.modified);
    expect(merged.approvalCard).toBe(defaultLabels.approvalCard);
    expect(defaultLabels.diffReview.status.added.name).toBe('Added');
  });
});

describe('the English', () => {
  it('describes a rule as describeRule does, which the server side keeps on its own', () => {
    const rules: RuleLabel[] = [
      { tool: '*' },
      { tool: 'run_command', args: { command: 'npm test*' } },
      { tool: 'mcp\\_*', args: { path: 'src/**', mode: 'w' } },
    ];
    for (const rule of rules) expect(defaultLabels.approvalCard.describeRule(rule)).toBe(describeRule(rule));
  });
});

describe('the Portuguese in the docs', () => {
  it('is the one tested here, in the guide and in the gallery', () => {
    const root = join(dirname(fileURLToPath(import.meta.url)), '../../..');
    const body = (code: string) => code.slice(code.indexOf('\n'));
    const tested = body(readFileSync(join(root, 'packages/signoff-ui/test/labels-pt.ts'), 'utf8'));
    const gallery = readFileSync(join(root, 'examples/playground/lib/labels-pt.ts'), 'utf8');
    const guide = readFileSync(join(root, 'examples/playground/content/docs/labels.md'), 'utf8');
    // The fence may say more after its title, such as `collapse`, which folds the block on the site.
    const block = /```ts title="labels-pt.ts"[^\n]*\n([\s\S]*?)```/.exec(guide)?.[1];
    expect(gallery.split('\n')[0]).toBe("import type { SignoffLabels } from 'signoff-ui';");
    expect(body(gallery)).toBe(tested);
    expect(block).toBe(gallery);
  });
});
