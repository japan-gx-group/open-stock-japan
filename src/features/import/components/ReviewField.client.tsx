'use client';

// 確認画面の 1 項目の入力欄。種類（数値・日付・選択肢など）はリソース定義の FieldDef から決める。

import React from 'react';
import type { FieldDef } from '@/lib/resources/fields';

export const ReviewField = ({
  id,
  field,
  value,
  disabled,
  error,
  compact = false,
  onChange,
}: {
  id: string;
  field: FieldDef;
  value: string | boolean | undefined;
  disabled: boolean;
  error?: string;
  /** 表の中に置く（ラベルを出さず、aria-label にする） */
  compact?: boolean;
  onChange: (value: string | boolean) => void;
}) => {
  const common = {
    id,
    disabled,
    'aria-invalid': error ? true : undefined,
    'aria-label': compact ? field.label : undefined,
    'aria-describedby': error ? `${id}-error` : undefined,
  };
  const invalidStyle = error ? { borderColor: 'var(--color-danger)' } : undefined;
  const text = typeof value === 'string' ? value : '';
  const isNumeric = field.type === 'integer' || field.type === 'decimal' || field.type === 'yen' || field.type === 'percent';

  let control: React.ReactNode;
  if (field.type === 'boolean') {
    control = (
      <label htmlFor={id} className="flex items-center gap-2 text-[13px] text-text-main cursor-pointer min-h-[38px]">
        <input {...common} aria-label={undefined} type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} />
        {compact ? <span className="sr-only">{field.label}</span> : field.label}
      </label>
    );
  } else if (field.type === 'textarea') {
    control = (
      <textarea
        {...common}
        className="gt-field w-full"
        style={{ minHeight: compact ? '56px' : '72px', height: 'auto', padding: '8px 10px', lineHeight: 1.55, minWidth: compact ? '260px' : undefined, ...invalidStyle }}
        value={text}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  } else if (field.type === 'select') {
    control = (
      <select
        {...common}
        className="gt-field gt-field-select w-full"
        style={{ minWidth: compact ? '130px' : undefined, ...invalidStyle }}
        value={text}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{field.required ? '選択してください' : '（指定なし）'}</option>
        {(field.options ?? []).map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  } else {
    control = (
      <input
        {...common}
        className="gt-field w-full"
        type={field.type === 'date' ? 'date' : field.type === 'time' ? 'time' : 'text'}
        inputMode={isNumeric ? 'decimal' : undefined}
        style={{ textAlign: isNumeric ? 'right' : undefined, minWidth: compact ? (isNumeric ? '112px' : field.type === 'date' ? '140px' : '170px') : undefined, ...invalidStyle }}
        value={text}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  }

  return (
    <div className={field.type === 'textarea' && !compact ? 'sm:col-span-2 lg:col-span-3' : undefined}>
      {!compact && field.type !== 'boolean' && (
        <label htmlFor={id} className="gt-field-label">
          {field.label}
          {field.required && <span className="text-danger ml-1">*</span>}
        </label>
      )}
      {control}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-[12px] text-danger mt-1 mb-0 whitespace-normal">
          {error}
        </p>
      )}
    </div>
  );
};
