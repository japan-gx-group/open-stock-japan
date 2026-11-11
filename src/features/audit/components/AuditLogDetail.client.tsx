'use client';

// 監査ログの 1 行の詳細。すべての項目と、変更前後の値（項目の日本語名つき）を出す。
// 一覧の行（値の中身を持たない）をすぐに出し、変更前後の値・ハッシュなどは API から読んで足す。

import React, { useCallback } from 'react';
import { Filter } from 'lucide-react';
import { ErrorBlock, LoadingBlock } from '@/components/resource/parts';
import { Modal } from '@/components/ui/Modal.client';
import { useAsyncData } from '@/hooks/useAsyncData';
import { fetchAuditLogDetail } from '../services/client';
import { buildAuditDiff, formatDetailText, type AuditDiff } from '../services/diff';
import type { AuditLogFilters } from '../services/filters';
import { formatJstDateTime, toUtcIso } from '../services/format';
import {
  auditActionLabel,
  auditCategoryLabel,
  auditCategoryOf,
  auditOutcomeLabel,
  auditOutcomeTone,
  auditRoleLabel,
  auditSourceLabel,
  describeActor,
  describeEntity,
  SYSTEM_ACTOR_LABEL,
} from '../services/labels';
import type { AuditLogItem } from '../types';

const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-3 py-2 border-b border-border last:border-b-0">
    <dt className="text-[12.5px] text-text-muted leading-relaxed">{label}</dt>
    <dd className="m-0 text-[13px] text-text-heading leading-relaxed break-words min-w-0">{children}</dd>
  </div>
);

const Mono = ({ children }: { children: React.ReactNode }) => (
  <span className="font-mono text-[12px] break-all text-text-body">{children}</span>
);

const FilterLink = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button
    type="button"
    className="inline-flex items-center gap-1 text-[12.5px] text-primary bg-transparent border-none p-0 cursor-pointer hover:underline"
    onClick={onClick}
  >
    <Filter size={12} />
    {label}
  </button>
);

const DIFF_TITLES: Record<AuditDiff['kind'], string> = {
  insert: '追加した内容',
  update: '変更した項目',
  delete: '削除した内容',
};

