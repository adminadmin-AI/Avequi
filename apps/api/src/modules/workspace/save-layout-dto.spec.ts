import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { SaveLayoutDto } from './dto/save-layout.dto';

/**
 * Contrato de tamanho do layout (tiers P/M/G).
 *
 * O ponto sensível é a COMPATIBILIDADE: quem personalizou a Home antes dos
 * tiers tem 'half'/'full' salvo no banco, e o navegador com o bundle antigo
 * em cache continua ENVIANDO esses valores por um tempo depois do deploy.
 * Se o DTO passasse a aceitar só o vocabulário novo, o PUT /workspace/layout
 * desses usuários viraria 400 — personalizar a Home quebraria em silêncio.
 */
describe('SaveLayoutDto — tamanhos aceitos', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
  const meta = { type: 'body' as const, metatype: SaveLayoutDto };

  const payload = (size: string) => ({
    version: 1,
    widgets: [{ id: 'chart-revenue', size }],
  });

  it.each(['small', 'medium', 'large'])('aceita o tier %s', async (size) => {
    const out = (await pipe.transform(payload(size), meta)) as SaveLayoutDto;
    expect(out.widgets[0].size).toBe(size);
  });

  it.each(['half', 'full'])('continua aceitando o vocabulário legado %s', async (size) => {
    const out = (await pipe.transform(payload(size), meta)) as SaveLayoutDto;
    expect(out.widgets[0].size).toBe(size);
  });

  it('rejeita tamanho inventado', async () => {
    await expect(pipe.transform(payload('gigante'), meta)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('size é opcional (layout que só oculta ou reordena)', async () => {
    const out = (await pipe.transform(
      { version: 1, widgets: [{ id: 'agenda', hidden: true }] },
      meta,
    )) as SaveLayoutDto;
    expect(out.widgets[0].size).toBeUndefined();
    expect(out.widgets[0].hidden).toBe(true);
  });
});
