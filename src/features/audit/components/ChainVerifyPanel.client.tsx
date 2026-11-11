'use client';

// 改ざんの検査: 監査ログの連鎖（連番とハッシュ）を先頭から計算し直して、書き換え・抜き取りが無いかを確かめる。
// 検査は API（POST /api/audit/verify）が DB の関数で行い、検査したことと結果も監査ログに残る。

import React, { useState } from 'react';
import { Check, Copy, Loader2, ShieldAlert, ShieldCheck } from 'lucide-react';
import { errorMessage } from '@/lib/resources/client';
import { requestChainVerify } from '../services/client';
import { formatJstDateTime } from '../services/format';
import { verifyReasonLabel } from '../services/labels';
import type { VerifyResponse } from '../types';

const formatCount = (value: number): string => value.toLocaleString('ja-JP');

const CopyButton = ({ text, label }: { text: string; label: string }) => {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setState('copied');
    } catch {
      // クリップボードが使えない環境（権限なし・http など）。値は画面に出ているので、手で写してもらう
      setState('failed');
    }
  };
  return (
    <span className="inline-flex items-center gap-2">
      <button type="button" className="gt-btn h-8 px-2 text-[12px]" onClick={() => void copy()}>
        {state === 'copied' ? <Check size={14} /> : <Copy size={14} />}
        {label}
      </button>
      <span role="status" aria-live="polite" className="text-[12px] text-text-muted">
        {state === 'copied' ? 'コピーしました' : state === 'failed' ? 'コピーできませんでした。選択して写してください' : ''}
      </span>
    </span>
  );
};

const ResultField = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div className="grid grid-cols-[120px_minmax(0,1fr)] gap-3 py-2 border-b border-border last:border-b-0">
    <dt className="text-[12.5px] text-text-muted">{label}</dt>
    <dd className="m-0 text-[13.5px] text-text-heading min-w-0">{children}</dd>
  </div>
);

const VerifyResultView = ({ response }: { response: VerifyResponse }) => {
  const { result, anchor } = response;

  if (!result.ok) {
    return (
      <section className="gt-card border-danger/40" role="alert" aria-label="検査の結果">
        <div className="flex items-center gap-2 text-danger">
          <ShieldAlert size={18} />
          <h3 className="text-[15px] font-semibold m-0">記録に問題が見つかりました</h3>
        </div>
        <dl className="m-0 mt-3">
          <ResultField label="問題のある連番">
            <span className="tabular-nums font-semibold">{formatCount(result.seq)}</span>
          </ResultField>
          <ResultField label="理由">{verifyReasonLabel(result.reason)}</ResultField>
          {result.expectedSeq != null && (
            <ResultField label="本来の連番">
              <span className="tabular-nums">{formatCount(result.expectedSeq)}</span>
            </ResultField>
          )}
          <ResultField label="確かめた件数">
            <span className="tabular-nums">{formatCount(result.count)} 件目で止まりました</span>
          </ResultField>
        </dl>
        <p className="text-[13px] leading-relaxed text-text-body m-0 mt-3">
          この連番より前の記録は連鎖がつながっています。データベースを直接操作できる人の作業の記録（データベースのログ・バックアップ）と照らして、原因を調べてください。
          検査で問題が見つかったことも、監査ログに「失敗」として残しました。
        </p>
      </section>
    );
  }

  // 連鎖の計算は合っていても、控えと合わなければ「問題なし」とは言えない（末尾を消して作り直した場合など）
  const anchorFailed = anchor != null && !anchor.matches;

  return (
    <section className={`gt-card ${anchorFailed ? 'border-danger/40' : ''}`} role={anchorFailed ? 'alert' : 'status'} aria-label="検査の結果">
      {anchorFailed ? (
        <div className="flex items-center gap-2 text-danger">
          <ShieldAlert size={18} />
          <h3 className="text-[15px] font-semibold m-0">いまの記録は、控えと合いません</h3>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-success">
          <ShieldCheck size={18} />
          <h3 className="text-[15px] font-semibold m-0">書き換え・抜き取りは見つかりませんでした</h3>
        </div>
      )}
      <dl className="m-0 mt-3">
        <ResultField label="確かめた件数">
          <span className="tabular-nums">{formatCount(result.count)} 件</span>
          {result.legacyCount > 0 && (
            <div className="text-[12px] text-text-muted">
              このほかに、この仕組みを入れる前の記録が {formatCount(result.legacyCount)} 件あります（連番とハッシュが無く、検査の対象外です）。
            </div>
          )}
        </ResultField>
        <ResultField label="最新の連番">
          <span className="tabular-nums font-semibold">{formatCount(result.lastSeq)}</span>
          <div className="text-[12px] text-text-muted">検査した時点の値です（この検査をしたことの記録は、次の連番で残ります）。</div>
        </ResultField>
        <ResultField label="最新のハッシュ">
          {result.lastHash ? (
            <>
              <code className="block font-mono text-[12.5px] break-all text-text-body">{result.lastHash}</code>
              <div className="mt-2">
                <CopyButton text={`連番 ${result.lastSeq} / ハッシュ ${result.lastHash}`} label="連番とハッシュをコピー" />
              </div>
            </>
          ) : (
            <span className="text-text-muted">記録がまだありません</span>
          )}
        </ResultField>
        <ResultField label="検査した日時">
          <span className="tabular-nums">{formatJstDateTime(result.checkedAt)}</span>
          <span className="text-text-muted">（日本時間）</span>
        </ResultField>
        {anchor && (
          <ResultField label="控えとの照合">
            {anchor.matches ? (
              <span className="text-success font-medium">連番 {formatCount(anchor.seq)} の記録は、控えたハッシュと同じです（そこまでの記録は変わっていません）。</span>
            ) : anchor.found ? (
              <span className="text-danger font-medium">
                連番 {formatCount(anchor.seq)} の記録のハッシュが、控えと違います。控えを取ったあとに、記録が作り直された可能性があります（控えの写し間違いでないかも確かめてください）。
              </span>
            ) : (
              <span className="text-danger font-medium">
                連番 {formatCount(anchor.seq)} の記録がありません。控えを取ったあとに、末尾の記録が消された可能性があります（控えの写し間違いでないかも確かめてください）。
              </span>
            )}
          </ResultField>
        )}
      </dl>
      <p className="text-[13px] leading-relaxed text-text-body m-0 mt-3">
        {anchorFailed && '残っている記録どうしの計算（連番とハッシュのつながり）は合っています。控えと合わなかったことは、監査ログに「失敗」として残しました。 '}
        この「最新の連番」と「最新のハッシュ」を、月次の記録など、このシステムの外に控えておいてください。次に検査するとき、上の「控えと照合する」に入れると、
        控えた時点までの記録が消されたり作り直されたりしていないことを確かめられます。
      </p>
    </section>
  );
};

