import {
  BookOpen,
  Building2,
  CalendarCheck,
  ExternalLink,
  FileSignature,
  FileText,
  FolderOpen,
  Gavel,
  Landmark,
  LayoutDashboard,
  LineChart,
  Megaphone,
  PieChart,
  ScanText,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { canReadAuditLog, type MemberRole } from '@/types/role';

/**
 * サイドバーのナビゲーション定義。
 * パンくず（AppTopBar）も画面名をこの定義から引くため、
 * 画面を増やすときはここ1か所に足せば両方に反映される。
 */
export type NavItem = {
  path: string;
  label: string;
  icon: LucideIcon;
  /**
   * この項目を出すロールの判定（省略すると社内の全員に出す）。
   * 出し分けだけのためのもので、権限の正しさはサーバ（src/lib/authz.ts）が確かめる。
   */
  visibleTo?: (role: MemberRole | null | undefined) => boolean;
};

export type NavGroup = {
  label: string;
  items: NavItem[];
};

export const NAV_GROUPS: NavGroup[] = [
  {
    label: '概要',
    items: [{ path: '/dashboard', label: 'ダッシュボード', icon: LayoutDashboard }],
  },
  {
    label: '株式・資本政策',
    items: [
      { path: '/cap-table', label: '資本政策表', icon: PieChart },
      { path: '/shareholders', label: '株主名簿', icon: Users },
      { path: '/rounds', label: '資金調達・種類株式', icon: TrendingUp },
      { path: '/convertibles', label: 'J-KISS・転換型', icon: FileSignature },
      { path: '/stock-options', label: 'ストックオプション', icon: Sparkles },
    ],
  },
  {
    label: 'ガバナンス',
    items: [
      { path: '/shareholder-meetings', label: '株主総会', icon: Landmark },
      { path: '/board-meetings', label: '取締役会', icon: Gavel },
      { path: '/compliance', label: '手続きカレンダー', icon: CalendarCheck },
      // 招集通知・議事録・J-KISS の発行に使う書類のひな形（AI で作れる）と、そこからの文書の作成
      { path: '/templates', label: '文書テンプレート', icon: FileText },
    ],
  },
  {
    label: '開示・共有',
    items: [
      { path: '/financials', label: '決算情報', icon: LineChart },
      { path: '/updates', label: '株主へのお知らせ', icon: Megaphone },
      { path: '/library', label: 'ライブラリ', icon: FolderOpen },
      { path: '/import', label: 'AI 取り込み', icon: ScanText },
      // 社外の株主がログインして見る画面（src/app/(external-portal)）。社内の人が開くと、
      // 株主に公開されている内容だけをプレビューできる（社内の画面のレイアウトの外に出る）。
      { path: '/external-portal', label: '株主ポータルを見る', icon: ExternalLink },
    ],
  },
  {
    label: '会社',
    items: [
      { path: '/company', label: '会社情報・役員', icon: Building2 },
      { path: '/legal-guide', label: '法令ガイド', icon: BookOpen },
      // だれが・いつ・何をしたかの記録（管理者と監査人だけ）
      { path: '/audit-log', label: '監査ログ', icon: ShieldCheck, visibleTo: canReadAuditLog },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap(group => group.items);

/** ログイン中の人のロールに出してよい項目だけにしたナビ（項目が無くなったグループは出さない） */
export const navGroupsFor = (role: MemberRole | null | undefined): NavGroup[] =>
  NAV_GROUPS.map(group => ({ ...group, items: group.items.filter(item => !item.visibleTo || item.visibleTo(role)) })).filter(
    group => group.items.length > 0,
  );

/** パンくず末尾に出す画面名。ナビに無いパス（設定など）はここで補う。 */
const EXTRA_PAGE_TITLES: { prefix: string; label: string }[] = [
  { prefix: '/settings/company', label: '組織・メンバー設定' },
  { prefix: '/settings/account', label: 'アカウント設定' },
  { prefix: '/settings', label: '設定' },
  { prefix: '/shareholder-meetings/', label: '株主総会の詳細' },
  { prefix: '/board-meetings/', label: '取締役会の詳細' },
];

export const getPageTitle = (pathname: string): string | null => {
  const navMatch = NAV_ITEMS.find(
    item => pathname === item.path || pathname.startsWith(`${item.path}/`),
  );
  // 詳細画面は一覧と別名にしたいので、より長い前方一致を先に見る。
  const extra = EXTRA_PAGE_TITLES.find(entry => pathname.startsWith(entry.prefix));
  if (extra) return extra.label;
  return navMatch?.label ?? null;
};
