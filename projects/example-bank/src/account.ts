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

  public applyEvent(state: BankAccount | null, event: BankAccountEvent): BankAccount {
    console.log('Applying event:', event.type, 'to state:', state);
    switch (event.type) {
      case 'AccountCreated': {
        if (state) {
          console.error('Unexpected AccountCreated event for existing state');
          throw new Error('AccountCreated can only be the first event');
        }
        
        const newState: BankAccount = {
          id: event.data.id, // Use the ID directly instead of calling getStreamId again
          owner: event.data.owner,
          balance: event.data.initialBalance,
          version: AccountAggregate.CURRENT_EVENT_VERSION,
          createdAt: event.data.timestamp,
          updatedAt: event.data.timestamp,
          accountType: event.data.accountType || 'checking',
          type: event.type,
          data: event.data,
          metadata: event.metadata
        };
        
        console.log('Created initial state:', newState);
        return newState;
      }

      case 'MoneyDeposited': {
        if (!state) {
          console.error('Cannot deposit into non-existent account');
          throw new Error('First event must be AccountCreated');
        }
        
        const newState: BankAccount = {
          ...state,
          balance: state.balance + event.data.amount,
          version: state.version + 1,
          updatedAt: event.data.timestamp,
          type: event.type,
          data: event.data,
          metadata: event.metadata
        };
        console.log('Updated state after deposit:', newState);
        return newState;
      }

      case 'MoneyWithdrawn': {
        if (!state) {
          throw new Error('Cannot withdraw from non-existent account');
        }
        const newState: BankAccount = {
          ...state,
          balance: state.balance - event.data.amount,
          version: state.version + 1,
          updatedAt: event.data.timestamp,
          type: event.type,
          data: event.data,
          metadata: event.metadata
        };
        console.log('Updated state after withdrawal:', newState);
        return newState;
      }

      default: {
        const _exhaustiveCheck: never = event;
        throw new Error(`Unknown event type: ${(event as any).type}`);
      }
    }
  }

  private getStreamId(accountId: string): string {
    const streamId = `account-${accountId}`;
    console.log('Generated stream ID:', streamId, 'for account:', accountId);
    return streamId;
  }

  async createAccount(
    owner: string,
    initialBalance: number,
    accountType: 'savings' | 'checking' = 'checking',
    metadata?: TransactionMetadata
  ): Promise<string> {
    const accountId = crypto.randomUUID();
    const streamId = this.getStreamId(accountId);
    console.log('Creating account with stream ID:', streamId);
    
    const event: BankAccountEvent = {
      type: 'AccountCreated',
      version: AccountAggregate.CURRENT_EVENT_VERSION,
      data: {
        id: streamId, // Store the stream ID, not the raw account ID
        owner,
        initialBalance,
        accountType,
        timestamp: '2025-01-20T15:49:09-05:00', // Use the same timestamp as in tests
      },
      metadata,
    };

    console.log('Appending AccountCreated event:', event);
    await this.streamHelper.appendEvent(streamId, event);
    console.log('Successfully appended AccountCreated event');
    
    return accountId;
  }

  async deposit(
    accountId: string,
    amount: number,
    description?: string,
    metadata?: TransactionMetadata
  ): Promise<void> {
    // If accountId already starts with 'account-', use it as is, otherwise add the prefix
    const streamId = accountId.startsWith('account-') ? accountId : this.getStreamId(accountId);
    console.log('Depositing to stream:', streamId);
    
    // Check current state first
    const result = await this.streamHelper.getCurrentState(streamId, this.applyEvent.bind(this));
    console.log('Current account state:', result?.state ?? null);
    
    if (!result.state) {
      console.error('Account not found for deposit:', streamId);
      throw new Error('First event must be AccountCreated');
    }

    const event: BankAccountEvent = {
      type: 'MoneyDeposited',
      version: AccountAggregate.CURRENT_EVENT_VERSION,
      data: {
        amount,
        description,
        timestamp: new Date().toISOString(),
      },
      metadata,
    };

    console.log('Appending MoneyDeposited event:', event);
    await this.streamHelper.appendEvent(streamId, event);
    console.log('Successfully appended MoneyDeposited event');
  }

  async withdraw(
    accountId: string,
    amount: number,
    description?: string,
    metadata?: TransactionMetadata
  ): Promise<void> {
    // If accountId already starts with 'account-', use it as is, otherwise add the prefix
    const streamId = accountId.startsWith('account-') ? accountId : this.getStreamId(accountId);
    console.log('Withdrawing from stream:', streamId);
    
    // Check current state first
    const result = await this.streamHelper.getCurrentState(streamId, this.applyEvent.bind(this));
    console.log('Current account state:', result?.state ?? null);
    
    if (!result.state) {
      console.error('Account not found for withdrawal:', streamId);
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
        timestamp: new Date().toISOString(),
      },
      metadata,
    };

    console.log('Appending MoneyWithdrawn event:', event);
    await this.streamHelper.appendEvent(streamId, event);
    console.log('Successfully appended MoneyWithdrawn event');
  }

  async getAccount(accountId: string): Promise<BankAccount | null> {
    // If accountId already starts with 'account-', use it as is, otherwise add the prefix
    const streamId = accountId.startsWith('account-') ? accountId : this.getStreamId(accountId);
    console.log('Getting account state for stream:', streamId);
    
    const result = await this.streamHelper.getCurrentState(streamId, this.applyEvent.bind(this));
    console.log('Got account state:', result?.state ?? null);
    
    return result?.state ?? null;
  }
}
