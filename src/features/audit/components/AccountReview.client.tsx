'use client';

// アカウントの棚卸し: 組織のすべてのアカウント（株主のアカウントを含む）と、受け取られていない招待の一覧。
// アクセス権の定期的な見直し（もう使わない人が残っていないか）に使う。読むのは API（/api/audit/accounts）経由。

import React, { useState } from 'react';
import Link from 'next/link';
import { Download, Loader2 } from 'lucide-react';
import { ErrorBlock, LoadingBlock } from '@/components/resource/parts';
import { errorMessage } from '@/lib/resources/client';
import { useAccountAccess } from '../hooks/useAccountAccess';
import { daysSinceLastSignIn, DORMANT_DAYS } from '../services/accessReview';
import { downloadAccountAccessCsv } from '../services/client';
import { formatJstDate, formatJstDateTime } from '../services/format';
import { accountStatusLabel, accountStatusTone, auditRoleLabel } from '../services/labels';
import type { AccountAccessItem, PendingInviteItem } from '../types';

const AccountRow = ({ account }: { account: AccountAccessItem }) => {
  const days = daysSinceLastSignIn(account.lastSignInAt);
  return (
    <tr>
      <td className="gt-wrap-sm">
        <div className="font-medium break-words">{account.fullName || '（氏名の登録なし）'}</div>
        {/* どの株主のアカウントかは見直しに要るので、切らずに折り返す */}
        {account.stakeholderName && <div className="text-[11.5px] text-text-muted break-words">紐づく株主: {account.stakeholderName}</div>}
      </td>
      <td>
        <span className="block max-w-[240px] truncate" title={account.email}>
          {account.email}
        </span>
      </td>
      <td>{auditRoleLabel(account.role)}</td>
      <td className="tabular-nums">{formatJstDate(account.createdAt)}</td>
      <td className="tabular-nums">
        {account.lastSignInAt ? (
          <>
            {formatJstDateTime(account.lastSignInAt).slice(0, 16)}
            <div className="text-[11.5px] text-text-muted">{days === 0 ? '24 時間以内' : `${days} 日前`}</div>
          </>
        ) : (
          <span className="text-text-muted">なし</span>
        )}
      </td>
      <td>
        <span className={`gt-pill gt-pill-sm ${account.mfaFactorCount > 0 ? 'gt-pill-good' : 'gt-pill-neutral'}`}>
          {account.mfaFactorCount > 0 ? '登録済み' : '未登録'}
        </span>
      </td>
      <td>
        <span className={`gt-pill gt-pill-sm ${accountStatusTone(account.status)}`}>{accountStatusLabel(account.status)}</span>
      </td>
    </tr>
  );
};

const InviteRow = ({ invite }: { invite: PendingInviteItem }) => (
  <tr>
    <td>
      <span className="block max-w-[260px] truncate" title={invite.email}>
        {invite.email}
      </span>
      {invite.stakeholderName && <div className="text-[11.5px] text-text-muted whitespace-normal break-words">紐づく株主: {invite.stakeholderName}</div>}
    </td>
    <td>{auditRoleLabel(invite.role)}</td>
    <td>{invite.invitedByName ?? <span className="text-text-muted">—</span>}</td>
    <td className="tabular-nums">{formatJstDate(invite.createdAt)}</td>
    <td className="tabular-nums">{formatJstDateTime(invite.expiresAt).slice(0, 16)}</td>
    <td>
      <span className={`gt-pill gt-pill-sm ${invite.isExpired ? 'gt-pill-neutral' : 'gt-pill-info'}`}>{invite.isExpired ? '期限切れ' : '招待中'}</span>
    </td>
  </tr>
);

