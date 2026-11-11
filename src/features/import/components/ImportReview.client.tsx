'use client';

// 読取りの結果の確認画面。AI が読み取った値は「提案」で、ここで確かめて直し、「台帳に反映する」を押したときだけ台帳に書く。
// 反映済み・破棄済みの結果と、閲覧のみの人には、同じ内容を読み取り専用で見せる。

import React, { useCallback, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, CheckCircle2, ExternalLink, FileText, Loader2 } from 'lucide-react';
import { PageHeading } from '@/components/layout/PageHeading';
import { ConfirmDialog } from '@/components/resource/ConfirmDialog.client';
import { ErrorBlock, LoadingBlock, NoticeList } from '@/components/resource/parts';
import { Toast } from '@/components/ui/Toast.client';
import { useAsyncData } from '@/hooks/useAsyncData';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useToast } from '@/hooks/useToast';
import { formatDateTime } from '@/lib/datetime';
import { documentKindLabel, groupsOfKind } from '@/lib/import/groups';
import type { AppliedSummary, ExtractionResponse } from '@/lib/import/types';
import { errorMessage } from '@/lib/resources/client';
import { AI_PROVIDER_LABELS, isAiProviderId } from '@/types/ai';
import { canEdit } from '@/types/role';
import { useImportReview } from '../hooks/useImportReview';
import { appliedLinkOf, COMPANY_LINK } from '../services/appliedLinks';
import { applyExtraction, discardExtraction, fetchExtraction } from '../services/importClient';
import { summarizeApply } from '../services/reviewEdits';
import { ReviewGroup } from './ReviewGroup.client';
import { ExtractionStatusPill } from './statusPill';

const AppliedCard = ({ summary }: { summary: AppliedSummary }) => {
  const meetingHref = summary.created.find((entry) => entry.resource === 'meetings')?.items[0]?.href;
  return (
    <section className="gt-card" aria-label="台帳に反映した内容">
      <h2 className="gt-card-title m-0 flex items-center gap-2">
        <CheckCircle2 size={17} className="text-success" />
        台帳に反映した内容
      </h2>
      <ul className="list-none p-0 mt-3 mb-0 flex flex-col gap-2 text-[13.5px]">
        {summary.created.map((entry) => {
          const link = entry.resource === 'meeting-agenda-items' && meetingHref ? { path: meetingHref, label: '会議の詳細' } : appliedLinkOf(entry.resource, entry.items);
          return (
            <li key={entry.group} className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="font-semibold text-text-heading">
                {entry.label} {entry.items.length} 件
              </span>
              <span className="text-text-muted break-all">{entry.items.map((item) => item.label).join('、')}</span>
              {link && (
                <Link href={link.path} className="text-primary underline underline-offset-2 whitespace-nowrap">
                  {link.label}で見る
                </Link>
              )}
            </li>
          );
        })}
        {summary.companyFields.length > 0 && (
          <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-semibold text-text-heading">会社情報 {summary.companyFields.length} 項目を更新</span>
            <span className="text-text-muted">{summary.companyFields.map((field) => field.label).join('、')}</span>
            <Link href={COMPANY_LINK.path} className="text-primary underline underline-offset-2 whitespace-nowrap">
              {COMPANY_LINK.label}で見る
            </Link>
          </li>
        )}
      </ul>
    </section>
  );
};

