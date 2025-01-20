import type { EventMetadata } from '@eventstore-helpers/core';

export interface BankAccount {
  id: string;
  balance: number;
  owner: string;
  createdAt: Date;
  updatedAt: Date;
  [key: string]: unknown;
}

export type AccountEvent =
  | {
      type: 'AccountCreated';
      data: {
        owner: string;
        initialBalance: number;
      };
    }
  | {
      type: 'MoneyDeposited';
      data: {
        amount: number;
      };
    }
  | {
      type: 'MoneyWithdrawn';
      data: {
        amount: number;
      };
    };

export interface TransactionMetadata extends EventMetadata {
  userId: string;
  source: string;
  transactionId: string;
}
