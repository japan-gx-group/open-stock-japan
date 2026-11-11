'use client';

// 操作の記録: 監査ログの一覧。期間・人・種類・記録元・結果・キーワードで絞り込み、行を押すと詳細を開く。
// 読むのは API（/api/audit/logs）経由で、権限はサーバが確かめる。CSV の出力もサーバが作る（出力したことも記録に残る）。

import React, { useMemo, useState } from 'react';
import { Download, Loader2, Search, X } from 'lucide-react';
import { ErrorBlock, LoadingBlock } from '@/components/resource/parts';
import { errorMessage } from '@/lib/resources/client';
import { useAccountAccess } from '../hooks/useAccountAccess';
import { useAuditLogs } from '../hooks/useAuditLogs';
import { downloadAuditLogCsv } from '../services/client';
import { summarizeColumns } from '../services/diff';
import { EXPORT_MAX_ROWS, hasAnyFilter, MAX_KEYWORD_LENGTH, SYSTEM_USER_FILTER, type AuditLogFilters } from '../services/filters';
import { formatJstDateTime } from '../services/format';
import {
  AUDIT_CATEGORIES,
  auditActionLabel,
  auditOutcomeLabel,
  auditOutcomeTone,
  auditSourceLabel,
  describeActor,
  describeEntity,
  OTHER_CATEGORY,
  OTHER_CATEGORY_LABEL,
  tableLabel,
} from '../services/labels';
import { AUDIT_OUTCOMES, AUDIT_SOURCES, type AuditLogItem, type AuditOutcome, type AuditSource } from '../types';
import { AuditLogDetailModal } from './AuditLogDetail.client';

const formatCount = (value: number): string => value.toLocaleString('ja-JP');

const shorten = (value: string, max = 12): string => (value.length > max ? `${value.slice(0, max)}…` : value);

interface AuditLogListProps {
  filters: AuditLogFilters;
  onFiltersChange: (filters: AuditLogFilters) => void;
}

const LogRow = ({ item, onOpen }: { item: AuditLogItem; onOpen: (item: AuditLogItem) => void }) => {
  const actor = describeActor(item);
  const entity = describeEntity(item);
  const changed = summarizeColumns(item.entityName, item.changedColumns);
  const actionLabel = auditActionLabel(item.action, item.source);
  return (
    <tr className="gt-row-link" onClick={() => onOpen(item)}>
      <td className="tabular-nums">
        {formatJstDateTime(item.createdAt)}
        <div className="text-[11.5px] text-text-muted">{item.seq != null ? `連番 ${formatCount(item.seq)}` : '連番なし'}</div>
      </td>
      <td>
        <div className="max-w-[190px] truncate" title={actor.primary}>
          {actor.primary}
        </div>
        {/* メールアドレスと当時のロールは、だれの操作かを見分けるのに要るので切らない（長すぎるものだけ … で切る） */}
        {actor.secondary && (
          <div className="max-w-[190px] truncate text-[11.5px] text-text-muted" title={actor.secondary}>
            {actor.secondary}
          </div>
        )}
      </td>
      <td className="gt-wrap">
        {/* 行のどこを押しても開くが、キーボードで開けるように実ボタンを 1 つ置く */}
        <button
          type="button"
          className="gt-row-toggle bg-transparent border-none p-0 cursor-pointer font-medium"
          aria-label={`${actionLabel} の詳細を開く`}
          onClick={(event) => {
            event.stopPropagation();
            onOpen(item);
          }}
        >
          {actionLabel}
        </button>
        <div className="text-[11.5px] text-text-muted">{auditSourceLabel(item.source)}</div>
      </td>
      <td className="gt-wrap">
        <div className="break-words">
          <span className="text-text-body">{entity.type}</span>
          {entity.name && <span className="font-medium">「{entity.name}」</span>}
        </div>
        {changed && (
          <div className="gt-cell-clip text-[11.5px] text-text-muted" title={`変更した項目: ${changed}`}>
            変更した項目: {changed}
          </div>
        )}
      </td>
      <td>
        <span className={`gt-pill gt-pill-sm ${auditOutcomeTone(item.outcome)}`}>{auditOutcomeLabel(item.outcome)}</span>
      </td>
      <td>
        {item.ipAddress ? (
          <span className="block max-w-[112px] truncate font-mono text-[12px] text-text-body" title={item.ipAddress}>
            {item.ipAddress}
          </span>
        ) : (
          <span className="text-text-muted">—</span>
        )}
      </td>
    </tr>
  );
};

