'use client';

// 税制適格ストックオプション（租税特別措置法29条の2）の要件チェック。
// 判定はすべて src/lib/legal/taxQualified.ts の関数の結果をそのまま出す。画面では数値や要件を決めない。
import React, { useMemo } from 'react';
import { CircleAlert, CircleCheck, CircleHelp } from 'lucide-react';
import { EmptyState, NoticeList } from '@/components/resource/parts';
import { formatDateJa, formatUnits, formatYenJa } from '@/lib/equity/format';
import { GRANT_ROLES, optionLabel, type EquitySnapshot } from '@/lib/equity/types';
import {
  annualExerciseAmounts,
  annualExerciseLimit,
  checkGrantRequirements,
  checkPlanRequirements,
  type RequirementResult,
  type RequirementStatus,
  type TaxQualifiedContext,
} from '@/lib/legal/taxQualified';
import { holdingRatioAt, majorShareholderCheckDate, type PlanView } from '../services/optionSummary';

const STATUS: Record<RequirementStatus, { label: string; pill: string; Icon: typeof CircleCheck; tone: string }> = {
  ok: { label: 'OK', pill: 'gt-pill-good', Icon: CircleCheck, tone: 'text-success' },
  ng: { label: 'NG', pill: 'gt-pill-bad', Icon: CircleAlert, tone: 'text-danger' },
  check: { label: '要確認', pill: 'gt-pill-warn', Icon: CircleHelp, tone: 'text-warning' },
};

const countBy = (results: readonly RequirementResult[]): Record<RequirementStatus, number> => {
  const counts: Record<RequirementStatus, number> = { ok: 0, ng: 0, check: 0 };
  for (const result of results) counts[result.status] += 1;
  return counts;
};

const StatusCounts = ({ results }: { results: readonly RequirementResult[] }) => {
  const counts = countBy(results);
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      {(['ng', 'check', 'ok'] as const)
        .filter((status) => counts[status] > 0)
        .map((status) => (
          <span key={status} className={`gt-pill gt-pill-sm ${STATUS[status].pill}`}>
            {STATUS[status].label} {counts[status]}
          </span>
        ))}
    </span>
  );
};

const RequirementList = ({ results }: { results: readonly RequirementResult[] }) => (
  <ul className="list-none p-0 m-0 flex flex-col">
    {results.map((result) => {
      const status = STATUS[result.status];
      return (
        <li key={result.key} className="flex items-start gap-2.5 py-2.5 border-b border-border last:border-b-0">
          <status.Icon size={16} className={`mt-[3px] shrink-0 ${status.tone}`} aria-hidden />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[13.5px] font-medium text-text-heading">{result.title}</span>
              <span className={`gt-pill gt-pill-sm ${status.pill}`}>{status.label}</span>
            </div>
            <p className="text-[13px] leading-relaxed text-text-body m-0 mt-0.5">{result.message}</p>
            <p className="text-[12px] text-text-muted m-0 mt-0.5">根拠: {result.basis}</p>
          </div>
        </li>
      );
    })}
  </ul>
);

