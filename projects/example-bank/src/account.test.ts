import { EventStoreDBClient } from '@eventstore/db-client';
import { StreamHelper } from '@eventstore-helpers/core';
import { AccountAggregate } from './account';
import { BankAccount, BankAccountEvent, TransactionMetadata } from './types';

const mockUUID = 'test-uuid';
jest.mock('crypto', () => ({
  randomUUID: () => mockUUID
}));

describe('AccountAggregate', () => {
  let mockStreamHelper: jest.Mocked<StreamHelper<BankAccount, BankAccountEvent>>;
  let accountAggregate: AccountAggregate;

  beforeEach(() => {
    mockStreamHelper = {
      appendEvent: jest.fn().mockResolvedValue(undefined),
      getCurrentState: jest.fn().mockResolvedValue({
        state: {
          id: 'account-test-uuid',
          owner: 'John Doe',
          balance: 1000,
          version: 1,
          createdAt: '2025-01-20T15:49:09-05:00',
          updatedAt: '2025-01-20T15:49:09-05:00',
          accountType: 'checking',
          metadata: {},
          type: 'AccountCreated',
          data: {
            id: 'account-test-uuid',
            owner: 'John Doe',
            initialBalance: 1000,
            timestamp: '2025-01-20T15:49:09-05:00'
          }
        },
        version: 1
      }),
    } as unknown as jest.Mocked<StreamHelper<BankAccount, BankAccountEvent>>;

    accountAggregate = new AccountAggregate(mockStreamHelper);
  });

  describe('createAccount', () => {
    it('should create a new account with initial balance', async () => {
      const accountId = 'test-uuid';
      const owner = 'John Doe';
      const initialBalance = 1000;
      const accountType = 'checking';
      const metadata: TransactionMetadata = { 
        userId: 'test-user',
        source: 'test',
        transactionId: 'test-uuid'
      };

      await accountAggregate.createAccount(accountId, owner, initialBalance, accountType, metadata);

      expect(mockStreamHelper.appendEvent).toHaveBeenCalledWith(
        'account-test-uuid',
        expect.objectContaining({
          type: 'AccountCreated',
          version: 1,
          data: expect.objectContaining({
            id: 'account-test-uuid',
            owner,
            initialBalance,
            accountType,
          }),
          metadata,
        })
      );
    });
  });

  describe('deposit', () => {
    it('should deposit money into an account', async () => {
      const accountId = 'test-uuid';
      const amount = 500;
      const description = 'Salary deposit';
      const metadata: TransactionMetadata = { 
        userId: 'test-user',
        source: 'test',
        transactionId: 'test-uuid'
      };

      await accountAggregate.deposit(accountId, amount, description, metadata);

      expect(mockStreamHelper.appendEvent).toHaveBeenCalledWith(
        'account-test-uuid',
        expect.objectContaining({
          type: 'MoneyDeposited',
          version: 1,
          data: expect.objectContaining({
            amount,
            description,
          }),
          metadata,
        })
      );
    });

    it('should fail to deposit to non-existent account', async () => {
      const accountId = 'non-existent';
      const metadata: TransactionMetadata = { 
        userId: 'test-user',
        source: 'test',
        transactionId: 'test-uuid'
      };

      mockStreamHelper.getCurrentState.mockResolvedValueOnce({ state: null, version: -1 });
      
      await expect(accountAggregate.deposit(accountId, 500, 'Salary deposit', metadata))
        .rejects.toThrow('Account not found');
    });
  });

  describe('withdraw', () => {
    it('should withdraw money from an account', async () => {
      const accountId = 'test-uuid';
      const amount = 500;
      const description = 'ATM withdrawal';
      const metadata: TransactionMetadata = { 
        userId: 'test-user',
        source: 'test',
        transactionId: 'test-uuid'
      };

      await accountAggregate.withdraw(accountId, amount, description, metadata);

      expect(mockStreamHelper.appendEvent).toHaveBeenCalledWith(
        'account-test-uuid',
        expect.objectContaining({
          type: 'MoneyWithdrawn',
          version: 1,
          data: expect.objectContaining({
            amount,
            description,
          }),
          metadata,
        })
      );
    });

    it('should fail to withdraw from non-existent account', async () => {
      const accountId = 'non-existent';
      const metadata: TransactionMetadata = { 
        userId: 'test-user',
        source: 'test',
        transactionId: 'test-uuid'
      };

      mockStreamHelper.getCurrentState.mockResolvedValueOnce({ state: null, version: -1 });
      
      await expect(accountAggregate.withdraw(accountId, 500, 'ATM withdrawal', metadata))
        .rejects.toThrow('Account not found');
    });

    it('should fail to withdraw more than balance', async () => {
      const accountId = 'test-uuid';
      const metadata: TransactionMetadata = { 
        userId: 'test-user',
        source: 'test',
        transactionId: 'test-uuid'
      };

      await accountAggregate.createAccount(accountId, 'John Doe', 1000, 'checking', metadata);
      await expect(accountAggregate.withdraw(accountId, 1500, 'ATM withdrawal', metadata))
        .rejects.toThrow('Insufficient funds');
    });
  });

  describe('getAccount', () => {
    it('should return null for non-existent account', async () => {
      const accountId = 'non-existent';
      mockStreamHelper.getCurrentState.mockResolvedValueOnce({ state: null, version: -1 });
      const account = await accountAggregate.getAccount(accountId);
      expect(account).toBeNull();
    });

    it('should return account state for existing account', async () => {
      const accountId = 'test-uuid';
      const account = await accountAggregate.getAccount(accountId);
      expect(account).toEqual(expect.objectContaining({
        id: 'account-test-uuid',
        owner: 'John Doe',
        balance: 1000,
        accountType: 'checking',
      }));
    });
  });

  describe('applyEvent', () => {
    it('should throw error for unknown event type', async () => {
      const accountId = 'test-uuid';
      const state: BankAccount = {
        id: 'account-test-uuid',
        owner: 'John Doe',
        balance: 1000,
        version: 1,
        createdAt: '2025-01-20T15:49:09-05:00',
        updatedAt: '2025-01-20T15:49:09-05:00',
        accountType: 'checking',
        metadata: {},
        type: 'AccountCreated',
        data: {
          id: 'account-test-uuid',
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
