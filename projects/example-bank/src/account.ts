import { StreamHelper } from '@eventstore-helpers/core';
import { EventStoreDBClient } from '@eventstore/db-client';
import { AccountEvent, BankAccount } from './types';

export class AccountAggregate {
  private streamHelper: StreamHelper<AccountEvent, BankAccount>;
  private static SNAPSHOT_FREQUENCY = 5;

  constructor(private client: EventStoreDBClient) {
    this.streamHelper = new StreamHelper<AccountEvent, BankAccount>(client, {
      streamPrefix: 'bank-account',
      snapshotFrequency: AccountAggregate.SNAPSHOT_FREQUENCY,
    });
  }

  private applyEvent(state: BankAccount | null, event: AccountEvent): BankAccount {
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
    const event: AccountEvent = {
      type: 'AccountCreated',
      data: {
        owner,
        initialBalance,
      },
    };

    await this.streamHelper.appendEvent(accountId, event);
  }

  async deposit(accountId: string, amount: number): Promise<void> {
    const event: AccountEvent = {
      type: 'MoneyDeposited',
      data: { amount },
    };

    await this.streamHelper.appendEvent(accountId, event);
  }

  async withdraw(accountId: string, amount: number): Promise<void> {
    const event: AccountEvent = {
      type: 'MoneyWithdrawn',
      data: { amount },
    };

    await this.streamHelper.appendEvent(accountId, event);
  }

  async getAccount(accountId: string): Promise<BankAccount | null> {
    const result = await this.streamHelper.readFromSnapshot(accountId, this.applyEvent.bind(this));
    return result?.state ?? null;
  }
}
