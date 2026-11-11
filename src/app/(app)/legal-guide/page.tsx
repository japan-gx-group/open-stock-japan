import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { PageHeading } from '@/components/layout/PageHeading';
import { NoticeList } from '@/components/resource/parts';
import { LEGAL_DISCLAIMER, LEGAL_DOCS } from '@/features/legal-guide/services/docs';

// 法令ガイドの目次。本文は docs/legal/ の Markdown（[slug] のページがサーバで読む）。
export default function LegalGuideIndexPage() {
  return (
    <div className="page-body">
      <PageHeading title="法令ガイド" description="このソフトウェアの計算と画面の注意書きの根拠にしている、会社法などの整理です" />
      <div className="flex flex-col gap-4 max-w-[900px]">
        <NoticeList items={[{ level: 'warning', message: LEGAL_DISCLAIMER }]} />
        <ul className="list-none p-0 m-0 flex flex-col gap-3">
          {LEGAL_DOCS.map((doc, index) => (
            <li key={doc.slug}>
              <Link href={`/legal-guide/${doc.slug}`} className="gt-card flex items-center justify-between gap-4 no-underline hover:bg-bg-subtle">
                <div className="min-w-0">
                  <div className="gt-card-title">
                    <span className="text-text-muted tabular-nums mr-2">{doc.slug === 'rules' ? '付録' : String(index + 1).padStart(2, '0')}</span>
                    {doc.title}
                  </div>
                  <div className="text-[13px] leading-relaxed text-text-body mt-1">{doc.summary}</div>
                </div>
                <ArrowRight size={18} className="shrink-0 text-text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
