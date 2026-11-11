import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { NoticeList } from '@/components/resource/parts';
import { Markdown, tableOfContents } from '@/features/legal-guide/components/Markdown';
import { LEGAL_DISCLAIMER, LEGAL_DOC_PATHS, LEGAL_DOCS } from '@/features/legal-guide/services/docs';
import { readLegalDoc } from '@/features/legal-guide/services/docsServer';
import { parseMarkdown } from '@/features/legal-guide/services/markdown';

// 法令ガイドの本文。docs/legal/ の Markdown をリクエストのたびにサーバで読み、React 要素にして出す。
// slug は一覧（LEGAL_DOCS）との照合にだけ使い、一覧に無ければ 404 にする。
export default async function LegalGuideDocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const loaded = await readLegalDoc(slug);
  if (!loaded) notFound();

  const blocks = parseMarkdown(loaded.source);
  const toc = tableOfContents(blocks);
  const position = LEGAL_DOCS.findIndex((doc) => doc.slug === loaded.doc.slug);
  const previous = position > 0 ? LEGAL_DOCS[position - 1] : null;
  const next = position < LEGAL_DOCS.length - 1 ? LEGAL_DOCS[position + 1] : null;

  return (
    <div className="page-body">
      <Link href="/legal-guide" className="inline-flex items-center gap-1 text-[13px] text-text-muted mb-3">
        <ChevronLeft size={15} />
        法令ガイドの目次
      </Link>
      <div className="flex flex-col gap-4 max-w-[980px]">
        <NoticeList items={[{ level: 'warning', message: LEGAL_DISCLAIMER }]} />

        {toc.length > 0 && (
          <nav className="gt-card" aria-label="この文書の目次">
            <div className="text-[13px] font-semibold text-text-heading">この文書の目次</div>
            <ol className="list-none p-0 m-0 mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-[13px]">
              {toc.map((entry) => (
                <li key={entry.id}>
                  <a href={`#${entry.id}`} className="text-primary">
                    {entry.text}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        )}

        <article className="gt-card" style={{ padding: '24px 28px' }}>
          <Markdown blocks={blocks} docPaths={LEGAL_DOC_PATHS} />
        </article>

        <nav className="flex items-center justify-between gap-3 flex-wrap" aria-label="前後の文書">
          {previous ? (
            <Link href={`/legal-guide/${previous.slug}`} className="gt-btn">
              ← {previous.title}
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link href={`/legal-guide/${next.slug}`} className="gt-btn">
              {next.title} →
            </Link>
          )}
        </nav>
      </div>
    </div>
  );
}
