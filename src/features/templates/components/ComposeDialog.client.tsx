'use client';

// テンプレートから文書を作るダイアログ。テンプレートと対象（会議・転換型証券の回次・投資家）を選ぶと、
// サーバが差し込み項目を台帳の値に置き換えた文面を返す（AI は使わない）。文面は、ここで直してから
// コピー・テキストで保存・印刷する（このツールには保存しない）。呼び出し側が onUse を渡したときは、
// 文面を呼び出し側に渡すボタンも出す（会議の議事録に入れる、など）。
//
// 入口は 3 つ:
//   文書テンプレートの画面 … template を渡す（対象はここで選ぶ）
//   会議の画面・転換型証券の画面 … subject と kinds を渡す（テンプレートはここで選ぶ）

import React, { useMemo, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { Check, Copy, Download, FileText, Loader2, Printer, RotateCcw } from 'lucide-react';
import { NoticeList, type NoticeLevel } from '@/components/resource/parts';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/Modal.client';
import { useResourceList } from '@/hooks/useResourceList';
import { formatDateJa, formatYenJa } from '@/lib/equity/format';
import { errorMessage } from '@/lib/resources/client';
import type { TemplateKindId } from '@/lib/resources/definitions';
import type { ResourceRow } from '@/lib/resources/fields';
import { composeDocument, type ComposedDocument } from '../services/client';
import { getTemplateKind, isTemplateKindId, templateKindName, type TemplateKindDef } from '../services/kinds';
import { countNeedsReview, placeholderToken } from '../services/placeholders';
import type { TemplateRow } from '../types';

// 印刷のときは、作った文書だけを出す（MinutesStep の議事録の印刷と同じやり方）。
// このダイアログが開いている間だけ効く（style 要素ごと外れる）。
const PRINT_CSS = `
.template-document-print-root { display: none; }
@media print {
  html, body { height: auto !important; overflow: visible !important; background: #fff !important; }
  body > *:not(.template-document-print-root) { display: none !important; }
  .template-document-print-root {
    display: block !important;
    color: #000;
    font-size: 11pt;
    line-height: 1.9;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
}
`;

const subscribeNothing = () => () => {};

/** ファイル名に使えない文字を除く */
const safeFileName = (value: string): string => value.replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 80) || 'document';

const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div>
    <div className="gt-field-label">{label}</div>
    {children}
  </div>
);

const FixedValue = ({ children }: { children: React.ReactNode }) => (
  <div className="rounded-md border border-border bg-bg-subtle px-3 py-2 text-[13.5px] text-text-heading break-words">{children}</div>
);

const SelectField = ({
  label,
  value,
  placeholder,
  options,
  isLoading,
  error,
  emptyMessage,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  options: { value: string; label: string }[];
  isLoading: boolean;
  error: string | null;
  emptyMessage: React.ReactNode;
  onChange: (value: string) => void;
}) => (
  <Field label={label}>
    {isLoading ? (
      <p className="text-[13px] text-text-muted m-0">読み込んでいます…</p>
    ) : error ? (
      <p className="text-[13px] text-danger m-0">{error}</p>
    ) : options.length === 0 ? (
      <p className="text-[13px] leading-relaxed text-text-muted m-0">{emptyMessage}</p>
    ) : (
      <select className="gt-field gt-field-select w-full" aria-label={label} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{placeholder}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    )}
  </Field>
);

/** 対象（会議・転換型証券の回次）を選ぶ */
const SubjectSelect = ({ kind, value, onChange }: { kind: TemplateKindDef; value: string; onChange: (value: string) => void }) => {
  const isMeeting = kind.subject !== 'convertible_round';
  const board = kind.subject === 'board_meeting';
  const rows = useResourceList<ResourceRow>(isMeeting ? 'meetings' : 'convertible-rounds');
  const options = useMemo(
    () =>
      (rows.data ?? [])
        .filter((row) => !isMeeting || (row.meetingType === 'board') === board)
        .map((row) => ({
          value: row.id,
          label: isMeeting ? `${textOf(row.title)}（${row.heldOn ? formatDateJa(textOf(row.heldOn)) : '開催日未定'}）` : textOf(row.name),
        })),
    [rows.data, isMeeting, board],
  );
  const label = isMeeting ? (board ? '取締役会' : '株主総会') : '転換型証券の回次';
  return (
    <SelectField
      label={label}
      value={value}
      placeholder="選んでください"
      options={options}
      isLoading={rows.isLoading && !rows.data}
      error={rows.error && !rows.data ? rows.error : null}
      emptyMessage={
        <>
          {label}がまだ登録されていません。
          <Link href={isMeeting ? (board ? '/board-meetings' : '/shareholder-meetings') : '/convertibles'} className="text-primary underline underline-offset-2 ml-1">
            登録の画面を開く
          </Link>
        </>
      }
      onChange={onChange}
    />
  );
};

