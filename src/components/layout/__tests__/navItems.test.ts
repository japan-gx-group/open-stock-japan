import { describe, expect, it } from 'vitest';
import { getPageTitle, navGroupsFor, NAV_ITEMS } from '../navItems';

// サイドバーの項目の出し分け。権限の正しさはサーバが確かめるので、ここでは「見せる・見せない」だけを確かめる。

const pathsFor = (role: Parameters<typeof navGroupsFor>[0]) => navGroupsFor(role).flatMap((group) => group.items.map((item) => item.path));

describe('navGroupsFor', () => {
  it('監査ログは、管理者と監査人にだけ出す', () => {
    expect(pathsFor('admin')).toContain('/audit-log');
    expect(pathsFor('auditor')).toContain('/audit-log');
    expect(pathsFor('logger')).not.toContain('/audit-log');
    expect(pathsFor('viewer')).not.toContain('/audit-log');
    expect(pathsFor(null)).not.toContain('/audit-log');
  });

  it('それ以外の項目は、ロールにかかわらず同じ', () => {
    const withoutAudit = NAV_ITEMS.map((item) => item.path).filter((path) => path !== '/audit-log');
    expect(pathsFor('viewer')).toEqual(withoutAudit);
    expect(pathsFor('logger')).toEqual(withoutAudit);
  });
});

describe('getPageTitle', () => {
  it('監査ログの画面名を返す', () => {
    expect(getPageTitle('/audit-log')).toBe('監査ログ');
  });
});
