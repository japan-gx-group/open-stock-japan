'use client';

import React, { useRef, useState } from 'react';
import { PageHeading } from '@/components/layout/PageHeading';
import { CompanyInfo } from './CompanyInfo.client';
import { MemberList } from './MemberList.client';
import { FiscalYearList } from './FiscalYearList.client';
import { AiSettings } from '@/features/ai/components/AiSettings.client';
import { SecurityPolicyCard } from './SecurityPolicyCard.client';
import { CheckCircle, AlertCircle } from 'lucide-react';

export const CompanySettings = () => {
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [fiscalYearListRefreshKey, setFiscalYearListRefreshKey] = useState(0);

  // 前のトーストの消去タイマーが後から表示したトーストを早期に消さないよう、表示のたびにキャンセルする
  // （AccountSettings と同じ方針）。
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showToast = (message: string, type: 'success' | 'error') => {
    if (toastTimerRef.current !== null) {
      clearTimeout(toastTimerRef.current);
    }
    setToast({ message, type });
    toastTimerRef.current = setTimeout(() => setToast(null), 3000);
  };

  return (
    <>
      <div className="page-body page-body-narrow">
        <PageHeading
          title="組織・メンバー設定"
          description="企業情報・事業年度・メンバー・AI の管理（変更は管理者のみ）"
        />
        <div className="flex flex-col" style={{ gap: '14px' }}>
        <CompanyInfo
          showToast={showToast}
          onSaved={() => setFiscalYearListRefreshKey((key) => key + 1)}
        />
        {/* 事業年度は自組織マスタ */}
        <FiscalYearList showToast={showToast} refreshKey={fiscalYearListRefreshKey} />
        <MemberList showToast={showToast} />
        {/* ログインの守り方（二要素認証の必須化・パスワードの決まり・セッションの有効期限） */}
        <SecurityPolicyCard showToast={showToast} />
        <AiSettings showToast={showToast} />
        </div>
      </div>

      {toast && (
        <div
          className={`fixed top-5 right-5 z-[9999] flex items-center gap-3 px-6 py-4 rounded-md border shadow-md animate-toast-in ${
            toast.type === 'success'
              ? 'bg-primary/5 border-primary/30 text-primary'
              : 'bg-danger/5 border-danger/30 text-danger'
          }`}
        >
          {toast.type === 'success' ? <CheckCircle size={20} /> : <AlertCircle size={20} />}
          <span className="text-sm font-semibold text-text-main">{toast.message}</span>
        </div>
      )}
    </>
  );
};
