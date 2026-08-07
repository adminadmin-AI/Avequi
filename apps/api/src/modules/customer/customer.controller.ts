import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CustomerService } from './customer.service';
import { CreateCustomerDto, CustomerAddressDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';
import { CustomerQueryDto } from './dto/customer-query.dto';
import { CustomerOptionsQueryDto } from './dto/customer-options-query.dto';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * #341 parte 2 (PR B): gate único RBAC v2 via @RequirePermission — o @Roles
 * legado foi removido (matriz validada pelo Rafael na issue #620).
 *
 * Endereços de entrega usam a família própria customers.addresses.* (decisão
 * Rafael): a loja/balcão adiciona endereço na venda (create), mas editar é do
 * comercial e remover é de gerência — regra distinta de editar o cliente.
 */
@ApiTags('customers')
@ApiBearerAuth()
@Controller('customers')
export class CustomerController {
  constructor(private readonly customerService: CustomerService) {}

  @Post()
  // LOJA_OPERACIONAL cria cliente na venda de balcão (decisão Rafael 04/07/2026)
  @RequirePermission('customers.registry.create')
  @ApiOperation({ summary: 'Criar cliente' })
  create(@Body() dto: CreateCustomerDto, @CurrentUser() user: any) {
    return this.customerService.create(dto, user);
  }

  @Get()
  @RequirePermission('customers.registry.view')
  @ApiOperation({ summary: 'Listar clientes (paginado — #1028)' })
  findAll(@CurrentUser() user: any, @Query() query: CustomerQueryDto) {
    return this.customerService.findAll(user.companyId, query);
  }

  // Rota estática ANTES de :id — "/customers/options" seria capturado por
  // findOne com id="options" senão.
  @Get('options')
  @RequirePermission('customers.registry.view')
  @ApiOperation({ summary: 'Opções para combobox de formulário — payload mínimo, sem paginação (#1028)' })
  findOptions(@CurrentUser() user: any, @Query() query: CustomerOptionsQueryDto) {
    return this.customerService.findOptions(user.companyId, query);
  }

  // Rota estática ANTES de :id (mesmo padrão de /options) — #1032, senão
  // "/customers/export" seria capturado por findOne com id="export".
  @Get('export')
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // mesmo limite dos exports em lote (#349)
  @RequirePermission('customers.registry.view')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="clientes.csv"')
  @ApiOperation({ summary: 'Exportar clientes em CSV — mesmos filtros da listagem, conjunto completo via cursor, auditado (LGPD) (#1032)' })
  exportCsv(
    @CurrentUser() user: any,
    @Query() query: CustomerQueryDto,
    @Req() req: Request,
  ): StreamableFile {
    const stream = this.customerService.exportCsv(user.companyId, query, {
      userId: user.id,
      sessionId: user.sessionId,
      ipAddress: req.ip,
      userAgent: req.get('user-agent') ?? undefined,
    });
    return new StreamableFile(stream);
  }

  // ─── #476: tags de segmentação (rotas estáticas ANTES de :id) ───────────────

  @Get('tags')
  @RequirePermission('customers.registry.view')
  @ApiOperation({ summary: 'Tags de segmentação com contagem de clientes (#476)' })
  listTags(@CurrentUser() user: any) {
    return this.customerService.listTags(user.companyId);
  }

  @Post('tags')
  @RequirePermission('customers.registry.update')
  @ApiOperation({ summary: 'Criar tag de segmentação (revenda, produtor rural…) (#476)' })
  createTag(@Body() dto: { name: string; color?: string }, @CurrentUser() user: any) {
    return this.customerService.createTag(user.companyId, dto);
  }

  @Delete('tags/:tagId')
  @RequirePermission('customers.registry.update')
  @ApiOperation({ summary: 'Remover tag (desvincula de todos os clientes) (#476)' })
  deleteTag(@Param('tagId') tagId: string, @CurrentUser() user: any) {
    return this.customerService.deleteTag(user.companyId, tagId);
  }

  @Patch(':id/tags')
  @RequirePermission('customers.registry.update')
  @ApiOperation({ summary: 'Definir as tags do cliente (substitui o conjunto) (#476)' })
  setTags(@Param('id') id: string, @Body() dto: { tagIds: string[] }, @CurrentUser() user: any) {
    return this.customerService.setCustomerTags(user.companyId, id, dto.tagIds ?? []);
  }

  // ─── #476: anexos — docs de emplacamento (CNH, comprovante) ────────────────

  @Get('attachments/:attachmentId')
  @RequirePermission('customers.registry.view')
  @ApiOperation({ summary: 'Download do anexo do cliente (#476)' })
  async downloadAttachment(
    @Param('attachmentId') attachmentId: string,
    @CurrentUser() user: any,
    @Res() res: Response,
  ) {
    const att = await this.customerService.getAttachment(user.companyId, attachmentId);
    res.set({
      'Content-Type': att.mimeType,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(att.filename)}"`,
      'Content-Length': String(att.size),
    });
    res.end(Buffer.from(att.data));
  }

  @Delete('attachments/:attachmentId')
  @RequirePermission('customers.registry.update')
  @ApiOperation({ summary: 'Remover anexo do cliente (#476)' })
  deleteAttachment(@Param('attachmentId') attachmentId: string, @CurrentUser() user: any) {
    return this.customerService.deleteAttachment(user.companyId, attachmentId);
  }

  @Get(':id/attachments')
  @RequirePermission('customers.registry.view')
  @ApiOperation({ summary: 'Anexos do cliente — só metadados (#476)' })
  listAttachments(@Param('id') id: string, @CurrentUser() user: any) {
    return this.customerService.listAttachments(user.companyId, id);
  }

  @Post(':id/attachments')
  @RequirePermission('customers.registry.update')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 10 * 1024 * 1024 } }))
  @ApiOperation({ summary: 'Anexar documento ao cliente (CNH, comprovante — máx 10MB) (#476)' })
  uploadAttachment(@Param('id') id: string, @UploadedFile() file: any, @CurrentUser() user: any) {
    if (!file) throw new BadRequestException('Arquivo obrigatório');
    return this.customerService.addAttachment(user.companyId, id, file, user?.id);
  }

  @Get(':id/credit')
  @RequirePermission('customers.registry.view')
  @ApiOperation({ summary: 'Situação de crédito: limite, em aberto e disponível (#475)' })
  creditStatus(@Param('id') id: string, @CurrentUser() user: any) {
    return this.customerService.creditStatus(id, user.companyId);
  }

  @Get(':id')
  @RequirePermission('customers.registry.view')
  @ApiOperation({ summary: 'Buscar cliente por ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.customerService.findOne(id, user.companyId);
  }

  @Patch(':id')
  @RequirePermission('customers.registry.update')
  @ApiOperation({ summary: 'Atualizar cliente' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateCustomerDto,
    @CurrentUser() user: any,
  ) {
    return this.customerService.update(id, dto, user);
  }

  // ─── Endereços de entrega (#474) ────────────────────────────────────────────

  @Post(':id/addresses')
  @RequirePermission('customers.addresses.create')
  @ApiOperation({ summary: 'Adicionar endereço de entrega ao cliente' })
  addAddress(@Param('id') id: string, @Body() dto: CustomerAddressDto, @CurrentUser() user: any) {
    return this.customerService.addAddress(id, dto, user.companyId);
  }

  @Patch(':id/addresses/:addressId')
  @RequirePermission('customers.addresses.update')
  @ApiOperation({ summary: 'Atualizar endereço de entrega' })
  updateAddress(
    @Param('id') id: string,
    @Param('addressId') addressId: string,
    @Body() dto: Partial<CustomerAddressDto>,
    @CurrentUser() user: any,
  ) {
    return this.customerService.updateAddress(id, addressId, dto, user.companyId);
  }

  @Delete(':id/addresses/:addressId')
  @RequirePermission('customers.addresses.delete')
  @ApiOperation({ summary: 'Remover endereço de entrega' })
  removeAddress(@Param('id') id: string, @Param('addressId') addressId: string, @CurrentUser() user: any) {
    return this.customerService.removeAddress(id, addressId, user.companyId);
  }
}
