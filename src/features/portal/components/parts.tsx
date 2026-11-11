// 株主ポータルの画面で共通の小さな部品（Server Component からそのまま使える）。
import type { ReactNode } from 'react';
import Link from 'next/link';
import { Download, FileText } from 'lucide-react';
import { formatBytes } from '@/features/library/services/format';
import { formatDateJa } from '@/lib/equity/format';
import { optionLabel } from '@/lib/equity/types';
import { DOCUMENT_CATEGORIES, UPDATE_CATEGORIES } from '@/lib/resources/definitions';
import { isoToTokyoDate } from '@/features/library/services/format';
import type { PortalDocument, PortalUpdateSummary } from '../services/visibility';

export const PortalTitle = ({ title, description, back }: { title: string; description?: ReactNode; back?: { href: string; label: string } }) => (
  <div className="mb-5">
    {back && (
      <Link href={back.href} className="text-[12.5px] text-primary no-underline hover:underline">
        ← {back.label}
      </Link>
    )}
    <h1 className="text-[22px] font-semibold text-text-heading tracking-tight mt-1 mb-0">{title}</h1>
    {description && <p className="text-[13px] text-text-muted mt-1 mb-0">{description}</p>}
  </div>
);

export const Section = ({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) => (
  <section className="gt-card">
    <div className="gt-card-head mb-3">
      <h2 className="gt-card-title m-0">{title}</h2>
      {action}
    </div>
    {children}
  </section>
);

export const MoreLink = ({ href, children }: { href: string; children: ReactNode }) => (
  <Link href={href} className="text-[12.5px] text-primary no-underline hover:underline whitespace-nowrap">
    {children} →
  </Link>
);

export const Empty = ({ children }: { children: ReactNode }) => (
  <p className="text-[13px] leading-relaxed text-text-muted m-0 py-2">{children}</p>
);

export const publishedDate = (iso: string | null): string => formatDateJa(isoToTokyoDate(iso));

export const UpdateList = ({ updates }: { updates: PortalUpdateSummary[] }) => (
  <ul className="list-none p-0 m-0">
    {updates.map((update) => (
      <li key={update.id} className="border-b border-border last:border-b-0">
        <Link href={`/external-portal/updates/${update.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 no-underline group">
          <span className="text-[12px] text-text-muted tabular-nums whitespace-nowrap w-[112px] shrink-0">{publishedDate(update.publishedAt)}</span>
          <span className="gt-pill gt-pill-sm gt-pill-neutral">{optionLabel(UPDATE_CATEGORIES, update.category)}</span>
          <span className="text-[14px] text-text-heading group-hover:text-primary group-hover:underline min-w-0 break-words">{update.title}</span>
        </Link>
      </li>
    ))}
  </ul>
);

/** 文書の一覧。ダウンロードは権限を確かめる API（/api/documents/<id>/download）を新しいタブで開く */
export const DocumentList = ({ documents, showCategory = true }: { documents: PortalDocument[]; showCategory?: boolean }) => (
  <ul className="list-none p-0 m-0">
    {documents.map((document) => (
      // スマートフォンでは、ダウンロードのボタンを題名の下の行に回す（題名とファイル名の幅を確保する）
      <li key={document.id} className="flex flex-wrap items-start gap-x-3 gap-y-2 py-3 border-b border-border last:border-b-0">
        <FileText size={17} className="mt-[3px] shrink-0 text-text-muted" />
        <div className="min-w-[min(100%,15rem)] flex-1">
          <div className="text-[14px] font-medium text-text-heading break-words">{document.title}</div>
          {/* 分類と日付は途中で割らない。区切りの無い長いファイル名だけ、どこででも折り返す */}
          <div className="text-[12px] text-text-muted mt-[2px]">
            {showCategory && <span className="whitespace-nowrap">{optionLabel(DOCUMENT_CATEGORIES, document.category)}・</span>}
            {document.documentDate && <span className="whitespace-nowrap">{formatDateJa(document.documentDate)}・</span>}
            <span className="break-all">
              {document.fileName}（{formatBytes(document.sizeBytes)}）
            </span>
          </div>
          {document.description && <p className="text-[12.5px] leading-relaxed text-text-body mt-1 mb-0 whitespace-pre-wrap break-words">{document.description}</p>}
        </div>
        <a
          href={`/api/documents/${document.id}/download`}
          target="_blank"
          rel="noopener noreferrer"
          className="gt-btn no-underline shrink-0 ml-[29px] sm:ml-0"
          style={{ height: '32px' }}
          aria-label={`${document.title} をダウンロード`}
        >
          <Download size={14} />
          ダウンロード
        </a>
      </li>
    ))}
  </ul>
);
