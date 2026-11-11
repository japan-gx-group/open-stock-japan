'use client';

// 業務データの入力フォーム（登録・編集の共通ダイアログ）。
// 項目はリソース定義（src/lib/resources/definitions.ts）から作る。上部の「AI で入力を補助」に文章を貼るか
// PDF・画像を付けると、AI が読み取った値を候補として項目に入れる（保存は利用者が確かめてから）。

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, Loader2, Paperclip, Sparkles, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/Modal.client';
import { useAiStatus } from '@/features/ai/hooks/useAiStatus';
import { ApiError, apiFetch, errorMessage, listItems, saveItem } from '@/lib/resources/client';
import { COMPANY_DEF } from '@/lib/resources/company';
import { RESOURCES, type ResourceName } from '@/lib/resources/definitions';
import { emptyFormValue, toFormValue, type FieldDef, type ResourceDef, type ResourceRow } from '@/lib/resources/fields';
import { AI_PROVIDER_LABELS } from '@/types/ai';

type FormValues = Record<string, string | boolean>;
type RefOptions = Record<string, { value: string; label: string }[]>;

export interface ResourceFormDialogProps {
  resource: ResourceName | 'company';
  isOpen: boolean;
  onClose: () => void;
  /** 編集する行。null・未指定なら新規登録 */
  initial?: ResourceRow | null;
  /** 新規登録の初期値（フォームの表示値。親の id など） */
  defaults?: FormValues;
  /** 画面に出さない項目（defaults で決めた親の id など） */
  hiddenKeys?: readonly string[];
  /** 選択肢を絞る項目（項目名 → 選べる値）。例: 株主総会の画面では会議の種類から取締役会を外す */
  allowedOptions?: Readonly<Record<string, readonly string[]>>;
  title?: string;
  onSaved: (row: ResourceRow) => void;
  /** 保存の方法を差し替える（会社情報など、汎用 API を使わないとき） */
  save?: (values: FormValues, id: string | null) => Promise<ResourceRow>;
  /** AI の入力補助を出すか（既定: 出す） */
  enableAi?: boolean;
}

const defOf = (resource: ResourceName | 'company'): ResourceDef => (resource === 'company' ? COMPANY_DEF : RESOURCES[resource]);

const ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp';
const MAX_FILE_BYTES = 4 * 1024 * 1024;

const initialValues = (def: ResourceDef, initial: ResourceRow | null | undefined, defaults: FormValues | undefined): FormValues => {
  const values: FormValues = {};
  for (const field of def.fields) {
    values[field.key] = initial ? toFormValue(field, initial[field.key]) : (defaults?.[field.key] ?? emptyFormValue(field));
  }
  return values;
};

interface AssistResponse {
  values: FormValues;
  notes: string[];
}

