import { BadRequestException } from '@nestjs/common';

/**
 * Regras de uso de chassi numa venda — fonte ÚNICA para os dois fluxos que
 * escolhem chassi: a venda balcão (#595) e a conferência da carga (#729).
 *
 * Por que compartilhado: são a mesma pergunta física ("este chassi pode sair
 * nesta venda?"). Duas implementações divergiriam com o tempo, e a que
 * divergisse para o lado frouxo deixaria dois pedidos donos do mesmo reboque.
 *
 * O que NÃO mora aqui: quando cada fluxo exige o chassi. O balcão exige no
 * fechamento; a conferência exige só quando a separação não amarrou nada
 * (depósito sem WMS). Essa decisão é de cada fluxo.
 */

/** Subconjunto do PrismaService/tx que estas funções usam (leitura). */
type LeitorDeChassi = {
  serialNumber: { findFirst: (args: any) => Promise<any> };
};

/** Subconjunto transacional — reserva exige updateMany condicional. */
type EscritorDeChassi = {
  serialNumber: { updateMany: (args: any) => Promise<{ count: number }> };
};

export interface ChassiEscolhido {
  serialNumberId: string;
  productId: string;
  /** Nome do produto, só para a mensagem de erro ser legível pelo operador. */
  productName: string;
  /** Depósito da venda: o chassi tem de estar nele. */
  warehouseId: string;
}

/**
 * O chassi pode ser usado nesta venda? Lança com mensagem de operador quando não.
 *
 * Confere, nesta ordem: existe e é da empresa · é do produto vendido · está no
 * depósito da venda · está disponível · não está amarrado a outra venda.
 *
 * ⚠️ Isto é validação de leitura, sujeita a corrida: entre validar e reservar,
 * outra venda pode levar o mesmo chassi. Quem fecha a corrida é a
 * `reservarChassi`, com atualização condicional. As duas se complementam — a
 * validação existe para dar mensagem boa, a reserva para dar garantia.
 */
export async function assertChassiUtilizavel(
  db: LeitorDeChassi,
  companyId: string,
  escolha: ChassiEscolhido,
): Promise<void> {
  const serial = await db.serialNumber.findFirst({
    where: { id: escolha.serialNumberId, companyId },
    select: {
      id: true,
      serial: true,
      productId: true,
      warehouseId: true,
      status: true,
      salesOrderId: true,
    },
  });

  if (!serial) {
    throw new BadRequestException(`Chassi ${escolha.serialNumberId} não encontrado.`);
  }
  if (serial.productId !== escolha.productId) {
    throw new BadRequestException(
      `Chassi ${serial.serial} não pertence ao produto "${escolha.productName}".`,
    );
  }
  if (serial.warehouseId !== escolha.warehouseId) {
    throw new BadRequestException(`Chassi ${serial.serial} não está no depósito da venda.`);
  }
  if (serial.status !== 'IN_STOCK') {
    throw new BadRequestException(
      `Chassi ${serial.serial} não está disponível (status ${serial.status}).`,
    );
  }
  if (serial.salesOrderId) {
    throw new BadRequestException(`Chassi ${serial.serial} já está vinculado a outra venda.`);
  }
}

/**
 * Reserva o chassi para a venda — a trava real contra concorrência (#595/#729).
 *
 * A condição vive no WHERE da atualização, não num `if` antes dela: o banco só
 * deixa passar quem encontrar o chassi ainda `IN_STOCK` e sem venda. Duas
 * conferências simultâneas no mesmo reboque: uma atualiza 1 linha e segue, a
 * outra atualiza 0 e recebe o erro abaixo. Nunca sobrescreve vínculo existente.
 *
 * Deve rodar SEMPRE dentro da transação que conclui a etapa — se a etapa falhar
 * depois, a reserva volta atrás junto.
 */
export async function reservarChassi(
  tx: EscritorDeChassi,
  companyId: string,
  salesOrderId: string,
  escolha: Pick<ChassiEscolhido, 'serialNumberId' | 'productName'>,
): Promise<void> {
  const movidos = await tx.serialNumber.updateMany({
    where: {
      id: escolha.serialNumberId,
      companyId,
      status: 'IN_STOCK' as any,
      salesOrderId: null,
    },
    data: { status: 'RESERVED_FOR_SALE' as any, salesOrderId },
  });

  if (movidos.count !== 1) {
    throw new BadRequestException(
      `Chassi de "${escolha.productName}" não está mais disponível — outra venda o reservou. Escaneie outro.`,
    );
  }
}
