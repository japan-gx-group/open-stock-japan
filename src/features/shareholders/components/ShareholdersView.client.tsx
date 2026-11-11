'use client';

// 株主名簿の画面（株主名簿・権利者・株式の異動の 3 つのタブ）。

import React, { useMemo, useState } from 'react';
import { PageHeading } from '@/components/layout/PageHeading';
import { ErrorBlock, LoadingBlock, NoticeList } from '@/components/resource/parts';
import { useCompany } from '@/hooks/useCompany';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useEquitySnapshot } from '@/hooks/useEquitySnapshot';
import { checkLedger } from '@/lib/equity/ledger';
import type { Stakeholder } from '@/lib/equity/types';
import { canEdit } from '@/types/role';
import { SHAREHOLDERS_TABS, type ShareholdersTab } from '../types';
import { RegistryTab } from './RegistryTab.client';
import { StakeholdersTab } from './StakeholdersTab.client';
import { TransactionsTab } from './TransactionsTab.client';

export interface ShareholdersViewProps {
  initialTab?: ShareholdersTab;
  /**
   * 拡張ポイント: 「権利者」タブの各行の「ポータル」列に出す操作（株主ポータルへの招待など）。
   * 渡されたときだけ列を出す。関数を渡すので、Client Component から描画すること。
   */
  renderStakeholderActions?: (stakeholder: Stakeholder) => React.ReactNode;
}

export const ShareholdersView = ({ initialTab = 'registry', renderStakeholderActions }: ShareholdersViewProps) => {
  const { role } = useCurrentUser();
  const editable = canEdit(role);
  const snapshotState = useEquitySnapshot();
  const company = useCompany();
  const [tab, setTab] = useState<ShareholdersTab>(initialTab);

  const snapshot = snapshotState.data;
  const authorizedShares = typeof company.data?.authorizedShares === 'number' ? company.data.authorizedShares : null;
  // 会社情報を読み終えるまでは、発行可能株式総数の確認を除いた結果になる
  const issues = useMemo(() => (snapshot ? checkLedger(snapshot, { authorizedShares }) : []), [snapshot, authorizedShares]);

  const heading = (
    <PageHeading
      title="株主名簿"
      description="株主名簿（会社法121条）と、株主・新株予約権者・投資家の情報、株式の異動を管理します。"
    />
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
  const counts: Record<ShareholdersTab, number | null> = {
    registry: null,
    stakeholders: snapshot.stakeholders.length,
    transactions: snapshot.shareTransactions.length,
  };

  return (
    <>
      {heading}
      <div className="flex flex-col gap-4">
        {snapshotState.error && <ErrorBlock message={snapshotState.error} onRetry={reload} />}
        <NoticeList items={issues.map((issue, index) => ({ level: issue.level, message: issue.message, key: `${issue.code}-${index}` }))} />

        <section className="gt-card gt-card-table">
          <div className="gt-tabs" role="tablist" aria-label="株主名簿の表示" style={{ marginTop: 0 }}>
            {SHAREHOLDERS_TABS.map((item) => (
              <button
                key={item.value}
                type="button"
                role="tab"
                id={`shareholders-tab-${item.value}`}
                aria-selected={tab === item.value}
                aria-controls="shareholders-tabpanel"
                className={`gt-tab ${tab === item.value ? 'gt-tab-active' : ''}`}
                onClick={() => setTab(item.value)}
              >
                {item.label}
                {counts[item.value] != null && <span className="gt-tab-count">{counts[item.value]}</span>}
              </button>
            ))}
          </div>
          <div id="shareholders-tabpanel" role="tabpanel" aria-labelledby={`shareholders-tab-${tab}`} className="pt-4">
            {tab === 'registry' && (
              <RegistryTab snapshot={snapshot} companyName={typeof company.data?.name === 'string' ? company.data.name : ''} />
            )}
            {tab === 'stakeholders' && (
              <StakeholdersTab snapshot={snapshot} canEdit={editable} onChanged={reload} renderActions={renderStakeholderActions} />
            )}
            {tab === 'transactions' && (
              <TransactionsTab
                snapshot={snapshot}
                canEdit={editable}
                onChanged={reload}
                hasBoardOfDirectors={company.governance.hasBoardOfDirectors}
                hasTransferRestriction={company.data ? company.data.hasTransferRestriction !== false : null}
              />
            )}
          </div>
        </section>
      </div>
    </>
  );
};
