import { describe, expect, it } from 'vitest';
import { parseStringArray, resolveServerSync } from './sidebar-prefs';

const EMPTY = { favorites: [], collapsedSections: [] };

describe('resolveServerSync (#975)', () => {
  it('servidor com dados vence o legado sempre', () => {
    const server = { favorites: ['/sales'], collapsedSections: ['fiscal'] };
    const legacy = { favorites: ['/crm'], collapsedSections: [] };

    const d = resolveServerSync(server, legacy, false);

    expect(d.prefs).toEqual(server);
    expect(d.shouldUpload).toBe(false);
  });

  it('servidor vazio + legado com favoritos + nunca migrado → migra e sobe', () => {
    const legacy = { favorites: ['/crm', '/stock'], collapsedSections: ['wms'] };

    const d = resolveServerSync(EMPTY, legacy, false);

    expect(d.prefs).toEqual(legacy);
    expect(d.shouldUpload).toBe(true);
  });

  it('já migrado antes → servidor vazio é escolha do usuário, não re-migra', () => {
    const legacy = { favorites: ['/crm'], collapsedSections: [] };

    const d = resolveServerSync(EMPTY, legacy, true);

    expect(d.prefs).toEqual(EMPTY);
    expect(d.shouldUpload).toBe(false);
  });

  it('servidor vazio + legado sem favoritos → estado zero, sem upload', () => {
    const d = resolveServerSync(EMPTY, EMPTY, false);

    expect(d.prefs).toEqual(EMPTY);
    expect(d.shouldUpload).toBe(false);
  });

  it('servidor só com seções recolhidas conta como "com dados" (não migra)', () => {
    const server = { favorites: [], collapsedSections: ['fiscal'] };
    const legacy = { favorites: ['/crm'], collapsedSections: [] };

    const d = resolveServerSync(server, legacy, false);

    expect(d.prefs).toEqual(server);
    expect(d.shouldUpload).toBe(false);
  });
});

describe('parseStringArray', () => {
  it('parseia array válido e descarta não-strings', () => {
    expect(parseStringArray('["/a", 1, "/b", null]')).toEqual(['/a', '/b']);
  });

  it('null, JSON inválido e não-array viram []', () => {
    expect(parseStringArray(null)).toEqual([]);
    expect(parseStringArray('{{{')).toEqual([]);
    expect(parseStringArray('"solta"')).toEqual([]);
  });
});
