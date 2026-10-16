'use client';

import type { ComponentPropsWithoutRef } from 'react';
import { toSourceItem, type SourceItem, type SourcePart } from './lib/ai';
import { sourcesLabels, commonLabels, type SignoffLabelsInput } from './lib/labels';
import { useLabels } from './labels';
import { getHostname } from './lib/format';
import { ExternalIcon, FileIcon } from './lib/icons';
import { safeUrl } from './lib/untrusted';
import { cn } from './lib/utils';

/** The labels' sections this module reads. */
const LABELS = { sources: sourcesLabels, common: commonLabels };

export type { SourceItem };

export interface SourcesProps extends Omit<ComponentPropsWithoutRef<'div'>, 'children'> {
  sources: ReadonlyArray<SourcePart | SourceItem>;
  variant?: 'chips' | 'cards';
  /** Visible heading. Default "Sources" (`labels.sources.label`); pass `null` to hide it (it stays as the accessible name). */
  label?: string | null | undefined;
  /**
   * Prefix for element ids (`${idPrefix}-1`, …) so inline citations can link to a source.
   * Default "source".
   */
  idPrefix?: string;
  /** Words to use instead of the English defaults: see `SignoffLabelsProvider`. */
  labels?: SignoffLabelsInput | undefined;
}

function Monogram({ item }: { item: SourceItem }) {
  if (!item.url) {
    return (
      <span aria-hidden="true" className="text-signoff-fg-subtle flex size-4 shrink-0 items-center justify-center">
        <FileIcon size={13} />
      </span>
    );
  }
  const host = getHostname(item.url);
  return (
    <span
      aria-hidden="true"
      className="bg-signoff-surface-2 font-signoff-mono text-signoff-fg-muted ring-signoff-border-strong flex size-4 shrink-0 items-center justify-center rounded-[4px] text-[9px] font-bold uppercase ring-1"
    >
      {host.charAt(0)}
    </span>
  );
}

/** Citation list as compact chips or richer cards. External links open in a new tab. */
export function Sources({
  sources,
  variant = 'chips',
  label: labelProp,
  idPrefix = 'source',
  labels,
  className,
  ...props
}: SourcesProps) {
  const L = useLabels(LABELS, labels);
  const items = sources.map(toSourceItem);
  if (items.length === 0) return null;
  const label = labelProp === undefined ? L.sources.label : labelProp;
  const name = label ?? L.sources.label;
  return (
    <div
      data-signoff
      data-slot="signoff-sources"
      data-variant={variant}
      className={cn('font-signoff-sans text-signoff-fg', className)}
      {...props}
    >
      {label !== null && (
        <p className="font-signoff-mono text-signoff-fg-subtle mb-2 text-[10.5px] font-medium tracking-[0.08em] uppercase">
          {label} <span className="text-signoff-fg-subtle">· {items.length}</span>
        </p>
      )}
      {/* A labelled list rather than a nav landmark: a conversation can hold many source lists. */}
      <ol
        aria-label={name}
        className={cn(variant === 'chips' ? 'flex flex-wrap gap-1.5' : 'grid grid-cols-1 gap-2 sm:grid-cols-2')}
      >
        {items.map((item, i) => {
          const n = i + 1;
          // A URL a link may not use (`javascript:`) is shown, not linked.
          const href = safeUrl(item.url);
          const host = item.url ? getHostname(item.url) : (item.filename ?? item.mediaType ?? L.sources.document);
          const title = item.title ?? host;
          const content =
            variant === 'chips' ? (
              <>
                <span className="font-signoff-mono text-signoff-accent-fg text-[10.5px] font-semibold tabular-nums">
                  {n}
                </span>
                <Monogram item={item} />
                <span className="text-signoff-fg max-w-[16rem] truncate">{title}</span>
                {item.title && item.url && <span className="text-signoff-fg-subtle hidden sm:inline">{host}</span>}
              </>
            ) : (
              <>
                <span className="text-signoff-fg-subtle flex items-center gap-2 text-xs">
                  <span className="font-signoff-mono text-signoff-accent-fg text-[10.5px] font-semibold tabular-nums">
                    {n}
                  </span>
                  <Monogram item={item} />
                  <span className="truncate">{host}</span>
                  {href && (
                    <ExternalIcon
                      size={12}
                      className="ml-auto shrink-0 opacity-0 transition-opacity group-hover/source:opacity-100"
                    />
                  )}
                </span>
                <span className="text-signoff-fg mt-1.5 line-clamp-2 text-[13px] leading-snug font-medium">
                  {title}
                </span>
                {item.description && (
                  <span className="text-signoff-fg-muted mt-1 line-clamp-2 text-xs leading-relaxed">
                    {item.description}
                  </span>
                )}
              </>
            );
          const shared = cn(
            'group/source focus-visible:outline-signoff-ring transition-colors focus-visible:outline-2 focus-visible:outline-offset-2',
            variant === 'chips'
              ? 'border-signoff-border bg-signoff-surface inline-flex h-7 max-w-full items-center gap-1.5 rounded-full border pr-2.5 pl-2 text-xs'
              : 'border-signoff-border bg-signoff-surface flex h-full flex-col rounded-lg border p-3',
            href && 'hover:border-signoff-border-strong hover:bg-signoff-surface-2',
          );
          return (
            <li key={`${item.id}-${i}`} id={`${idPrefix}-${n}`} className="min-w-0">
              {href ? (
                <a href={href} target="_blank" rel="noopener noreferrer" className={shared}>
                  {content}
                  <span className="sr-only">{L.common.opensInNewTab}</span>
                </a>
              ) : (
                <span className={shared}>{content}</span>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}