const AiAssistPanel = ({
  resource,
  onApply,
}: {
  resource: ResourceName | 'company';
  onApply: (values: FormValues) => number;
}) => {
  const { status, isLoading } = useAiStatus();
  const [isExpanded, setIsExpanded] = useState(false);
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ filled: number; notes: string[] } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isReady = Boolean(status?.configured && status.modelId);

  const selectFile = (selected: File | null) => {
    setError(null);
    if (selected && selected.size > MAX_FILE_BYTES) {
      setError('ファイルは 4MB までです');
      return;
    }
    setFile(selected);
  };

  const send = async () => {
    if (isSending || (!text.trim() && !file)) return;
    setIsSending(true);
    setError(null);
    setResult(null);
    try {
      const form = new FormData();
      form.set('resource', resource);
      if (text.trim()) form.set('text', text.trim());
      if (file) form.set('file', file);
      const response = await apiFetch<AssistResponse>('/api/ai/form-assist', { method: 'POST', body: form });
      setResult({ filled: onApply(response.values), notes: response.notes });
    } catch (caught) {
      setError(errorMessage(caught, 'AI による読み取りに失敗しました'));
    } finally {
      setIsSending(false);
    }
  };

  return (
    <div className="rounded-md border border-border bg-primary-bg/40 mb-5">
      <button
        type="button"
        className="flex w-full items-center justify-between gap-2 px-4 py-3 bg-transparent border-none cursor-pointer text-left"
        onClick={() => setIsExpanded((previous) => !previous)}
        aria-expanded={isExpanded}
      >
        <span className="flex items-center gap-2 text-[13px] font-semibold text-text-main">
          <Sparkles size={15} className="text-primary" />
          AI で入力を補助
          <span className="font-normal text-text-muted">メモや契約書の文面・PDF から項目を読み取ります</span>
        </span>
        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>

      {isExpanded && (
        <div className="px-4 pb-4">
          {isLoading ? (
            <p className="text-[13px] text-text-muted m-0">AI の設定を確認しています…</p>
          ) : !isReady ? (
            <p className="text-[13px] text-text-muted m-0">
              AI が未設定です。管理者が「組織・メンバー設定 &gt; AI の設定」で提供元の API キーとモデルを設定すると使えます。
            </p>
          ) : (
            <>
              <textarea
                className="gt-field w-full"
                style={{ minHeight: '84px', height: 'auto', padding: '9px 11px', lineHeight: 1.6 }}
                placeholder="例: 2026年10月30日、みらいベンチャーズ1号投資事業有限責任組合（東京都港区…）が A種優先株式 2,000株を 1株 30,000円で引き受け"
                value={text}
                maxLength={60000}
                onChange={(event) => setText(event.target.value)}
              />
              <div className="flex flex-wrap items-center gap-2 mt-2">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ACCEPT}
                  className="hidden"
                  onChange={(event) => {
                    selectFile(event.target.files?.[0] ?? null);
                    event.target.value = '';
                  }}
                />
                <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                  <Paperclip />
                  PDF・画像を付ける
                </Button>
                {file && (
                  <span className="gt-pill gt-pill-neutral">
                    {file.name}
                    <button
                      type="button"
                      aria-label="ファイルを外す"
                      className="bg-transparent border-none cursor-pointer p-0 ml-1 flex"
                      onClick={() => setFile(null)}
                    >
                      <X size={12} />
                    </button>
                  </span>
                )}
                <Button type="button" size="sm" className="ml-auto" disabled={isSending || (!text.trim() && !file)} onClick={send}>
                  {isSending ? <Loader2 className="animate-spin" /> : <Sparkles />}
                  {isSending ? '読み取り中…' : 'AI で読み取る'}
                </Button>
              </div>
              <p className="text-[12px] text-text-muted mt-2 mb-0">
                入力した文章とファイルは {status?.provider ? AI_PROVIDER_LABELS[status.provider] : 'AI の提供元'}（{status?.modelId}）に送信されます。
                読み取った値は候補として項目に入るだけで、保存されるのは「保存」を押したときです。
              </p>
            </>
          )}
          {error && (
            <p role="alert" className="text-[13px] text-danger mt-2 mb-0">
              {error}
            </p>
          )}
          {result && (
            <div className="text-[13px] mt-2" role="status">
              <p className="m-0 text-text-main">
                {result.filled > 0
                  ? `${result.filled} 項目に候補を入れました（「AI」の印の項目）。内容を確かめてから保存してください。`
                  : '読み取れる項目がありませんでした。'}
              </p>
              {result.notes.length > 0 && (
                <ul className="mt-1 mb-0 pl-5 text-text-muted">
                  {result.notes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const FieldInput = ({
  field,
  value,
  options,
  disabled,
  invalid,
  onChange,
}: {
  field: FieldDef;
  value: string | boolean;
  options: { value: string; label: string }[] | null;
  disabled: boolean;
  invalid: boolean;
  onChange: (value: string | boolean) => void;
}) => {
  const id = `field-${field.key}`;
  const common = { id, disabled, 'aria-invalid': invalid || undefined };

  if (field.type === 'boolean') {
    return (
      <label htmlFor={id} className="flex items-center gap-2 text-[13px] text-text-main cursor-pointer min-h-[38px]">
        <input {...common} type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} />
        {field.label}
      </label>
    );
  }
  const text = typeof value === 'string' ? value : '';
  if (field.type === 'textarea') {
    return (
      <textarea
        {...common}
        className="gt-field w-full"
        style={{ minHeight: '96px', height: 'auto', padding: '9px 11px', lineHeight: 1.6 }}
        value={text}
        placeholder={field.placeholder}
        maxLength={field.maxLength}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }
  if (field.type === 'select' || field.type === 'ref') {
    return (
      <select {...common} className="gt-field gt-field-select w-full" value={text} onChange={(event) => onChange(event.target.value)}>
        <option value="">{field.required ? '選択してください' : '（指定なし）'}</option>
        {(options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }
  const isNumeric = field.type === 'integer' || field.type === 'decimal' || field.type === 'yen' || field.type === 'percent';
  return (
    <input
      {...common}
      className="gt-field w-full"
      type={field.type === 'date' ? 'date' : field.type === 'time' ? 'time' : field.type === 'email' ? 'email' : 'text'}
      inputMode={isNumeric ? 'decimal' : undefined}
      style={isNumeric ? { textAlign: 'right' } : undefined}
      value={text}
      placeholder={field.placeholder}
      maxLength={field.type === 'text' ? field.maxLength : undefined}
      onChange={(event) => onChange(event.target.value)}
    />
  );
};

const FormBody = ({ resource, initial, defaults, hiddenKeys, allowedOptions, onClose, onSaved, save, enableAi = true }: ResourceFormDialogProps) => {
  const def = defOf(resource);
  const [values, setValues] = useState<FormValues>(() => initialValues(def, initial, defaults));
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [aiKeys, setAiKeys] = useState<Set<string>>(new Set());
  const [refOptions, setRefOptions] = useState<RefOptions>({});
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);
  const isEditing = Boolean(initial);

  const visibleFields = useMemo(
    () => def.fields.filter((field) => !field.hidden && !hiddenKeys?.includes(field.key)),
    [def, hiddenKeys],
  );

  // 参照の項目の選択肢（株主・株式の種類など）を読む
  const applyRefOptions = useCallback((options: RefOptions) => setRefOptions(options), []);
  useEffect(() => {
    let active = true;
    const refFields = def.fields.filter((field) => field.type === 'ref' && field.ref && !field.hidden);
    const names = Array.from(new Set(refFields.map((field) => field.ref as ResourceName)));
    Promise.all(names.map(async (name) => [name, await listItems(name).catch(() => [])] as const)).then((entries) => {
      if (!active) return;
      const byName = new Map(entries);
      const options: RefOptions = {};
      for (const field of refFields) {
        const target = RESOURCES[field.ref as ResourceName];
        options[field.key] = (byName.get(field.ref as ResourceName) ?? []).map((row) => ({ value: row.id, label: target.labelOf(row) }));
      }
      applyRefOptions(options);
    });
    return () => {
      active = false;
    };
  }, [def, applyRefOptions]);

  const setValue = (key: string, value: string | boolean) => {
    setValues((previous) => ({ ...previous, [key]: value }));
    setFieldErrors((previous) => {
      if (!(key in previous)) return previous;
      const next = { ...previous };
      delete next[key];
      return next;
    });
    setAiKeys((previous) => {
      if (!previous.has(key)) return previous;
      const next = new Set(previous);
      next.delete(key);
      return next;
    });
  };

  // AI の候補を入れる。編集中に作成後は変えられない項目と、画面に無い項目には入れない。
  const applyAssist = (assist: FormValues): number => {
    const keys = visibleFields
      .filter((field) => !(isEditing && field.immutable) && assist[field.key] !== undefined && assist[field.key] !== '')
      .map((field) => field.key);
    if (keys.length === 0) return 0;
    setValues((previous) => ({ ...previous, ...Object.fromEntries(keys.map((key) => [key, assist[key]])) }));
    setAiKeys((previous) => new Set([...previous, ...keys]));
    return keys.length;
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    setIsSaving(true);
    setFormError(null);
    try {
      const id = initial?.id ?? null;
      const row = save ? await save(values, id) : await saveItem(resource as ResourceName, values, id);
      onSaved(row);
      onClose();
    } catch (caught) {
      if (caught instanceof ApiError) setFieldErrors(caught.fieldErrors);
      setFormError(errorMessage(caught, '保存に失敗しました'));
    } finally {
      savingRef.current = false;
      setIsSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate>
      {def.formNote && <p className="text-[13px] leading-relaxed text-text-muted mt-0 mb-4">{def.formNote}</p>}
      {enableAi && <AiAssistPanel resource={resource} onApply={applyAssist} />}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-4">
        {visibleFields.map((field) => {
          const wide = field.width === 'full' || field.type === 'textarea';
          const error = fieldErrors[field.key];
          return (
            <div key={field.key} className={wide ? 'sm:col-span-2' : undefined}>
              {field.type !== 'boolean' && (
                <label htmlFor={`field-${field.key}`} className="gt-field-label flex items-center gap-1.5">
                  {field.label}
                  {field.required && <span className="text-danger">*</span>}
                  {aiKeys.has(field.key) && <span className="gt-pill gt-pill-sm gt-pill-accent">AI</span>}
                </label>
              )}
              <FieldInput
                field={field}
                value={values[field.key] ?? ''}
                options={
                  field.type === 'ref'
                    ? (refOptions[field.key] ?? [])
                    : field.options
                      ? field.options.filter((option) => allowedOptions?.[field.key]?.includes(option.value) ?? true)
                      : null
                }
                disabled={isSaving || (isEditing && field.immutable === true)}
                invalid={Boolean(error)}
                onChange={(value) => setValue(field.key, value)}
              />
              {field.type === 'boolean' && aiKeys.has(field.key) && <span className="gt-pill gt-pill-sm gt-pill-accent">AI</span>}
              {error ? (
                <p role="alert" className="text-[12px] text-danger mt-1 mb-0">
                  {error}
                </p>
              ) : (
                field.help && <p className="text-[12px] text-text-muted mt-1 mb-0">{field.help}</p>
              )}
            </div>
          );
        })}
      </div>

      {formError && (
        <p role="alert" className="text-[13px] text-danger mt-4 mb-0">
          {formError}
        </p>
      )}
      <div className="flex justify-end gap-2 mt-6">
        <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
          キャンセル
        </Button>
        <Button type="submit" disabled={isSaving}>
          {isSaving && <Loader2 className="animate-spin" />}
          {isEditing ? '変更を保存' : '登録する'}
        </Button>
      </div>
    </form>
  );
};

export const ResourceFormDialog = (props: ResourceFormDialogProps) => {
  const def = defOf(props.resource);
  return (
    <Modal
      isOpen={props.isOpen}
      onClose={props.onClose}
      title={props.title ?? `${def.label}を${props.initial ? '編集' : '登録'}`}
      size="xl"
    >
      {/* 開くたびに入力を初期化する（閉じている間は描画しない） */}
      {props.isOpen && <FormBody key={props.initial?.id ?? 'new'} {...props} />}
    </Modal>
  );
};
