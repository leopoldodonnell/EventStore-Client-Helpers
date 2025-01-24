import { AggregateHelper } from '@eventstore-helpers/core';
import { EventStoreDBClient } from '@eventstore/db-client';
import { BankAccount, BankAccountEvent, TransactionMetadata } from './types';
import { migrations } from './migrations';
import crypto from 'crypto';

interface TransactionEntity {
  id: string;
  type: 'transaction';
  version: number;
}

export class AccountAggregateV2 {
  private aggregateHelper: AggregateHelper<BankAccount, BankAccountEvent>;
  public static readonly CURRENT_EVENT_VERSION = 1;

  constructor(client: EventStoreDBClient) {
    this.aggregateHelper = new AggregateHelper(client, {
      snapshotFrequency: 5,
      currentEventVersion: AccountAggregateV2.CURRENT_EVENT_VERSION,
      eventMigrations: migrations as any,
      aggregatePrefix: 'account-',
      entityPrefixes: {
        transaction: 'transaction',
      },
    });
  }

  async createAccount(
    owner: string,
    initialBalance: number,
    accountType: 'savings' | 'checking' = 'checking',
    metadata?: TransactionMetadata
  ): Promise<string> {
    const accountId = crypto.randomUUID();
    const transactionId = crypto.randomUUID();

    await this.aggregateHelper.beginTransaction(accountId);

    try {
      const event: BankAccountEvent = {
        type: 'AccountCreated',
        version: AccountAggregateV2.CURRENT_EVENT_VERSION,
        data: {
          id: accountId,
          owner,
          initialBalance,
          accountType,
          timestamp: new Date().toISOString(),
        },
        metadata,
      };

      const transactionEntity: TransactionEntity = {
        id: transactionId,
        type: 'transaction',
        version: 1,
      };

      await this.aggregateHelper.addEvent(accountId, event, [transactionEntity]);
      await this.aggregateHelper.commitTransaction(accountId);

      return accountId;
    } catch (error) {
      await this.aggregateHelper.rollbackTransaction(accountId);
      throw error;
    }
  }

  async deposit(
    accountId: string,
    amount: number,
    description?: string,
    metadata?: TransactionMetadata
  ): Promise<void> {
    const transactionId = crypto.randomUUID();

    await this.aggregateHelper.beginTransaction(accountId);

    try {
      // Check current state first
      const result = await this.aggregateHelper.getCurrentState(accountId, this.applyEvent.bind(this));

      if (!result.state) {
        throw new Error('First event must be AccountCreated');
      }

      const event: BankAccountEvent = {
        type: 'MoneyDeposited',
        version: AccountAggregateV2.CURRENT_EVENT_VERSION,
        data: {
          amount,
          description,
          timestamp: new Date().toISOString(),
        },
        metadata,
      };

      const transactionEntity: TransactionEntity = {
        id: transactionId,
        type: 'transaction',
        version: 1,
      };

      await this.aggregateHelper.addEvent(accountId, event, [transactionEntity]);
      await this.aggregateHelper.commitTransaction(accountId);
    } catch (error) {
      await this.aggregateHelper.rollbackTransaction(accountId);
      throw error;
    }
  }

  async withdraw(
    accountId: string,
    amount: number,
    description?: string,
    metadata?: TransactionMetadata
  ): Promise<void> {
    const transactionId = crypto.randomUUID();

    await this.aggregateHelper.beginTransaction(accountId);

    try {
      // Check current state first
      const result = await this.aggregateHelper.getCurrentState(accountId, this.applyEvent.bind(this));

      if (!result.state) {
        throw new Error('First event must be AccountCreated');
      }

      if (result.state.balance < amount) {
        throw new Error('Insufficient funds');
      }

      const event: BankAccountEvent = {
        type: 'MoneyWithdrawn',
        version: AccountAggregateV2.CURRENT_EVENT_VERSION,
        data: {
          amount,
          description,
          timestamp: new Date().toISOString(),
        },
        metadata,
      };

      const transactionEntity: TransactionEntity = {
        id: transactionId,
        type: 'transaction',
        version: 1,
      };

      await this.aggregateHelper.addEvent(accountId, event, [transactionEntity]);
      await this.aggregateHelper.commitTransaction(accountId);
    } catch (error) {
      await this.aggregateHelper.rollbackTransaction(accountId);
      throw error;
    }
  }

  async getAccount(accountId: string): Promise<BankAccount | null> {
    const result = await this.aggregateHelper.getCurrentState(accountId, this.applyEvent.bind(this));
    return result?.state ?? null;
  }

  private applyEvent(state: BankAccount | null, event: BankAccountEvent): BankAccount {
    switch (event.type) {
      case 'AccountCreated': {
        if (state) {
          throw new Error('AccountCreated can only be the first event');
        }
        
        return {
          id: event.data.id,
          owner: event.data.owner,
          balance: event.data.initialBalance,
          version: AccountAggregateV2.CURRENT_EVENT_VERSION,
          createdAt: event.data.timestamp,
          updatedAt: event.data.timestamp,
          accountType: event.data.accountType || 'checking',
          type: event.type,
          data: event.data,
          metadata: event.metadata,
        };
      }

      case 'MoneyDeposited': {
        if (!state) {
          throw new Error('First event must be AccountCreated');
        }
        
        return {
          ...state,
          balance: state.balance + event.data.amount,
          version: state.version + 1,
          updatedAt: event.data.timestamp,
          type: event.type,
          data: event.data,
          metadata: event.metadata,
        };
      }

      case 'MoneyWithdrawn': {
        if (!state) {
          throw new Error('First event must be AccountCreated');
        }

        return {
          ...state,
          balance: state.balance - event.data.amount,
          version: state.version + 1,
          updatedAt: event.data.timestamp,
          type: event.type,
          data: event.data,
          metadata: event.metadata,
        };
      }

      default: {
        const _exhaustiveCheck: never = event;
        throw new Error(`Unknown event type: ${(event as any).type}`);
      }
    }
  }
}
