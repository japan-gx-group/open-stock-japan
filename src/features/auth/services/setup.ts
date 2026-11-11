'use server';

// 初回登録（初期セットアップ）用の Server Action。
//
// なぜ service_role（admin client）を使うか:
//   RLS 上、authenticated ロールには organizations / profiles への INSERT 権限が無い
//   （新規組織作成には「adminでないと作れないが、profileが無いとadminになれない」鶏卵問題がある）。
//   そのため初回のプロビジョニングだけは RLS をバイパスできる service_role で行う。
//   このファイルは 'use server' なのでコードは常にサーバ上でのみ実行される（docs/architecture.md）。
//
// 運用前提（自社ホスト・単一テナント）:
//   1デプロイ＝1社。初回登録は「その環境の一度きりの初期セットアップ」であり、
//   組織が既に存在する場合は実行しない（誰でも新組織を作れる公開サインアップにはしない）。

import { createHash, timingSafeEqual } from 'node:crypto';
import { createAdminClient } from '@/lib/supabase/admin';
import { recordAuditEvent } from '@/lib/audit/events';
import { logger } from '@/lib/logging/logger';
import { isValidEmail } from '@/lib/email';
import { toPasswordSaveErrorMessage, validateNewPassword } from '@/lib/security/passwordPolicy';
import {
  DEFAULT_FISCAL_YEAR_START_MONTH,
  deriveFiscalYearPeriod,
  getFiscalYearStartYearForDate,
} from '@/lib/fiscal-year/fiscalYearPeriod';
import { SETUP_TOKEN_MISSING_MESSAGE, type ActionResult, type SetupState, type SetupTokenStatus, type SignupInput } from '../types';

// 開発時だけ「セットアップ済みガード」を外すエスケープハッチ。
//
// なぜ必要か:
//   ローカルはデモシード（supabase/seeds/demo/demo.sql）でデモ組織が投入されるため、上の
//   運用前提のままだと /signup は一度も開けない（常に /login へリダイレクトされる）。
//   初期セットアップ画面の開発・確認ができないので、シードを消さずに何度でも試せる逃げ道を用意する。
//   有効時は既存組織を残したまま「新しい組織＋その管理者アカウント」が追加で作られる。
//
// ⚠️ セキュリティ上の前提:
//   本番ビルド（NODE_ENV === 'production'）では .env に何を書いても必ず無効になる。
//   env の設定ミスだけで「誰でも新組織を作れる公開サインアップ」に化けないよう、
//   フラグと NODE_ENV の二重条件にしている。この条件は緩めないこと。
const isSetupGuardBypassed = (): boolean =>
  process.env.NODE_ENV !== 'production' &&
  process.env.ALLOW_SETUP_WHEN_COMPLETED === 'true';

// 初期セットアップを実行してよいか（＝組織が1件でも存在するか）を判定する。
// /signup ページのガードと、setupOrganization 実行前の二重チェックで使う。
// 開発用バイパスが有効なときは、実際の組織数によらず常に 'pending' を返す。
//
// 判定できなかった場合は 'unknown' を返し、'completed' とは区別する。どちらも
// 「初期セットアップを実行させない」点は同じだが、'unknown' は環境側の異常であり、
// 「セットアップ済みです」と案内してしまうと新規環境の構築時に原因へ辿り着けない。
// 呼び出し側はログとエラーメッセージで原因を出すこと（詳細は types.ts の SetupState）。
export const getSetupState = async (): Promise<SetupState> => {
  // 両方のガードをまとめて素通りさせたいので、DB を引く前にここで返す。
  if (isSetupGuardBypassed()) {
    return 'pending';
  }

  try {
    // createAdminClient() は NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY が
    // 未設定だと throw する。try の中に入れて 'unknown' に倒さないと /signup が 500 になり、
    // ウィザードの Server Action も reject してボタンが固まる。
    const admin = createAdminClient();
    const { count, error } = await admin
      .from('organizations')
      .select('id', { count: 'exact', head: true });

    if (error) {
      logger.error({ error }, '初期セットアップ状態の判定に失敗しました');
      return 'unknown';
    }
    return (count ?? 0) > 0 ? 'completed' : 'pending';
  } catch (error) {
    logger.error({ error }, '初期セットアップ状態の判定に失敗しました');
    return 'unknown';
  }
};

