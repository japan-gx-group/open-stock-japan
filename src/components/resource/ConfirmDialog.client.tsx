'use client';

// 削除など、取り消せない操作の確認ダイアログ。
import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Modal } from '@/components/ui/Modal.client';
import { errorMessage } from '@/lib/resources/client';

export const ConfirmDialog = ({
  isOpen,
  title,
  message,
  confirmLabel = '削除する',
  destructive = true,
  onCancel,
  onConfirm,
}: {
  isOpen: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  destructive?: boolean;
  onCancel: () => void;
  /** 失敗したら例外を投げる（メッセージをダイアログに出す）。成功したら呼び出し側で閉じる */
  onConfirm: () => Promise<void>;
}) => {
  const [isRunning, setIsRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    if (isRunning) return;
    setIsRunning(true);
    setError(null);
    try {
      await onConfirm();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIsRunning(false);
    }
  };

  const close = () => {
    setError(null);
    onCancel();
  };

  return (
    <Modal isOpen={isOpen} onClose={close} title={title} size="md">
      <div className="text-[14px] leading-relaxed text-text-main">{message}</div>
      {error && (
        <p role="alert" className="text-[13px] text-danger mt-3 mb-0">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2 mt-6">
        <Button type="button" variant="outline" onClick={close} disabled={isRunning}>
          キャンセル
        </Button>
        <Button type="button" variant={destructive ? 'destructive' : 'default'} onClick={run} disabled={isRunning}>
          {isRunning && <Loader2 className="animate-spin" />}
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
};
