import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ProductService } from './product.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';

@ApiTags('products')
@ApiBearerAuth()
@Controller('products')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Post()
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER', 'COMMERCIAL')
  @ApiOperation({ summary: 'Criar produto' })
  create(@Body() dto: CreateProductDto, @CurrentUser() user: any) {
    return this.productService.create(dto, user);
  }

  @Get()
  @ApiOperation({ summary: 'Listar produtos' })
  @ApiQuery({ name: 'search', required: false })
  @ApiQuery({ name: 'type', required: false })
  @ApiQuery({ name: 'isActive', required: false })
  findAll(
    @CurrentUser() user: any,
    @Query('search') search?: string,
    @Query('type') type?: string,
    @Query('isActive') isActive?: string,
  ) {
    return this.productService.findAll(user.companyId, { search, type, isActive });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar produto por ID' })
  findOne(@Param('id') id: string, @CurrentUser() user: any) {
    return this.productService.findOne(id, user.companyId);
  }

  @Patch(':id')
  @Roles('SUPER_ADMIN', 'DIRECTOR', 'MANAGER')
  @ApiOperation({ summary: 'Atualizar produto' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateProductDto,
    @CurrentUser() user: any,
  ) {
    return this.productService.update(id, dto, user);
  }
}
