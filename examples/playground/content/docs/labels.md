Every word the components show or announce, the visible text and what screen readers hear alike, comes from one object of labels. Translate it once and pass it to `SignoffLabelsProvider`, or pass part of it to a component's `labels` prop. There are 218 of them, 143 fixed strings and 75 functions, in thirteen sections: one per component, one for `useApprovalPolicy`, and three shared ones, `format` for numbers, `common`, and `untrusted` for the marks on text from the agent that could read as something it is not.

## Translate everything

Labels hold functions, which cannot go from a Server Component to a Client Component, so render the provider from a module with `'use client'`, and keep the object stable: at module scope, as here, or memoized.

```tsx title="app/providers.tsx"
'use client';

import type { ReactNode } from 'react';
import { SignoffLabelsProvider } from 'signoff-ui';
import { pt } from './labels-pt';

export function Providers({ children }: { children: ReactNode }) {
  return <SignoffLabelsProvider labels={pt}>{children}</SignoffLabelsProvider>;
}
```

Type the translation as `SignoffLabels`, as the [Portuguese below](/docs/labels#portuguese) is: a label it misses, or one a new release adds, is then a type error rather than English on the page. Set `lang` on the page, or on the element that holds the components when the rest of the page is in another language (`<div lang="pt-PT">`), so screen readers pronounce the words in the right language.

## Change a few words

A partial object is enough: anything it leaves out stays English.

```tsx
<SignoffLabelsProvider labels={{ diffReview: { title: 'Agent changes' }, approvalCard: { approve: 'Run it' } }}>
  <AgentRun />
</SignoffLabelsProvider>

<ApprovalCard {...props} labels={{ approvalCard: { deny: 'Not now' } }} />
```

Providers nest, the inner one winning key by key, and a component's own `labels` win over both, for it and for what it renders: `AgentMessage`'s apply to its timeline, approval cards and markdown too. Props that already took text, such as `title`, `submitLabel`, `approveLabel`, `denyLabel` and `reasonPlaceholder`, still win over the labels. For a hook or markup of your own, `useSignoffLabels()` returns the labels in effect, and `mergeLabels(defaultLabels, ...overrides)` builds the same merged object anywhere, the server included.

## Strings and functions

Fixed text is a string. Text built from values (counts, file paths, line numbers, tool names) is a function, so a translation can get its plurals, its gender agreement and its word order right:

```ts
files: (count) => `${count} ${count === 1 ? 'ficheiro' : 'ficheiros'}`,
decided: (kind, n, total, decision, remaining) => ...,
```

A few return parts, where the components style or hide one of them: `moreAfter`, `moreBefore` and `showAll` return `{ visible, hidden }`, what the button shows and what only screen readers hear after it; `commentHeading` returns `{ hidden, visible }`; `rememberedFor` returns `{ before, after }`, the words around the tool's name. `format` holds how numbers read: durations, the spoken durations of announcements, token counts, cost and percentages. The English ones are fixed and locale-stable; a translation can use `Intl.NumberFormat`, as the Portuguese does.

## What they do not cover

- **Words for the agent.** `reviewToolOutput`'s summary, `toToolApproval`'s reasons and the result objects' fields are read by the model, not by a person, and stay English. Pass `toToolApproval` a `reason` function to word its reasons yourself. A deny rule's reason is the exception, as the approval card shows it: it is `approvalPolicy.ruleDenial`, or the rule's own `reason`.
- **`deriveAgentState`'s detail** while the model writes: pass `writingResponse: labels.agentStatus.writingResponse`, since the helper runs outside any provider.
- **Keys.** J, K, A, R, Y, N and the rest are the same in every language, and so are their `aria-keyshortcuts`. The hints that name them are labels.
- **Your content.** Tool names, titles, descriptions, tool output and what `ToolMeta` renders are yours. A tool's displayed name defaults to its humanized name (`run_command` reads "Run command"), so give `ToolMeta` a `label` in your language.
- **Right-to-left layouts** are not mirrored yet. Code, commands, paths and rule patterns stay left to right in a right-to-left page ([Accessibility](/docs/accessibility#right-to-left)).

## How it's tested

A test renders every component through the states it has (pending, edited, decided, compared, commented on, streamed, stopped) with each label replaced by a marker and the content in Cyrillic, and fails on any English left on the page, in text, accessible names, titles or placeholders. It also fails on a label no state shows, so the states cover every label. A second test reads the components' source and fails on English written into it: text between tags, a string where a name or a placeholder goes, or one handed to the live region. The Portuguese below is the one the tests render, and its type checks that it is complete.

## Portuguese

Every label, in European Portuguese.

```ts title="labels-pt.ts" collapse
import type { SignoffLabels } from 'signoff-ui';

// Every label in European Portuguese. Typed as `SignoffLabels`, so a missing one fails to compile.
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);
const decimal = new Intl.NumberFormat('pt-PT', { maximumFractionDigits: 1 });
const compact = new Intl.NumberFormat('pt-PT', { notation: 'compact', maximumFractionDigits: 1 });
const usd = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'USD', maximumSignificantDigits: 3 });
const valid = (n: number | undefined | null): n is number => n != null && Number.isFinite(n) && n >= 0;
const lines = (r: { side: 'new' | 'old'; startLine: number; endLine: number }) =>
  `${r.startLine === r.endLine ? `a linha ${r.startLine}` : `as linhas ${r.startLine} a ${r.endLine}`}${r.side === 'old' ? ' do original' : ''}`;

export const pt: SignoffLabels = {
  format: {
    duration: (ms) => {
      if (!valid(ms)) return '–';
      if (Math.round(ms) < 1000) return `${Math.round(ms)} ms`;
      const seconds = Math.round(ms / 1000);
      if (ms < 60_000) return `${decimal.format(ms / 1000)} s`;
      return `${Math.floor(seconds / 60)} min ${String(seconds % 60).padStart(2, '0')} s`;
    },
    durationLong: (ms) => {
      if (!valid(ms)) return 'duração desconhecida';
      if (Math.round(ms) < 1000) return `${Math.round(ms)} milissegundos`;
      if (ms < 60_000) return `${decimal.format(ms / 1000)} segundos`;
      const seconds = Math.round(ms / 1000);
      const [m, s] = [Math.floor(seconds / 60), seconds % 60];
      return `${m} ${plural(m, 'minuto', 'minutos')} e ${s} ${plural(s, 'segundo', 'segundos')}`;
    },
    tokens: (n) => (n == null || !Number.isFinite(n) ? '–' : compact.format(n)),
    cost: (value) => (value == null || !Number.isFinite(value) ? '–' : usd.format(value)),
    percent: (fraction) => new Intl.NumberFormat('pt-PT', { style: 'percent' }).format(fraction),
  },
  common: {
    copied: 'Copiado',
    copyThe: (what) => `Copiar ${what.toLowerCase()}`,
    showAllLines: (count) => `Mostrar as ${count} linhas`,
    showLess: 'Mostrar menos',
    opensInNewTab: '(abre num novo separador)',
    modKey: (mac) => (mac ? '⌘' : 'Ctrl'),
  },
  agentStatus: {
    states: {
      idle: 'Inativo',
      thinking: 'A pensar',
      working: 'A trabalhar',
      'awaiting-approval': 'À espera de aprovação',
      done: 'Concluído',
      stopped: 'Parado',
      error: 'Erro',
    },
    spoken: (state, detail) => (detail ? `${state}: ${detail}` : state),
    writingResponse: 'A escrever a resposta',
  },
  toolCallTimeline: {
    list: 'Chamadas de ferramentas',
    phases: {
      streaming: 'A preparar',
      running: 'A executar',
      'awaiting-approval': 'Precisa de aprovação',
      success: 'Concluída',
      error: 'Falhou',
      denied: 'Recusada',
    },
    stopped: 'Interrompida',
    finished: (name, duration) => `${name} terminou em ${duration}`,
    failed: (name, error) => `${name} falhou: ${error ?? 'erro desconhecido'}`,
    blockedByPolicy: (name) => `${name} foi bloqueada pela política`,
    denied: (name) => `${name} foi recusada`,
    input: 'Entrada',
    inputStreaming: 'Entrada (a chegar)',
    output: 'Saída',
    outputPartial: 'Saída (parcial)',
    error: 'Erro',
    deniedBy: (automatic) => (automatic ? 'Bloqueada pela política' : 'Recusada pelo utilizador'),
    waitingForInput: 'À espera da entrada…',
    subagent: {
      name: 'Subagente',
      calls: (count) => `${count} ${plural(count, 'chamada', 'chamadas')}`,
      list: (name) => `Chamadas de ferramentas de ${name}`,
      paused: 'Em pausa',
    },
  },
  approvalCard: {
    required: 'Aprovação necessária',
    risk: { low: 'Risco baixo', medium: 'Risco médio', high: 'Risco alto', critical: 'Crítico' },
    command: 'Comando',
    arguments: 'Argumentos',
    approve: 'Aprovar',
    session: 'Nesta sessão',
    always: 'Sempre',
    deny: 'Recusar',
    alwaysDeny: 'Recusar sempre',
    sendDenial: 'Enviar recusa',
    confirm: 'Confirmar aprovação',
    denyWithFeedback: 'Recusar com comentário',
    reasonLabel: 'Diga ao agente porquê (opcional)',
    reasonPlaceholder: 'O que deve o agente fazer em vez disto?',
    approveHint: 'aprovar',
    keyboardHint: (offered, mod) =>
      `Teclado: prima ${[
        offered.approve && 'Y para aprovar',
        offered.session && 'S para aprovar nesta sessão',
        offered.always && 'A para aprovar sempre',
        offered.deny && 'N para recusar',
        offered.alwaysDeny && 'Shift N para recusar sempre',
      ]
        .filter(Boolean)
        .join(', ')}, ou ${mod} Enter para aprovar.`,
    summary: ({ risk, command, cwd, args, rule }) =>
      [
        risk && `${risk}.`,
        command !== undefined
          ? `Executa ${command}${cwd ? ` em ${cwd}` : ''}.`
          : args.length > 0 && `Argumentos: ${args.map((arg) => arg.join(' ')).join(', ')}.`,
        rule && `Uma decisão duradoura abrange ${rule}.`,
      ]
        .filter(Boolean)
        .join(' '),
    resolved: {
      'allow-once': 'Aprovado',
      'allow-session': 'Aprovado nesta sessão',
      'allow-always': 'Aprovado sempre',
      'deny-once': 'Recusado',
      'deny-always': 'Recusado sempre',
    },
    resolvedFor: (resolved, rule) => `${resolved}: ${rule}.`,
    approved: 'Aprovado',
    denied: 'Recusado',
    autoApproved: 'Aprovado automaticamente',
    blockedByPolicy: 'Bloqueado pela política',
    allowedByRule: 'Permitido pela sua regra',
    deniedByRule: 'Recusado pela sua regra',
    describeRule: (rule) => {
      const args = Object.entries(rule.args ?? {});
      const tool = rule.tool === '*' ? 'qualquer ferramenta' : rule.tool.replace(/\\(.)/g, '$1');
      return args.length === 0
        ? `${tool}, quaisquer argumentos`
        : `${tool} com ${args.map(([name, pattern]) => `${name} ${pattern}`).join(', ')}`;
    },
    critical: 'Ação crítica. Prima aprovar outra vez para confirmar.',
    confirmCancelled: 'Confirmação cancelada.',
    invalidJson: 'Os argumentos não são JSON válido.',
    editArguments: 'Editar argumentos',
    doneEditing: 'Concluir edição',
    undoEdits: 'Desfazer edições',
    edited: 'Editado: ao aprovar, corre com os novos argumentos.',
    argumentsJson: 'Argumentos, em JSON',
    notValidJson: (error) => `JSON inválido: ${error}`,
    ruleLegend: 'Chamadas abrangidas por uma decisão duradoura',
    rememberedFor: (any) => ({
      before: 'Fica memorizado para ',
      after: any ? ' com quaisquer argumentos.' : ' quando:',
    }),
    argumentMatches: (name) => `${name} corresponde a`,
    anyArguments: 'Quaisquer argumentos',
    globHelp: '* corresponde a qualquer texto exceto operadores da shell (; & | > < e acentos graves); ** a tudo.',
    batch: {
      group: 'Aprovações pendentes',
      waiting: (count) => `${count} aprovações à espera.`,
      approveAll: 'Aprovar todas',
      denyAll: 'Recusar todas',
      confirm: 'Confirmar aprovar todas',
      critical: 'Uma delas é crítica. Prima Aprovar todas outra vez para confirmar.',
      answered: (count, approved) => `${count} aprovações ${approved ? 'aprovadas' : 'recusadas'}.`,
    },
  },
  diffReview: {
    title: 'Rever alterações',
    layout: 'Disposição do diff',
    views: { unified: 'Unificado', split: 'Lado a lado' },
    files: (count) => `${count} ${plural(count, 'ficheiro', 'ficheiros')}`,
    hunks: (count, comparing) => `${count} ${plural(count, 'bloco', 'blocos')}${comparing ? ' até agora' : ''}`,
    status: {
      modified: { letter: 'M', name: 'Modificado' },
      added: { letter: 'A', name: 'Adicionado' },
      deleted: { letter: 'E', name: 'Eliminado' },
      renamed: { letter: 'R', name: 'Renomeado' },
    },
    navigator: 'Ficheiros nesta revisão',
    navigatorState: (decided, total, viewed) => `, ${decided} de ${total} decididos${viewed ? ', visto' : ''}`,
    comparingShort: 'a comparar…',
    renamedTo: 'para',
    toggleFile: (collapsed, path) => `${collapsed ? 'Mostrar' : 'Ocultar'} ${path}`,
    viewed: 'Visto',
    rejectFile: 'Rejeitar ficheiro',
    acceptFile: 'Aceitar ficheiro',
    comparing: 'A comparar alterações…',
    fallback:
      'Demasiadas alterações para comparar linha a linha: as linhas alteradas aparecem como um só bloco que as substitui.',
    noChanges: 'Sem alterações de texto.',
    wholeFile: (status, binary, oldPath) =>
      binary
        ? 'Ficheiro binário, não mostrado.'
        : status === 'renamed'
          ? `Renomeado de ${oldPath}, sem alterações.`
          : status === 'deleted'
            ? 'Ficheiro vazio, eliminado.'
            : 'Novo ficheiro vazio.',
    accept: 'Aceitar',
    reject: 'Rejeitar',
    itemName: (kind, n) => `${kind === 'hunk' ? 'bloco' : 'alteração'} ${n}`,
    acceptItem: (item) => `Aceitar ${item}`,
    rejectItem: (item) => `Rejeitar ${item}`,
    resetItem: (item) => `Repor ${item}`,
    commentOn: (what) => `Comentar ${what}`,
    badge: { accepted: 'aceite', rejected: 'rejeitado' },
    hunk: (n, total, path, from, to, decision) =>
      `Bloco ${n} de ${total}, ${path}, linhas ${from} a ${to}, ${
        decision === 'pending' ? 'por rever' : decision === 'accepted' ? 'aceite' : 'rejeitado'
      }`,
    fileItem: (n, total, path, what, decision) =>
      `Alteração ${n} de ${total}, ${path}, ${what}, ${
        decision === 'pending' ? 'por rever' : decision === 'accepted' ? 'aceite' : 'rejeitada'
      }`,
    describeFile: (status, binary, oldPath) =>
      binary
        ? 'ficheiro binário'
        : status === 'renamed'
          ? `renomeado de ${oldPath}`
          : status === 'deleted'
            ? 'ficheiro vazio eliminado'
            : 'novo ficheiro vazio',
    hunkCode: (n, path) => `Código do bloco ${n}, ${path}`,
    added: 'Adicionada: ',
    removed: 'Removida: ',
    decided: (kind, n, total, decision, remaining) => {
      const hunk = kind === 'hunk';
      const word =
        decision === 'pending'
          ? hunk
            ? 'reposto'
            : 'reposta'
          : decision === 'accepted'
            ? 'aceite'
            : hunk
              ? 'rejeitado'
              : 'rejeitada';
      return `${hunk ? 'Bloco' : 'Alteração'} ${n} de ${total} ${word}. ${
        remaining === 0 ? 'Todos os blocos revistos.' : `${remaining} por rever.`
      }`;
    },
    decidedAll: (total, decision) => `Os ${total} blocos foram ${decision === 'accepted' ? 'aceites' : 'rejeitados'}.`,
    decidedFile: (count, path, decision) =>
      count === 1
        ? `O bloco de ${path} foi ${decision === 'accepted' ? 'aceite' : 'rejeitado'}.`
        : `Os ${count} blocos de ${path} foram ${decision === 'accepted' ? 'aceites' : 'rejeitados'}.`,
    viewedAnnouncement: (path, viewed, total) => `${path} visto. ${viewed} de ${total} ficheiros vistos.`,
    notViewedAnnouncement: (path) => `${path} deixou de estar visto.`,
    lines,
    selected: (line, range) =>
      `${line}. ${range.startLine === range.endLine ? `Linha ${range.startLine} selecionada` : `Linhas ${range.startLine} a ${range.endLine} selecionadas`}${range.side === 'old' ? ' no original' : ''}.`,
    where: (comment) =>
      comment.target === 'file'
        ? 'o ficheiro'
        : comment.target === 'hunk'
          ? 'o bloco'
          : lines({ side: 'new', startLine: comment.startLine ?? 0, endLine: comment.endLine ?? 0 }),
    commentHeading: (where) => ({ hidden: 'Comentário ', visible: `Sobre ${where}` }),
    commentField: (where) => `Comentário sobre ${where}, para o agente`,
    commentPlaceholder: 'O que deve mudar aqui?',
    editComment: (where) => `Editar comentário sobre ${where}`,
    deleteComment: (where) => `Eliminar comentário sobre ${where}`,
    edit: 'Editar',
    delete: 'Eliminar',
    cancel: 'Cancelar',
    saveComment: 'Guardar comentário',
    addComment: 'Comentar',
    commentAdded: (where, path) => `Comentário adicionado sobre ${where} de ${path}.`,
    commentUpdated: 'Comentário atualizado.',
    commentDeleted: 'Comentário eliminado.',
    unchangedLines: (count) => `${count} ${plural(count, 'linha inalterada', 'linhas inalteradas')}`,
    moreAfter: (count, hunk) => ({
      visible: `mais ${count}`,
      hidden: ` ${plural(count, 'linha inalterada', 'linhas inalteradas')} depois do bloco ${hunk}`,
    }),
    moreBefore: (count, hunk) => ({
      visible: `mais ${count}`,
      hidden: ` ${plural(count, 'linha inalterada', 'linhas inalteradas')} antes do bloco ${hunk}`,
    }),
    showAll: (count) => ({
      visible: 'Mostrar todas',
      hidden: count === 1 ? ' a linha inalterada' : ` as ${count} linhas inalteradas`,
    }),
    expanded: (count) => `A mostrar mais ${count} ${plural(count, 'linha inalterada', 'linhas inalteradas')}.`,
    reviewed: 'revistos',
    filesViewed: (viewed, total) => `${viewed} de ${total} ficheiros vistos`,
    comments: (count) => `${count} ${plural(count, 'comentário', 'comentários')}`,
    comparingFiles: 'a comparar ficheiros…',
    skipped: 'os blocos por rever ficam de fora',
    apply: (accepted, total) => (accepted > 0 ? `Aplicar ${accepted} de ${total}` : 'Aplicar alterações'),
    submitted: (accepted, total, comments) =>
      `Revisão enviada: ${accepted} de ${total} ${plural(accepted, 'aceite', 'aceites')}${
        comments > 0 ? `, ${comments} ${plural(comments, 'comentário', 'comentários')}` : ''
      }.`,
    acceptAll: 'Aceitar tudo',
    rejectAll: 'Rejeitar tudo',
    keyHints: { move: 'mover', accept: 'aceitar', reject: 'rejeitar', comment: 'comentar', apply: 'aplicar' },
    keyboardHelp: (mod) =>
      `Teclado: J ou K para mudar de bloco, Shift J ou Shift K para mudar de ficheiro, A para aceitar, R para rejeitar, U para repor, Alt A ou Alt R para o ficheiro inteiro, Shift A ou Shift R para todos os blocos, Shift com a seta para cima ou para baixo para selecionar linhas, C para as comentar ou comentar o bloco, E para mostrar mais linhas inalteradas, V para marcar o ficheiro como visto, ${mod} Enter para aplicar.`,
  },
  markdown: {
    code: (language) => (language && language !== 'text' ? `Código, ${language}` : 'Código'),
    codeBadge: 'código',
    copyCode: 'Copiar código',
    table: 'Tabela',
    image: 'Imagem:',
    imageFallback: 'imagem',
    citation: (n) => `Fonte ${n}`,
    task: 'Tarefa',
  },
  reasoning: {
    thinking: 'A pensar',
    thoughtFor: (duration) => `Pensou durante ${duration}`,
    reasoning: 'Raciocínio',
  },
  runMeter: {
    title: 'Execução',
    metrics: (live) => `Métricas da execução${live ? ' (ao vivo)' : ''}`,
    summary: ({ input, output, cost, ttft, total }) =>
      [
        `${input} tokens de entrada`,
        `${output} tokens de saída`,
        cost !== undefined ? `custo estimado ${cost}` : undefined,
        ttft !== undefined ? `tempo até ao primeiro token ${ttft}` : undefined,
        total !== undefined ? `total ${total}` : undefined,
      ]
        .filter(Boolean)
        .join(', '),
    inputTokens: 'Tokens de entrada',
    outputTokens: 'Tokens de saída',
    estimatedCost: 'Custo estimado',
    timeToFirstToken: 'Tempo até ao primeiro token',
    totalTime: 'Tempo total',
    ttft: 'TTFT',
    live: 'Ao vivo',
    tokens: 'Tokens',
    estCost: 'Custo est.',
    breakdown: 'Detalhe dos tokens',
    split: (input, output) => `Entrada ${input} · Saída ${output}`,
    input: 'Entrada',
    output: 'Saída',
    cached: (n) => `(${n} em cache)`,
    reasoningTokens: (n) => `(${n} de raciocínio)`,
    total: 'Total',
    cacheHit: 'Acertos na cache',
    costSplit: (input, output) => `${input} entrada · ${output} saída`,
    rates: (input, output) => `US$ ${input}/${output} por 1M`,
  },
  approvalPolicy: { ruleDenial: 'Recusado por uma regra' },
  sources: { label: 'Fontes', document: 'Documento' },
  agentMessage: { attachedImage: 'Imagem anexada' },
  untrusted: {
    invisible: (count, codes) =>
      count === 1 ? `Carácter invisível ${codes[0]}` : `${count} caracteres invisíveis: ${codes.join(', ')}`,
    blank: (count, lines) =>
      lines
        ? `${lines} ${plural(lines, 'quebra de linha', 'quebras de linha')}`
        : `${count} ${plural(count, 'espaço em branco', 'espaços em branco')}`,
    linksTo: (host) => `Leva a ${host}`,
  },
};
```