export const AccountReview = () => {
  const access = useAccountAccess();
  const [isExporting, setIsExporting] = useState(false);
  const [exportNote, setExportNote] = useState<{ tone: 'info' | 'error'; message: string } | null>(null);

  const exportCsv = async () => {
    if (isExporting) return;
    setIsExporting(true);
    setExportNote(null);
    try {
      const result = await downloadAccountAccessCsv();
      setExportNote({ tone: 'info', message: `CSV に出力しました（${result.fileName}）。出力したことも「操作の記録」に残しました。` });
    } catch (caught) {
      setExportNote({ tone: 'error', message: errorMessage(caught, 'CSV の出力に失敗しました') });
    } finally {
      setIsExporting(false);
    }
  };

  const data = access.data;

  return (
    <div className="flex flex-col gap-4">
      <section className="gt-card" aria-label="棚卸しの進め方">
        <div className="gt-card-title">棚卸しの進め方</div>
        <ul className="m-0 mt-2 pl-5 list-disc text-[13px] leading-relaxed text-text-body flex flex-col gap-1">
          <li>
            四半期に 1 回など時期を決めて、この一覧を見直します。退職・異動した人、取引が終わった外部の人、株主でなくなった人のアカウントが残っていないかを確かめてください。
          </li>
          <li>
            ロールが仕事に合っているか（管理者が多すぎないか）、「未ログイン」「長期間ログインなし」（{DORMANT_DAYS} 日を超えてログインが無い）のアカウントが今も必要かを確かめます。
          </li>
          <li>
            不要なアカウントの削除とロールの変更は <Link href="/settings/company" className="text-primary underline underline-offset-2">組織・メンバー設定</Link>、株主のアカウントは{' '}
            <Link href="/shareholders" className="text-primary underline underline-offset-2">株主名簿</Link> から行います。変更は「操作の記録」に残ります。
          </li>
          <li>見直した証跡として、CSV を出力して日付・確認した人と一緒に保管してください（出力したことも記録に残ります）。</li>
        </ul>
      </section>

      {access.isLoading && !data ? (
        <LoadingBlock />
      ) : !data ? (
        <ErrorBlock message={access.error ?? 'アカウントの一覧の取得に失敗しました'} onRetry={() => void access.reload()} />
      ) : (
        <>
          {access.error && <ErrorBlock message={access.error} onRetry={() => void access.reload()} />}
          <section className="gt-card gt-card-table" aria-labelledby="audit-accounts-title">
            <div className="gt-card-head items-center flex-wrap">
              <div>
                <h2 id="audit-accounts-title" className="gt-card-title m-0">
                  アカウント
                </h2>
                <div className="gt-card-sub">
                  {data.accounts.length} 件（{formatJstDateTime(data.generatedAt).slice(0, 16)} 時点・日本時間）
                </div>
              </div>
              <button type="button" className="gt-btn" disabled={isExporting} onClick={() => void exportCsv()}>
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
            <div className="gt-table-scroll mt-2">
              <table className="gt-table">
                <thead>
                  <tr>
                    <th>氏名</th>
                    <th>メールアドレス</th>
                    <th>ロール</th>
                    <th>作成日</th>
                    <th>最後のログイン</th>
                    <th>二要素認証</th>
                    <th>状態</th>
                  </tr>
                </thead>
                <tbody>
                  {data.accounts.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="gt-table-empty">
                        アカウントがありません。
                      </td>
                    </tr>
                  ) : (
                    data.accounts.map((account) => <AccountRow key={account.id} account={account} />)
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="gt-card gt-card-table" aria-labelledby="audit-invites-title">
            <h2 id="audit-invites-title" className="gt-card-title m-0">
              招待中（まだ受け取られていない招待）
            </h2>
            <div className="gt-card-sub">
              招待を受け取るとアカウントが作られます。期限切れの招待は使えません。不要な招待は取り消してください。
            </div>
            <div className="gt-table-scroll mt-2">
              <table className="gt-table">
                <thead>
                  <tr>
                    <th>メールアドレス</th>
                    <th>ロール</th>
                    <th>招待した人</th>
                    <th>招待した日</th>
                    <th>有効期限</th>
                    <th>状態</th>
                  </tr>
                </thead>
                <tbody>
                  {data.invites.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="gt-table-empty">
                        受け取られていない招待はありません。
                      </td>
                    </tr>
                  ) : (
                    data.invites.map((invite) => <InviteRow key={`${invite.email}:${invite.createdAt}`} invite={invite} />)
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
};
