'use client';

// 監査ログの画面（操作の記録・アカウントの棚卸し・改ざんの検査）。
// 読めるかどうかはサーバ（ページと API の requireAuditReader）が確かめる。読めない人には、理由だけを出す。

import React, { useState } from 'react';
import { PageHeading } from '@/components/layout/PageHeading';
import { EmptyState } from '@/components/resource/parts';
import type { AuditLogFilters } from '../services/filters';
import { AccountReview } from './AccountReview.client';
import { AuditLogList } from './AuditLogList.client';
import { ChainVerifyPanel } from './ChainVerifyPanel.client';

const TABS = [
  { value: 'logs', label: '操作の記録' },
  { value: 'accounts', label: 'アカウントの棚卸し' },
  { value: 'verify', label: '改ざんの検査' },
] as const;
type AuditTab = (typeof TABS)[number]['value'];

interface AuditLogScreenProps {
  /** 読めない人に出す理由（サーバの権限の確認の結果）。読める人は null */
  deniedMessage: string | null;
}

export const AuditLogScreen = ({ deniedMessage }: AuditLogScreenProps) => {
  const [tab, setTab] = useState<AuditTab>('logs');
  // タブを行き来しても、絞り込みの条件は残す
  const [filters, setFilters] = useState<AuditLogFilters>({});

  const heading = (
    <PageHeading
      title="監査ログ"
      description="だれが・いつ・どこから・何を・どう変えたかの記録です。記録は追記専用で、あとから書き換え・削除はできません。"
    />
  );

  if (deniedMessage) {
    return (
      <div className="page-body">
        {heading}
        <EmptyState
          title={deniedMessage}
          description="監査ログとアカウントの棚卸しには、すべての人の操作の記録・接続元が含まれます。見る必要があるときは、組織の管理者に依頼してください。"
        />
      </div>
    );
  }

  return (
    <div className="page-body">
      {heading}
      <div className="flex flex-col gap-4">
        <div className="gt-tabs" role="tablist" aria-label="監査ログの表示" style={{ marginTop: 0 }}>
          {TABS.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              id={`audit-tab-${item.value}`}
              aria-selected={tab === item.value}
              aria-controls="audit-tabpanel"
              className={`gt-tab ${tab === item.value ? 'gt-tab-active' : ''}`}
              onClick={() => setTab(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <div id="audit-tabpanel" role="tabpanel" aria-labelledby={`audit-tab-${tab}`}>
          {tab === 'logs' && <AuditLogList filters={filters} onFiltersChange={setFilters} />}
          {tab === 'accounts' && <AccountReview />}
          {tab === 'verify' && <ChainVerifyPanel />}
        </div>
      </div>
    </div>
  );
};
