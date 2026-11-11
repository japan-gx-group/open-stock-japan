'use client';

// 会社情報・役員。会社情報は登記事項と定款の定め（機関設計）で、招集通知の期限や役員の任期の計算の元になる。
// 会社情報の変更は管理者だけ、役員の登録・変更は管理者とメンバー（権限の正しさはサーバが確かめる）。

import React, { useMemo, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { PageHeading } from '@/components/layout/PageHeading';
import { ConfirmDialog } from '@/components/resource/ConfirmDialog.client';
import { ErrorBlock, LegalBasis, LoadingBlock, NoticeList } from '@/components/resource/parts';
import { ResourceFormDialog } from '@/components/resource/ResourceFormDialog.client';
import { Badge } from '@/components/ui/badge';
import { useCompany } from '@/hooks/useCompany';
import { useCurrentUser } from '@/hooks/useCurrentUser';
import { useResourceList } from '@/hooks/useResourceList';
import { formatDateJa, todayInTokyo } from '@/lib/equity/format';
import { LEGAL, type Governance } from '@/lib/legal/rules';
import { deleteItem, saveCompany } from '@/lib/resources/client';
import { OFFICER_POSITIONS } from '@/lib/resources/definitions';
import type { ResourceRow } from '@/lib/resources/fields';
import { canEdit, isAdmin } from '@/types/role';
import {
  COMPANY_FIELD_GROUPS,
  companyFieldByKey,
  formatCompanyValue,
  governanceFacts,
  isActive,
  officerRegistration,
  officerTerm,
  officerWarnings,
  parseStartMonth,
  type OfficerLike,
} from '../services/companyFacts';

type OfficerRow = ResourceRow & OfficerLike & { isOutside: boolean; notes: string };

const positionLabel = (position: string): string => OFFICER_POSITIONS.find((option) => option.value === position)?.label ?? position;

const CompanyInfoSection = ({
  company,
  governance,
  editable,
  onEdit,
}: {
  company: ResourceRow;
  governance: Governance;
  editable: boolean;
  onEdit: () => void;
}) => {
  const facts = useMemo(() => governanceFacts(governance), [governance]);
  return (
    <>
      <section className="gt-card" aria-labelledby="company-info-title">
        <div className="gt-card-head">
          <div>
            <h2 id="company-info-title" className="gt-card-title m-0">
              会社情報
            </h2>
            <div className="gt-card-sub">登記事項証明書（履歴事項全部証明書）と定款のとおりに登録します。{!editable && '変更できるのは管理者だけです。'}</div>
          </div>
          {editable && (
            <button type="button" className="gt-btn" onClick={onEdit}>
              <Pencil size={15} />
              編集
            </button>
          )}
        </div>

        <div className="flex flex-col gap-5 mt-4">
          {COMPANY_FIELD_GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="text-[13px] font-semibold text-text-heading m-0 pb-1 border-b border-border">{group.title}</h3>
              {group.description && <p className="text-[12px] text-text-muted mt-1 mb-0">{group.description}</p>}
              <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-3 mt-3 mb-0">
                {group.keys.map((key) => {
                  const field = companyFieldByKey(key);
                  if (!field) return null;
                  return (
                    <div key={key} className={`min-w-0 ${field.type === 'textarea' || field.width === 'full' ? 'sm:col-span-2 lg:col-span-3' : ''}`}>
                      <dt className="text-[12px] text-text-muted">{field.label}</dt>
                      <dd className="m-0 text-[13.5px] text-text-heading whitespace-pre-wrap break-words">{formatCompanyValue(field, company[key])}</dd>
                    </div>
                  );
                })}
              </dl>
            </div>
          ))}
        </div>
      </section>

      <section className="gt-card gt-card-table" aria-labelledby="company-facts-title">
        <h2 id="company-facts-title" className="gt-card-title m-0">
          この機関設計で決まること
        </h2>
        <div className="gt-card-sub">機関設計と定款の定めから計算しています。株主総会・取締役会の画面と手続きカレンダーは、この内容で期限を計算します。</div>
        <div className="gt-table-scroll mt-2">
          <table className="gt-table">
            <tbody>
              {facts.map((fact, index) => (
                <tr key={fact.label}>
                  {/* 見出しの列は折り返さない（「…か」の 1 文字だけが次の行に落ちないように）。
                      罫線は右のセルと同じ色にし、最後の行では引かない。上の余白は右のセルの 1 行目に高さを合わせる */}
                  <th
                    scope="row"
                    className={`align-top border-border pt-[13px]${index === facts.length - 1 ? ' border-b-0' : ''}`}
                  >
                    {fact.label}
                  </th>
                  <td className="gt-wrap-lg">
                    <span className="font-semibold">{fact.value}</span>
                    {fact.basis && (
                      <span className="inline-block">
                        <LegalBasis>{fact.basis}</LegalBasis>
                      </span>
                    )}
                    {fact.note && <div className="text-[12.5px] leading-relaxed text-text-muted mt-1">{fact.note}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
};

const OfficersSection = ({
  officers,
  governance,
  fiscalYearStartMonth,
  editable,
  onChanged,
}: {
  officers: OfficerRow[];
  governance: Governance;
  fiscalYearStartMonth: number | null;
  editable: boolean;
  onChanged: () => Promise<void>;
}) => {
  const today = todayInTokyo();
  const [form, setForm] = useState<{ officer: OfficerRow | null } | null>(null);
  const [deleting, setDeleting] = useState<OfficerRow | null>(null);
  const warnings = useMemo(() => officerWarnings(officers, governance, today), [officers, governance, today]);
  const ordered = useMemo(() => {
    const rank = (officer: OfficerRow): number => {
      const index = OFFICER_POSITIONS.findIndex((option) => option.value === officer.position);
      return (isActive(officer, today) ? 0 : 100) + (index < 0 ? 50 : index);
    };
    return [...officers].sort((a, b) => rank(a) - rank(b) || (a.appointedOn ?? '').localeCompare(b.appointedOn ?? ''));
  }, [officers, today]);

  return (
    <section className="gt-card gt-card-table" aria-labelledby="officers-title">
      <div className="gt-card-head">
        <div>
          <h2 id="officers-title" className="gt-card-title m-0">
            役員
          </h2>
          <div className="gt-card-sub">
            就任・退任・重任は、変更の日から {LEGAL.registrationDeadlineDays} 日以内に登記が必要です<LegalBasis>会社法915条1項</LegalBasis>。任期満了は手続きカレンダーにも表示されます。
          </div>
        </div>
        {editable && (
          <button type="button" className="gt-btn-primary" onClick={() => setForm({ officer: null })}>
            <Plus size={16} />
            役員を登録
          </button>
        )}
      </div>

      {warnings.length > 0 && (
        <div className="mt-3">
          <NoticeList items={warnings.map((warning) => ({ key: warning.key, level: warning.level, message: warning.message }))} />
        </div>
      )}
      {fiscalYearStartMonth == null && (
        <p className="text-[12.5px] text-text-muted mt-3 mb-0">事業年度の開始月が未登録のため、任期満了の予定日を計算できません。会社情報で登録してください。</p>
      )}

      {ordered.length === 0 ? (
        <p className="gt-table-empty m-0">役員はまだ登録されていません。</p>
      ) : (
        <div className="gt-table-scroll mt-2">
          <table className="gt-table">
            <thead>
              <tr>
                <th>役職</th>
                <th>氏名</th>
                <th title="上段: 就任日 ／ 下段: 退任日（退任日を登録した役員のみ）">就任日・退任日</th>
                <th>任期満了の目安</th>
                <th>登記</th>
                {editable && <th aria-label="操作" />}
              </tr>
            </thead>
            <tbody>
              {ordered.map((officer) => {
                const active = isActive(officer, today);
                const term = officerTerm(officer, governance, fiscalYearStartMonth);
                const registration = officerRegistration(officer, today);
                const expired = active && term.expiresOn != null && term.expiresOn < today;
                return (
                  <tr key={officer.id} className={active ? '' : 'opacity-60'}>
                    <td>{positionLabel(officer.position)}</td>
                    {/* 「社外」は氏名の横に置く（役職の列を 1 行に保ち、そのぶんの幅を氏名・任期の列に回す） */}
                    <td className="gt-wrap">
                      <span className="font-semibold">{officer.name}</span>
                      {officer.isOutside && <Badge variant="outline" className="ml-2 align-middle">社外</Badge>}
                      {officer.notes && <div className="text-[12px] text-text-muted">{officer.notes}</div>}
                    </td>
                    <td>
                      {formatDateJa(officer.appointedOn)}
                      {officer.retiredOn && <div className="text-[12px] text-text-muted">退任 {formatDateJa(officer.retiredOn)}</div>}
                    </td>
                    <td className="gt-wrap-lg">
                      {!active ? (
                        '—'
                      ) : term.expiresOn ? (
                        <>
                          <span className="whitespace-nowrap">{formatDateJa(term.expiresOn)}</span>
                          {expired && <Badge variant="danger" className="ml-2">期限を経過</Badge>}
                          <div className="text-[12px] text-text-muted">
                            {term.source === 'manual'
                              ? '入力された予定日'
                              : `任期 ${term.termYears} 年・${formatDateJa(term.lastFiscalYearEnd)} に終了する事業年度の定時株主総会の終結の時まで（総会の期限の目安）`}
                          </div>
                        </>
                      ) : term.termYears == null ? (
                        <span className="text-text-muted">法定の任期なし</span>
                      ) : (
                        <span className="text-text-muted">計算できません（就任日・事業年度の開始月が必要）</span>
                      )}
                    </td>
                    <td>
                      <Badge
                        variant={
                          registration.state === 'overdue'
                            ? 'danger'
                            : registration.state === 'registered_late'
                              ? 'warning'
                              : registration.state === 'registered'
                                ? 'success'
                                : 'neutral'
                        }
                      >
                        {registration.label}
                      </Badge>
                      {officer.registeredOn && <div className="mt-0.5 text-[12px] text-text-muted">{formatDateJa(officer.registeredOn)}</div>}
                      {registration.deadline && registration.state !== 'registered' && (
                        <div className="text-[12px] text-text-muted">期限: {formatDateJa(registration.deadline)}</div>
                      )}
                    </td>
                    {editable && (
                      <td className="text-right">
                        <button type="button" className="gt-iconbtn" aria-label={`${officer.name} を編集`} onClick={() => setForm({ officer })}>
                          <Pencil size={15} />
                        </button>
                        <button type="button" className="gt-iconbtn" aria-label={`${officer.name} を削除`} onClick={() => setDeleting(officer)}>
                          <Trash2 size={15} />
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <ResourceFormDialog
        resource="officers"
        isOpen={form != null}
        onClose={() => setForm(null)}
        initial={form?.officer ?? null}
        title={form?.officer ? '役員を編集' : '役員を登録'}
        onSaved={() => void onChanged()}
      />
      <ConfirmDialog
        isOpen={deleting != null}
        title="役員を削除"
        message={
          <>
            {deleting?.name} の登録を削除します。退任した役員は、削除せずに退任日を入力して残すことをおすすめします（会議の出欠の記録とのつながりが消えます）。
          </>
        }
        onCancel={() => setDeleting(null)}
        onConfirm={async () => {
          if (!deleting) return;
          await deleteItem('officers', deleting.id);
          setDeleting(null);
          await onChanged();
        }}
      />
    </section>
  );
};

export const CompanyPage = () => {
  const { role } = useCurrentUser();
  const company = useCompany();
  const officers = useResourceList<OfficerRow>('officers');
  const [isEditing, setIsEditing] = useState(false);
  const fiscalYearStartMonth = parseStartMonth(company.data);

  return (
    <div className="page-body">
      <PageHeading title="会社情報・役員" description="登記事項・機関設計・定款の定めと、役員の就任・任期・登記を管理します" />
      <div className="flex flex-col gap-4 max-w-[1040px]">
        {company.isLoading && !company.data ? (
          <LoadingBlock />
        ) : !company.data ? (
          <ErrorBlock message={company.error ?? '会社情報の取得に失敗しました'} onRetry={() => void company.reload()} />
        ) : (
          <CompanyInfoSection company={company.data} governance={company.governance} editable={isAdmin(role)} onEdit={() => setIsEditing(true)} />
        )}

        {officers.isLoading && !officers.data ? (
          <LoadingBlock />
        ) : !officers.data ? (
          <ErrorBlock message={officers.error ?? '役員の取得に失敗しました'} onRetry={() => void officers.reload()} />
        ) : (
          <OfficersSection
            officers={officers.data}
            governance={company.governance}
            fiscalYearStartMonth={fiscalYearStartMonth}
            editable={canEdit(role)}
            onChanged={officers.reload}
          />
        )}
      </div>

      {company.data && (
        <ResourceFormDialog
          resource="company"
          isOpen={isEditing}
          onClose={() => setIsEditing(false)}
          initial={company.data}
          title="会社情報を編集"
          save={(values) => saveCompany(values)}
          onSaved={() => void company.reload()}
        />
      )}
    </div>
  );
};