export const AuditLogList = ({ filters, onFiltersChange }: AuditLogListProps) => {
  const logs = useAuditLogs(filters);
  const accounts = useAccountAccess();
  const [selected, setSelected] = useState<AuditLogItem | null>(null);
  const [isExporting, setIsExporting] = useState(false);
  const [exportNote, setExportNote] = useState<{ tone: 'info' | 'error'; message: string } | null>(null);

  // キーワードは打っている途中では絞り込まず、Enter か「検索」で反映する。
  // 条件が外から差し替えられたとき（詳細からの絞り込み・クリア）は、入力欄も合わせる
  const appliedKeyword = filters.q ?? '';
  const [keyword, setKeyword] = useState({ applied: appliedKeyword, text: appliedKeyword });
  if (keyword.applied !== appliedKeyword) setKeyword({ applied: appliedKeyword, text: appliedKeyword });

  const update = (patch: Partial<AuditLogFilters>) => {
    setExportNote(null);
    onFiltersChange({ ...filters, ...patch });
  };

  const userOptions = useMemo(() => {
    const options = (accounts.data?.accounts ?? []).map((account) => ({ value: account.id, label: account.fullName || account.email }));
    // 一覧に無い人（削除済みのアカウントなど）で絞り込んでいるときも、選択中として出す
    if (filters.userId && filters.userId !== SYSTEM_USER_FILTER && !options.some((option) => option.value === filters.userId)) {
      options.push({ value: filters.userId, label: '一覧にないアカウント（削除済みなど）' });
    }
    return options;
  }, [accounts.data, filters.userId]);

  const submitKeyword = (event: React.FormEvent) => {
    event.preventDefault();
    update({ q: keyword.text.trim() || undefined });
  };

  const exportCsv = async () => {
    if (isExporting) return;
    setIsExporting(true);
    setExportNote(null);
    try {
      const result = await downloadAuditLogCsv(filters);
      const rows = result.rowCount != null ? `${formatCount(result.rowCount)} 件` : '';
      setExportNote({
        tone: 'info',
        message: result.truncated
          ? `条件に合う ${formatCount(result.totalCount ?? 0)} 件のうち、新しい順に ${rows}を出力しました（上限 ${formatCount(result.maxRows ?? EXPORT_MAX_ROWS)} 件）。残りは、期間を区切って出力してください。`
          : `${rows}を CSV に出力しました（${result.fileName}）。出力したことも記録に残しました。`,
      });
      // 出力したことの記録が 1 行増えるので、読み直す
      void logs.reload();
    } catch (caught) {
      setExportNote({ tone: 'error', message: errorMessage(caught, 'CSV の出力に失敗しました') });
    } finally {
      setIsExporting(false);
    }
  };

  const countText =
    logs.total == null
      ? ''
      : logs.items.length < logs.total
        ? `${formatCount(logs.total)} 件中 ${formatCount(logs.items.length)} 件を表示`
        : `${formatCount(logs.total)} 件`;

  return (
    <div className="flex flex-col gap-4">
      <form className="gt-filter-bar" style={{ marginTop: 0 }} role="search" aria-label="記録の絞り込み" onSubmit={submitKeyword}>
        <div className="gt-filter-field" style={{ flex: '0 0 auto' }} role="group" aria-labelledby="audit-filter-period">
          <span id="audit-filter-period" className="gt-field-label">
            期間（日本時間）
          </span>
          <div className="flex items-center gap-2">
            <input
              type="date"
              className="gt-field"
              style={{ width: '148px' }}
              aria-label="期間の始まり"
              value={filters.from ?? ''}
              max={filters.to || undefined}
              onChange={(event) => update({ from: event.target.value || undefined })}
            />
            <span className="text-[13px] text-text-muted">〜</span>
            <input
              type="date"
              className="gt-field"
              style={{ width: '148px' }}
              aria-label="期間の終わり"
              value={filters.to ?? ''}
              min={filters.from || undefined}
              onChange={(event) => update({ to: event.target.value || undefined })}
            />
          </div>
        </div>
        <div className="gt-filter-field">
          <label htmlFor="audit-filter-user" className="gt-field-label">
            操作した人
          </label>
          <select
            id="audit-filter-user"
            className="gt-field gt-field-select w-full"
            value={filters.userId ?? ''}
            onChange={(event) => update({ userId: event.target.value || undefined })}
          >
            <option value="">すべて</option>
            {userOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
            <option value={SYSTEM_USER_FILTER}>システム（人によらない処理）</option>
          </select>
        </div>
        <div className="gt-filter-field">
          <label htmlFor="audit-filter-category" className="gt-field-label">
            種類
          </label>
          <select
            id="audit-filter-category"
            className="gt-field gt-field-select w-full"
            value={filters.category ?? ''}
            onChange={(event) => update({ category: event.target.value || undefined })}
          >
            <option value="">すべて</option>
            {AUDIT_CATEGORIES.map((category) => (
              <option key={category.value} value={category.value}>
                {category.label}
              </option>
            ))}
            <option value={OTHER_CATEGORY}>{OTHER_CATEGORY_LABEL}</option>
          </select>
        </div>
        <div className="gt-filter-field">
          <label htmlFor="audit-filter-source" className="gt-field-label">
            記録元
          </label>
          <select
            id="audit-filter-source"
            className="gt-field gt-field-select w-full"
            value={filters.source ?? ''}
            onChange={(event) => update({ source: (event.target.value || undefined) as AuditSource | undefined })}
          >
            <option value="">すべて</option>
            {AUDIT_SOURCES.map((source) => (
              <option key={source} value={source}>
                {auditSourceLabel(source)}
              </option>
            ))}
          </select>
        </div>
        <div className="gt-filter-field" style={{ flexBasis: '120px' }}>
          <label htmlFor="audit-filter-outcome" className="gt-field-label">
            結果
          </label>
          <select
            id="audit-filter-outcome"
            className="gt-field gt-field-select w-full"
            value={filters.outcome ?? ''}
            onChange={(event) => update({ outcome: (event.target.value || undefined) as AuditOutcome | undefined })}
          >
            <option value="">すべて</option>
            {AUDIT_OUTCOMES.map((outcome) => (
              <option key={outcome} value={outcome}>
                {auditOutcomeLabel(outcome)}
              </option>
            ))}
          </select>
        </div>
        <div className="gt-filter-field gt-filter-field-grow">
          <label htmlFor="audit-filter-keyword" className="gt-field-label">
            キーワード
          </label>
          <input
            id="audit-filter-keyword"
            type="search"
            className="gt-field w-full"
            placeholder="操作・メールアドレス・IP アドレス・詳細"
            maxLength={MAX_KEYWORD_LENGTH}
            value={keyword.text}
            onChange={(event) => setKeyword({ applied: appliedKeyword, text: event.target.value })}
          />
        </div>
        <button type="submit" className="gt-btn">
          <Search size={14} />
          検索
        </button>
        {hasAnyFilter(filters) && (
          <button type="button" className="gt-btn" onClick={() => onFiltersChange({})}>
            条件をクリア
          </button>
        )}
      </form>

      {(filters.requestId || filters.entityId || filters.entityName) && (
        <div className="flex flex-wrap items-center gap-2 text-[12.5px] text-text-body" aria-label="詳細から指定した条件">
          {filters.requestId && (
            <span className="gt-pill gt-pill-accent" title={filters.requestId}>
              同じリクエストの記録: {shorten(filters.requestId)}
              <button
                type="button"
                className="bg-transparent border-none p-0 cursor-pointer inline-flex text-inherit"
                aria-label="リクエストでの絞り込みを外す"
                onClick={() => update({ requestId: undefined })}
              >
                <X size={13} />
              </button>
            </span>
          )}
          {(filters.entityId || filters.entityName) && (
            <span className="gt-pill gt-pill-accent" title={[filters.entityName, filters.entityId].filter(Boolean).join(' / ')}>
              対象: {filters.entityName ? tableLabel(filters.entityName) : ''}
              {filters.entityId ? ` ${shorten(filters.entityId, 8)}` : ''}
              <button
                type="button"
                className="bg-transparent border-none p-0 cursor-pointer inline-flex text-inherit"
                aria-label="対象での絞り込みを外す"
                onClick={() => update({ entityName: undefined, entityId: undefined })}
              >
                <X size={13} />
              </button>
            </span>
          )}
        </div>
      )}

      {logs.isLoading ? (
        <LoadingBlock />
      ) : (
        <div className="gt-card gt-card-table">
          <div className="gt-card-head items-center flex-wrap">
            <div className="text-[12.5px] text-text-muted" role="status" aria-live="polite">
              {logs.isRefreshing ? '読み込んでいます…' : countText}
            </div>
            <button type="button" className="gt-btn" disabled={isExporting || logs.total === 0} onClick={() => void exportCsv()}>
              {isExporting ? <Loader2 size={15} className="animate-spin" /> : <Download size={15} />}
              CSV 出力
            </button>
          </div>
          {exportNote && (
            <p
              role={exportNote.tone === 'error' ? 'alert' : 'status'}
              className={`text-[12.5px] leading-relaxed m-0 mt-2 ${exportNote.tone === 'error' ? 'text-danger' : 'text-text-body'}`}
            >
              {exportNote.message}
            </p>
          )}
          {logs.error && (
            <div className="mt-3">
              <ErrorBlock message={logs.error} onRetry={() => void logs.reload()} />
            </div>
          )}
          <div className={`gt-table-scroll mt-2 ${logs.isRefreshing ? 'opacity-60' : ''}`}>
            <table className="gt-table">
              <thead>
                <tr>
                  <th>日時（日本時間）</th>
                  <th>操作した人</th>
                  <th>操作</th>
                  <th>対象</th>
                  <th>結果</th>
                  <th title="接続元の IP アドレス">接続元</th>
                </tr>
              </thead>
              <tbody>
                {logs.items.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="gt-table-empty">
                      {logs.error ? '記録を読み込めませんでした。' : hasAnyFilter(filters) ? '条件に合う記録がありません。' : '記録はまだありません。'}
                    </td>
                  </tr>
                ) : (
                  logs.items.map((item) => <LogRow key={item.id} item={item} onOpen={setSelected} />)
                )}
              </tbody>
            </table>
          </div>
          {logs.hasMore && (
            <div className="flex flex-col items-center gap-2 py-3">
              {logs.loadMoreError && (
                <span role="alert" className="text-[12.5px] text-danger">
                  {logs.loadMoreError}
                </span>
              )}
              <button type="button" className="gt-btn" disabled={logs.isLoadingMore} onClick={() => void logs.loadMore()}>
                {logs.isLoadingMore && <Loader2 size={15} className="animate-spin" />}
                さらに読み込む
              </button>
            </div>
          )}
        </div>
      )}

      <p className="text-[12px] leading-relaxed text-text-muted m-0">
        CSV 出力は、いまの絞り込みの条件に合う記録を、新しい順に最大 {formatCount(EXPORT_MAX_ROWS)} 件まで出力します（超える場合は期間を区切ってください）。
        出力したこと自体も記録に残ります。「データの変更」は、データベースが変更のたびに自動で残す記録（変更前後の値つき）です。
      </p>

      {selected && (
        <AuditLogDetailModal
          key={selected.id}
          item={selected}
          onClose={() => setSelected(null)}
          onFilter={(next) => {
            setSelected(null);
            setExportNote(null);
            onFiltersChange(next);
          }}
        />
      )}
    </div>
  );
};
