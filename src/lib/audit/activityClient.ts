// Excel への出力・印刷を、行う前にサーバへ伝えて監査ログに残す（ブラウザ用）。
import { apiFetch } from '@/lib/resources/client';
import type { ActivityDetail, ActivityKind } from './activity';

/**
 * 出力・印刷の前に呼ぶ。記録できなかったときは例外を投げるので、呼び出し側は出力をやめる
 * （記録の無い持ち出しを作らないため）。例外の message は、そのまま画面に出せる文。
 */
export const recordActivity = async (kind: ActivityKind, detail: ActivityDetail = {}): Promise<void> => {
  try {
    await apiFetch('/api/activity', { method: 'POST', body: JSON.stringify({ kind, detail }) });
  } catch {
    throw new Error('出力の記録を残せなかったため、中止しました。時間をおいてもう一度お試しください');
  }
};