/** 投資家（回次の中の投資 1 件）を選ぶ */
const InvestmentSelect = ({ roundId, value, onChange }: { roundId: string; value: string; onChange: (value: string) => void }) => {
  const investments = useResourceList<ResourceRow>('convertible-investments', 'roundId', roundId);
  const stakeholders = useResourceList<ResourceRow>('stakeholders');
  const options = useMemo(() => {
    const names = new Map((stakeholders.data ?? []).map((row) => [row.id, textOf(row.name)]));
    return (investments.data ?? []).map((row) => ({
      value: row.id,
      label: `${names.get(textOf(row.stakeholderId)) ?? '（不明な権利者）'}（${formatYenJa(typeof row.amount === 'number' ? row.amount : null)}）`,
    }));
  }, [investments.data, stakeholders.data]);
  const isLoading = (investments.isLoading && !investments.data) || (stakeholders.isLoading && !stakeholders.data);
  return (
    <SelectField
      label="投資家"
      value={value}
      placeholder="選んでください"
      options={options}
      isLoading={isLoading}
      error={investments.error && !investments.data ? investments.error : null}
      emptyMessage="この回次には、まだ投資の記録がありません。"
      onChange={onChange}
    />
  );
};

/** テンプレートを選ぶ（kinds に入る種類のものだけ） */
const TemplateSelect = ({
  kinds,
  value,
  onChange,
}: {
  kinds: readonly TemplateKindId[];
  value: string;
  onChange: (template: TemplateRow | null) => void;
}) => {
  const templates = useResourceList<TemplateRow>('document-templates');
  const rows = useMemo(() => (templates.data ?? []).filter((row) => kinds.includes(row.kind)), [templates.data, kinds]);
  return (
    <SelectField
      label="テンプレート"
      value={value}
      placeholder="選んでください"
      options={rows.map((row) => ({ value: row.id, label: `${row.title}${row.status === 'reviewed' ? '' : '（確認中）'}` }))}
      isLoading={templates.isLoading && !templates.data}
      error={templates.error && !templates.data ? templates.error : null}
      emptyMessage={
        <>
          この文書に使えるテンプレート（{kinds.map(templateKindName).join('・')}）が、まだありません。
          <Link href="/templates" className="text-primary underline underline-offset-2 ml-1">
            文書テンプレートの画面で作る
          </Link>
        </>
      }
      onChange={(id) => onChange(rows.find((row) => row.id === id) ?? null)}
    />
  );
};

interface ComposeProps {
  /** 使うテンプレートが決まっているとき */
  template?: TemplateRow | null;
  /** 対象（会議・回次）が決まっているとき */
  subject?: { id: string; label: string } | null;
  /** テンプレートをここで選ぶときの、種類の候補 */
  kinds?: readonly TemplateKindId[];
  /** 文面を呼び出し側に渡すボタンの名前（onUse と合わせて渡す） */
  useLabel?: string;
  /** 直した文面を受け取る。失敗したら例外を投げる */
  onUse?: (text: string) => void | Promise<void>;
  onClose: () => void;
}