export const TaxQualifiedPanel = ({
  snapshot,
  planViews,
  establishedOn,
}: {
  snapshot: EquitySnapshot;
  planViews: readonly PlanView[];
  establishedOn: string | null;
}) => {
  // 上場しているかどうかは台帳に持っていないため、非上場会社として判定する
  const context: TaxQualifiedContext = useMemo(() => ({ establishedOn }), [establishedOn]);
  const qualifiedViews = planViews.filter((view) => view.plan.planType === 'tax_qualified');
  const annualRows = useMemo(() => annualExerciseAmounts(snapshot, context), [snapshot, context]);
  const nameById = useMemo(() => new Map(snapshot.stakeholders.map((stakeholder) => [stakeholder.id, stakeholder.name])), [snapshot]);

  const disclaimer = (
    <NoticeList
      items={[
        {
          level: 'warning',
          message:
            'このチェックは、台帳に入力された日付・金額・区分から機械的に確かめられる項目だけを判定したものです。付与契約の文言、株式の保管・管理、特別関係者に当たるかどうか、他社で付与された分との通算などは判定していません。税制適格に当たるかどうかの最終的な判断は、必ず税理士・弁護士に確認してください。',
        },
        ...(establishedOn
          ? []
          : [
              {
                level: 'info' as const,
                message:
                  '会社の設立日が未入力のため、年間の上限と行使期間は原則の区分で判定しています。「組織・メンバー設定」の会社情報に設立日を入力すると、設立からの年数に応じた区分で判定します。',
              },
            ]),
      ]}
    />
  );

  if (qualifiedViews.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {disclaimer}
        <EmptyState
          title="税制適格ストックオプションの回次がありません"
          description="回次の種類を「税制適格ストックオプション」にすると、発行価額・行使期間・行使価額・付与対象者・年間の権利行使価額の上限をここで確認できます。"
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {disclaimer}

      {qualifiedViews.map((view) => {
        const { plan } = view;
        const planResults = checkPlanRequirements(plan, context);
        const limit = annualExerciseLimit(plan, context);
        return (
          <section key={plan.id} className="gt-card" aria-label={`${plan.name}の税制適格チェック`}>
            <div className="gt-card-head">
              <div>
                <h2 className="gt-card-title m-0">{plan.name}</h2>
                <div className="gt-card-sub">
                  発行決議日 {formatDateJa(plan.resolutionDate)}・会社の設立日 {formatDateJa(establishedOn)}・非上場会社として判定
                </div>
              </div>
              <StatusCounts results={planResults} />
            </div>

            <div className="mt-3 rounded-md border border-border bg-bg-subtle px-3 py-2.5 text-[13px] leading-relaxed">
              <span className="text-text-muted">この回次に適用される年間の権利行使価額の上限: </span>
              <strong className="text-text-heading tabular-nums">{formatYenJa(limit.limit)}</strong>
              <span className="text-text-muted">（{limit.reason}。区分は付与決議の日で決まります）</span>
            </div>

            <h3 className="text-[13.5px] font-semibold text-text-heading mt-4 mb-0">回次（発行要項）の要件</h3>
            <RequirementList results={planResults} />

            <h3 className="text-[13.5px] font-semibold text-text-heading mt-4 mb-0">割当先ごとの要件</h3>
            {view.grants.length === 0 ? (
              <p className="text-[13px] text-text-muted mt-2 mb-0">まだ割当がありません。</p>
            ) : (
              <div className="flex flex-col">
                {view.grants.map((grant) => {
                  const checkDate = majorShareholderCheckDate(plan, grant.grant);
                  const ratio = holdingRatioAt(snapshot, grant.grant.stakeholderId, checkDate);
                  const results = checkGrantRequirements({ plan, grant: grant.grant, holdingRatioAtGrant: ratio });
                  return (
                    <div key={grant.grant.id} className="py-3 border-b border-border last:border-b-0">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="text-[13.5px]">
                          <span className="font-semibold text-text-heading">{grant.holderName}</span>
                          <span className="text-text-muted">
                            {' '}
                            {optionLabel(GRANT_ROLES, grant.grant.holderRole)}・{formatUnits(grant.grant.units)}
                          </span>
                        </div>
                        <StatusCounts results={results} />
                      </div>
                      <div className="pl-1">
                        <RequirementList results={results} />
                      </div>
                      <p className="text-[12px] text-text-muted m-0 mt-1">
                        {ratio == null
                          ? '持株比率は、判定の基準日またはその日の発行済株式が台帳から分からないため計算していません。'
                          : `持株比率は ${formatDateJa(checkDate)}（${plan.resolutionDate ? '発行決議日' : '割当日'}）時点の株主名簿から計算しています。`}
                      </p>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        );
      })}

      <section className="gt-card gt-card-table" aria-label="年間の権利行使価額">
        <h2 className="gt-card-title m-0">年間の権利行使価額（割当先 × 暦年）</h2>
        <div className="gt-card-sub">
          税制適格の回次の行使の記録を、割当先ごと・暦年ごとに合計しています。判定には、回次の区分（付与決議の日における設立からの年数）に応じて権利行使価額を割った額を使います。
        </div>
        {annualRows.length === 0 ? (
          <p className="text-[13px] text-text-muted mt-3 mb-3">税制適格の回次の行使はまだ記録されていません。</p>
        ) : (
          <div className="gt-table-scroll mt-2">
            <table className="gt-table">
              <thead>
                <tr>
                  <th>割当先</th>
                  <th>暦年</th>
                  <th className="gt-num">権利行使価額の合計</th>
                  <th className="gt-num">判定に使う額</th>
                  <th className="gt-num">上限</th>
                  <th>判定</th>
                </tr>
              </thead>
              <tbody>
                {annualRows.map((row) => (
                  <tr key={`${row.stakeholderId}:${row.year}`}>
                    <td className="font-medium">{nameById.get(row.stakeholderId) ?? '（不明な権利者）'}</td>
                    <td>{row.year} 年</td>
                    <td className="gt-num">{formatYenJa(row.amount)}</td>
                    <td className="gt-num">{formatYenJa(row.adjustedAmount)}</td>
                    <td className="gt-num">{formatYenJa(row.limit)}</td>
                    <td className="gt-wrap-lg">
                      <span className={`gt-pill gt-pill-sm ${row.exceeded ? 'gt-pill-bad' : 'gt-pill-good'}`}>
                        {row.exceeded ? '上限超過' : '上限内'}
                      </span>
                      <span className={`block text-[12px] leading-relaxed mt-1 ${row.exceeded ? 'text-danger' : 'text-text-muted'}`}>
                        {row.message}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
};
