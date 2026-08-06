import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ProductService } from './product.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductQueryDto } from './dto/product-query.dto';
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
