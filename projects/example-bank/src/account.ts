import { StreamHelper } from '@eventstore-helpers/core';
import { EventStoreDBClient } from '@eventstore/db-client';
import { AccountEvent, BankAccount, TransactionMetadata } from './types';

export class AccountAggregate {
  private streamHelper: StreamHelper<AccountEvent & { metadata?: TransactionMetadata }, BankAccount>;
  private static SNAPSHOT_FREQUENCY = 5;

  constructor(private client: EventStoreDBClient) {
    this.streamHelper = new StreamHelper<AccountEvent & { metadata?: TransactionMetadata }, BankAccount>(client, {
      streamPrefix: 'bank-account',
      snapshotFrequency: AccountAggregate.SNAPSHOT_FREQUENCY,
    });
  }

  private applyEvent(state: BankAccount | null, event: AccountEvent & { metadata?: TransactionMetadata }): BankAccount {
    switch (event.type) {
      case 'AccountCreated':
        return {
          id: state?.id ?? '',
          owner: event.data.owner,
          balance: event.data.initialBalance,
          createdAt: new Date(),
          updatedAt: new Date(),
        };

      case 'MoneyDeposited':
        if (!state) throw new Error('Account not found');
        return {
          ...state,
          balance: state.balance + event.data.amount,
          updatedAt: new Date(),
        };

      case 'MoneyWithdrawn':
        if (!state) throw new Error('Account not found');
        if (state.balance < event.data.amount) {
          throw new Error('Insufficient funds');
        }
        return {
          ...state,
          balance: state.balance - event.data.amount,
          updatedAt: new Date(),
        };

      default:
        return state ?? ({} as BankAccount);
    }
  }

  async createAccount(accountId: string, owner: string, initialBalance: number): Promise<void> {
    const metadata: TransactionMetadata = {
      userId: owner,
      transactionId: crypto.randomUUID(),
      source: 'web'
    };

    const event: AccountEvent & { metadata: TransactionMetadata } = {
      type: 'AccountCreated',
      data: {
        owner,
        initialBalance,
      },
      metadata
    };

    await this.streamHelper.appendEvent(accountId, event);
  }

  async deposit(accountId: string, amount: number, userId: string): Promise<void> {
    const metadata: TransactionMetadata = {
      userId,
      transactionId: crypto.randomUUID(),
      source: 'web'
    };

    const event: AccountEvent & { metadata: TransactionMetadata } = {
      type: 'MoneyDeposited',
      data: { amount },
      metadata
    };

    await this.streamHelper.appendEvent(accountId, event);
  }

  async withdraw(accountId: string, amount: number, userId: string): Promise<void> {
    const metadata: TransactionMetadata = {
      userId,
      transactionId: crypto.randomUUID(),
      source: 'web'
    };

    const event: AccountEvent & { metadata: TransactionMetadata } = {
      type: 'MoneyWithdrawn',
      data: { amount },
      metadata
    };

    await this.streamHelper.appendEvent(accountId, event);
  }

  async getAccount(accountId: string): Promise<BankAccount | null> {
    const result = await this.streamHelper.readFromSnapshot(accountId, this.applyEvent.bind(this));
    return result?.state ?? null;
  }
}
