'use client';

// AI 取り込みの入口: 文書を読み取るカードと、これまでの読取りの履歴。

import React from 'react';
import Link from 'next/link';
import { PageHeading } from '@/components/layout/PageHeading';
import { EmptyState, ErrorBlock, LoadingBlock } from '@/components/resource/parts';
import { useAsyncData } from '@/hooks/useAsyncData';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { formatDateTime } from '@/lib/datetime';
import { documentKindLabel } from '@/lib/import/groups';
import { canEdit } from '@/types/role';
import { fetchExtractions } from '../services/importClient';
import { ImportUploadCard } from './ImportUploadCard.client';
import { ExtractionStatusPill } from './statusPill';

const History = ({ editable }: { editable: boolean }) => {
  const { data, error, isLoading, reload } = useAsyncData(fetchExtractions);
  if (isLoading && !data) return <LoadingBlock />;
  if (error && !data) return <ErrorBlock message={error} onRetry={() => void reload()} />;
  const items = data ?? [];
  if (items.length === 0) {
    return <EmptyState title="読取りの履歴はまだありません" description="文書を読み取ると、ここに履歴が残ります。確認待ちの読取りは、あとから開いて反映できます。" />;
  }
  return (
    <section className="gt-card gt-card-table" aria-label="読取りの履歴">
      <h2 className="gt-card-title m-0">読取りの履歴</h2>
      <div className="gt-table-scroll mt-2">
        <table className="gt-table">
          <thead>
            <tr>
              <th title="上の行が文書のタイトル、下の行が文書の種類">文書・文書の種類</th>
              <th>状態</th>
              <th>読取り</th>
              <th>反映</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id}>
                {/* タイトルはファイル名のことが多い（区切りの無い長い英数字でも、列の中で折り返す） */}
                <td className="gt-wrap">
                  <div className="break-all">{item.documentTitle}</div>
                  <div className="text-[11.5px] text-text-muted">{documentKindLabel(item.documentKind)}</div>
                </td>
                <td>
                  <ExtractionStatusPill status={item.status} />
                </td>
                <td>
                  {formatDateTime(item.createdAt)}
                  <div className="text-[11.5px] text-text-muted">{item.createdByName ?? '—'}</div>
                </td>
                <td>
                  {item.appliedAt ? (
                    <>
                      {formatDateTime(item.appliedAt)}
                      <div className="text-[11.5px] text-text-muted">{item.appliedByName ?? '—'}</div>
                    </>
                  ) : (
                    '—'
                  )}
                </td>
                <td className="text-right">
                  <Link href={`/import/${item.id}`} className="text-primary underline underline-offset-2">
                    {item.status === 'extracted' && editable ? '確認して反映する' : '内容を見る'}
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export const ImportPage = () => {
  const { role } = useCurrentUser();
  const editable = canEdit(role);
  return (
    <div className="page-body">
      <PageHeading title="AI 取り込み" description="契約書・登記事項証明書・議事録・決算書を AI で読み取り、確かめてから台帳に反映します" />
      <div className="flex flex-col gap-4">
        <ImportUploadCard canUpload={editable} />
        <History editable={editable} />
      </div>
    </div>
  );
};