const DiffTable = ({ diff }: { diff: AuditDiff }) => (
  <section aria-label="変更前と変更後の値">
    <h4 className="text-[13.5px] font-semibold text-text-heading m-0 mb-1">{DIFF_TITLES[diff.kind]}</h4>
    <p className="text-[12px] text-text-muted m-0 mb-2">
      {diff.kind === 'update'
        ? '変わった項目だけを記録しています。'
        : diff.kind === 'insert'
          ? '追加した行のすべての項目です（変更前はありません）。'
          : '削除した行のすべての項目です（変更後はありません）。'}
    </p>
    <div className="gt-table-scroll">
      <table className="gt-table">
        <thead>
          <tr>
            <th>項目</th>
            <th>変更前</th>
            <th>変更後</th>
          </tr>
        </thead>
        <tbody>
          {diff.rows.map((row) => (
            <tr key={row.column}>
              <td className="gt-wrap-sm align-top" title={row.column}>
                {row.label}
              </td>
              <td className="gt-wrap-sm align-top whitespace-pre-wrap break-all text-text-body">{row.before ?? '—'}</td>
              <td className="gt-wrap-sm align-top whitespace-pre-wrap break-all">{row.after ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </section>
);

interface AuditLogDetailModalProps {
  /** 一覧で選んだ行 */
  item: AuditLogItem;
  onClose: () => void;
  /** 条件を差し替えて一覧を絞り込む（同じリクエスト・同じ人・同じ対象の記録を見る） */
  onFilter: (filters: AuditLogFilters) => void;
}

export const AuditLogDetailModal = ({ item, onClose, onFilter }: AuditLogDetailModalProps) => {
  const load = useCallback(() => fetchAuditLogDetail(item.id), [item.id]);
  const detail = useAsyncData(load);
  const full = detail.data;
  const current = full ?? item;

  const actor = describeActor(current);
  const entity = describeEntity(current);
  const diff = full ? buildAuditDiff(full.entityName, full.oldValues, full.newValues) : null;
  const detailText = full ? formatDetailText(full.detail) : '';

  return (
    <Modal isOpen onClose={onClose} title="記録の詳細" size="xl">
      <div className="flex flex-col gap-5">
        <dl className="m-0">
          <Row label="日時">
            <span className="tabular-nums">{formatJstDateTime(current.createdAt)}</span>
            <span className="text-text-muted">（日本時間）</span>
            <div className="text-[12px] text-text-muted tabular-nums">UTC: {toUtcIso(current.createdAt)}</div>
          </Row>
          <Row label="操作">
            <div className="font-medium">{auditActionLabel(current.action, current.source)}</div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
              <Mono>{current.action}</Mono>
              <span className="gt-pill gt-pill-sm gt-pill-neutral">{auditSourceLabel(current.source)}</span>
              <span className="gt-pill gt-pill-sm gt-pill-neutral">{auditCategoryLabel(auditCategoryOf(current.action))}</span>
              <span className={`gt-pill gt-pill-sm ${auditOutcomeTone(current.outcome)}`}>{auditOutcomeLabel(current.outcome)}</span>
            </div>
          </Row>
          <Row label="操作した人">
            <div>{actor.primary}</div>
            {actor.primary !== SYSTEM_ACTOR_LABEL && (
              <div className="text-[12px] text-text-muted">
                {[current.actorEmail, current.actorRole ? `当時のロール: ${auditRoleLabel(current.actorRole)}` : null].filter(Boolean).join('・')}
              </div>
            )}
            {actor.primary === SYSTEM_ACTOR_LABEL && (
              <div className="text-[12px] text-text-muted">ログインした人によらない処理、または操作した人を特定できない記録です。</div>
            )}
            {current.userId && (
              <div className="mt-1">
                <FilterLink label="この人の記録を見る" onClick={() => onFilter({ userId: current.userId ?? undefined })} />
              </div>
            )}
          </Row>
          <Row label="対象">
            <div>
              {entity.type}
              {entity.name && <span className="font-medium">「{entity.name}」</span>}
            </div>
            <div className="text-[12px] text-text-muted">
              <Mono>
                {current.entityName}
                {current.entityId ? ` / ${current.entityId}` : ''}
              </Mono>
            </div>
            {current.entityId && (
              <div className="mt-1">
                <FilterLink
                  label="この対象の記録を見る"
                  onClick={() => onFilter({ entityName: current.entityName, entityId: current.entityId ?? undefined })}
                />
              </div>
            )}
          </Row>
          <Row label="接続元">{current.ipAddress ? <Mono>{current.ipAddress}</Mono> : <span className="text-text-muted">記録なし</span>}</Row>
          {full && (
            <Row label="ブラウザ">
              {full.userAgent ? <span className="text-[12px] break-all text-text-body">{full.userAgent}</span> : <span className="text-text-muted">記録なし</span>}
            </Row>
          )}
          <Row label="リクエストの番号">
            {current.requestId ? (
              <>
                <Mono>{current.requestId}</Mono>
                <div className="mt-1">
                  <FilterLink label="同じリクエストの記録を見る" onClick={() => onFilter({ requestId: current.requestId ?? undefined })} />
                </div>
              </>
            ) : (
              <span className="text-text-muted">記録なし</span>
            )}
          </Row>
          <Row label="連番">
            {current.seq != null ? (
              <span className="tabular-nums">{current.seq.toLocaleString('ja-JP')}</span>
            ) : (
              <span className="text-text-muted">なし（改ざんの検査の仕組みを入れる前の記録）</span>
            )}
          </Row>
          {full && current.seq != null && (
            <>
              <Row label="ハッシュ">
                <Mono>{full.hash}</Mono>
              </Row>
              <Row label="直前のハッシュ">
                {full.prevHash ? <Mono>{full.prevHash}</Mono> : <span className="text-text-muted">なし（最初の記録）</span>}
              </Row>
            </>
          )}
          <Row label="記録のID">
            <Mono>{current.id}</Mono>
          </Row>
        </dl>

        {detail.isLoading && !full && <LoadingBlock label="変更前後の値を読み込んでいます…" />}
        {detail.error && !full && <ErrorBlock message={detail.error} onRetry={() => void detail.reload()} />}

        {diff && <DiffTable diff={diff} />}

        {detailText && (
          <section aria-label="アプリが残した詳細">
            <h4 className="text-[13.5px] font-semibold text-text-heading m-0 mb-2">アプリが残した詳細</h4>
            <pre className="m-0 rounded-md border border-border bg-bg-subtle p-3 text-[12px] leading-relaxed text-text-body whitespace-pre-wrap break-all font-mono">
              {detailText}
            </pre>
          </section>
        )}

        <div className="flex justify-end">
          <button type="button" className="gt-btn" onClick={onClose}>
            閉じる
          </button>
        </div>
      </div>
    </Modal>
  );
};
