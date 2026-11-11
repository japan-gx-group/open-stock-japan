'use client';

// テンプレートを新しく作るときの入口。種類を選び、作り方（AI に書いてもらう・手元の文面から作る・白紙から書く）を選ぶ。
// ここで作るのは「下書き」まで。保存は、次の編集の画面で文面を確かめてから行う。
//
// AI に送るもの:
//   AI に書いてもらう … 会社の機関設計（サーバが読む）と、ここで入力した要望・参考の文面。台帳の値（会社名・株主・金額）は送らない
//   手元の文面から作る … 貼り付けた文面。AI は置き換える場所の案を返すだけで、文面はサーバが機械的に置き換える

import React, { useState } from 'react';
import { ChevronLeft, ChevronRight, Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/Modal.client';
import { useAiStatus } from '@/features/ai/hooks/useAiStatus';
import { errorMessage } from '@/lib/resources/client';
import type { TemplateKindId } from '@/lib/resources/definitions';
import { AI_PROVIDER_LABELS } from '@/types/ai';
import { requestTemplateConversion, requestTemplateDraft } from '../services/client';
import { getTemplateKind, kindsOfCategory, TEMPLATE_CATEGORIES, templateKindName, type TemplateKindDef } from '../services/kinds';
import type { TemplateDraft } from '../types';

type Method = 'ai' | 'paste' | 'blank';

const MAX_REQUEST = 2_000;
const MAX_REFERENCE = 20_000;
const MAX_SOURCE = 80_000;

const notesAsMemo = (notes: string[]): string => (notes.length > 0 ? `確かめること（AI から）:\n${notes.map((note) => `- ${note}`).join('\n')}` : '');

const KindPicker = ({ onPick }: { onPick: (kind: TemplateKindId) => void }) => (
  <div className="flex flex-col gap-5">
    <p className="text-[13px] leading-relaxed text-text-body m-0">何のテンプレートを作りますか。あとから文面は自由に直せます。</p>
    {TEMPLATE_CATEGORIES.map((category) => (
      <section key={category.value} aria-label={category.label}>
        <h4 className="text-[13px] font-semibold text-text-heading m-0">{category.label}</h4>
        <ul className="list-none p-0 mt-2 mb-0 grid grid-cols-1 sm:grid-cols-2 gap-2">
          {kindsOfCategory(category.value).map((kind) => (
            <li key={kind.id}>
              <button
                type="button"
                className="group flex h-full w-full flex-col justify-start text-left rounded-md border border-border-strong bg-bg-card px-3 py-2.5 cursor-pointer hover:border-primary hover:bg-primary-bg/30"
                onClick={() => onPick(kind.id)}
              >
                <span className="flex items-center justify-between gap-2 text-[13.5px] font-medium text-text-heading">
                  {kind.label}
                  <ChevronRight size={15} className="shrink-0 text-text-subtle group-hover:text-primary" />
                </span>
                <span className="block text-[12px] leading-snug text-text-muted mt-0.5">{kind.summary}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    ))}
  </div>
);

const MethodOption = ({
  value,
  current,
  title,
  description,
  disabledReason,
  onSelect,
}: {
  value: Method;
  current: Method;
  title: string;
  description: string;
  disabledReason?: string | null;
  onSelect: (method: Method) => void;
}) => (
  <label
    className={`flex items-start gap-2.5 rounded-md border px-3 py-2.5 ${
      disabledReason ? 'border-border bg-bg-subtle text-text-subtle' : current === value ? 'border-primary bg-primary-bg/40 cursor-pointer' : 'border-border-strong cursor-pointer'
    }`}
  >
    <input
      type="radio"
      name="template-method"
      className="mt-[3px]"
      checked={current === value}
      disabled={Boolean(disabledReason)}
      onChange={() => onSelect(value)}
    />
    <span className="min-w-0">
      <span className={`block text-[13.5px] font-medium ${disabledReason ? 'text-text-subtle' : 'text-text-heading'}`}>{title}</span>
      <span className="block text-[12px] leading-snug text-text-muted mt-0.5">{disabledReason ?? description}</span>
    </span>
  </label>
);

const MethodStep = ({
  kind,
  onBack,
  onDraft,
}: {
  kind: TemplateKindDef;
  onBack: () => void;
  onDraft: (draft: TemplateDraft) => void;
}) => {
  const { status, isLoading } = useAiStatus();
  const aiReady = Boolean(status?.configured && status.modelId);
  const destination = status?.provider ? `${AI_PROVIDER_LABELS[status.provider]}（${status.modelId}）` : 'AI の提供元';
  const aiUnavailable = isLoading ? 'AI の設定を確認しています…' : !aiReady ? 'AI が未設定のため使えません（組織・メンバー設定 > AI の設定）' : null;

  // AI に書かせない種類（契約書）は、手元の文面からの取り込みを最初に選んでおく
  const [method, setMethod] = useState<Method>(kind.instruction ? 'ai' : 'paste');
  const [request, setRequest] = useState('');
  const [reference, setReference] = useState('');
  const [source, setSource] = useState('');
  const [convert, setConvert] = useState(true);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AI が使えないと分かったら、AI に書いてもらう以外の作り方に移す
  const effectiveMethod: Method = method === 'ai' && !isLoading && !aiReady ? 'paste' : method;
  const useAiForPaste = convert && aiReady;
  const base = { id: null, kind: kind.id, status: 'draft' as const };

  const run = async () => {
    if (isRunning) return;
    setError(null);
    if (effectiveMethod === 'blank') {
      onDraft({ ...base, title: templateKindName(kind.id), body: '', notes: '', origin: null });
      return;
    }
    setIsRunning(true);
    try {
      if (effectiveMethod === 'ai') {
        const result = await requestTemplateDraft(kind.id, request, reference);
        onDraft({
          ...base,
          title: result.title,
          body: result.body,
          notes: notesAsMemo(result.notes),
          origin: {
            summary: `${AI_PROVIDER_LABELS[result.provider]}（${result.modelId}）が書いたひな形です。保存の前に、文面と「【要確認】」の箇所を確かめてください。`,
            details: result.notes,
          },
        });
      } else if (useAiForPaste) {
        const result = await requestTemplateConversion(kind.id, source);
        const places = result.applied.reduce((total, item) => total + item.count, 0);
        const parts = [`空欄 ${places} か所を、差し込み項目に置き換えました（空欄以外の文字は変えていません）。`];
        if (result.skipped.length > 0) parts.push(`置き換えなかった案が ${result.skipped.length} 件あります。`);
        if (result.remainingBlanks > 0) parts.push(`空欄が ${result.remainingBlanks} か所残っています。`);
        onDraft({
          ...base,
          title: templateKindName(kind.id),
          body: result.body,
          notes: notesAsMemo(result.notes),
          origin: {
            summary: parts.join(' '),
            details: [...result.skipped.map((item) => `「${item.find}」: ${item.reason}`), ...result.notes].slice(0, 12),
          },
        });
      } else {
        onDraft({
          ...base,
          title: templateKindName(kind.id),
          body: source.trim(),
          notes: '',
          origin: { summary: '貼り付けた文面を、そのまま取り込みました。空欄を差し込み項目に置き換えるには、右の一覧から選んで入れてください。', details: [] },
        });
      }
    } catch (caught) {
      setError(errorMessage(caught, 'ひな形の作成に失敗しました'));
    } finally {
      setIsRunning(false);
    }
  };

  const canRun = effectiveMethod === 'blank' || (effectiveMethod === 'ai' ? aiReady : source.trim() !== '');

  return (
    <div className="flex flex-col gap-4">
      <div>
        <button type="button" className="inline-flex items-center gap-1 bg-transparent border-0 p-0 cursor-pointer text-[12.5px] text-text-muted" onClick={onBack} disabled={isRunning}>
          <ChevronLeft size={14} />
          種類を選び直す
        </button>
        <div className="text-[15px] font-semibold text-text-heading mt-1.5">{templateKindName(kind.id)}</div>
        <p className="text-[12.5px] leading-relaxed text-text-muted mt-0.5 mb-0">
          {kind.summary}
          {kind.basis && `（${kind.basis}）`}
        </p>
      </div>

      {kind.cautions.length > 0 && (
        <ul className="m-0 pl-5 list-disc text-[12.5px] leading-relaxed text-text-body">
          {kind.cautions.map((caution) => (
            <li key={caution}>{caution}</li>
          ))}
        </ul>
      )}

      <fieldset className="border-0 p-0 m-0 flex flex-col gap-2">
        <legend className="gt-field-label">作り方</legend>
        <MethodOption
          value="ai"
          current={effectiveMethod}
          title="AI に書いてもらう"
          description="会社の機関設計（取締役会・監査役の有無など）に合わせて、差し込み項目つきのひな形を書きます。"
          disabledReason={kind.instruction ? aiUnavailable : 'この種類の文面は、AI には書かせません。お手元のひな形を貼り付けてください。'}
          onSelect={setMethod}
        />
        <MethodOption
          value="paste"
          current={effectiveMethod}
          title="手元の文面から作る"
          description="お使いのひな形や、過去に作った文書を貼り付けます。文面はそのまま使い、空欄を差し込み項目に置き換えます。"
          onSelect={setMethod}
        />
        <MethodOption value="blank" current={effectiveMethod} title="白紙から書く" description="編集の画面で、文面を一から書きます。" onSelect={setMethod} />
      </fieldset>

      {effectiveMethod === 'ai' && (
        <div className="flex flex-col gap-3">
          <div>
            <label htmlFor="template-request" className="gt-field-label">
              AI への要望（任意）
            </label>
            <textarea
              id="template-request"
              className="gt-field w-full"
              style={{ minHeight: '72px', height: 'auto', padding: '9px 12px', lineHeight: 1.6 }}
              value={request}
              maxLength={MAX_REQUEST}
              placeholder="例: 簡潔に。出欠は返信用のメールアドレスで受け付ける"
              onChange={(event) => setRequest(event.target.value)}
            />
          </div>
          <details>
            <summary className="cursor-pointer text-[12.5px] font-medium text-text-body">参考にする文面を貼る（任意）</summary>
            <textarea
              className="gt-field w-full mt-2"
              style={{ minHeight: '120px', height: 'auto', padding: '9px 12px', lineHeight: 1.6 }}
              aria-label="参考にする文面"
              value={reference}
              maxLength={MAX_REFERENCE}
              placeholder="過去に作った文書を貼ると、構成と文体を合わせます。そこにある日付・氏名・金額は、差し込み項目に置き換えて書きます。"
              onChange={(event) => setReference(event.target.value)}
            />
          </details>
          <p className="text-[12px] leading-relaxed text-text-muted m-0">
            会社の機関設計と、ここに入力した内容を、{destination} に送ります。会社名・株主・金額などの台帳の値は送りません（ひな形には、差し込み項目として書かれます）。
          </p>
          <p className="text-[12px] leading-relaxed text-text-muted m-0">
            AI が書くのは、たたき台です。法的な正しさを保証するものではありません。すでに争いのある相手に関する書面（請求・警告の通知、和解契約書、裁判所に出す書面など）には使えません。弁護士に相談してください。
          </p>
        </div>
      )}

      {effectiveMethod === 'paste' && (
        <div className="flex flex-col gap-3">
          <div>
            <label htmlFor="template-source" className="gt-field-label">
              文面
            </label>
            <textarea
              id="template-source"
              className="gt-field w-full"
              style={{ minHeight: '200px', height: 'auto', padding: '10px 12px', lineHeight: 1.7 }}
              value={source}
              maxLength={MAX_SOURCE}
              placeholder="ひな形の文面を貼り付けてください（Word などからコピーした文字）。"
              onChange={(event) => setSource(event.target.value)}
            />
          </div>
          <label className={`flex items-start gap-2 text-[13px] ${aiReady ? 'text-text-main cursor-pointer' : 'text-text-subtle'}`}>
            <input type="checkbox" className="mt-[3px]" checked={useAiForPaste} disabled={!aiReady} onChange={(event) => setConvert(event.target.checked)} />
            <span>
              AI で、空欄（●・＿・[発行会社名称] のような記入箇所）を差し込み項目に置き換える
              {!aiReady && !isLoading && <span className="block text-[12px]">（AI が未設定のため使えません。編集の画面で、自分で置き換えられます）</span>}
            </span>
          </label>
          {useAiForPaste && (
            <p className="text-[12px] leading-relaxed text-text-muted m-0">
              貼り付けた文面を、{destination} に送ります。AI は置き換える場所の案を返すだけで、文面はこのツールが置き換えます。空欄以外の文字が変わる案は、使いません。
            </p>
          )}
        </div>
      )}

      {error && (
        <p role="alert" className="text-[13px] text-danger m-0">
          {error}
        </p>
      )}
      <div className="flex items-center justify-end gap-3">
        {isRunning && <span className="text-[12px] text-text-muted">1 分ほどかかることがあります</span>}
        <Button type="button" onClick={run} disabled={isRunning || !canRun}>
          {isRunning ? <Loader2 className="animate-spin" /> : effectiveMethod === 'ai' || useAiForPaste ? <Sparkles /> : null}
          {isRunning ? '作成中…' : effectiveMethod === 'ai' ? 'ひな形を作る' : effectiveMethod === 'paste' ? '取り込む' : '編集へ進む'}
        </Button>
      </div>
    </div>
  );
};

export const NewTemplateDialog = ({
  isOpen,
  onClose,
  onDraft,
}: {
  isOpen: boolean;
  onClose: () => void;
  /** 下書きができたら呼ばれる（呼び出し側が、編集の画面を開く） */
  onDraft: (draft: TemplateDraft) => void;
}) => {
  const [kindId, setKindId] = useState<TemplateKindId | null>(null);
  const close = () => {
    setKindId(null);
    onClose();
  };
  return (
    <Modal isOpen={isOpen} onClose={close} title="テンプレートを作る" size="xl">
      {isOpen &&
        (kindId ? (
          <MethodStep
            key={kindId}
            kind={getTemplateKind(kindId)}
            onBack={() => setKindId(null)}
            onDraft={(draft) => {
              setKindId(null);
              onDraft(draft);
            }}
          />
        ) : (
          <KindPicker onPick={setKindId} />
        ))}
    </Modal>
  );
};
