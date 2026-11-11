'use client';

// テンプレートの編集（新規・既存で共通）。左に名前と文面、右に差し込み項目の一覧とメモ。
// 文面は文字として保存し、文字として表示する（HTML として解釈しない）。
// AI が書いたひな形も、手元の文面から取り込んだものも、ここで人が確かめてから保存する。

import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { NoticeList, type NoticeLevel } from '@/components/resource/parts';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/Modal.client';
import { ApiError, errorMessage, saveItem } from '@/lib/resources/client';
import { countBlanks } from '../services/convert';
import { analyzeTemplate, fillTemplate } from '../services/fill';
import { getTemplateKind, scopesOfKind, templateKindName } from '../services/kinds';
import { countNeedsReview, PLACEHOLDER_SCOPE_LABELS, placeholdersFor, placeholderToken, type PlaceholderDef } from '../services/placeholders';
import { sampleValues } from '../services/values';
import type { TemplateDraft, TemplateRow } from '../types';

const MAX_BODY_LENGTH = 80_000;

const groupByScope = (defs: PlaceholderDef[]): { label: string; defs: PlaceholderDef[] }[] => {
  const groups: { label: string; defs: PlaceholderDef[] }[] = [];
  for (const def of defs) {
    const label = PLACEHOLDER_SCOPE_LABELS[def.scope];
    const group = groups.find((entry) => entry.label === label);
    if (group) group.defs.push(def);
    else groups.push({ label, defs: [def] });
  }
  return groups;
};

