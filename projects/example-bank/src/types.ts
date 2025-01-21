import { BaseEvent } from '@eventstore-helpers/core';
import { JSONEventType } from '@eventstore/db-client';

// Base interface for versioned events
// export interface BaseEvent<T extends string, D> {
//   type: T;
//   version: number;
//   data: D;
//   metadata?: EventMetadata;
//   [key: string]: unknown;
// }

export interface BankAccount extends JSONEventType {
  id: string;
  owner: string;
  balance: number;
  version: number;
  createdAt: string;
  updatedAt: string;
  accountType: string;
  type: string;
  data: Record<string, unknown>;
  [key: string]: unknown;
}

export type AccountCreatedEvent = BaseEvent<'AccountCreated', {
  id: string;
  owner: string;
  initialBalance: number;
  accountType: string;
  timestamp: string;
}>;

export type MoneyDepositedEvent = BaseEvent<'MoneyDeposited', {
  amount: number;
  description?: string;
  timestamp: string;
}>;

export type MoneyWithdrawnEvent = BaseEvent<'MoneyWithdrawn', {
  amount: number;
  description?: string;
  timestamp: string;
}>;

// V1 Event Types
export type AccountCreatedEventV1 = AccountCreatedEvent & { version: 1 };
export type MoneyDepositedEventV1 = MoneyDepositedEvent & { version: 1 };
export type MoneyWithdrawnEventV1 = MoneyWithdrawnEvent & { version: 1 };

// V2 Event Types
export type AccountCreatedEventV2 = AccountCreatedEvent & { version: 2 };
export type MoneyDepositedEventV2 = MoneyDepositedEvent & { version: 2, transactionId: string };
export type MoneyWithdrawnEventV2 = MoneyWithdrawnEvent & { version: 2, transactionId: string };

// Union types for all V1 and V2 events
export type AccountEventV1 = AccountCreatedEventV1 | MoneyDepositedEventV1 | MoneyWithdrawnEventV1;
export type AccountEventV2 = AccountCreatedEventV2 | MoneyDepositedEventV2 | MoneyWithdrawnEventV2;

// Combined type for all events
export type BankAccountEvent = AccountEventV1 | AccountEventV2;

export interface TransactionMetadata {
  userId: string;
  source: string;
  transactionId: string;
  [key: string]: unknown;
}
