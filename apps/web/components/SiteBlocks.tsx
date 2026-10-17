'use client';

import { cx } from '@dizi/ui';
import { parseBody, type SiteBlock } from '@/lib/cms';

/* The one renderer.
 *
 * The public site and the Front CMS's preview both draw pages through this component, from the blocks the parser
 * produced. That is not tidiness for its own sake: a preview drawn by different code is a drawing of the page rather
 * than the page, and the first difference anybody notices is the one that has already gone live.
 *
 * It is deliberately plain. A hospital website's most-read page is a list of opening times read on a phone by
 * somebody in a hurry, and every piece of decoration between them and the sentence is a cost.
 */

export function SiteBlocks({ blocks, locale, className }: { blocks: SiteBlock[]; locale: 'en' | 'bn'; className?: string }) {
  return (
    <div lang={locale} className={cx('space-y-3', className)}>
      {blocks.map((block, index) => (
        <BlockView key={`${block.kind}-${index}`} block={block} locale={locale} />
      ))}
    </div>
  );
}

/** Parse and draw in one call, for a caller that holds the raw text. */
export function SiteText({ text, locale, className }: { text: string; locale: 'en' | 'bn'; className?: string }) {
  return <SiteBlocks blocks={parseBody(text, locale)} locale={locale} className={className} />;
}

function BlockView({ block, locale }: { block: SiteBlock; locale: 'en' | 'bn' }) {
  const text = locale === 'en' ? block.en : block.bn;

  switch (block.kind) {
    case 'heading':
      return <h2 className="mt-4 text-lg font-semibold text-text-primary first:mt-0">{text}</h2>;
    case 'callout':
      return (
        <p className="rounded-lg border border-safety-critical bg-surface-sunken p-3 text-sm font-medium text-safety-critical">{text}</p>
      );
    case 'notice':
      return (
        <p className="border-l-2 border-brand-500 pl-3 text-sm text-text-secondary">
          {/\d{4}-\d{2}-\d{2}/.test(text) ? (
            <>
              <time dateTime={/\d{4}-\d{2}-\d{2}/.exec(text)?.[0] ?? ''} className="font-numeric mr-2 font-medium text-text-primary">
                {/\d{4}-\d{2}-\d{2}/.exec(text)?.[0]}
              </time>
              {text.replace(/\d{4}-\d{2}-\d{2}\s*—\s*/, '')}
            </>
          ) : (
            text
          )}
        </p>
      );
    case 'list':
      return (
        <ul className="list-disc space-y-1 pl-5 text-sm text-text-secondary">
          {(block.rows ?? []).map((row, index) => (
            <li key={index}>{locale === 'en' ? row.en : row.bn}</li>
          ))}
        </ul>
      );
    case 'facts':
      return (
        <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(block.rows ?? []).map((row, index) => {
            const raw = locale === 'en' ? row.en : row.bn;
            const [key, ...rest] = raw.split(':');
            return (
              <div key={index} className="rounded-lg border border-border-subtle bg-surface-raised px-3 py-2">
                <dt className="text-xs text-text-tertiary">{key}</dt>
                <dd className="text-sm font-medium text-text-primary">{rest.join(':').trim()}</dd>
              </div>
            );
          })}
        </dl>
      );
    default:
      return <p className="text-sm leading-relaxed text-text-secondary">{text}</p>;
  }
}
