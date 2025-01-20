import type { EventMetadata } from '@eventstore-helpers/core';

// Base interface for versioned events
export interface BaseEvent<T extends string, D> {
  type: T;
  version: number;
  data: D;
  metadata?: EventMetadata;
  [key: string]: unknown;
}

export interface BankAccount {
  id: string;
  balance: number;
  owner: string;
  createdAt: Date;
  updatedAt: Date;
  accountType: 'savings' | 'checking';
  [key: string]: unknown;
}

// V1 Event type definitions
export type AccountEventV1 =
  | BaseEvent<'AccountCreated', {
      owner: string;
      initialBalance: number;
    }>
  | BaseEvent<'MoneyDeposited', {
      amount: number;
    }>
  | BaseEvent<'MoneyWithdrawn', {
      amount: number;
    }>;

// V2 Event type definitions with additional fields
export type AccountEventV2 =
  | BaseEvent<'AccountCreated', {
      owner: string;
      initialBalance: number;
      accountType: 'savings' | 'checking';
    }>
  | BaseEvent<'MoneyDeposited', {
      amount: number;
      description?: string;
    }>
  | BaseEvent<'MoneyWithdrawn', {
      amount: number;
      description?: string;
    }>;

// Union type of all event versions
export type AccountEvent = AccountEventV1 | AccountEventV2;

export interface TransactionMetadata extends EventMetadata {
  userId: string;
  source: string;
  transactionId: string;
}
