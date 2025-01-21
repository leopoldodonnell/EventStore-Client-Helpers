import { EventMigration } from '@eventstore-helpers/core';
import { AccountEventV1, AccountEventV2 } from './types';
import crypto from 'crypto';

// Example migration from V1 to V2 for AccountCreated event
export const accountCreatedV1ToV2: EventMigration<
  Extract<AccountEventV1, { type: 'AccountCreated' }>,
  Extract<AccountEventV2, { type: 'AccountCreated' }>
> = {
  fromVersion: 1,
  toVersion: 2,
  eventType: 'AccountCreated',
  migrate: (event) => ({
    type: event.type,
    version: 2,
    data: {
      ...event.data,
      accountType: 'checking',  // Default to checking for migrated accounts
    },
  }),
};

// Example migration from V1 to V2 for MoneyDeposited event
export const moneyDepositedV1ToV2: EventMigration<
  Extract<AccountEventV1, { type: 'MoneyDeposited' }>,
  Extract<AccountEventV2, { type: 'MoneyDeposited' }>
> = {
  fromVersion: 1,
  toVersion: 2,
  eventType: 'MoneyDeposited',
  migrate: (event) => ({
    type: event.type,
    version: 2,
    transactionId: `migrated-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
    data: {
      ...event.data,
      description: 'Migrated from V1',  // Add default description
    },
  }),
};

// Example migration from V1 to V2 for MoneyWithdrawn event
export const moneyWithdrawnV1ToV2: EventMigration<
  Extract<AccountEventV1, { type: 'MoneyWithdrawn' }>,
  Extract<AccountEventV2, { type: 'MoneyWithdrawn' }>
> = {
  fromVersion: 1,
  toVersion: 2,
  eventType: 'MoneyWithdrawn',
  migrate: (event) => ({
    type: event.type,
    version: 2,
    transactionId: crypto.randomUUID(),
    data: {
      ...event.data,
      description: 'Migrated from V1',  // Add default description
    },
  }),
};

// Collection of all migrations
export const migrations = [
  accountCreatedV1ToV2,
  moneyDepositedV1ToV2,
  moneyWithdrawnV1ToV2,
];
