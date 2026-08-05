import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { UpdateUserDto } from './update-user.dto';

/**
 * Regressão do bug do toggle Ativo/Inativo da tela de usuários (16/07/2026):
 * o web envia `PATCH /users/:id { isActive: boolean }`, mas o UpdateUserDto
 * (PartialType do CreateUserDto) não declarava o campo — o ValidationPipe
 * global (forbidNonWhitelisted) rejeitava a requisição INTEIRA com
 * "property isActive should not exist" e a UI mostrava só o toast genérico
 * "Erro ao alterar status". Inativar/reativar pela interface era impossível
 * para QUALQUER usuário/admin.
 *
 * Contrato travado aqui: o payload do toggle é aceito; tipo errado e campo
 * desconhecido continuam rejeitados (o forbidNonWhitelisted não foi
 * afrouxado).
 */
describe('UpdateUserDto — toggle isActive da tela de usuários', () => {
  // mesmas opções do ValidationPipe global (main.ts)
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  const asBody = (payload: unknown) =>
    pipe.transform(payload, { type: 'body', metatype: UpdateUserDto });

  it('payload do toggle { isActive: false } → aceito (era o bug: 400)', async () => {
    await expect(asBody({ isActive: false })).resolves.toMatchObject({ isActive: false });
  });

  it('reativação { isActive: true } → aceita', async () => {
    await expect(asBody({ isActive: true })).resolves.toMatchObject({ isActive: true });
  });

  it('isActive não-booleano → rejeitado', async () => {
    await expect(asBody({ isActive: 'sim' })).rejects.toThrow(BadRequestException);
  });

  it('edição normal continua aceita junto do isActive', async () => {
    await expect(asBody({ name: 'Novo Nome', isActive: true })).resolves.toMatchObject({
      name: 'Novo Nome',
      isActive: true,
    });
  });

  it('campo desconhecido segue rejeitado (forbidNonWhitelisted preservado)', async () => {
    await expect(asBody({ naoExiste: 1 })).rejects.toThrow(BadRequestException);
  });

  // ── #946: papel sai do update (RBAC v2 é a fonte de verdade) ──

  it('PATCH com `role` → 400 pelo pipeline normal (sem fallback no service)', async () => {
    await expect(asBody({ role: 'SUPER_ADMIN' })).rejects.toThrow(BadRequestException);
  });

  it('`role` junto de campos válidos rejeita a requisição INTEIRA', async () => {
    // Nada de aceitar o nome e ignorar o papel em silêncio: quem tentou mudar
    // papel aqui precisa saber que o caminho agora é Perfis e Permissões.
    await expect(asBody({ name: 'Novo Nome', role: 'DIRECTOR' })).rejects.toThrow(
      BadRequestException,
    );
  });

  it('edição sem papel continua funcionando', async () => {
    await expect(asBody({ name: 'Novo Nome' })).resolves.toMatchObject({
      name: 'Novo Nome',
    });
  });
});