export const ChainVerifyPanel = () => {
  const [response, setResponse] = useState<VerifyResponse | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [anchorSeq, setAnchorSeq] = useState('');
  const [anchorHash, setAnchorHash] = useState('');

  const run = async (event: React.FormEvent) => {
    event.preventDefault();
    if (isRunning) return;
    setIsRunning(true);
    setError(null);
    try {
      setResponse(await requestChainVerify({ anchorSeq: anchorSeq.trim(), anchorHash: anchorHash.trim() }));
    } catch (caught) {
      setResponse(null);
      setError(errorMessage(caught, '検査に失敗しました'));
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="flex flex-col gap-4 max-w-[920px]">
      <section className="gt-card" aria-label="改ざんの検査について">
        <div className="gt-card-title">この検査で分かること</div>
        <ul className="m-0 mt-2 pl-5 list-disc text-[13px] leading-relaxed text-text-body flex flex-col gap-1">
          <li>
            監査ログは追記専用です。記録には 1 件ごとに連番を振り、「直前の記録のハッシュ」を含めてハッシュ（内容から計算する指紋）を取っています。
            途中の 1 件を書き換えたり抜き取ったりすると、そこから先の計算が合わなくなります。
          </li>
          <li>検査では、最初の記録から順に計算し直して、連番の飛び・ハッシュの食い違いが無いかを確かめます。</li>
        </ul>
        <div className="gt-card-title mt-4">この検査だけでは分からないこと</div>
        <ul className="m-0 mt-2 pl-5 list-disc text-[13px] leading-relaxed text-text-body flex flex-col gap-1">
          <li>
            <strong>末尾の記録をまとめて消された場合</strong>は、残った記録どうしの計算は合うので、この検査だけでは見つけられません。
            検査のあとに表示する「最新の連番」と「最新のハッシュ」を、月次の記録など別の場所に控えておき、次の検査で照合してください。
          </li>
          <li>
            データベースの管理者が、仕組みそのものを止めてすべてを作り直した場合も、控えが無ければ見つけられません。データベースに入れる人の管理と、控えの保管で補います。
          </li>
        </ul>
      </section>

      <form className="gt-card" onSubmit={run} aria-label="検査の実行">
        <div className="gt-card-title">検査する</div>
        <div className="gt-card-sub">記録が多いと時間がかかることがあります。検査したことと結果は、監査ログに残ります。</div>
        <fieldset className="border-none p-0 m-0 mt-4">
          <legend className="gt-field-label p-0">控えと照合する（任意）</legend>
          <div className="flex flex-wrap gap-3">
            <div className="flex flex-col" style={{ flex: '0 0 140px' }}>
              <label htmlFor="audit-anchor-seq" className="text-[12px] text-text-muted mb-1">
                控えた連番
              </label>
              <input
                id="audit-anchor-seq"
                className="gt-field"
                inputMode="numeric"
                placeholder="例: 1200"
                maxLength={20}
                value={anchorSeq}
                onChange={(event) => setAnchorSeq(event.target.value)}
              />
            </div>
            <div className="flex flex-col" style={{ flex: '1 1 320px', minWidth: 0 }}>
              <label htmlFor="audit-anchor-hash" className="text-[12px] text-text-muted mb-1">
                控えたハッシュ（64 文字）
              </label>
              <input
                id="audit-anchor-hash"
                className="gt-field font-mono"
                placeholder="前回の検査で控えたハッシュ"
                maxLength={80}
                spellCheck={false}
                autoComplete="off"
                value={anchorHash}
                onChange={(event) => setAnchorHash(event.target.value)}
              />
            </div>
          </div>
        </fieldset>
        <div className="mt-4 flex items-center gap-3 flex-wrap">
          <button type="submit" className="gt-btn-primary" disabled={isRunning}>
            {isRunning ? <Loader2 size={15} className="animate-spin" /> : <ShieldCheck size={15} />}
            検査する
          </button>
          {isRunning && (
            <span role="status" className="text-[12.5px] text-text-muted">
              検査しています…
            </span>
          )}
        </div>
        {error && (
          <p role="alert" className="text-[13px] text-danger m-0 mt-3">
            {error}
          </p>
        )}
      </form>

      {response && <VerifyResultView response={response} />}
    </div>
  );
};
