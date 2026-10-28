import { act, cleanup, render, screen } from '@testing-library/react';
import type { ReactElement } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { getImagePolicy, isAllowedImage } from '../src/lib/images';
import { Markdown, type MarkdownProps } from '../src/markdown';
import { axe } from './utils';

describe('Markdown', () => {
  it('renders GFM: headings, lists, tables, inline and block code', () => {
    const { container } = render(
      <Markdown>
        {'## Plan\n\n- one\n- two\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\nUse `ratelimit`.\n\n```ts\nconst x = 1;\n```'}
      </Markdown>,
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Plan' })).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(screen.getByText('ratelimit').tagName).toBe('CODE');
    expect(container.querySelector('pre')).toHaveTextContent('const x = 1;');
    expect(screen.getByRole('button', { name: 'Copy code' })).toBeInTheDocument();
  });

  it("keeps react-markdown's syntax tree nodes off the DOM", () => {
    const { container } = render(
      <Markdown streaming citations={1}>
        {'# A\n\n> **b** [c](https://example.com) [1]\n\n1. d\n\n---\n\n| e |\n|---|\n| f |\n\n`g`'}
      </Markdown>,
    );
    expect(container.querySelectorAll('h1, blockquote, strong, a, ol, li, hr, table, th, td, code').length).toBe(12);
    expect(container.querySelector('[node]')).toBeNull();
  });

  it('closes unterminated syntax while streaming and shows a caret', () => {
    const { container } = render(<Markdown streaming>{'This is **important'}</Markdown>);
    expect(container.querySelector('strong')).toHaveTextContent('important');
    expect(container.querySelector('[class*="animate-signoff-blink"]')).not.toBeNull();
    expect(container).not.toHaveTextContent('**');
  });

  it('does not render raw HTML or javascript: URLs', () => {
    const { container } = render(
      <Markdown>{'<script>alert(1)</script>\n\nInline <b>x</b> and [click](javascript:alert(1))'}</Markdown>,
    );
    expect(container.querySelector('script')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(screen.getByText('click').closest('a')?.getAttribute('href') ?? '').not.toContain('javascript');
  });

  it('opens external links in a new tab', () => {
    render(<Markdown>{'[docs](https://ai-sdk.dev)'}</Markdown>);
    expect(screen.getByRole('link', { name: 'docs' })).toHaveAttribute('target', '_blank');
  });

  it('turns [n] markers into citation links, but not inside code', () => {
    const { container } = render(
      <Markdown citations={2} citationPrefix="m1-source">
        {'Sliding windows work well [1][2]. Arrays use `a[1]`. Out of range [3].'}
      </Markdown>,
    );
    expect(screen.getByRole('link', { name: 'Source 1' })).toHaveAttribute('href', '#m1-source-1');
    expect(screen.getByRole('link', { name: 'Source 2' })).toHaveAttribute('href', '#m1-source-2');
    expect(screen.queryByRole('link', { name: 'Source 3' })).not.toBeInTheDocument();
    expect(container.querySelector('code')).toHaveTextContent('a[1]');
  });

  describe('streaming caret', () => {
    /** Render while capturing React's console errors (invalid DOM nesting, void-element children). */
    function renderStreaming(text: string, props: Partial<MarkdownProps> = {}) {
      const errors: string[] = [];
      const spy = vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args.map(String).join(' ')));
      try {
        const { container } = render(
          <Markdown streaming {...props}>
            {text}
          </Markdown>,
        );
        return { container, errors };
      } finally {
        spy.mockRestore();
      }
    }

    it.each([
      ['a dashed thematic break', 'Done.\n\n---\n', 'hr'],
      ['a starred thematic break', 'Section one\n\n***', 'hr'],
    ])('puts the caret after %s instead of inside it', (_name, text, tag) => {
      const { container, errors } = renderStreaming(text);
      expect(errors).toEqual([]);
      const el = container.querySelector(tag)!;
      expect(el.childNodes).toHaveLength(0);
      expect(el.nextElementSibling).toHaveAttribute('aria-hidden', 'true');
      expect(container.querySelector('[class*="animate-signoff-blink"]')).not.toBeNull();
    });

    it('keeps the caret out of a trailing image', () => {
      const { container, errors } = renderStreaming('See ![x](https://img.test/chart.png)', {
        allowedImageHosts: ['img.test'],
      });
      expect(errors).toEqual([]);
      const img = container.querySelector('img')!;
      expect(img.childNodes).toHaveLength(0);
      expect(img.nextElementSibling).toHaveAttribute('aria-hidden', 'true');
    });

    it('renders every prefix of a rich document without errors', () => {
      const doc = [
        '# Plan\n\nRead **the route** and `lib/redis.ts`, then [docs](https://ai-sdk.dev).\n\n',
        '- [x] search\n- [ ] read\n\n1. one\n2. two\n\n',
        '> quoted *text*\n\n---\n\n',
        '![chart](https://img.test/c.png) and a break  \nnext line\n\n',
        '| a | b |\n|---|---|\n| 1 | 2 |\n\n',
        '```ts\nconst x = 1;\n```\n\n***\n',
      ].join('');
      for (const allowedImageHosts of [undefined, ['img.test']]) {
        for (let end = 1; end <= doc.length; end++) {
          const { errors } = renderStreaming(doc.slice(0, end), { allowedImageHosts });
          expect({ prefix: doc.slice(0, end), errors }).toEqual({ prefix: doc.slice(0, end), errors: [] });
          cleanup();
        }
      }
    });
  });

  describe('images', () => {
    const pixel = 'https://attacker.example/pixel.png?d=SECRET';

    it('does not load remote images by default, and links to them instead', () => {
      const { container } = render(<Markdown>{`Summary ![status](${pixel}) done.`}</Markdown>);
      expect(container.querySelector('img')).toBeNull();
      const link = screen.getByRole('link', { name: /status/ });
      expect(link).toHaveAttribute('href', pixel);
      expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    });

    it('loads images only from allowed hosts', () => {
      const { container } = render(
        <Markdown allowedImageHosts={['Images.Example.com', 'localhost:3000']}>
          {[
            '![ok](https://images.example.com/a.png)',
            `![pixel](${pixel})`,
            '![lookalike](https://images.example.com.attacker.example/a.png)',
            '![relative](/a.png)',
            '![protocol-relative](//attacker.example/a.png)',
            '![port](http://localhost:3000/a.png)',
          ].join('\n\n')}
        </Markdown>,
      );
      expect([...container.querySelectorAll('img')].map((img) => img.getAttribute('src'))).toEqual([
        'https://images.example.com/a.png',
        'http://localhost:3000/a.png',
      ]);
      expect(screen.getByRole('img', { name: 'ok' })).toBeInTheDocument();
      expect(screen.getAllByRole('link')).toHaveLength(4);
    });

    it("loads relative images with 'self', but never protocol-relative ones", () => {
      const relative = ['/static/logo.png', './chart.png', 'chart.png', '../img/a.png?v=2', '/a%2F%2Fb.png'];
      // Markdown percent-encodes backslashes (`/\host` becomes the path `/%5Chost`); the next test covers raw URLs.
      const elsewhere = ['//attacker.example/p.png', 'https://app.example/logo.png'];
      const { container } = render(
        <Markdown allowedImageHosts={['self']}>
          {[...relative, ...elsewhere].map((src, i) => `![image ${i}](${src})`).join('\n\n')}
        </Markdown>,
      );
      expect([...container.querySelectorAll('img')].map((img) => img.getAttribute('src'))).toEqual(relative);
      expect(screen.getAllByRole('link')).toHaveLength(elsewhere.length);
    });

    it("decides 'self' without the page's location, the same on the server and in the browser", () => {
      const policy = getImagePolicy(['self', 'Images.Example.com']);
      expect(isAllowedImage('/a.png', policy)).toBe(true);
      expect(isAllowedImage('https://images.example.com/a.png', policy)).toBe(true);
      expect(isAllowedImage(`${window.location.origin}/a.png`, policy)).toBe(false);
      for (const src of ['//x.test/a', '/\\x.test/a', '\\/x.test/a', ' //x.test/a', '/\t/x.test/a', 'https://self/a']) {
        expect({ src, allowed: isAllowedImage(src, policy) }).toEqual({ src, allowed: false });
      }
      expect(isAllowedImage('/a.png', getImagePolicy(['localhost', window.location.host]))).toBe(false);
    });

    it("loads every image with '*'", () => {
      const { container } = render(<Markdown allowedImageHosts={['*']}>{`![a](${pixel}) ![b](/b.png)`}</Markdown>);
      expect(container.querySelectorAll('img')).toHaveLength(2);
    });

    describe('inside a link (a badge)', () => {
      const badge = 'Build: [![CI](https://img.shields.io/badge/ci-green.svg)](https://github.com/acme/app/actions)';

      /** Render while capturing React's console errors (e.g. "<a> cannot be a descendant of <a>"). */
      function renderQuietly(ui: ReactElement) {
        const errors: string[] = [];
        const spy = vi.spyOn(console, 'error').mockImplementation((...args) => errors.push(args.map(String).join(' ')));
        try {
          return { ...render(ui), errors };
        } finally {
          spy.mockRestore();
        }
      }

      it('renders one link to the outer URL when the image is blocked', () => {
        const { container, errors } = renderQuietly(<Markdown>{badge}</Markdown>);
        expect(errors).toEqual([]);
        expect(container.querySelector('a a')).toBeNull();
        expect(container.querySelector('img')).toBeNull();
        const links = screen.getAllByRole('link');
        expect(links).toHaveLength(1);
        expect(links[0]).toHaveAttribute('href', 'https://github.com/acme/app/actions');
        expect(links[0]).toHaveAccessibleName('Image: CI');
      });

      it('keeps the image inside the link when its host is allowed', () => {
        const { container, errors } = renderQuietly(
          <Markdown allowedImageHosts={['img.shields.io']}>{badge}</Markdown>,
        );
        expect(errors).toEqual([]);
        expect(screen.getAllByRole('link')).toHaveLength(1);
        expect(container.querySelector('a > img')).toHaveAttribute('src', 'https://img.shields.io/badge/ci-green.svg');
      });

      it('does not nest links when you override the link component', () => {
        const { container, errors } = renderQuietly(
          <Markdown
            components={{
              a: ({ node: _node, children, ...props }) => (
                <a data-custom="" {...props}>
                  {children}
                </a>
              ),
            }}
          >
            {badge}
          </Markdown>,
        );
        expect(errors).toEqual([]);
        expect(container.querySelector('a a')).toBeNull();
        expect(screen.getByRole('link')).toHaveAttribute('data-custom');
      });

      it('server-renders markup that hydrates without a mismatch', async () => {
        for (const allowedImageHosts of [undefined, ['img.shields.io'], ['self']]) {
          const ui = (
            <Markdown allowedImageHosts={allowedImageHosts} citations={1}>
              {`${badge} and [a link with ![an image](/logo.png) inside](https://x.dev) [1]`}
            </Markdown>
          );
          const container = document.createElement('div');
          container.innerHTML = renderToString(ui);
          document.body.append(container);
          expect(container.querySelector('a a')).toBeNull();
          const serverHtml = container.innerHTML;
          const recoverable: unknown[] = [];
          const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
          const root = await act(async () =>
            hydrateRoot(container, ui, { onRecoverableError: (error) => recoverable.push(error) }),
          );
          expect(recoverable).toEqual([]);
          expect(errors).not.toHaveBeenCalled();
          expect(container.innerHTML).toBe(serverHtml);
          errors.mockRestore();
          act(() => root.unmount());
          container.remove();
        }
      });
    });

    it('renders the alt text for images without a usable URL, including half-streamed ones', () => {
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { container, rerender } = render(
        <Markdown allowedImageHosts={['*']}>{'![x](javascript:alert(1)) ![y](data:image/png;base64,AAAA)'}</Markdown>,
      );
      expect(container.querySelector('img')).toBeNull();
      expect(container).toHaveTextContent('x y');
      rerender(
        <Markdown streaming allowedImageHosts={['*']}>
          {'Here: ![chart](https://img.te'}
        </Markdown>,
      );
      expect(container.querySelector('img')).toBeNull();
      expect(container).toHaveTextContent('Here: chart');
      expect(errors).not.toHaveBeenCalled();
      errors.mockRestore();
    });
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <Markdown citations={1} allowedImageHosts={['img.test']}>
        {
          '# Title\n\nText [1] with [a link](https://x.dev).\n\n```sh\npnpm i\n```\n\n![chart](https://img.test/c.png) ![pixel](https://x.dev/p.png)'
        }
      </Markdown>,
    );
    expect(await axe(container)).toHaveNoViolations();
  });

  it('names the checkboxes of a task list, which read with their state', async () => {
    const { container } = render(<Markdown>{'- [x] Read the route\n- [ ] Add the rate limit\n- plain item'}</Markdown>);
    const boxes = screen.getAllByRole('checkbox', { name: 'Task' });
    expect(boxes).toHaveLength(2);
    expect(boxes[0]).toBeChecked();
    expect(boxes[1]).not.toBeChecked();
    // Still a record of the agent's plan, not a control.
    for (const box of boxes) expect(box).toBeDisabled();
    expect(await axe(container)).toHaveNoViolations();
  });

  it('takes the task name from the labels', () => {
    render(<Markdown labels={{ markdown: { task: 'Tarefa' } }}>{'- [ ] Rever'}</Markdown>);
    expect(screen.getByRole('checkbox', { name: 'Tarefa' })).toBeInTheDocument();
  });
});
