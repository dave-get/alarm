import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEnum, IsString, MaxLength } from 'class-validator';
import { DevicePlatform } from '../../../common/enums/alert.enums.js';

export class RegisterDeviceDto {
  @ApiProperty({ example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]' })
  @IsString()
  @MaxLength(255)
  pushToken: string;

  @ApiProperty({ enum: DevicePlatform, example: 'ANDROID' })
  @Transform(({ value }) => (typeof value === 'string' ? value.toUpperCase() : value))
  @IsEnum(DevicePlatform)
  platform: DevicePlatform;
}