const ReviewBody = ({ data, onApplied }: { data: ExtractionResponse; onApplied: (next: ExtractionResponse) => void }) => {
  const router = useRouter();
  const { role } = useCurrentUser();
  const { toast, showToast } = useToast({ durationMs: 5000 });
  const { extraction, context } = data;
  const { state, check, actions } = useImportReview(data);
  const [dialog, setDialog] = useState<'apply' | 'discard' | null>(null);

  const isPending = extraction.status === 'extracted';
  const readOnly = !isPending || !canEdit(role);
  const specs = groupsOfKind(extraction.documentKind);
  const hasRows = specs.some((spec) => (state[spec.key] ?? []).length > 0);
  const provider = isAiProviderId(extraction.provider) ? AI_PROVIDER_LABELS[extraction.provider] : extraction.provider;

  const apply = async () => {
    const next = await applyExtraction(extraction.id, state);
    setDialog(null);
    showToast('台帳に反映しました', 'success');
    onApplied(next);
  };

  const discard = async () => {
    await discardExtraction(extraction.id);
    router.push('/import');
  };

  return (
    <>
      <div className="flex flex-col gap-4" style={{ paddingBottom: readOnly ? 0 : '72px' }}>
        <section className="gt-card" aria-label="文書">
          <div className="gt-card-head">
            <div style={{ minWidth: 0 }}>
              <h2 className="gt-card-title m-0 flex items-center gap-2">
                <FileText size={17} className="shrink-0" />
                <span className="break-all">{extraction.document.title}</span>
              </h2>
              <p className="gt-card-sub m-0 break-all">
                {documentKindLabel(extraction.documentKind)}・{extraction.document.fileName}
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <ExtractionStatusPill status={extraction.status} />
              <a href={`/api/documents/${extraction.document.id}/download`} target="_blank" rel="noopener noreferrer" className="gt-btn">
                <ExternalLink size={14} />
                保存した文書を開く
              </a>
            </div>
          </div>
          {extraction.result.summary && <p className="text-[14px] leading-relaxed text-text-main mt-3 mb-0">{extraction.result.summary}</p>}
          <p className="text-[12.5px] text-text-muted mt-2 mb-0">
            {formatDateTime(extraction.createdAt)} に {extraction.createdByName ?? '（不明）'} が {provider}（{extraction.modelId}）で読取り
            {extraction.result.documentDate && `・文書の日付 ${extraction.result.documentDate}`}
            {extraction.appliedAt && `・${formatDateTime(extraction.appliedAt)} に ${extraction.appliedByName ?? '（不明）'} が反映`}
          </p>
          {isPending && (
            <p className="text-[12.5px] text-text-muted mt-2 mb-0">
              AI が読み取った値は候補です。保存した文書と見比べて直し、「台帳に反映する」を押したときだけ台帳に書き込みます。
            </p>
          )}
        </section>

        {extraction.appliedSummary && <AppliedCard summary={extraction.appliedSummary} />}
        {extraction.status === 'discarded' && (
          <NoticeList items={[{ level: 'info', message: 'この読取りの結果は破棄されています（台帳には反映していません）。文書はライブラリに残っています。' }]} />
        )}

        {(extraction.result.warnings.length > 0 || (isPending && check.notices.length > 0)) && (
          <NoticeList
            items={[
              ...extraction.result.warnings.map((message, index) => ({ level: 'warning' as const, message: `AI からの注意: ${message}`, key: `ai-${index}` })),
              ...(isPending ? check.notices.map((notice, index) => ({ ...notice, key: `check-${index}` })) : []),
            ]}
          />
        )}

        {!isPending && hasRows && (
          <p className="text-[13px] text-text-muted m-0">
            以下は、AI がこの文書から読み取った内容（反映の前の提案）です。{extraction.status === 'applied' && '反映のときに直した値や、今の台帳の内容は、上のリンク先の画面で確かめてください。'}
          </p>
        )}

        {!hasRows && <NoticeList items={[{ level: 'info', message: 'この文書から読み取れた項目はありません。文書の種類を選び直して、もう一度読み取ってください。' }]} />}

        {specs.map((spec) => (
          <ReviewGroup
            key={spec.key}
            spec={spec}
            kind={extraction.documentKind}
            state={state}
            context={context}
            check={check}
            actions={actions}
            readOnly={readOnly}
            archived={!isPending}
          />
        ))}
      </div>

      {!readOnly && (
        // 画面の右下に固定する（長い表を見ている間も、件数と反映のボタンが見えるように）
        <div className="gt-card fixed bottom-4 right-6 z-30 max-w-[calc(100vw-32px)]" style={{ padding: '10px 14px', boxShadow: 'var(--shadow-md)' }}>
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-[13px] text-text-main" role="status">
              反映の対象 <strong>{check.includedCount}</strong> 件
              {check.errorCount > 0 && <span className="text-danger ml-3">直す必要のある項目 {check.errorCount} 件</span>}
              {check.warningCount > 0 && <span className="text-text-muted ml-3">注意 {check.warningCount} 件</span>}
            </div>
            <div className="ml-auto flex gap-2 pl-4">
              <button type="button" className="gt-btn" onClick={() => setDialog('discard')}>
                破棄
              </button>
              <button type="button" className="gt-btn-primary" disabled={check.errorCount > 0 || check.includedCount === 0} onClick={() => setDialog('apply')}>
                台帳に反映する
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        isOpen={dialog === 'apply'}
        title="台帳に反映します"
        confirmLabel="反映する"
        destructive={false}
        onCancel={() => setDialog(null)}
        onConfirm={apply}
        message={
          <>
            <p className="mt-0 mb-2">確認した内容を台帳に書き込みます。</p>
            <ul className="mt-0 mb-2 pl-5">
              {summarizeApply(state).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
            {check.warningCount > 0 && <p className="mt-0 mb-2 text-text-muted">注意が {check.warningCount} 件あります。内容を確かめたうえで反映してください。</p>}
            <p className="m-0 text-text-muted text-[13px]">反映したあとの修正・削除は、それぞれの画面（株主名簿・資金調達など）で行います。</p>
          </>
        }
      />
      <ConfirmDialog
        isOpen={dialog === 'discard'}
        title="読取りの結果を破棄します"
        confirmLabel="破棄する"
        onCancel={() => setDialog(null)}
        onConfirm={discard}
        message="この読取りの結果を破棄します（台帳には何も書き込みません）。保存した文書はライブラリに残ります。"
      />
      <Toast toast={toast} />
    </>
  );
};

export const ImportReview = ({ id }: { id: string }) => {
  const load = useCallback(() => fetchExtraction(id), [id]);
  const { data, error, isLoading } = useAsyncData(load);
  // 反映のあとは、サーバが返した最新の状態（反映済み・読み取り専用）に差し替える
  const [applied, setApplied] = useState<ExtractionResponse | null>(null);
  const current = applied ?? data;

  return (
    <div className="page-body">
      <PageHeading
        title="読取りの確認"
        description="AI が文書から読み取った内容を確かめ、台帳に反映します"
        actions={
          <Link href="/import" className="gt-btn">
            <ArrowLeft size={14} />
            AI 取り込みに戻る
          </Link>
        }
      />
      {isLoading && !current ? (
        <LoadingBlock />
      ) : error && !current ? (
        <ErrorBlock message={errorMessage(error)} />
      ) : current ? (
        // 状態が変わったら（反映後）、行の状態を作り直す
        <ReviewBody key={`${current.extraction.id}-${current.extraction.status}`} data={current} onApplied={setApplied} />
      ) : (
        <div className="flex items-center gap-2 text-[13px] text-text-muted">
          <Loader2 size={15} className="animate-spin" />
        </div>
      )}
    </div>
  );
};
