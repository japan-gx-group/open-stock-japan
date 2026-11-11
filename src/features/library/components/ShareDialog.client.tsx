'use client';

// 文書の「共有」ダイアログ。
//   1. 公開範囲（社内のみ / 全株主 / 指定した株主）と、指定した株主の選択（document_shares）
//   2. 共有リンク（期限つき・ログイン不要）の発行・一覧・取り消し
// どちらも管理者・メンバーだけが使える（API が requireEditor で確かめる）。

import React, { useCallback, useMemo, useState } from 'react';
import { Check, Copy, Link2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/Modal.client';
import { ConfirmDialog } from '@/components/resource/ConfirmDialog.client';
import { useAsyncData } from '@/hooks/useAsyncData';
import { useResourceList } from '@/hooks/useResourceList';
import { apiFetch, errorMessage } from '@/lib/resources/client';
import { DOCUMENT_VISIBILITIES } from '@/lib/resources/definitions';
import { SHARE_LINK_DEFAULT_DAYS, SHARE_LINK_MAX_DAYS, SHARE_LINK_MIN_DAYS } from '@/lib/sharing/linkRules';
import type { ShareLinkStatus } from '@/lib/sharing/linkRules';
import { buildShareUrl, SHARE_LINK_STATUS_LABELS, type LibraryDocument } from '../services/documents';
import { formatDateTimeJa } from '../services/format';

type Visibility = LibraryDocument['visibility'];

interface Sharing {
  visibility: Visibility;
  stakeholderIds: string[];
}

interface ShareLink {
  id: string;
  label: string;
  expiresAt: string;
  revokedAt: string | null;
  accessCount: number;
  lastAccessedAt: string | null;
  createdAt: string;
  status: ShareLinkStatus;
}

const VISIBILITY_HELP: Record<Visibility, string> = {
  internal: '社内のメンバー（管理者・メンバー・閲覧のみ）だけが読めます。株主ポータルには出ません。',
  shareholders: '株主ポータルにログインしたすべての株主が読めます。',
  restricted: '下で選んだ株主だけが、株主ポータルで読めます（その株主がポータルのアカウントを持っている場合）。',
};

const VisibilitySection = ({ document, onChanged }: { document: LibraryDocument; onChanged: () => void }) => {
  const loadSharing = useCallback(
    async () => (await apiFetch<{ sharing: Sharing }>(`/api/documents/${document.id}/shares`)).sharing,
    [document.id],
  );
  const sharing = useAsyncData(loadSharing);
  const stakeholders = useResourceList('stakeholders');
  // 編集中の値。null のあいだは読み込んだ値をそのまま出す
  const [edited, setEdited] = useState<Sharing | null>(null);
  const [search, setSearch] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ type: 'ok' | 'error'; text: string } | null>(null);

  const visible = useMemo(() => {
    const word = search.trim().toLowerCase();
    return (stakeholders.data ?? []).filter((row) => !word || String(row.name ?? '').toLowerCase().includes(word));
  }, [stakeholders.data, search]);

  if (sharing.error) return <p className="text-[13px] text-danger m-0">{sharing.error}</p>;
  if (!sharing.data) return <p className="text-[13px] text-text-muted m-0">読み込んでいます…</p>;
  const draft: Sharing = edited ?? sharing.data;

  const isDirty =
    draft.visibility !== sharing.data.visibility ||
    (draft.visibility === 'restricted' && [...draft.stakeholderIds].sort().join() !== [...sharing.data.stakeholderIds].sort().join());
  const widens = draft.visibility !== 'internal' && isDirty;

  const toggle = (id: string) =>
    setEdited({
      ...draft,
      stakeholderIds: draft.stakeholderIds.includes(id) ? draft.stakeholderIds.filter((value) => value !== id) : [...draft.stakeholderIds, id],
    });

  const save = async () => {
    if (isSaving) return;
    setIsSaving(true);
    setMessage(null);
    try {
      await apiFetch(`/api/documents/${document.id}/shares`, {
        method: 'PUT',
        body: JSON.stringify({ visibility: draft.visibility, stakeholderIds: draft.visibility === 'restricted' ? draft.stakeholderIds : [] }),
      });
      await sharing.reload();
      setEdited(null);
      onChanged();
      setMessage({ type: 'ok', text: '公開範囲を保存しました' });
    } catch (caught) {
      setMessage({ type: 'error', text: errorMessage(caught, '保存に失敗しました') });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div>
      <div role="radiogroup" aria-label="公開範囲" className="flex flex-col gap-2">
        {DOCUMENT_VISIBILITIES.map((option) => (
          <label key={option.value} className="flex items-start gap-2 text-[13.5px] text-text-main cursor-pointer">
            <input
              type="radio"
              name="visibility"
              className="mt-[3px]"
              checked={draft.visibility === option.value}
              onChange={() => {
                setMessage(null);
                setEdited({ ...draft, visibility: option.value });
              }}
            />
            <span>
              <span className="font-medium">{option.label}</span>
              <span className="block text-[12px] text-text-muted">{VISIBILITY_HELP[option.value]}</span>
            </span>
          </label>
        ))}
      </div>

      {draft.visibility === 'restricted' && (
        <div className="mt-3 rounded-md border border-border p-3">
          <div className="flex items-center justify-between gap-3 mb-2">
            <span className="text-[12.5px] font-medium text-text-main">公開する株主（{draft.stakeholderIds.length} 名を選択中）</span>
            <input
              className="gt-field"
              style={{ height: '32px', width: '180px' }}
              placeholder="名前で絞り込む"
              aria-label="株主を名前で絞り込む"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          {stakeholders.isLoading ? (
            <p className="text-[12.5px] text-text-muted m-0">読み込んでいます…</p>
          ) : stakeholders.error ? (
            <p className="text-[12.5px] text-danger m-0">{stakeholders.error}</p>
          ) : visible.length === 0 ? (
            <p className="text-[12.5px] text-text-muted m-0">該当する株主がいません。</p>
          ) : (
            <ul className="list-none p-0 m-0 max-h-[180px] overflow-y-auto">
              {visible.map((row) => (
                <li key={row.id}>
                  <label className="flex items-center gap-2 py-1 text-[13px] text-text-main cursor-pointer">
                    <input type="checkbox" checked={draft.stakeholderIds.includes(row.id)} onChange={() => toggle(row.id)} />
                    <span>{String(row.name ?? '')}</span>
                    {!row.email && <span className="text-[11.5px] text-text-subtle">（メール未登録）</span>}
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {widens && (
        <p className="text-[12.5px] text-warning mt-3 mb-0">
          保存すると、{draft.visibility === 'shareholders' ? 'すべての株主' : '選んだ株主'}が株主ポータルでこの文書をダウンロードできるようになります。
        </p>
      )}
      <div className="flex items-center justify-end gap-3 mt-3">
        {message && (
          <span role={message.type === 'error' ? 'alert' : 'status'} className={`text-[12.5px] ${message.type === 'error' ? 'text-danger' : 'text-success'}`}>
            {message.text}
          </span>
        )}
        <Button type="button" onClick={save} disabled={!isDirty || isSaving}>
          {isSaving && <Loader2 className="animate-spin" />}
          公開範囲を保存
        </Button>
      </div>
    </div>
  );
};

const LinksSection = ({ document }: { document: LibraryDocument }) => {
  const loadLinks = useCallback(
    async () => (await apiFetch<{ items: ShareLink[] }>(`/api/share-links?documentId=${document.id}`)).items,
    [document.id],
  );
  const links = useAsyncData(loadLinks);
  const [label, setLabel] = useState('');
  const [days, setDays] = useState(String(SHARE_LINK_DEFAULT_DAYS));
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ url: string; expiresAt: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [toRevoke, setToRevoke] = useState<ShareLink | null>(null);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isCreating) return;
    setIsCreating(true);
    setError(null);
    setCreated(null);
    setCopied(false);
    try {
      const result = await apiFetch<{ item: ShareLink; token: string }>('/api/share-links', {
        method: 'POST',
        body: JSON.stringify({ documentId: document.id, label, expiresInDays: Number(days) }),
      });
      // トークンはこの応答でしか受け取れない。画面を閉じるまでだけ持つ（保存しない）
      setCreated({ url: buildShareUrl(window.location.origin, result.token), expiresAt: result.item.expiresAt });
      setLabel('');
      await links.reload();
    } catch (caught) {
      setError(errorMessage(caught, '共有リンクの作成に失敗しました'));
    } finally {
      setIsCreating(false);
    }
  };

  const copy = async () => {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.url);
      setCopied(true);
    } catch {
      setError('コピーできませんでした。リンクを選択してコピーしてください');
    }
  };

  const revoke = async () => {
    if (!toRevoke) return;
    await apiFetch(`/api/share-links/${toRevoke.id}`, { method: 'DELETE' });
    setToRevoke(null);
    await links.reload();
  };

  return (
    <div>
      <p className="text-[12.5px] leading-relaxed text-text-muted mt-0 mb-3">
        リンクを知っている人は、ログインせずにこの文書をダウンロードできます（公開範囲の設定とは別に働きます）。
        投資を検討している相手など、アカウントを持たない人に渡すときに使い、期限は必要な長さにとどめてください。
      </p>
      <form onSubmit={create} className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[180px]">
          <label htmlFor="share-link-label" className="gt-field-label">
            メモ（渡す相手など。任意）
          </label>
          <input id="share-link-label" className="gt-field w-full" value={label} maxLength={200} placeholder="例: 架空キャピタル 山田様" onChange={(event) => setLabel(event.target.value)} />
        </div>
        <div style={{ width: '120px' }}>
          <label htmlFor="share-link-days" className="gt-field-label">
            有効期間（日）
          </label>
          <input
            id="share-link-days"
            type="number"
            className="gt-field w-full"
            min={SHARE_LINK_MIN_DAYS}
            max={SHARE_LINK_MAX_DAYS}
            step={1}
            required
            value={days}
            onChange={(event) => setDays(event.target.value)}
          />
        </div>
        <Button type="submit" disabled={isCreating}>
          {isCreating ? <Loader2 className="animate-spin" /> : <Link2 />}
          リンクを作る
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-[13px] text-danger mt-2 mb-0">
          {error}
        </p>
      )}

      {created && (
        <div className="rounded-md border border-success/40 bg-success-soft px-3 py-3 mt-3">
          <p className="text-[12.5px] font-medium text-text-main mt-0 mb-2">
            共有リンクを作りました。このリンクは今だけ表示されます（あとから再表示できません）。コピーして相手に渡してください。
          </p>
          <div className="flex gap-2">
            <input className="gt-field flex-1" readOnly value={created.url} aria-label="共有リンク" onFocus={(event) => event.target.select()} />
            <button type="button" className="gt-btn" onClick={copy}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? 'コピーしました' : 'コピー'}
            </button>
          </div>
          <p className="text-[12px] text-text-muted mt-2 mb-0">期限: {formatDateTimeJa(created.expiresAt)} まで</p>
        </div>
      )}

      <div className="mt-4">
        {links.isLoading && !links.data ? (
          <p className="text-[12.5px] text-text-muted m-0">読み込んでいます…</p>
        ) : links.error ? (
          <p className="text-[12.5px] text-danger m-0">{links.error}</p>
        ) : (links.data ?? []).length === 0 ? (
          <p className="text-[12.5px] text-text-muted m-0">発行済みの共有リンクはありません。</p>
        ) : (
          <div className="gt-table-scroll">
            <table className="gt-table">
              <thead>
                <tr>
                  <th>メモ</th>
                  <th>状態・期限</th>
                  <th title="上の行がアクセスの回数、下の行が最後にアクセスされた日時">アクセス</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {(links.data ?? []).map((link) => {
                  const status = SHARE_LINK_STATUS_LABELS[link.status];
                  return (
                    <tr key={link.id}>
                      <td className="gt-wrap-sm break-words">{link.label || <span className="text-text-subtle">（メモなし）</span>}</td>
                      <td>
                        <span className={`gt-pill gt-pill-sm ${status.tone}`}>{status.label}</span>
                        <div className="text-[11.5px] text-text-muted mt-[2px]">期限 {formatDateTimeJa(link.expiresAt)}</div>
                      </td>
                      <td>
                        <span className="tabular-nums">{link.accessCount.toLocaleString('ja-JP')} 回</span>
                        <div className="text-[11.5px] text-text-muted">最後 {formatDateTimeJa(link.lastAccessedAt)}</div>
                      </td>
                      <td className="text-right">
                        {link.status === 'active' && (
                          <button type="button" className="text-[12.5px] text-danger hover:underline bg-transparent border-0 p-0 cursor-pointer" onClick={() => setToRevoke(link)}>
                            取り消す
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        isOpen={toRevoke != null}
        title="共有リンクを取り消す"
        confirmLabel="取り消す"
        message={<>このリンク{toRevoke?.label ? `（${toRevoke.label}）` : ''}を取り消します。取り消すと、リンクを持っている人はダウンロードできなくなります。元には戻せません。</>}
        onCancel={() => setToRevoke(null)}
        onConfirm={revoke}
      />
    </div>
  );
};

export const ShareDialog = ({
  document,
  onClose,
  onChanged,
}: {
  /** 共有する文書。null なら閉じている */
  document: LibraryDocument | null;
  onClose: () => void;
  /** 公開範囲を変えたあと（一覧を読み直す） */
  onChanged: () => void;
}) => (
  <Modal isOpen={document != null} onClose={onClose} title={document ? `共有: ${document.title}` : '共有'} size="xl">
    {document && (
      <div key={document.id} className="flex flex-col gap-6">
        <section>
          <h3 className="text-[14px] font-semibold text-text-heading mt-0 mb-2">公開範囲（株主ポータル）</h3>
          <VisibilitySection document={document} onChanged={onChanged} />
        </section>
        <hr className="border-border m-0" />
        <section>
          <h3 className="text-[14px] font-semibold text-text-heading mt-0 mb-2">共有リンク（期限つき・ログイン不要）</h3>
          <LinksSection document={document} />
        </section>
      </div>
    )}
  </Modal>
);
