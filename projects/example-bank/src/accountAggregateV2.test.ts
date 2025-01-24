import { EventStoreDBClient } from '@eventstore/db-client';
import { AccountAggregateV2 } from './accountAggregateV2';
import { BankAccount, BankAccountEvent } from './types';

const mockUUID = 'test-uuid';
jest.mock('crypto', () => ({
  randomUUID: () => mockUUID
}));

describe('AccountAggregateV2', () => {
  let mockClient: jest.Mocked<EventStoreDBClient>;
  let accountAggregate: AccountAggregateV2;
  let mockTransaction: any;

  beforeEach(() => {
    mockTransaction = {
      appendToStream: jest.fn().mockResolvedValue(undefined),
      commit: jest.fn().mockResolvedValue(undefined),
    };

    mockClient = {
      startTransaction: jest.fn().mockResolvedValue(mockTransaction),
      readStream: jest.fn().mockResolvedValue([]),
    } as any;

    accountAggregate = new AccountAggregateV2(mockClient);
  });

  describe('createAccount', () => {
    it('should create a new account with initial balance', async () => {
      const owner = 'John Doe';
      const initialBalance = 1000;
      const accountType = 'checking';
      const metadata = { 
        userId: 'test-user',
        source: 'test',
        transactionId: 'test-uuid'
      };

      const accountId = await accountAggregate.createAccount(owner, initialBalance, accountType, metadata);
      expect(accountId).toBe('test-uuid');

      // Verify transaction was started and committed
      expect(mockClient.startTransaction).toHaveBeenCalled();
      expect(mockTransaction.commit).toHaveBeenCalled();

      // Verify events were appended
      expect(mockTransaction.appendToStream).toHaveBeenCalledWith(
        'account-test-uuid',
        expect.arrayContaining([
          expect.objectContaining({
            type: 'AccountCreated',
            data: expect.objectContaining({
              type: 'AccountCreated',
              version: 1,
              data: {
                id: 'test-uuid',
                owner,
                initialBalance,
                accountType,
                timestamp: expect.any(String),
              },
              metadata,
            }),
          }),
        ])
      );
    });
  });

  describe('deposit', () => {
    it('should deposit money into account', async () => {
      const accountId = 'test-uuid';
      const amount = 500;
      const description = 'Salary deposit';
      const metadata = { userId: 'test-user', transactionId: 'test-uuid', source: 'test' };

      // Mock current state
      const mockState: BankAccount = {
        id: accountId,
        owner: 'John Doe',
        balance: 1000,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        accountType: 'checking',
        type: 'AccountCreated',
        data: {},
        metadata: {},
      };

      mockClient.readStream = jest.fn().mockResolvedValue([{
        event: {
          type: 'AccountCreated',
          data: mockState,
        },
      }]);

      await accountAggregate.deposit(accountId, amount, description, metadata);

      // Verify transaction was started and committed
      expect(mockClient.startTransaction).toHaveBeenCalled();
      expect(mockTransaction.commit).toHaveBeenCalled();

      // Verify events were appended
      expect(mockTransaction.appendToStream).toHaveBeenCalledWith(
        'account-test-uuid',
        expect.arrayContaining([
          expect.objectContaining({
            type: 'MoneyDeposited',
            data: expect.objectContaining({
              type: 'MoneyDeposited',
              version: 1,
              data: {
                amount,
                description,
                timestamp: expect.any(String),
              },
              metadata,
            }),
          }),
        ])
      );
    });

    it('should handle transaction rollback on error', async () => {
      const accountId = 'test-uuid';
      const amount = 500;

      mockTransaction.commit.mockRejectedValueOnce(new Error('Commit failed'));

      await expect(accountAggregate.deposit(accountId, amount)).rejects.toThrow('Commit failed');
    });
  });

  describe('withdraw', () => {
    it('should withdraw money from account', async () => {
      const accountId = 'test-uuid';
      const amount = 500;
      const description = 'ATM withdrawal';
      const metadata = { userId: 'test-user', transactionId: 'test-uuid', source: 'test' };

      // Mock current state
      const mockState: BankAccount = {
        id: accountId,
        owner: 'John Doe',
        balance: 1000,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        accountType: 'checking',
        type: 'AccountCreated',
        data: {},
        metadata: {},
      };

      mockClient.readStream = jest.fn().mockResolvedValue([{
        event: {
          type: 'AccountCreated',
          data: mockState,
        },
      }]);

      await accountAggregate.withdraw(accountId, amount, description, metadata);

      // Verify transaction was started and committed
      expect(mockClient.startTransaction).toHaveBeenCalled();
      expect(mockTransaction.commit).toHaveBeenCalled();

      // Verify events were appended
      expect(mockTransaction.appendToStream).toHaveBeenCalledWith(
        'account-test-uuid',
        expect.arrayContaining([
          expect.objectContaining({
            type: 'MoneyWithdrawn',
            data: expect.objectContaining({
              type: 'MoneyWithdrawn',
              version: 1,
              data: {
                amount,
                description,
                timestamp: expect.any(String),
              },
              metadata,
            }),
          }),
        ])
      );
    });

    it('should prevent withdrawal if insufficient funds', async () => {
      const accountId = 'test-uuid';
      const amount = 1500;

      // Mock current state with insufficient balance
      const mockState: BankAccount = {
        id: accountId,
        owner: 'John Doe',
        balance: 1000,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        accountType: 'checking',
        type: 'AccountCreated',
        data: {},
        metadata: {},
      };

      mockClient.readStream = jest.fn().mockResolvedValue([{
        event: {
          type: 'AccountCreated',
          data: mockState,
        },
      }]);

      await expect(accountAggregate.withdraw(accountId, amount)).rejects.toThrow('Insufficient funds');
    });
  });
});
