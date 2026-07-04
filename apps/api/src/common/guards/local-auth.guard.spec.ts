import { AuthGuard } from '@nestjs/passport';
import { LocalAuthGuard } from './local-auth.guard';

// LocalAuthGuard nao tem logica propria: apenas `extends AuthGuard('local')`.
// Smoke test para garantir que continua ligado a strategy 'local' do passport
// (se alguem trocar a strategy ou adicionar logica, este teste sinaliza).
describe('LocalAuthGuard', () => {
  it('estende AuthGuard("local") sem sobrescrever canActivate', () => {
    const guard = new LocalAuthGuard();
    expect(guard).toBeInstanceOf(AuthGuard('local'));
    expect(
      Object.prototype.hasOwnProperty.call(
        LocalAuthGuard.prototype,
        'canActivate',
      ),
    ).toBe(false);
  });
});