const Body = ({ template: fixedTemplate = null, subject: fixedSubject = null, kinds = [], useLabel, onUse, onClose }: ComposeProps) => {
  const [chosen, setChosen] = useState<TemplateRow | null>(null);
  const [subjectId, setSubjectId] = useState(fixedSubject?.id ?? '');
  const [investmentId, setInvestmentId] = useState('');
  const [composed, setComposed] = useState<ComposedDocument | null>(null);
  const [text, setText] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [isUsing, setIsUsing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // body へのポータルはブラウザでだけ描く
  const isClient = useSyncExternalStore(subscribeNothing, () => true, () => false);

  const template = fixedTemplate ?? chosen;
  const kind = template && isTemplateKindId(template.kind) ? getTemplateKind(template.kind) : null;
  const needsSubject = kind != null && kind.subject !== 'company';
  const ready = kind != null && (!needsSubject || subjectId !== '') && (!kind.perInvestor || investmentId !== '');

  const compose = async () => {
    if (!template || !ready || isRunning) return;
    setIsRunning(true);
    setError(null);
    try {
      const result = await composeDocument(template.id, needsSubject ? subjectId : null, kind?.perInvestor ? investmentId : null);
      setComposed(result);
      setText(result.text);
    } catch (caught) {
      setError(errorMessage(caught, '文書を作れませんでした'));
    } finally {
      setIsRunning(false);
    }
  };

  const copy = async () => {
    setError(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('クリップボードにコピーできませんでした。文面を選択してコピーしてください。');
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `${safeFileName(composed?.title ?? 'document')}.txt`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const use = async () => {
    if (!onUse || isUsing) return;
    setIsUsing(true);
    setError(null);
    try {
      await onUse(text);
      onClose();
    } catch (caught) {
      setError(errorMessage(caught, '保存に失敗しました'));
    } finally {
      setIsUsing(false);
    }
  };

  if (composed) {
    const reviewCount = countNeedsReview(text);
    const notices: { key: string; level: NoticeLevel; message: string }[] = composed.warnings.map((message) => ({
      key: message,
      level: 'warning',
      message,
    }));
    if (composed.missing.length > 0) {
      notices.push({
        key: 'missing',
        level: 'warning',
        message: `台帳に値が無かった項目があります: ${composed.missing.join('、')}。文面の「【要確認】」を埋めるか、台帳に入力してから作り直してください。`,
      });
    }
    if (composed.unknown.length > 0) {
      notices.push({
        key: 'unknown',
        level: 'warning',
        message: `テンプレートに、置き換えられない差し込み項目があります: ${composed.unknown.map(placeholderToken).join('、')}。テンプレートを直してください。`,
      });
    }
    if (composed.templateStatus !== 'reviewed') {
      notices.push({ key: 'status', level: 'info', message: 'このテンプレートは「確認中」です。文面を確かめてから使ってください。' });
    }
    if (reviewCount > 0) {
      notices.push({ key: 'review', level: 'info', message: `「【要確認】」が ${reviewCount} か所あります。使う前に、埋めてください。` });
    }

    return (
      <>
        {!onUse && <style>{PRINT_CSS}</style>}
        {!onUse && isClient && createPortal(<div className="template-document-print-root">{text}</div>, document.body)}

        {notices.length > 0 && (
          <div className="mb-3">
            <NoticeList items={notices} />
          </div>
        )}
        <textarea
          className="gt-field w-full"
          style={{ minHeight: '380px', height: 'auto', padding: '12px 14px', lineHeight: 1.8 }}
          aria-label="文面"
          value={text}
          maxLength={100_000}
          onChange={(event) => setText(event.target.value)}
        />
        <p className="text-[12px] leading-relaxed text-text-muted mt-1.5 mb-0">
          {onUse
            ? '台帳の値を入れた文面です。直してから使ってください。法令上の記載事項は、必ず自分で確かめてください。'
            : 'この文書は、このツールには保存されません。コピーするか、ファイルに保存してください。法令上の記載事項は、必ず自分で確かめてください。'}
        </p>
        {error && (
          <p role="alert" className="text-[13px] text-danger mt-3 mb-0">
            {error}
          </p>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2 mt-5">
          <button type="button" className="gt-btn" onClick={() => setComposed(null)} disabled={isUsing}>
            <RotateCcw size={15} />
            選び直す
          </button>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <button type="button" className="gt-btn" onClick={() => void copy()}>
              {copied ? <Check size={15} /> : <Copy size={15} />}
              {copied ? 'コピーしました' : 'コピー'}
            </button>
            <button type="button" className="gt-btn" onClick={download}>
              <Download size={15} />
              テキストで保存
            </button>
            {!onUse && (
              <button type="button" className="gt-btn" onClick={() => window.print()}>
                <Printer size={15} />
                印刷
              </button>
            )}
            {onUse && (
              <Button type="button" onClick={use} disabled={isUsing || !text.trim()}>
                {isUsing && <Loader2 className="animate-spin" />}
                {useLabel ?? 'この文面を使う'}
              </Button>
            )}
          </div>
        </div>
      </>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-[13px] leading-relaxed text-text-body m-0">
        テンプレートの差し込み項目を、登録済みの内容に置き換えて文書を作ります。AI は使いません。
      </p>

      {fixedTemplate ? (
        <Field label="テンプレート">
          <FixedValue>
            {fixedTemplate.title}
            <span className="ml-2 text-[12px] text-text-muted">{templateKindName(fixedTemplate.kind)}</span>
          </FixedValue>
        </Field>
      ) : (
        <TemplateSelect
          kinds={kinds}
          value={chosen?.id ?? ''}
          onChange={(row) => {
            setChosen(row);
            setInvestmentId('');
          }}
        />
      )}

      {kind && needsSubject && fixedSubject && (
        <Field label={kind.subject === 'convertible_round' ? '転換型証券の回次' : kind.subject === 'board_meeting' ? '取締役会' : '株主総会'}>
          <FixedValue>{fixedSubject.label}</FixedValue>
        </Field>
      )}
      {kind && needsSubject && !fixedSubject && (
        <SubjectSelect
          key={kind.subject}
          kind={kind}
          value={subjectId}
          onChange={(value) => {
            setSubjectId(value);
            setInvestmentId('');
          }}
        />
      )}
      {kind?.perInvestor && subjectId && <InvestmentSelect key={subjectId} roundId={subjectId} value={investmentId} onChange={setInvestmentId} />}

      {error && (
        <p role="alert" className="text-[13px] text-danger m-0">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onClose} disabled={isRunning}>
          キャンセル
        </Button>
        <Button type="button" onClick={compose} disabled={!ready || isRunning}>
          {isRunning ? <Loader2 className="animate-spin" /> : <FileText />}
          文書を作る
        </Button>
      </div>
    </div>
  );
};

export const ComposeDialog = ({ isOpen, title = 'テンプレートから文書を作る', ...props }: ComposeProps & { isOpen: boolean; title?: string }) => (
  <Modal isOpen={isOpen} onClose={props.onClose} title={title} size="xl">
    {isOpen && <Body {...props} />}
  </Modal>
);
