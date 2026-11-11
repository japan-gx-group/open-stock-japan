'use client';

// 資金調達ラウンドと株式の種類の画面。

import React, { useState } from 'react';
import { PageHeading } from '@/components/layout/PageHeading';
import { ErrorBlock, LoadingBlock } from '@/components/resource/parts';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useEquitySnapshot } from '@/hooks/useEquitySnapshot';
import { canEdit } from '@/types/role';
import { FundingRoundsTab } from './FundingRoundsTab.client';
import { ShareClassesTab } from './ShareClassesTab.client';

const TABS = [
  { value: 'rounds', label: '資金調達ラウンド' },
  { value: 'classes', label: '株式の種類' },
] as const;
type RoundsTab = (typeof TABS)[number]['value'];

export const RoundsView = () => {
  const { role } = useCurrentUser();
  const editable = canEdit(role);
  const snapshotState = useEquitySnapshot();
  const [tab, setTab] = useState<RoundsTab>('rounds');
  const snapshot = snapshotState.data;

  const heading = (
    <PageHeading title="資金調達・種類株式" description="資金調達ラウンドごとの条件・割当て・登記の状況と、株式の種類（普通株式・優先株式）の内容を管理します。" />
  );

  if (snapshotState.isLoading && !snapshot) {
    return (
      <>
        {heading}
        <LoadingBlock />
      </>
    );
  }
  if (!snapshot) {
    return (
      <>
        {heading}
        <ErrorBlock message={snapshotState.error ?? 'データの取得に失敗しました'} onRetry={() => void snapshotState.reload()} />
      </>
    );
  }

  const reload = () => void snapshotState.reload();
  const counts: Record<RoundsTab, number> = { rounds: snapshot.fundingRounds.length, classes: snapshot.shareClasses.length };

  return (
    <>
      {heading}
      <div className="flex flex-col gap-4">
        {snapshotState.error && <ErrorBlock message={snapshotState.error} onRetry={reload} />}
        <div className="gt-tabs" role="tablist" aria-label="資金調達・種類株式の表示" style={{ marginTop: 0 }}>
          {TABS.map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              id={`rounds-tab-${item.value}`}
              aria-selected={tab === item.value}
              aria-controls="rounds-tabpanel"
              className={`gt-tab ${tab === item.value ? 'gt-tab-active' : ''}`}
              onClick={() => setTab(item.value)}
            >
              {item.label}
              <span className="gt-tab-count">{counts[item.value]}</span>
            </button>
          ))}
        </div>
        <div id="rounds-tabpanel" role="tabpanel" aria-labelledby={`rounds-tab-${tab}`}>
          {tab === 'rounds' ? (
            <FundingRoundsTab snapshot={snapshot} canEdit={editable} onChanged={reload} />
          ) : (
            <ShareClassesTab snapshot={snapshot} canEdit={editable} onChanged={reload} />
          )}
        </div>
      </div>
    </>
  );
};