// 初回の登録に、セットアップ用の合言葉（環境変数 SETUP_TOKEN）が要るか。
//
// /signup は「組織がまだ 1 つも無いとき」に、だれでも開ける。インターネットに公開してから最初の登録までのあいだに
// 別の人が先に登録すると、その人が管理者になる。SETUP_TOKEN を設定しておくと、その値を知っている人だけが登録できる。
// 16 文字より短い値は、設定の誤りとして扱い、登録させない（短い合言葉で守ったつもりにさせない）。
const MIN_SETUP_TOKEN_LENGTH = 16;

const configuredSetupToken = (): string | null => {
  const token = process.env.SETUP_TOKEN?.trim();
  return token ? token : null;
};

/**
 * 初回の登録に、合言葉がどう関わるか。
 *   not_required … 合言葉なしで登録できる（開発中の環境で、SETUP_TOKEN を設定していないとき）
 *   required     … 合言葉の入力が要る
 *   missing      … 登録できない。本番（NODE_ENV=production）なのに SETUP_TOKEN が無い、または短すぎる
 *
 * 本番では必ず合言葉を求める。設定を忘れたまま公開しても、最初に来た人が管理者になることが無いようにする。
 */
export const getSetupTokenStatus = async (): Promise<SetupTokenStatus> => {
  const token = configuredSetupToken();
  if (token !== null) {
    return token.length >= MIN_SETUP_TOKEN_LENGTH ? 'required' : 'missing';
  }
  return process.env.NODE_ENV === 'production' ? 'missing' : 'not_required';
};

// 長さの違いからも中身を推測させないよう、ハッシュどうしを、時間の差が出ない比べ方で比べる
const tokenMatches = (given: string, expected: string): boolean => {
  const digest = (value: string) => createHash('sha256').update(value, 'utf8').digest();
  return timingSafeEqual(digest(given), digest(expected));
};