const Body = ({ draft, onClose, onSaved }: { draft: TemplateDraft; onClose: () => void; onSaved: (row: TemplateRow) => void }) => {
  const kind = getTemplateKind(draft.kind);
  const scopes = useMemo(() => scopesOfKind(kind), [kind]);
  const [title, setTitle] = useState(draft.title);
  const [body, setBody] = useState(draft.body);
  const [notes, setNotes] = useState(draft.notes);
  const [view, setView] = useState<'edit' | 'sample'>('edit');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // 差し込み項目を入れたあとに、カーソルを置く位置（文面を描き直した直後に反映する）
  const pendingCaret = useRef<number | null>(null);

  useLayoutEffect(() => {
    const position = pendingCaret.current;
    const element = textareaRef.current;
    if (position == null || !element) return;
    pendingCaret.current = null;
    element.focus();
    element.setSelectionRange(position, position);
  }, [body, view]);

  const groups = useMemo(() => groupByScope(placeholdersFor(scopes)), [scopes]);
  const analysis = useMemo(() => analyzeTemplate(body, scopes), [body, scopes]);
  const usedNames = useMemo(() => new Set(analysis.used.map((def) => def.name)), [analysis]);
  const sample = useMemo(() => fillTemplate(body, sampleValues(scopes)).text, [body, scopes]);
  const reviewCount = countNeedsReview(body);
  const blankCount = countBlanks(body);
  const willReopen = draft.status === 'reviewed' && body.trim() !== draft.body.trim();

  const checks: { key: string; level: NoticeLevel; message: string }[] = [];
  if (analysis.unknown.length > 0) {
    checks.push({
      key: 'unknown',
      level: 'warning',
      message: `一覧に無い差し込み項目があります: ${analysis.unknown.map(placeholderToken).join('、')}。このままだと、文書を作るときに「【要確認】」になります。右の一覧の名前に直してください。`,
    });
  }
  if (analysis.outOfScope.length > 0) {
    checks.push({
      key: 'scope',
      level: 'warning',
      message: `この種類のテンプレートでは値を入れられない差し込み項目があります: ${analysis.outOfScope.map(placeholderToken).join('、')}。`,
    });
  }
  if (blankCount > 0) {
    checks.push({
      key: 'blank',
      level: 'info',
      message: `空欄（● など）が ${blankCount} か所残っています。差し込み項目に置き換えるか、文書を作るたびに埋めてください。`,
    });
  }
  if (reviewCount > 0) {
    checks.push({ key: 'review', level: 'info', message: `「【要確認】」が ${reviewCount} か所あります。文書を作るたびに、人が埋める箇所です。` });
  }

  /** カーソルの位置に差し込み項目を入れる（選んでいる文字があれば、置き換える） */
  const insert = (name: string) => {
    const token = placeholderToken(name);
    const element = textareaRef.current;
    // 見本を見ているとき（文面の欄が無いとき）は、文面の終わりに足して、編集に戻す
    const start = view === 'edit' && element ? (element.selectionStart ?? body.length) : body.length;
    const end = view === 'edit' && element ? (element.selectionEnd ?? start) : body.length;
    pendingCaret.current = start + token.length;
    setBody(`${body.slice(0, start)}${token}${body.slice(end)}`);
    setView('edit');
  };

  const save = async () => {
    if (isSaving) return;
    setIsSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      const row = await saveItem<TemplateRow>(
        'document-templates',
        { title, kind: draft.kind, status: draft.status, body, notes },
        draft.id,
      );
      onSaved(row);
      onClose();
    } catch (caught) {
      setError(errorMessage(caught, '保存に失敗しました'));
      if (caught instanceof ApiError) setFieldErrors(caught.fieldErrors);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      {draft.origin && (
        <div className="mb-4 rounded-md border border-border bg-primary-bg/40 px-4 py-3 text-[13px] leading-relaxed text-text-main">
          <p className="m-0 font-medium">{draft.origin.summary}</p>
          {draft.origin.details.length > 0 && (
            <ul className="mt-2 mb-0 pl-5 list-disc text-text-body">
              {draft.origin.details.map((detail) => (
                <li key={detail} className="break-words">
                  {detail}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_300px] gap-6">
        <div className="min-w-0">
          <label htmlFor="template-title" className="gt-field-label">
            名前
          </label>
          <input
            id="template-title"
            className="gt-field w-full"
            value={title}
            maxLength={200}
            aria-invalid={fieldErrors.title ? true : undefined}
            placeholder="例: 臨時株主総会の招集通知"
            onChange={(event) => setTitle(event.target.value)}
          />
          {fieldErrors.title && <p className="text-[12px] text-danger mt-1 mb-0">{fieldErrors.title}</p>}

          <div className="flex items-end justify-between gap-3 mt-4 mb-1.5">
            <label htmlFor="template-body" className="gt-field-label" style={{ marginBottom: 0 }}>
              文面
            </label>
            <div className="inline-flex overflow-hidden rounded-md border border-border-strong text-[12px]" role="group" aria-label="文面の表示">
              {(
                [
                  ['edit', '編集'],
                  ['sample', '見本（例の値を入れた状態）'],
                ] as const
              ).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={view === value}
                  className={`border-0 px-2.5 py-1 cursor-pointer ${view === value ? 'bg-primary-bg font-semibold text-primary' : 'bg-bg-card text-text-body'}`}
                  onClick={() => setView(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          {view === 'edit' ? (
            <textarea
              id="template-body"
              ref={textareaRef}
              className="gt-field w-full"
              style={{ minHeight: '440px', height: 'auto', padding: '12px 14px', lineHeight: 1.8 }}
              value={body}
              maxLength={MAX_BODY_LENGTH}
              aria-invalid={fieldErrors.body ? true : undefined}
              placeholder={'差し込み項目は {{会社名}} のように書きます。右の一覧から選ぶと、カーソルの位置に入ります。'}
              onChange={(event) => setBody(event.target.value)}
            />
          ) : (
            <div
              className="rounded-md border border-border bg-bg-subtle px-4 py-3 overflow-auto text-[13.5px] leading-[1.9] text-text-main whitespace-pre-wrap break-words"
              style={{ minHeight: '440px', maxHeight: '560px' }}
            >
              {sample || <span className="text-text-muted">文面がまだありません。</span>}
            </div>
          )}
          {fieldErrors.body && <p className="text-[12px] text-danger mt-1 mb-0">{fieldErrors.body}</p>}
          <p className="text-[12px] leading-relaxed text-text-muted mt-1.5 mb-0">
            {view === 'edit'
              ? '文書を作るときに、{{ }} の部分が台帳の値に置き換わります。値が無い項目は「【要確認】」になります。'
              : '右の一覧の「例」を入れた見本です。実際の文書には、選んだ会議や回次の値が入ります。'}
          </p>

          {checks.length > 0 && (
            <div className="mt-3">
              <NoticeList items={checks} />
            </div>
          )}
        </div>

        <aside className="min-w-0">
          <div className="text-[12px] text-text-muted">種類</div>
          <div className="text-[13.5px] font-medium text-text-heading">{templateKindName(draft.kind)}</div>
          {kind.basis && <div className="text-[12px] text-text-muted mt-0.5">{kind.basis}</div>}

          <h4 className="text-[13px] font-semibold text-text-heading mt-4 mb-1">差し込み項目</h4>
          <p className="text-[12px] leading-relaxed text-text-muted mt-0 mb-2">押すと、文面のカーソルの位置に入ります。</p>
          <div className="rounded-md border border-border overflow-auto" style={{ maxHeight: '340px' }}>
            {groups.map((group) => (
              <div key={group.label}>
                <div className="sticky top-0 bg-bg-subtle px-3 py-1.5 text-[11.5px] font-medium text-text-subtle border-b border-border">{group.label}</div>
                <ul className="list-none m-0 p-0">
                  {group.defs.map((def) => (
                    <li key={def.name} className="border-b border-border-light last:border-b-0">
                      <button
                        type="button"
                        className="w-full text-left bg-transparent border-0 cursor-pointer px-3 py-1.5 hover:bg-bg-subtle"
                        onClick={() => insert(def.name)}
                        title={`例: ${def.example}`}
                      >
                        <span className={`text-[12.5px] font-medium ${usedNames.has(def.name) ? 'text-primary' : 'text-text-heading'}`}>
                          {def.name}
                          {usedNames.has(def.name) && <span className="ml-1.5 text-[11px] font-normal text-text-muted">使用中</span>}
                        </span>
                        <span className="block text-[11.5px] leading-snug text-text-muted">{def.description}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>

          {kind.items.length > 0 && (
            <details className="mt-4">
              <summary className="cursor-pointer text-[13px] font-semibold text-text-heading">記載する事項（目安）</summary>
              <ul className="mt-2 mb-0 pl-5 list-disc text-[12.5px] leading-relaxed text-text-body">
                {kind.items.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </details>
          )}

          <label htmlFor="template-notes" className="gt-field-label mt-4">
            メモ（社内向け）
          </label>
          <textarea
            id="template-notes"
            className="gt-field w-full"
            style={{ minHeight: '96px', height: 'auto', padding: '9px 12px', lineHeight: 1.6 }}
            value={notes}
            maxLength={4000}
            placeholder="例: 顧問弁護士の確認済み（2026 年 10 月）"
            onChange={(event) => setNotes(event.target.value)}
          />
        </aside>
      </div>

      {willReopen && (
        <p className="text-[12.5px] text-warning mt-4 mb-0">確認済みのテンプレートです。文面を変えて保存すると、「確認中」に戻ります。</p>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-danger mt-4 mb-0">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 mt-5">
        <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
          キャンセル
        </Button>
        <Button type="button" onClick={save} disabled={isSaving || !title.trim() || !body.trim()}>
          {isSaving && <Loader2 className="animate-spin" />}
          {draft.id ? '保存' : 'テンプレートを保存'}
        </Button>
      </div>
    </>
  );
};

export const TemplateEditor = ({
  draft,
  onClose,
  onSaved,
}: {
  /** 編集するテンプレート（新規は id が null）。null のあいだは閉じている */
  draft: TemplateDraft | null;
  onClose: () => void;
  onSaved: (row: TemplateRow) => void;
}) => (
  <Modal isOpen={draft != null} onClose={onClose} title={draft?.id ? 'テンプレートを編集' : 'テンプレートを作る'} size="2xl">
    {draft && <Body draft={draft} onClose={onClose} onSaved={onSaved} />}
  </Modal>
);
