import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;

  beforeEach(() => {
    const mockConfig = {
      get: jest.fn().mockReturnValue('test-secret-key-for-jwt-at-least-32-chars'),
    };
    strategy = new JwtStrategy(mockConfig as any);
  });

  it('should extract user from valid payload', async () => {
    const payload = {
      sub: 'user-1',
      email: 'admin@gdr.com.br',
      role: 'SUPER_ADMIN',
      companyId: 'company-1',
    };

    const result = await strategy.validate(payload);

    expect(result).toEqual({
      id: 'user-1',
      email: 'admin@gdr.com.br',
      role: 'SUPER_ADMIN',
      companyId: 'company-1',
    });
  });

  it('should map sub to id', async () => {
    const result = await strategy.validate({ sub: 'abc-123' });

    expect(result.id).toBe('abc-123');
  });

  it('should return undefined fields when payload is incomplete', async () => {
    const result = await strategy.validate({ sub: 'user-1' });

    expect(result.id).toBe('user-1');
    expect(result.companyId).toBeUndefined();
    expect(result.role).toBeUndefined();
    expect(result.email).toBeUndefined();
  });
});
