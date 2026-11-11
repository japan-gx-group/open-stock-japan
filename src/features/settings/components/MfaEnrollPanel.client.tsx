'use client';

// 二要素認証（認証アプリ）の登録の手順。アカウント設定のダイアログと、/mfa/setup（必須のときの登録）で使う。
//   1. 機器の名前を決めて始める → 2. QR コード（または秘密の値）を認証アプリに登録 → 3. 6 桁のコードを確認
// 登録・確認はサーバ（src/features/settings/services/mfa.ts）で行う。秘密の値は、この画面にだけ出す
// （閉じると二度と表示できない。登録をやり直すと、新しい値になる）。

import React, { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { cancelMfaEnrollment, confirmMfaEnrollment, startMfaEnrollment } from '@/features/settings/services/mfa';
import type { MfaEnrollment } from '@/features/settings/services/mfaTypes';

// 秘密の値を、手で入力しやすいように 4 文字ずつに区切る
const groupSecret = (secret: string): string => secret.replace(/(.{4})/g, '$1 ').trim();

export const MfaEnrollPanel = ({
  defaultName,
  onCompleted,
  onCancel,
}: {
  /** 機器の名前の初期値（例: 認証アプリ / 予備の機器） */
  defaultName: string;
  /** 登録が完了したとき */
  onCompleted: () => void;
  /** やめるとき（指定しなければ「やめる」ボタンを出さない） */
  onCancel?: () => void;
}) => {
  const [name, setName] = useState(defaultName);
  const [enrollment, setEnrollment] = useState<MfaEnrollment | null>(null);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [isStarting, setIsStarting] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const codeInputRef = useRef<HTMLInputElement>(null);
  // 途中で画面を離れたら、確認前の登録を消す（残っていても無効だが、次の登録の邪魔になる）
  const pendingFactorIdRef = useRef<string | null>(null);

  useEffect(
    () => () => {
      const factorId = pendingFactorIdRef.current;
      if (factorId) void cancelMfaEnrollment({ factorId }).catch(() => undefined);
    },
    [],
  );

  const handleStart = async () => {
    if (isStarting) return;
    setIsStarting(true);
    setError('');
    try {
      const result = await startMfaEnrollment({ name });
      if (!result.ok) {
        setError(result.error);
        return;
      }
      pendingFactorIdRef.current = result.data.factorId;
      setEnrollment(result.data);
      setTimeout(() => codeInputRef.current?.focus(), 0);
    } catch {
      setError('通信に失敗しました。時間をおいて再度お試しください。');
    } finally {
      setIsStarting(false);
    }
  };

  const handleConfirm = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!enrollment || isConfirming) return;
    setIsConfirming(true);
    setError('');
    try {
      const result = await confirmMfaEnrollment({ factorId: enrollment.factorId, code });
      if (!result.ok) {
        setError(result.error);
        setCode('');
        codeInputRef.current?.focus();
        return;
      }
      pendingFactorIdRef.current = null;
      onCompleted();
    } catch {
      setError('通信に失敗しました。時間をおいて再度お試しください。');
    } finally {
      setIsConfirming(false);
    }
  };

  const handleCancel = () => {
    const factorId = pendingFactorIdRef.current;
    pendingFactorIdRef.current = null;
    if (factorId) void cancelMfaEnrollment({ factorId }).catch(() => undefined);
    onCancel?.();
  };

  if (!enrollment) {
    return (
      <div className="flex flex-col gap-4">
        <ol className="list-decimal pl-5 text-sm leading-relaxed text-text-main">
          <li>スマートフォンに認証アプリ（Google Authenticator、Microsoft Authenticator、1Password など）を用意します。</li>
          <li>次の画面の QR コードを認証アプリで読み取ります。</li>
          <li>認証アプリに表示された6桁のコードを入力すると、登録が完了します。</li>
        </ol>
        <div className="flex flex-col gap-1">
          <label htmlFor="mfa-factor-name" className="text-xs font-bold text-text-muted">
            機器の名前（あとで見分けるため）
          </label>
          <input
            id="mfa-factor-name"
            className="gt-field"
            value={name}
            maxLength={40}
            onChange={(event) => setName(event.target.value)}
            placeholder="例: 仕事用のスマートフォン"
          />
        </div>
        {error && (
          <p className="text-sm text-danger" role="alert">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-3">
          {onCancel && (
            <button type="button" className="gt-btn text-sm" onClick={handleCancel} disabled={isStarting}>
              やめる
            </button>
          )}
          <button type="button" className="gt-btn-primary text-sm flex items-center gap-2" onClick={handleStart} disabled={isStarting}>
            {isStarting && <Loader2 size={16} className="animate-spin" />}
            QR コードを表示する
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={handleConfirm} className="flex flex-col gap-4">
      <p className="text-sm leading-relaxed text-text-main">
        認証アプリで下の QR コードを読み取り、表示された6桁のコードを入力してください。
      </p>
      <div className="flex flex-col items-center gap-3 rounded-md border border-border bg-white p-4">
        {/* 認証サービスが返す SVG の data URL。next/image は data URL の最適化をしないので、素の img を使う */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={enrollment.qrCode} alt="認証アプリで読み取る QR コード" width={184} height={184} />
      </div>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-bold text-text-muted">QR コードを読み取れないときは、この値を認証アプリに入力します</span>
        <code
          data-testid="mfa-secret"
          className="select-all break-all rounded-md border border-border bg-bg-subtle px-3 py-2 font-mono text-[13px] tracking-wider text-text-main"
        >
          {groupSecret(enrollment.secret)}
        </code>
        <span className="text-xs text-text-muted">
          この値は、この画面を閉じると二度と表示できません。第三者に見せないでください。
        </span>
      </div>
      <div className="flex flex-col gap-1">
        <label htmlFor="mfa-enroll-code" className="text-xs font-bold text-text-muted">
          認証アプリに表示された6桁のコード
        </label>
        <input
          id="mfa-enroll-code"
          ref={codeInputRef}
          className="gt-field max-w-[200px] font-mono tracking-[0.3em]"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={12}
          placeholder="000000"
          required
        />
      </div>
      {error && (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-3">
        {onCancel && (
          <button type="button" className="gt-btn text-sm" onClick={handleCancel} disabled={isConfirming}>
            やめる
          </button>
        )}
        <button type="submit" className="gt-btn-primary text-sm flex items-center gap-2" disabled={isConfirming || !code.trim()}>
          {isConfirming && <Loader2 size={16} className="animate-spin" />}
          登録を完了する
        </button>
      </div>
    </form>
  );
};
