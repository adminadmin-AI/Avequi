import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  StreamableFile,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProductService } from './product.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductQueryDto } from './dto/product-query.dto';
import { ProductOptionsQueryDto } from './dto/product-options-query.dto';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

/**
 * #341 parte 2 (PR B): gate único RBAC v2 via @RequirePermission — o @Roles
 * legado foi removido (matriz validada pelo Rafael na issue #620).
 * companyId SEMPRE do JWT (service já escopado).
 */
@ApiTags('products')
@ApiBearerAuth()
@Controller('products')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Post()
  @RequirePermission('products.catalog.create')
  @ApiOperation({ summary: 'Criar produto' })
  create(@Body() dto: CreateProductDto, @CurrentUser() user: any) {
    return this.productService.create(dto, user);
  }

  @Get()
  @RequirePermission('products.catalog.view')
  @ApiOperation({ summary: 'Listar produtos (paginado — #1028)' })
  findAll(@CurrentUser() user: any, @Query() query: ProductQueryDto) {
    return this.productService.findAll(user.companyId, query);
  }

  // Rota estática ANTES de :id (mesmo padrão do CustomerController) — senão
  // "/products/options" seria capturado por findOne com id="options".
  @Get('options')
  @RequirePermission('products.catalog.view')
  @ApiOperation({ summary: 'Opções para combobox de formulário — payload mínimo, sem paginação (#1028)' })
  findOptions(@CurrentUser() user: any, @Query() query: ProductOptionsQueryDto) {
    return this.productService.findOptions(user.companyId, query);
  }

  // Rota estática ANTES de :id (mesmo padrão de /options) — #1032, senão
  // "/products/export" seria capturado por findOne com id="export".
  @Get('export')
  @Throttle({ default: { limit: 10, ttl: 60000 } }) // mesmo limite dos exports em lote (#349)
  // Ver a lista e EXTRAIR a lista são privilégios diferentes: exige as duas
  // (semântica AND do decorator). Por recurso e não a
  // `analytics.export.execute` genérica: aquela abre as 6 rotas de
  // /reports/export/* de uma vez (fornecedores, compras, vendas, estoque).
  // O legado some na #1050 e adota estes codes.
  @RequirePermission('products.catalog.view', 'products.catalog.export')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="produtos.csv"')
  @ApiOperation({ summary: 'Exportar produtos em CSV — mesmos filtros da listagem, conjunto completo via cursor (#1032)' })
  exportCsv(@CurrentUser() user: any, @Query() query: ProductQueryDto): StreamableFile {
    return new StreamableFile(this.productService.exportCsv(user.companyId, query));
  }

  @Get(':id')
  @RequirePermission('products.catalog.view')
  @ApiOperation({ summary: 'Buscar produto por ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.productService.findOne(id, user.companyId);
  }

  @Patch(':id')
  @RequirePermission('products.catalog.update')
  @ApiOperation({ summary: 'Atualizar produto' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
    @CurrentUser() user: any,
  ) {
    return this.productService.update(id, dto, user);
  }
}
