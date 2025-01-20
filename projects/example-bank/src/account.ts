import { StreamHelper, EventMigration } from '@eventstore-helpers/core';
import { EventStoreDBClient } from '@eventstore/db-client';
import { AccountEvent, AccountEventV1, AccountEventV2, BankAccount, TransactionMetadata } from './types';
import { migrations } from './migrations';
import crypto from 'crypto';

export class AccountAggregate {
  private streamHelper: StreamHelper<BankAccount, AccountEvent>;
  private static SNAPSHOT_FREQUENCY = 5;
  private static CURRENT_EVENT_VERSION = 2;

  constructor(private client: EventStoreDBClient) {
    this.streamHelper = new StreamHelper<BankAccount, AccountEvent>(client, {
      streamPrefix: 'bank-account',
      snapshotFrequency: AccountAggregate.SNAPSHOT_FREQUENCY,
      eventMigrations: [...migrations] as EventMigration<any, any>[],
      currentEventVersion: AccountAggregate.CURRENT_EVENT_VERSION,
    });
  }

  private applyEvent(state: BankAccount | null, event: AccountEvent): BankAccount {
    switch (event.type) {
      case 'AccountCreated': {
        return {
          id: state?.id ?? '',
          owner: event.data.owner,
          balance: event.data.initialBalance,
          createdAt: new Date(),
          updatedAt: new Date(),
          accountType: 'accountType' in event.data ? event.data.accountType : 'checking',
        };
      }

      case 'MoneyDeposited': {
        if (!state) throw new Error('Account not found');
        return {
          ...state,
          balance: state.balance + event.data.amount,
          updatedAt: new Date(),
        };
      }

      case 'MoneyWithdrawn': {
        if (!state) throw new Error('Account not found');
        if (state.balance < event.data.amount) {
          throw new Error('Insufficient funds');
        }
        return {
          ...state,
          balance: state.balance - event.data.amount,
          updatedAt: new Date(),
        };
      }

      default:
        return state ?? {
          id: '',
          owner: '',
          balance: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
          accountType: 'checking'
        };
    }
  }

  async createAccount(accountId: string, owner: string, initialBalance: number, accountType: 'savings' | 'checking' = 'checking'): Promise<void> {
    const metadata: TransactionMetadata = {
      userId: owner,
      transactionId: crypto.randomUUID(),
      source: 'web'
    };

    const event: AccountEventV2 = {
      type: 'AccountCreated',
      version: AccountAggregate.CURRENT_EVENT_VERSION,
      data: {
        owner,
        initialBalance,
        accountType,
      },
      metadata
    };

    await this.streamHelper.appendEvent(accountId, event);
  }

  async deposit(accountId: string, amount: number, userId: string, description?: string): Promise<void> {
    const metadata: TransactionMetadata = {
      userId,
      transactionId: crypto.randomUUID(),
      source: 'web'
    };

    const event: AccountEventV2 = {
      type: 'MoneyDeposited',
      version: AccountAggregate.CURRENT_EVENT_VERSION,
      data: { 
        amount,
        description 
      },
      metadata
    };

    await this.streamHelper.appendEvent(accountId, event);
  }

  async withdraw(accountId: string, amount: number, userId: string, description?: string): Promise<void> {
    const metadata: TransactionMetadata = {
      userId,
      transactionId: crypto.randomUUID(),
      source: 'web'
    };

    const event: AccountEventV2 = {
      type: 'MoneyWithdrawn',
      version: AccountAggregate.CURRENT_EVENT_VERSION,
      data: { 
        amount,
        description 
      },
      metadata
    };

    await this.streamHelper.appendEvent(accountId, event);
  }

  async getAccount(accountId: string): Promise<BankAccount | null> {
    const result = await this.streamHelper.getCurrentState(accountId, this.applyEvent.bind(this));
    return result?.state ?? null;
  }
}