export const setupOrganization = async (
  input: SignupInput,
): Promise<ActionResult<{ email: string }>> => {
  const tokenStatus = await getSetupTokenStatus();
  if (tokenStatus === 'missing') {
    logger.error('初回の登録を受け付けません。環境変数 SETUP_TOKEN（16 文字以上）を設定してください');
    return { ok: false, error: SETUP_TOKEN_MISSING_MESSAGE };
  }
  if (tokenStatus === 'required' && !tokenMatches(String(input.setupToken ?? '').trim(), configuredSetupToken() ?? '')) {
    return { ok: false, error: 'セットアップ用の合言葉が正しくありません' };
  }

  // 画面側でも検証するが、Server Action は直接呼べる前提でサーバ側でも最低限検証する。
  const email = input.email.trim().toLowerCase();
  const fullName = input.fullName.trim();
  const organizationName = input.organizationName.trim();

  if (!fullName || !email || !input.password) {
    return { ok: false, error: '氏名・メールアドレス・パスワードは必須です' };
  }
  if (!isValidEmail(email)) {
    return { ok: false, error: 'メールアドレスの形式が正しくありません' };
  }
  // パスワードの決まり（src/lib/security/passwordPolicy.ts）
  const passwordError = validateNewPassword(input.password);
  if (passwordError) {
    return { ok: false, error: passwordError };
  }
  if (!organizationName) {
    return { ok: false, error: '企業名は必須です' };
  }

  const admin = createAdminClient();

  // ガード: 既に組織があれば初期セットアップは実行しない。
  // 注（既知の残余リスク）: このチェックと下の INSERT の間はアトミックでないため、
  // 2人がほぼ同時にセットアップを完了すると両方通過し、組織が2つ作られ得る（TOCTOU）。
  // 主トリガである二重クリックは画面側の submittingRef ガードで塞いでいる。
  // 起こるのは「新規環境の初回1回だけ・別々の人がミリ秒差で送信」という極めて稀な状況で、
  // 単一テナント運用では実質発生しないため、ここでは DB 制約による厳密防止までは行わない
  // （厳密に塞ぐには organizations を1行に限る制約が要るが、将来のマルチテナント化と両立しない）。
  const setupState = await getSetupState();
  if (setupState === 'completed') {
    return {
      ok: false,
      error: 'この環境は既にセットアップ済みです。ログインしてご利用ください',
    };
  }
  // 判定不能。原因（接続設定の誤りなど）はサーバログに出ているので、そこへ誘導する。
  if (setupState === 'unknown') {
    return {
      ok: false,
      error:
        'セットアップ状態を確認できませんでした。Supabase への接続設定（URL・SUPABASE_SERVICE_ROLE_KEY）とサーバのログを確認してください',
    };
  }

  // 1) 認証ユーザー作成。メール確認済みで作り、登録直後にそのままログインできるようにする。
  const { data: created, error: createError } = await admin.auth.admin.createUser({
    email,
    password: input.password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (createError || !created.user) {
    // 認証サービスが弱いパスワードとして拒否した場合（422）は、決まりの文言を返す。
    if (createError?.code === 'weak_password') {
      return { ok: false, error: toPasswordSaveErrorMessage(createError, 'ユーザーの作成に失敗しました') };
    }
    // 422 = 既存メール等でユーザーを作れないケース。
    if (createError?.status === 422) {
      return { ok: false, error: 'このメールアドレスは既に登録されています' };
    }
    return { ok: false, error: 'ユーザーの作成に失敗しました' };
  }
  const userId = created.user.id;

  // 途中で失敗したら作成済みユーザーを消し、中途半端な状態を残さない（掃除はベストエフォート）。
  const deleteUserQuiet = async () => {
    try {
      await admin.auth.admin.deleteUser(userId);
    } catch {
      // 掃除失敗は致命的ではないので握りつぶす
    }
  };

  // 2) 組織作成。会社の詳しい情報（機関設計・資本金など）は、セットアップ後に会社情報の画面で入力する。
  const { data: org, error: orgError } = await admin
    .from('organizations')
    .insert({ name: organizationName })
    .select('id')
    .single();
  if (orgError || !org) {
    await deleteUserQuiet();
    return { ok: false, error: '企業情報の作成に失敗しました' };
  }
  const organizationId = org.id as string;

  // 組織を消せば配下の profiles / fiscal_years / share_classes は cascade で消える。最後にユーザーを消す。
  const cleanupAll = async () => {
    try {
      await admin.from('organizations').delete().eq('id', organizationId);
    } catch {
      // 掃除失敗は握りつぶす
    }
    await deleteUserQuiet();
  };

  // 3) プロフィール作成。初回登録者（組織を作った人）は管理者（role = 'admin'）にする。
  const { error: profileError } = await admin.from('profiles').insert({
    id: userId,
    organizationId,
    email,
    fullName,
    role: 'admin',
  });
  if (profileError) {
    await cleanupAll();
    return { ok: false, error: 'プロフィールの作成に失敗しました' };
  }

  // 4) 最初の事業年度（今日が属する年度）の登録。
  //    事業年度が1件も無いと決算情報や定時株主総会を年度に紐づけられないため、
  //    セットアップ直後から使える状態にしておく。
  //    後から企業設定で期首月を変えた場合も、この年度行はそのまま残る（設定画面の年度追加と同じ扱い）。
  //
  //    期首月: 上の organizations insert では fiscalYearStartMonth を入れていない（null）ため、
  //    設定画面が null を4月に正規化するのと同じ既定値で年度を切る。セットアップ画面で
  //    期首月を選べるようにする際は、organizations insert に入れる値とこの変数を必ず揃えること
  //    （ずれると企業設定の表示と最初の事業年度の期間が食い違う）。
  const fiscalYearStartMonth = DEFAULT_FISCAL_YEAR_START_MONTH;
  const { label, startDate, endDate } = deriveFiscalYearPeriod(
    getFiscalYearStartYearForDate(new Date(), fiscalYearStartMonth),
    fiscalYearStartMonth,
  );
  const { error: fiscalYearError } = await admin.from('fiscal_years').insert({
    organizationId,
    label,
    startDate,
    endDate,
  });
  if (fiscalYearError) {
    await cleanupAll();
    return { ok: false, error: '事業年度の作成に失敗しました' };
  }

  // 5) 既定の株式の種類（普通株式）。株式の種類が1件も無いと株式の異動を記録できないため、
  //    セットアップ直後から株主名簿を使える状態にしておく。
  const { error: shareClassError } = await admin.from('share_classes').insert({
    organizationId,
    name: '普通株式',
    kind: 'common',
  });
  if (shareClassError) {
    await cleanupAll();
    return { ok: false, error: '株式の種類の作成に失敗しました' };
  }
  // 組織と最初の管理者ができたことを残す（ここから先の操作は、すべて監査ログに連番つきで残る）
  await recordAuditEvent(
    { organizationId, userId },
    { action: 'organization.setup', entityName: 'organizations', entityId: organizationId, detail: { name: organizationName, email } },
    admin,
  );

  return { ok: true, data: { email } };
};
