// #365 emitido quando uma BinRegistration transita para REGISTERED — o módulo
// delivery escuta para avançar a entrega de AWAITING_BIN → AWAITING_PICKUP.
export const BIN_REGISTERED_EVENT = 'vehicle.bin.registered';

export class BinRegisteredEvent {
  constructor(
    public readonly companyId: string,
    public readonly serialNumberId: string,
  ) {}
}
