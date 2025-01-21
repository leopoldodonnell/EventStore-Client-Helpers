import { EventStoreDBClient } from '@eventstore/db-client';
import { StreamHelper } from '@eventstore-helpers/core';
import { AccountAggregate } from './account';
import { BankAccount, BankAccountEvent, TransactionMetadata } from './types';

const mockUUID = 'test-uuid';
jest.mock('crypto', () => ({
  randomUUID: () => mockUUID
}));

// Create a mock class that extends StreamHelper
class MockStreamHelper extends StreamHelper<BankAccount, BankAccountEvent> {
  constructor() {
    super({} as EventStoreDBClient, {
      snapshotFrequency: 0,
      currentEventVersion: 1,
      eventMigrations: []
    });
  }

  appendEvent = jest.fn();
  getLatestSnapshot = jest.fn();
  getCurrentState = jest.fn();
}

describe('AccountAggregate', () => {
  let mockStreamHelper: MockStreamHelper;
  let accountAggregate: AccountAggregate;

  beforeEach(() => {
    mockStreamHelper = new MockStreamHelper();
    accountAggregate = new AccountAggregate(mockStreamHelper);
  });

  describe('createAccount', () => {
    it('should create a new account with initial balance', async () => {
      const owner = 'John Doe';
      const initialBalance = 1000;
      const accountType = 'checking';
      const metadata: TransactionMetadata = { 
        userId: 'test-user',
        source: 'test',
        transactionId: mockUUID
      };

      await accountAggregate.createAccount(owner, initialBalance, accountType, metadata);

      expect(mockStreamHelper.appendEvent).toHaveBeenCalledWith(
        mockUUID,
        {
          type: 'AccountCreated',
          version: 1,
          data: {
            id: mockUUID,
            owner,
            initialBalance,
            accountType,
            timestamp: '2025-01-20T15:49:09-05:00',
          },
          metadata,
        }
      );
    });
  });

  describe('deposit', () => {
    it('should deposit money into account', async () => {
      const accountId = 'test-account';
      const amount = 500;
      const description = 'Salary deposit';
      const metadata = { userId: 'test-user', transactionId: 'test-uuid', source: 'test' };

      mockStreamHelper.getCurrentState.mockResolvedValue({
        state: {
          id: accountId,
          owner: 'John Doe',
          balance: 1000,
          version: 1,
          createdAt: '2025-01-20T15:49:09-05:00',
          updatedAt: '2025-01-20T15:49:09-05:00',
          accountType: 'checking',
          metadata: {},
          type: 'AccountCreated',
          data: {
            id: accountId,
            owner: 'John Doe',
            initialBalance: 1000,
            timestamp: '2025-01-20T15:49:09-05:00'
          }
        },
        version: 1
      });

      await accountAggregate.deposit(accountId, amount, description, metadata);

      expect(mockStreamHelper.appendEvent).toHaveBeenCalledWith(
        accountId,
        {
          type: 'MoneyDeposited',
          version: 1,
          data: {
            amount,
            description,
            timestamp: '2025-01-20T15:49:09-05:00',
          },
          metadata
        }
      );
    });

    it('should throw error when first event is not AccountCreated', async () => {
      const accountId = 'test-account';
      const amount = 500;
      const description = 'Salary deposit';
      const metadata = { userId: 'test-user', transactionId: 'test-uuid', source: 'test' };

      mockStreamHelper.getCurrentState.mockResolvedValue({ state: null, version: 0 });

      await expect(accountAggregate.deposit(accountId, amount, description, metadata))
        .rejects
        .toThrow('First event must be AccountCreated');
    });
  });

  describe('withdraw', () => {
    it('should withdraw money from account', async () => {
      const accountId = 'test-account';
      const amount = 500;
      const description = 'ATM withdrawal';
      const metadata = { userId: 'test-user', transactionId: 'test-uuid', source: 'test' };

      mockStreamHelper.getCurrentState.mockResolvedValue({
        state: {
          id: accountId,
          owner: 'John Doe',
          balance: 1000,
          version: 1,
          createdAt: '2025-01-20T15:49:09-05:00',
          updatedAt: '2025-01-20T15:49:09-05:00',
          accountType: 'checking',
          metadata: {},
          type: 'AccountCreated',
          data: {
            id: accountId,
            owner: 'John Doe',
            initialBalance: 1000,
            timestamp: '2025-01-20T15:49:09-05:00'
          }
        },
        version: 1
      });

      await accountAggregate.withdraw(accountId, amount, description, metadata);

      expect(mockStreamHelper.appendEvent).toHaveBeenCalledWith(
        accountId,
        {
          type: 'MoneyWithdrawn',
          version: 1,
          data: {
            amount,
            description,
            timestamp: '2025-01-20T15:49:09-05:00',
          },
          metadata
        }
      );
    });

    it('should throw error when withdrawing more than balance', async () => {
      const accountId = 'test-account';
      const amount = 1500;
      const description = 'ATM withdrawal';
      const metadata = { userId: 'test-user', transactionId: 'test-uuid', source: 'test' };

      mockStreamHelper.getCurrentState.mockResolvedValue({
        state: {
          id: accountId,
          owner: 'John Doe',
          balance: 1000,
          version: 1,
          createdAt: '2025-01-20T15:49:09-05:00',
          updatedAt: '2025-01-20T15:49:09-05:00',
          accountType: 'checking',
          metadata: {},
          type: 'AccountCreated',
          data: {
            id: accountId,
            owner: 'John Doe',
            initialBalance: 1000,
            timestamp: '2025-01-20T15:49:09-05:00'
          }
        },
        version: 1
      });

      await expect(accountAggregate.withdraw(accountId, amount, description, metadata))
        .rejects
        .toThrow('Insufficient funds');
    });
  });

  describe('getAccount', () => {
    it('should return null for non-existent account', async () => {
      const accountId = 'non-existent';
      mockStreamHelper.getCurrentState.mockResolvedValue({ state: null, version: 0 });

      const result = await accountAggregate.getAccount(accountId);
      expect(result).toBeNull();
    });

    it('should return account state for existing account', async () => {
      const accountId = 'test-account';
      const mockAccount: BankAccount = {
        id: accountId,
        owner: 'John Doe',
        balance: 1000,
        version: 1,
        createdAt: '2025-01-20T16:46:27-05:00',
        updatedAt: '2025-01-20T16:46:27-05:00',
        accountType: 'checking',
        type: 'BankAccount',
        data: {}
      };

      mockStreamHelper.getCurrentState.mockResolvedValue({
        state: mockAccount,
        version: 1
      });

      const result = await accountAggregate.getAccount(accountId);
      expect(result).toEqual(mockAccount);
    });
  });

  describe('applyEvent', () => {
    it('should throw error for unknown event type', async () => {
      const accountId = 'test-account';
      const state: BankAccount = {
        id: accountId,
        owner: 'John Doe',
        balance: 1000,
        version: 1,
        createdAt: '2025-01-20T15:49:09-05:00',
        updatedAt: '2025-01-20T15:49:09-05:00',
        accountType: 'checking',
        metadata: {},
        type: 'AccountCreated',
        data: {
          id: accountId,
          owner: 'John Doe',
          initialBalance: 1000,
          timestamp: '2025-01-20T15:49:09-05:00'
        }
      };

      const unknownEvent = {
        type: 'UnknownEvent',
        version: 1,
        data: {
          amount: 100,
          timestamp: '2025-01-20T15:49:09-05:00'
        }
      } as unknown as BankAccountEvent;

      expect(() => accountAggregate['applyEvent'](state, unknownEvent))
        .toThrow('Unknown event type: UnknownEvent');
    });
  });
});
