// ヘルスチェックエンドポイント。ホスト側の死活監視やデプロイの readiness probe に使う。
// Supabase への接続を検証し、アプリケーションの正常性を返す。
//
// 未認証で叩かれる前提のエンドポイント（proxy.ts の matcher で除外済み）。
//
// service_role クライアントを使う理由: RLS ポリシーはすべて `to authenticated` で、
// anon ロールにはどのテーブルにも読み取り権が無い。anon で叩くと DB が正常でも
// 「permission denied」が返り、疎通の可否を判定できないため。
// 公開経路だが、レスポンスに載せるのは ok / error の2値だけで、DB のエラーメッセージや
// 行データは一切返さない（詳細はサーバーログにのみ残す）。キーもサーバ内に閉じている。
import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { logger } from '@/lib/logging/logger';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// 確認の結果を数秒だけ使い回す。この API はログインなしで呼べるので、呼ばれるたびに DB へ問い合わせると、
// 外から叩くだけで DB に負荷をかけられる。監視の間隔（ふつう 10 秒以上）なら、毎回あたらしい結果になる。
const CACHE_MS = 5_000;
let cached: { at: number; healthy: boolean; body: { status: string; timestamp: string; checks: Record<string, 'ok' | 'error'> } } | null = null;

const respond = (entry: NonNullable<typeof cached>) =>
  NextResponse.json(entry.body, { status: entry.healthy ? 200 : 503, headers: { 'Cache-Control': 'no-store' } });

export const GET = async () => {
  if (cached && Date.now() - cached.at < CACHE_MS) {
    return respond(cached);
  }

  const checks: Record<string, 'ok' | 'error'> = {};
  let healthy = true;

  try {
    const supabase = createAdminClient();
    const { error } = await supabase.from('organizations').select('id').limit(1);
    checks.database = error ? 'error' : 'ok';
    if (error) {
      healthy = false;
      logger.error({ error }, 'ヘルスチェック: データベース接続エラー');
    }
  } catch (error) {
    checks.database = 'error';
    healthy = false;
    logger.error({ error }, 'ヘルスチェック: データベース接続エラー');
  }

  cached = { at: Date.now(), healthy, body: { status: healthy ? 'healthy' : 'unhealthy', timestamp: new Date().toISOString(), checks } };
  return respond(cached);
};
