import { registerEnumType } from '@nestjs/graphql';

/**
 * Type of address
 */
export enum AddressType {
  RESIDENTIAL = 'residential',
  MAILING = 'mailing',
  BUSINESS = 'business',
  VOTING = 'voting', // Important for civic applications
}

registerEnumType(AddressType, {
  name: 'AddressType',
  description: 'The type of address',
});
