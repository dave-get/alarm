import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, Max, Min, ValidateIf } from 'class-validator';
import { AlertCondition, AlertMode, AlertStatus } from '../../../common/enums/alert.enums.js';
import { SUPPORTED_SYMBOLS } from '../../../common/enums/symbols.enum.js';
import { PaginationQueryDto } from '../../../common/dto/pagination.dto.js';
import { IsPositiveDecimalString } from '../../../common/validators/is-decimal-price.validator.js';

const upper = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toUpperCase() : value);
const defined = (_: unknown, v: unknown) => v !== undefined;

export class CreateAlertDto {
  @ApiProperty({ enum: SUPPORTED_SYMBOLS, example: 'XRPUSDT' })
  @Transform(upper)
  @IsIn(SUPPORTED_SYMBOLS)
  symbol: string;

  @ApiProperty({ example: '1.5000', description: 'Positive decimal string (no floats)' })
  @IsPositiveDecimalString()
  targetPrice: string;

  @ApiProperty({ enum: AlertCondition, example: 'ABOVE' })
  @Transform(upper)
  @IsEnum(AlertCondition)
  condition: AlertCondition;

  @ApiPropertyOptional({ enum: AlertMode, default: 'ONCE' })
  @ValidateIf(defined)
  @Transform(upper)
  @IsEnum(AlertMode)
  mode?: AlertMode;

  @ApiPropertyOptional({ description: 'RECURRING only: minimum seconds between triggers', default: 300, minimum: 0, maximum: 86400 })
  @ValidateIf(defined)
  @IsInt()
  @Min(0)
  @Max(86_400)
  cooldownSeconds?: number;

  @ApiPropertyOptional({ description: 'RECURRING only: % the price must move back before rearming', default: '0.5', example: '0.5' })
  @ValidateIf(defined)
  @IsPositiveDecimalString()
  rearmMarginPercent?: string;
}

export class UpdateAlertDto {
  @ApiPropertyOptional({ example: '1.6000' })
  @ValidateIf(defined)
  @IsPositiveDecimalString()
  targetPrice?: string;

  @ApiPropertyOptional({ enum: AlertCondition })
  @ValidateIf(defined)
  @Transform(upper)
  @IsEnum(AlertCondition)
  condition?: AlertCondition;

  @ApiPropertyOptional({ enum: AlertMode })
  @ValidateIf(defined)
  @Transform(upper)
  @IsEnum(AlertMode)
  mode?: AlertMode;

  @ApiPropertyOptional({ minimum: 0, maximum: 86400 })
  @ValidateIf(defined)
  @IsInt()
  @Min(0)
  @Max(86_400)
  cooldownSeconds?: number;

  @ApiPropertyOptional({ example: '0.5' })
  @ValidateIf(defined)
  @IsPositiveDecimalString()
  rearmMarginPercent?: string;
}

export class ListAlertsQueryDto {
  @ApiPropertyOptional({ enum: AlertStatus })
  @ValidateIf(defined)
  @Transform(upper)
  @IsEnum(AlertStatus)
  status?: AlertStatus;

  @ApiPropertyOptional({ enum: SUPPORTED_SYMBOLS })
  @ValidateIf(defined)
  @Transform(upper)
  @IsIn(SUPPORTED_SYMBOLS)
  symbol?: string;
}

export class HistoryQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ enum: SUPPORTED_SYMBOLS })
  @ValidateIf(defined)
  @Transform(upper)
  @IsIn(SUPPORTED_SYMBOLS)
  symbol?: string;

  @ApiPropertyOptional({ description: 'Only events for this alarm' })
  @ValidateIf(defined)
  @Type(() => String)
  alertId?: string;
}
