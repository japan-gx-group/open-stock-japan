'use client';

// 文書の登録（ファイルのアップロード）と、登録済みの文書の情報の編集。
// 登録は multipart/form-data で POST /api/documents、編集は PATCH /api/documents/<id>（ファイルの差し替えはできない）。

import React, { useState } from 'react';
import { Loader2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/Modal.client';
import { ApiError, apiFetch, errorMessage } from '@/lib/resources/client';
import { DOCUMENT_CATEGORIES, DOCUMENT_VISIBILITIES } from '@/lib/resources/definitions';
import { formatBytes } from '../services/format';
import type { LibraryDocument } from '../services/documents';

const MAX_BYTES = 20 * 1024 * 1024;
const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp,.docx,.xlsx,.pptx,.txt,.csv';

export interface DocumentFormDefaults {
  category?: string;
  visibility?: LibraryDocument['visibility'];
  entityType?: string;
  entityId?: string;
}

interface Values {
  title: string;
  category: string;
  documentDate: string;
  description: string;
  visibility: string;
}

const Form = ({
  initial,
  defaults,
  onClose,
  onSaved,
}: {
  initial: LibraryDocument | null;
  defaults: DocumentFormDefaults;
  onClose: () => void;
  onSaved: (document: LibraryDocument) => void;
}) => {
  const [values, setValues] = useState<Values>({
    title: initial?.title ?? '',
    category: initial?.category ?? defaults.category ?? 'other',
    documentDate: initial?.documentDate ?? '',
    description: initial?.description ?? '',
    visibility: initial?.visibility ?? defaults.visibility ?? 'internal',
  });
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const isEdit = initial != null;

  const set = (key: keyof Values) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setValues((previous) => ({ ...previous, [key]: event.target.value }));

  const selectFile = (selected: File | null) => {
    setError(null);
    if (selected && selected.size > MAX_BYTES) {
      setError('ファイルは 20MB までです');
      setFile(null);
      return;
    }
    setFile(selected);
    // タイトルが空なら、ファイル名（拡張子なし）を入れておく
    if (selected) setValues((previous) => (previous.title.trim() ? previous : { ...previous, title: selected.name.replace(/\.[^.]+$/, '') }));
  };

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isSaving) return;
    if (!isEdit && !file) {
      setError('ファイルを選んでください');
      return;
    }
    setIsSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      let saved: LibraryDocument;
      if (isEdit) {
        ({ item: saved } = await apiFetch<{ item: LibraryDocument }>(`/api/documents/${initial.id}`, {
          method: 'PATCH',
          body: JSON.stringify(values),
        }));
      } else {
        const form = new FormData();
        form.set('file', file as File);
        for (const [key, value] of Object.entries(values)) if (value) form.set(key, value);
        if (defaults.entityType && defaults.entityId) {
          form.set('entityType', defaults.entityType);
          form.set('entityId', defaults.entityId);
        }
        ({ item: saved } = await apiFetch<{ item: LibraryDocument }>('/api/documents', { method: 'POST', body: form }));
      }
      onSaved(saved);
      onClose();
    } catch (caught) {
      if (caught instanceof ApiError) setFieldErrors(caught.fieldErrors);
      setError(errorMessage(caught, '保存に失敗しました'));
    } finally {
      setIsSaving(false);
    }
  };

  const fieldError = (key: string) =>
    fieldErrors[key] ? (
      <p className="text-[12px] text-danger mt-1 mb-0" role="alert">
        {fieldErrors[key]}
      </p>
    ) : null;

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      {isEdit ? (
        <p className="text-[12.5px] text-text-muted m-0">
          ファイル: {initial.fileName}（{formatBytes(initial.sizeBytes)}）。ファイルを差し替えるときは、削除して登録し直してください。
        </p>
      ) : (
        <div>
          <label htmlFor="document-file" className="gt-field-label">
            ファイル（PDF・画像・Word・Excel・PowerPoint・テキスト・CSV。20MB まで）
          </label>
          <input
            id="document-file"
            type="file"
            accept={ACCEPT}
            className="block w-full text-[13px] text-text-main file:mr-3 file:rounded-md file:border file:border-border-strong file:bg-bg-card file:px-3 file:py-2 file:text-[13px] file:cursor-pointer"
            onChange={(event) => selectFile(event.target.files?.[0] ?? null)}
          />
          {file && <p className="text-[12px] text-text-muted mt-1 mb-0">{formatBytes(file.size)}</p>}
        </div>
      )}
      <div>
        <label htmlFor="document-title" className="gt-field-label">
          タイトル
        </label>
        <input id="document-title" className="gt-field w-full" value={values.title} maxLength={200} onChange={set('title')} placeholder="例: 第3期 計算書類" />
        {fieldError('title')}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="document-category" className="gt-field-label">
            分類
          </label>
          <select id="document-category" className="gt-field gt-field-select w-full" value={values.category} onChange={set('category')}>
            {DOCUMENT_CATEGORIES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          {fieldError('category')}
        </div>
        <div>
          <label htmlFor="document-date" className="gt-field-label">
            文書の日付（任意）
          </label>
          <input id="document-date" type="date" className="gt-field w-full" value={values.documentDate} onChange={set('documentDate')} />
          {fieldError('documentDate')}
        </div>
      </div>
      <div>
        <label htmlFor="document-description" className="gt-field-label">
          説明（任意）
        </label>
        <textarea
          id="document-description"
          className="gt-field w-full"
          style={{ height: 'auto', minHeight: '72px', padding: '10px 12px', lineHeight: 1.6 }}
          value={values.description}
          maxLength={4000}
          onChange={set('description')}
        />
        {fieldError('description')}
      </div>
      {!isEdit && (
        <div>
          <label htmlFor="document-visibility" className="gt-field-label">
            公開範囲
          </label>
          <select id="document-visibility" className="gt-field gt-field-select w-full" value={values.visibility} onChange={set('visibility')}>
            {DOCUMENT_VISIBILITIES.filter((option) => option.value !== 'restricted').map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="text-[12px] text-text-muted mt-1 mb-0">
            {values.visibility === 'shareholders'
              ? '株主ポータルにログインしたすべての株主が、この文書を読めるようになります。'
              : '社内のメンバーだけが読めます。特定の株主だけに公開するときは、登録後に「共有」から指定します。'}
          </p>
          {fieldError('visibility')}
        </div>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-danger m-0">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 mt-1">
        <Button type="button" variant="outline" onClick={onClose} disabled={isSaving}>
          キャンセル
        </Button>
        <Button type="submit" disabled={isSaving}>
          {isSaving ? <Loader2 className="animate-spin" /> : !isEdit && <Upload />}
          {isEdit ? '保存' : 'アップロード'}
        </Button>
      </div>
    </form>
  );
};

export const DocumentFormDialog = ({
  isOpen,
  initial = null,
  defaults = {},
  title,
  onClose,
  onSaved,
}: {
  isOpen: boolean;
  /** 編集する文書。null・未指定なら新規の登録（アップロード） */
  initial?: LibraryDocument | null;
  /** 新規の登録の初期値と、関連づけるレコード */
  defaults?: DocumentFormDefaults;
  title?: string;
  onClose: () => void;
  onSaved: (document: LibraryDocument) => void;
}) => (
  <Modal isOpen={isOpen} onClose={onClose} title={title ?? (initial ? '文書の情報を編集' : '文書をアップロード')} size="lg">
    {isOpen && <Form key={initial?.id ?? 'new'} initial={initial} defaults={defaults} onClose={onClose} onSaved={onSaved} />}
  </Modal>
);
