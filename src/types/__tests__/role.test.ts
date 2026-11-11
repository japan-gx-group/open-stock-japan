import { describe, expect, it } from 'vitest';
import {
  canEdit,
  isAdmin,
  isAssignableMemberRole,
  isInternal,
  isMemberRole,
  isShareholder,
  memberRoleLabel,
} from '../role';

describe('isAdmin', () => {
  it('admin だけを管理者とみなす', () => {
    expect(isAdmin('admin')).toBe(true);
    expect(isAdmin('logger')).toBe(false);
    expect(isAdmin('viewer')).toBe(false);
    expect(isAdmin('shareholder')).toBe(false);
  });

  it('ロールが取れていないときは管理者ではない', () => {
    expect(isAdmin(null)).toBe(false);
    expect(isAdmin(undefined)).toBe(false);
  });
});

describe('isInternal / canEdit / isShareholder', () => {
  it('社内は admin・logger・viewer。株主は社内ではない', () => {
    expect((['admin', 'logger', 'viewer', 'shareholder'] as const).map(isInternal)).toEqual([
      true,
      true,
      true,
      false,
    ]);
  });

  it('編集できるのは admin と logger だけ', () => {
    expect((['admin', 'logger', 'viewer', 'shareholder'] as const).map(canEdit)).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it('shareholder だけを株主とみなす', () => {
    expect((['admin', 'logger', 'viewer', 'shareholder'] as const).map(isShareholder)).toEqual([
      false,
      false,
      false,
      true,
    ]);
  });

  it('ロールが取れていないときはどれも false', () => {
    for (const role of [null, undefined]) {
      expect(isInternal(role)).toBe(false);
      expect(canEdit(role)).toBe(false);
      expect(isShareholder(role)).toBe(false);
    }
  });
});

describe('memberRoleLabel', () => {
  it('ロールごとの表示名', () => {
    expect(memberRoleLabel('admin')).toBe('管理者');
    expect(memberRoleLabel('logger')).toBe('メンバー');
    expect(memberRoleLabel('viewer')).toBe('閲覧のみ');
    expect(memberRoleLabel('shareholder')).toBe('株主');
  });
});

describe('isMemberRole / isAssignableMemberRole', () => {
  it('DB に入りうる値は 5 つ、メンバー管理で書ける値は社内の 4 つ（株主は書けない）', () => {
    const values = ['admin', 'logger', 'viewer', 'auditor', 'shareholder', 'member'];
    expect(values.map(isMemberRole)).toEqual([true, true, true, true, true, false]);
    expect(values.map(isAssignableMemberRole)).toEqual([true, true, true, true, false, false]);
  });
});
