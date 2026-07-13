import { vehicleInfCpl } from './fiscal.service';

// Descrição do veículo nas Informações Complementares (pedido Claudio 13/07)
const vehicle = {
  tipoOperacao: '0', chassi: '92UPRTB75TS001163', codigoCor: '09',
  descricaoCor: 'PRATA', potenciaMotor: 0, cilindrada: 0,
  pesoLiquido: '0.570', pesoBruto: '0.750', serie: 'SN101',
  tipoCombustivel: '11', numeroMotor: '0', anoModelo: 2026, anoFabricacao: 2026,
  tipoPintura: 'S', tipoVeiculo: '10', especieVeiculo: '2', vin: 'N',
  condicao: '1', codigoMarcaModelo: '600657', corDenatran: '09',
  lotacao: 0, restricao: '0', qtdEixos: 1,
} as any;

describe('vehicleInfCpl', () => {
  it('monta a descrição EXATA no formato das notas do sistema anterior', () => {
    expect(vehicleInfCpl(vehicle, 'PR')).toBe(
      'REBOQUE NOVO, COR PRATA, CARROCERIA ABERTA, MARCA R CARRESUL PRT B, COD 600657, ' +
      'COM 1 EIXO, CAP DE CARGA 0,57 TON, PBT 0,75 TON, ANO DE FABRICACAO E MODELO 2026, ' +
      'SEM RESERVA DE DOMINIO. CHASSI 92UPRTB75TS001163',
    );
  });

  it('venda para o RS declara pneus novos', () => {
    expect(vehicleInfCpl(vehicle, 'RS')).toContain('. REBOQUE COM PNEUS NOVOS');
    expect(vehicleInfCpl(vehicle, 'SC')).not.toContain('PNEUS NOVOS');
  });

  it('plural de eixos, anos distintos e código sem marca conhecida', () => {
    const v2 = { ...vehicle, qtdEixos: 2, anoFabricacao: 2025, codigoMarcaModelo: '999999' };
    const out = vehicleInfCpl(v2, 'PR');
    expect(out).toContain('COM 2 EIXOS');
    expect(out).toContain('ANO FABRICACAO 2025 MODELO 2026');
    expect(out).toContain('COD 999999');
    expect(out).not.toContain('MARCA ');
  });

  it('sem eixos informados omite o trecho', () => {
    expect(vehicleInfCpl({ ...vehicle, qtdEixos: null }, 'PR')).not.toContain('EIXO');
  });
});
