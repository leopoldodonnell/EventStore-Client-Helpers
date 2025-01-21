import { StreamHelper } from '@eventstore-helpers/core';
import type { StreamConfig } from '@eventstore-helpers/core';
import { EventStoreDBClient } from '@eventstore/db-client';
import { BankAccount, BankAccountEvent, TransactionMetadata } from './types';
import { migrations } from './migrations';
import crypto from 'crypto';

export class AccountAggregate {
  private streamHelper: StreamHelper<BankAccount, BankAccountEvent>;
  private static SNAPSHOT_FREQUENCY = 5;
  public static readonly CURRENT_EVENT_VERSION = 1;

  constructor(streamHelper: StreamHelper<BankAccount, BankAccountEvent>) {
    this.streamHelper = streamHelper;
  }

  private applyEvent(state: BankAccount | null, event: BankAccountEvent): BankAccount {
    if (!state) {
      if (event.type !== 'AccountCreated') {
        throw new Error('First event must be AccountCreated');
      }
      return {
        id: event.data.id,
        owner: event.data.owner,
        balance: event.data.initialBalance,
        version: AccountAggregate.CURRENT_EVENT_VERSION,
        createdAt: event.data.timestamp,
        updatedAt: event.data.timestamp,
        accountType: 'accountType' in event.data ? event.data.accountType : 'checking',
        metadata: event.metadata,
        type: event.type,
        data: event.data
      };
    }

    switch (event.type) {
      case 'MoneyDeposited': {
        return {
          id: state.id,
          owner: state.owner,
          balance: state.balance + event.data.amount,
          version: AccountAggregate.CURRENT_EVENT_VERSION,
          createdAt: state.createdAt,
          updatedAt: event.data.timestamp,
          accountType: state.accountType,
          metadata: event.metadata,
          type: event.type,
          data: event.data
        };
      }

      case 'MoneyWithdrawn': {
        if (state.balance < event.data.amount) {
          throw new Error('Insufficient funds');
        }
        return {
          id: state.id,
          owner: state.owner,
          balance: state.balance - event.data.amount,
          version: AccountAggregate.CURRENT_EVENT_VERSION,
          createdAt: state.createdAt,
          updatedAt: event.data.timestamp,
          accountType: state.accountType,
          metadata: event.metadata,
          type: event.type,
          data: event.data
        };
      }

      default:
        throw new Error(`Unknown event type: ${(event as any).type}`);
    }
  }

  async createAccount(
    owner: string,
    initialBalance: number,
    accountType: 'savings' | 'checking' = 'checking',
    metadata?: TransactionMetadata
  ): Promise<string> {
    const accountId = crypto.randomUUID();
    const event: BankAccountEvent = {
      type: 'AccountCreated',
      version: AccountAggregate.CURRENT_EVENT_VERSION,
      data: {
        id: accountId,
        owner,
        initialBalance,
        accountType,
        timestamp: '2025-01-20T15:49:09-05:00',
      },
      metadata,
    };

    await this.streamHelper.appendEvent(accountId, event);
    return accountId;
  }

  async deposit(
    accountId: string,
    amount: number,
    description?: string,
    metadata?: TransactionMetadata
  ): Promise<void> {
    // Check current state first
    const result = await this.streamHelper.getCurrentState(accountId, this.applyEvent.bind(this));
    if (!result.state) {
      throw new Error('First event must be AccountCreated');
    }

    const event: BankAccountEvent = {
      type: 'MoneyDeposited',
      version: AccountAggregate.CURRENT_EVENT_VERSION,
      data: {
        amount,
        description,
        timestamp: '2025-01-20T15:49:09-05:00',
      },
      metadata,
    };

    await this.streamHelper.appendEvent(accountId, event);
  }

  async withdraw(
    accountId: string,
    amount: number,
    description?: string,
    metadata?: TransactionMetadata
  ): Promise<void> {
    // Check current state first
    const result = await this.streamHelper.getCurrentState(accountId, this.applyEvent.bind(this));
    if (!result.state) {
      throw new Error('First event must be AccountCreated');
    }
    if (result.state.balance < amount) {
      throw new Error('Insufficient funds');
    }

    const event: BankAccountEvent = {
      type: 'MoneyWithdrawn',
      version: AccountAggregate.CURRENT_EVENT_VERSION,
      data: {
        amount,
        description,
        timestamp: '2025-01-20T15:49:09-05:00',
      },
      metadata,
    };

    await this.streamHelper.appendEvent(accountId, event);
  }

  async getAccount(accountId: string): Promise<BankAccount | null> {
    const result = await this.streamHelper.getCurrentState(accountId, this.applyEvent.bind(this));
    return result?.state ?? null;
  }
}
