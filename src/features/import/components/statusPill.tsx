// 読取りの結果の状態の表示。
import type { ExtractionStatus } from '@/lib/import/types';

const LABELS: Record<ExtractionStatus, { label: string; tone: string }> = {
  extracted: { label: '確認待ち', tone: 'gt-pill-warn' },
  applied: { label: '反映済み', tone: 'gt-pill-good' },
  discarded: { label: '破棄', tone: 'gt-pill-neutral' },
};

export const ExtractionStatusPill = ({ status }: { status: ExtractionStatus }) => (
  <span className={`gt-pill ${LABELS[status]?.tone ?? 'gt-pill-neutral'}`}>{LABELS[status]?.label ?? status}</span>
);
