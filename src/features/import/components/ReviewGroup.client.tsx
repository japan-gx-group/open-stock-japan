'use client';

// 確認画面の 1 つのまとまり（株主・株式の異動・会議など）。行ごとに、対象にするか・参照先・値を直せる。
// 項目の入力欄は、リソース定義の FieldDef（reviewFieldsOf）から作る。

import React from 'react';
import { AlertTriangle, Link2 } from 'lucide-react';
import { GROUP_SPECS, reviewFieldsOf, type GroupSpec, type RefSpec } from '@/lib/import/groups';
import { existingRowsOf, refExisting, refNew } from '@/lib/import/review';
import type { ImportContext, ImportDocumentKind, ReviewCheck, ReviewRow, ReviewState, RowIssues } from '@/lib/import/types';
import { toFormValue, type FieldDef } from '@/lib/resources/fields';
import type { ReviewActions } from '../hooks/useImportReview';
import { ReviewField } from './ReviewField.client';

interface GroupProps {
  spec: GroupSpec;
  kind: ImportDocumentKind;
  state: ReviewState;
  context: ImportContext;
  check: ReviewCheck;
  actions: ReviewActions;
  readOnly: boolean;
  /** 反映済み・破棄済みの結果（AI が読み取った内容だけを見せる。今の台帳との照合・注意・対象の選択は出さない） */
  archived: boolean;
}

const rowLabel = (spec: GroupSpec, row: ReviewRow, index: number): string => {
  const value = spec.labelKey ? row.values[spec.labelKey] : '';
  return typeof value === 'string' && value.trim() !== '' ? value : `${spec.label} ${index + 1}`;
};

const RefSelect = ({
  id,
  refSpec,
  row,
  state,
  context,
  disabled,
  error,
  compact,
  archived,
  onChange,
}: {
  id: string;
  refSpec: RefSpec;
  row: ReviewRow;
  state: ReviewState;
  context: ImportContext;
  disabled: boolean;
  error?: string;
  compact: boolean;
  archived: boolean;
  onChange: (value: string) => void;
}) => {
  const sourceSpec = refSpec.source ? GROUP_SPECS[refSpec.source] : null;
  const proposals = refSpec.source ? (state[refSpec.source] ?? []) : [];
  const existing = existingRowsOf(refSpec.target, context);
  const name = row.names[refSpec.key];
  const match = row.matches[refSpec.key];
  if (archived) {
    return (
      <div style={{ minWidth: compact ? '160px' : undefined }}>
        {!compact && <div className="gt-field-label">{refSpec.label}</div>}
        <div className="text-[13.5px] text-text-main min-h-[38px] flex items-center">{name ?? '—'}</div>
      </div>
    );
  }
  return (
    <div style={{ minWidth: compact ? '200px' : undefined }}>
      {!compact && (
        <label htmlFor={id} className="gt-field-label">
          {refSpec.label}
          {refSpec.required && <span className="text-danger ml-1">*</span>}
        </label>
      )}
      <select
        id={id}
        className="gt-field gt-field-select w-full"
        style={error ? { borderColor: 'var(--color-danger)' } : undefined}
        aria-label={compact ? refSpec.label : undefined}
        aria-invalid={error ? true : undefined}
        disabled={disabled}
        value={row.refs[refSpec.key] ?? ''}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{refSpec.required ? '選択してください' : '（指定なし）'}</option>
        {proposals.length > 0 && (
          <optgroup label="この取り込みで新しく作る">
            {proposals.map((proposal, index) => (
              <option key={proposal.key} value={refNew(proposal.key)}>
                新規: {sourceSpec ? rowLabel(sourceSpec, proposal, index) : proposal.key}
                {proposal.include ? '' : '（対象外）'}
              </option>
            ))}
          </optgroup>
        )}
        {existing.length > 0 && (
          <optgroup label="登録済み">
            {existing.map((item) => (
              <option key={item.id} value={refExisting(item.id)}>
                {item.label}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      {name && (
        <p className="text-[11.5px] text-text-muted mt-1 mb-0 leading-snug">
          文書の表記: {name}
          {/* 表の中では名前を割らず、注意は次の行に出す（列を広げない） */}
          {match?.status === 'candidates' && <span className={compact ? 'block text-warning' : 'text-warning'}>（似た名前の登録あり）</span>}
        </p>
      )}
      {error && (
        <p role="alert" className="text-[12px] text-danger mt-1 mb-0 whitespace-normal">
          {error}
        </p>
      )}
    </div>
  );
};

const RowNotes = ({
  spec,
  row,
  issues,
  readOnly,
  actions,
}: {
  spec: GroupSpec;
  row: ReviewRow;
  issues: RowIssues | undefined;
  readOnly: boolean;
  actions: ReviewActions;
}) => {
  const hasContent = (issues && (issues.errors.length > 0 || issues.warnings.length > 0)) || (!row.include && row.existing) || (row.include && row.similar.length > 0);
  if (!hasContent) return null;
  return (
    <div className="flex flex-col gap-1.5 text-[12.5px] leading-relaxed">
      {!row.include && row.existing && (
        <p className="m-0 flex items-center gap-1.5 text-text-muted">
          <Link2 size={13} className="shrink-0" />
          登録済みの「{row.existing.label}」と一致したため、新しく作りません（別のものなら、対象にすると新しく作ります）。
        </p>
      )}
      {issues?.errors.map((message) => (
        <p key={message} role="alert" className="m-0 text-danger">
          {message}
        </p>
      ))}
      {issues?.warnings.map((message) => (
        <p key={message} className="m-0 flex items-start gap-1.5 text-text-main">
          <AlertTriangle size={13} className="mt-[3px] shrink-0 text-warning" />
          <span>{message}</span>
        </p>
      ))}
      {row.include && !readOnly && row.similar.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {row.similar.map((item) => (
            <button key={item.id} type="button" className="gt-btn" style={{ height: '28px', fontSize: '12px' }} onClick={() => actions.linkExisting(spec.key, row.key, item)}>
              「{item.label}」と同じ（新しく作らない）
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

const StatusPill = ({ row }: { row: ReviewRow }) =>
  row.include ? (
    <span className="gt-pill gt-pill-sm gt-pill-accent">新規</span>
  ) : row.existing ? (
    <span className="gt-pill gt-pill-sm gt-pill-neutral">登録済み</span>
  ) : (
    <span className="gt-pill gt-pill-sm gt-pill-neutral">対象外</span>
  );

const IncludeBox = ({ spec, row, label, readOnly, actions }: { spec: GroupSpec; row: ReviewRow; label: string; readOnly: boolean; actions: ReviewActions }) => (
  <input
    type="checkbox"
    aria-label={`${label}を台帳に反映する`}
    checked={row.include}
    disabled={readOnly}
    onChange={(event) => actions.setIncluded(spec.key, row.key, event.target.checked)}
  />
);

// ---- 表（1 件 1 行） ----

const TableGroup = ({ spec, kind, state, context, check, actions, readOnly, archived }: GroupProps) => {
  const fields = reviewFieldsOf(spec, kind);
  const rows = state[spec.key] ?? [];
  // 反映済み・破棄済みでは、文書に名前が書かれていた参照だけを見せる
  const refs = archived ? spec.refs.filter((ref) => ref.nameKey) : spec.refs;
  const columns = 2 + refs.length + fields.length;
  return (
    // 入力欄を並べる表なので、列が多いまとまりは横にスクロールする。@container は、行の注意の幅を「見えている幅」に合わせるため
    <div className="gt-table-scroll @container">
      <table className="gt-table">
        <thead>
          <tr>
            {!archived && (
              <>
                <th style={{ width: '36px' }}>
                  <span className="sr-only">反映する</span>
                </th>
                <th />
              </>
            )}
            {refs.map((ref) => (
              <th key={ref.key}>
                {ref.label}
                {ref.required && <span className="text-danger ml-1">*</span>}
              </th>
            ))}
            {fields.map((field) => (
              <th key={field.key}>
                {field.label}
                {field.required && <span className="text-danger ml-1">*</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const issues = archived ? undefined : check.rows[row.key];
            const label = rowLabel(spec, row, index);
            const disabled = readOnly || (!archived && !row.include);
            const notes = <RowNotes spec={spec} row={row} issues={issues} readOnly={readOnly} actions={actions} />;
            const hasNotes =
              !archived &&
              Boolean((issues && (issues.errors.length > 0 || issues.warnings.length > 0)) || (!row.include && row.existing) || (row.include && row.similar.length > 0));
            return (
              <React.Fragment key={row.key}>
                <tr style={{ opacity: archived || row.include ? 1 : 0.6 }}>
                  {!archived && (
                    <>
                      <td style={{ borderBottom: hasNotes ? 'none' : undefined, verticalAlign: 'top', paddingTop: '20px' }}>
                        <IncludeBox spec={spec} row={row} label={label} readOnly={readOnly} actions={actions} />
                      </td>
                      <td style={{ borderBottom: hasNotes ? 'none' : undefined, verticalAlign: 'top', paddingTop: '18px' }}>
                        <StatusPill row={row} />
                      </td>
                    </>
                  )}
                  {refs.map((ref) => (
                    <td key={ref.key} style={{ borderBottom: hasNotes ? 'none' : undefined, verticalAlign: 'top' }}>
                      <RefSelect
                        id={`${row.key}-${ref.key}`}
                        refSpec={ref}
                        row={row}
                        state={state}
                        context={context}
                        disabled={disabled}
                        error={issues?.fieldErrors[ref.key]}
                        compact
                        archived={archived}
                        onChange={(value) => actions.setRef(spec.key, row.key, ref.key, value)}
                      />
                    </td>
                  ))}
                  {fields.map((field) => (
                    <td key={field.key} style={{ borderBottom: hasNotes ? 'none' : undefined, verticalAlign: 'top' }}>
                      <ReviewField
                        id={`${row.key}-${field.key}`}
                        field={field}
                        value={row.values[field.key]}
                        disabled={disabled}
                        error={issues?.fieldErrors[field.key]}
                        compact
                        onChange={(value) => actions.setValue(spec.key, row.key, field.key, value)}
                      />
                    </td>
                  ))}
                </tr>
                {hasNotes && (
                  <tr>
                    <td />
                    <td colSpan={columns - 1} style={{ paddingTop: 0 }}>
                      {/* 注意・誤りの文は、表を横にスクロールしても左に残し（sticky）、見えている幅で折り返す */}
                      <div className="sticky left-0 w-fit max-w-[calc(100cqw-60px)] whitespace-normal">{notes}</div>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
};

// ---- 枠（項目を並べる） ----

const FormGroup = ({ spec, kind, state, context, check, actions, readOnly, archived }: GroupProps) => {
  const fields = reviewFieldsOf(spec, kind);
  const refs = archived ? spec.refs.filter((ref) => ref.nameKey) : spec.refs;
  return (
    <div className="flex flex-col gap-3">
      {(state[spec.key] ?? []).map((row, index) => {
        const issues = archived ? undefined : check.rows[row.key];
        const label = rowLabel(spec, row, index);
        const disabled = readOnly || (!archived && !row.include);
        return (
          <div key={row.key} className="rounded-md border border-border" style={{ padding: '14px 16px' }}>
            {archived ? (
              <div className="text-[14px] font-semibold text-text-heading">{label}</div>
            ) : (
              <>
                <label className="flex items-center gap-2 text-[14px] font-semibold text-text-heading cursor-pointer">
                  <IncludeBox spec={spec} row={row} label={label} readOnly={readOnly} actions={actions} />
                  {label}
                  <StatusPill row={row} />
                </label>
                <div className="mt-2">
                  <RowNotes spec={spec} row={row} issues={issues} readOnly={readOnly} actions={actions} />
                </div>
              </>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3 mt-3" style={{ opacity: archived || row.include ? 1 : 0.6 }}>
              {refs.map((ref) => (
                <RefSelect
                  key={ref.key}
                  id={`${row.key}-${ref.key}`}
                  refSpec={ref}
                  row={row}
                  state={state}
                  context={context}
                  disabled={disabled}
                  error={issues?.fieldErrors[ref.key]}
                  compact={false}
                  archived={archived}
                  onChange={(value) => actions.setRef(spec.key, row.key, ref.key, value)}
                />
              ))}
              {fields.map((field) => (
                <ReviewField
                  key={field.key}
                  id={`${row.key}-${field.key}`}
                  field={field}
                  value={row.values[field.key]}
                  disabled={disabled}
                  error={issues?.fieldErrors[field.key]}
                  onChange={(value) => actions.setValue(spec.key, row.key, field.key, value)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
};

// ---- 会社情報（項目ごとに、今の値と読み取った値を並べて選ぶ） ----

const displayValue = (field: FieldDef, value: string | boolean): string => {
  if (field.type === 'boolean') return value === true ? 'はい' : 'いいえ';
  if (typeof value !== 'string' || value === '') return '（未入力）';
  if (field.type === 'select') return field.options?.find((option) => option.value === value)?.label ?? value;
  return value;
};

const CompanyGroup = ({ spec, kind, state, context, check, actions, readOnly, archived }: GroupProps) => {
  const row = state.company?.[0];
  if (!row) return null;
  const fields = reviewFieldsOf(spec, kind);
  if (archived) {
    return (
      <div className="gt-table-scroll">
        <table className="gt-table">
          <thead>
            <tr>
              <th>項目</th>
              <th>読み取った値</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((field) => (
              <tr key={field.key}>
                <td style={{ minWidth: '180px' }}>{field.label}</td>
                <td className="gt-wrap w-full break-words whitespace-pre-wrap">{displayValue(field, row.values[field.key] ?? '')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }
  const issues = check.rows[row.key];
  const locked = readOnly || !context.canEditCompany;
  return (
    <div>
      {!context.canEditCompany && (
        <p className="text-[13px] text-text-muted mt-0 mb-3">
          会社情報の変更は管理者だけが行えます。読み取った値は確認できますが、反映はされません（管理者がこの画面から反映できます）。
        </p>
      )}
      {issues?.errors.map((message) => (
        <p key={message} role="alert" className="text-[13px] text-danger mt-0 mb-2">
          {message}
        </p>
      ))}
      <div className="gt-table-scroll">
        <table className="gt-table">
          <thead>
            <tr>
              <th style={{ width: '36px' }}>
                <span className="sr-only">反映する</span>
              </th>
              <th>項目</th>
              <th>今の値</th>
              <th>読み取った値（反映する値）</th>
            </tr>
          </thead>
          <tbody>
            {fields.map((field) => {
              const ticked = (row.ticked ?? []).includes(field.key);
              const current = context.company ? toFormValue(field, context.company[field.key]) : field.type === 'boolean' ? false : '';
              const same = current === row.values[field.key];
              return (
                <tr key={field.key}>
                  <td style={{ verticalAlign: 'top', paddingTop: '20px' }}>
                    <input
                      type="checkbox"
                      aria-label={`${field.label}を反映する`}
                      checked={ticked}
                      disabled={locked}
                      onChange={(event) => actions.setTicked(row.key, field.key, event.target.checked)}
                    />
                  </td>
                  <td style={{ verticalAlign: 'top', paddingTop: '18px', minWidth: '180px' }}>{field.label}</td>
                  <td style={{ verticalAlign: 'top', paddingTop: '18px', maxWidth: '280px' }} className="gt-wrap-sm text-text-muted break-words whitespace-pre-wrap">
                    {displayValue(field, current)}
                  </td>
                  <td style={{ minWidth: '260px' }}>
                    <ReviewField
                      id={`${row.key}-${field.key}`}
                      field={field}
                      value={row.values[field.key]}
                      disabled={locked || !ticked}
                      error={issues?.fieldErrors[field.key]}
                      compact
                      onChange={(value) => actions.setValue('company', row.key, field.key, value)}
                    />
                    {same && <p className="text-[11.5px] text-text-muted mt-1 mb-0 whitespace-normal">今の値と同じです</p>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ---- 照合だけ（登記簿の発行済株式数） ----

const CrosscheckGroup = ({ spec, state, archived }: GroupProps) => (
  <div>
    <p className="text-[13px] text-text-muted mt-0 mb-2">
      台帳には書き込みません。{archived ? '登記簿に記載されていた発行済株式数です。' : '登記簿の記載と、台帳の発行済株式数を比べた結果を、上の注意に表示しています。'}
    </p>
    <div className="gt-table-scroll" style={{ maxWidth: '420px' }}>
      <table className="gt-table">
        <thead>
          <tr>
            <th>株式の種類</th>
            <th className="gt-num">登記簿の発行済株式数</th>
          </tr>
        </thead>
        <tbody>
          {(state[spec.key] ?? []).map((row) => (
            <tr key={row.key}>
              <td>{row.values.shareClassName || '普通株式'}</td>
              <td className="gt-num">{row.values.shares}株</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

export const ReviewGroup = (props: GroupProps) => {
  const { spec, kind, state, actions, readOnly, archived } = props;
  const rows = state[spec.key] ?? [];
  if (rows.length === 0) return null;
  const type = spec.target.type;
  const included = rows.filter((row) => row.include).length;
  const isBulk = type !== 'company' && type !== 'crosscheck' && !spec.single && rows.length > 1 && !readOnly;
  // 株主名簿からの取り込みは、異動日と種類を全行まとめて決める
  const isHoldings = kind === 'shareholder_list' && spec.key === 'shareTransactions' && !readOnly;

  return (
    <section className="gt-card" aria-label={spec.label}>
      <div className="gt-card-head mb-3">
        <div>
          <h2 className="gt-card-title m-0">{spec.label}</h2>
          {type !== 'crosscheck' && type !== 'company' && (
            <p className="gt-card-sub m-0">{archived ? `AI が読み取った ${rows.length} 件` : `${rows.length} 件のうち ${included} 件を反映`}</p>
          )}
        </div>
        {isBulk && (
          <div className="flex gap-2">
            <button type="button" className="gt-btn" onClick={() => actions.setAllIncluded(spec.key, true)}>
              すべて対象にする
            </button>
            <button type="button" className="gt-btn" onClick={() => actions.setAllIncluded(spec.key, false)}>
              すべて外す
            </button>
          </div>
        )}
      </div>
      {isHoldings && (
        <div className="flex flex-wrap items-end gap-3 rounded-md border border-border bg-primary-bg/40 mb-3" style={{ padding: '10px 14px' }}>
          <div>
            <label htmlFor="holdings-date" className="gt-field-label">
              異動日をまとめて設定
            </label>
            <input
              id="holdings-date"
              type="date"
              className="gt-field"
              onChange={(event) => {
                if (event.target.value) actions.setAllValues('shareTransactions', 'transactionDate', event.target.value);
              }}
            />
          </div>
          <div>
            <label htmlFor="holdings-type" className="gt-field-label">
              異動の種類をまとめて設定
            </label>
            <select
              id="holdings-type"
              className="gt-field gt-field-select"
              defaultValue=""
              onChange={(event) => {
                if (event.target.value) actions.setAllValues('shareTransactions', 'transactionType', event.target.value);
              }}
            >
              <option value="">（変更しない）</option>
              {(reviewFieldsOf(spec, kind).find((field) => field.key === 'transactionType')?.options ?? []).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <p className="text-[12px] text-text-muted m-0 max-w-[460px] leading-relaxed">
            今の持株数を、この日に取得した 1 件の異動として記録します。過去の発行・譲渡の履歴は復元されません。
          </p>
        </div>
      )}
      {type === 'company' ? (
        <CompanyGroup {...props} />
      ) : type === 'crosscheck' ? (
        <CrosscheckGroup {...props} />
      ) : spec.layout === 'table' ? (
        <TableGroup {...props} />
      ) : (
        <FormGroup {...props} />
      )}
    </section>
  );
};
