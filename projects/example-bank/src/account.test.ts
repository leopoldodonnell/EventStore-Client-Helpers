import { EventStoreDBClient } from '@eventstore/db-client';
import { AccountAggregate } from './account';
import { StreamHelper } from '@eventstore-helpers/core';
import { AccountEvent, BankAccount, TransactionMetadata } from './types';

// Mock crypto.randomUUID
const mockUUID = '123e4567-e89b-12d3-a456-426614174000';
global.crypto = {
  ...global.crypto,
  randomUUID: () => mockUUID
};

// Mock the StreamHelper
jest.mock('@eventstore-helpers/core', () => {
  const mockAppendEvent = jest.fn();
  const mockReadFromSnapshot = jest.fn();
  
  return {
    StreamHelper: jest.fn().mockImplementation(() => ({
      appendEvent: mockAppendEvent,
      readFromSnapshot: mockReadFromSnapshot,
    })),
  };
});

describe('AccountAggregate', () => {
  let client: EventStoreDBClient;
  let accountAggregate: AccountAggregate;
  let mockStreamHelper: jest.Mocked<StreamHelper<AccountEvent & { metadata?: TransactionMetadata }, BankAccount>>;

  beforeEach(() => {
    client = new EventStoreDBClient({ endpoint: 'localhost:2113' });
    accountAggregate = new AccountAggregate(client);
    mockStreamHelper = (StreamHelper as jest.Mock).mock.results[0].value;
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createAccount', () => {
    it('should create a new account with initial balance and metadata', async () => {
      const accountId = 'test-account';
      const owner = 'John Doe';
      const initialBalance = 1000;

      await accountAggregate.createAccount(accountId, owner, initialBalance);

      expect(mockStreamHelper.appendEvent).toHaveBeenCalledWith(
        accountId,
        {
          type: 'AccountCreated',
          data: {
            owner,
            initialBalance,
          },
          metadata: {
            userId: owner,
            transactionId: mockUUID,
            source: 'web'
          }
        }
      );
    });
  });

  describe('deposit', () => {
    it('should append deposit event with metadata', async () => {
      const accountId = 'test-account';
      const amount = 500;
      const userId = 'user-123';

      await accountAggregate.deposit(accountId, amount, userId);

      expect(mockStreamHelper.appendEvent).toHaveBeenCalledWith(
        accountId,
        {
          type: 'MoneyDeposited',
          data: { amount },
          metadata: {
            userId,
            transactionId: mockUUID,
            source: 'web'
          }
        }
      );
    });
  });

  describe('withdraw', () => {
    it('should append withdraw event with metadata', async () => {
      const accountId = 'test-account';
      const amount = 300;
      const userId = 'user-123';

      await accountAggregate.withdraw(accountId, amount, userId);

      expect(mockStreamHelper.appendEvent).toHaveBeenCalledWith(
        accountId,
        {
          type: 'MoneyWithdrawn',
          data: { amount },
          metadata: {
            userId,
            transactionId: mockUUID,
            source: 'web'
          }
        }
      );
    });
  });

  describe('getAccount', () => {
    it('should return null when account does not exist', async () => {
      mockStreamHelper.readFromSnapshot.mockResolvedValue(null);

      const result = await accountAggregate.getAccount('non-existent');
      expect(result).toBeNull();
    });

    it('should return account state when it exists', async () => {
      const mockAccount = {
        id: 'test-account',
        owner: 'John Doe',
        balance: 1000,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockStreamHelper.readFromSnapshot.mockResolvedValue({
        state: mockAccount,
        version: 1,
      });

      const result = await accountAggregate.getAccount('test-account');
      expect(result).toEqual(mockAccount);
    });

    it('should correctly apply events to rebuild account state', async () => {
      // Test the event application logic
      const accountId = 'test-account';
      const events: (AccountEvent & { metadata?: TransactionMetadata })[] = [
        {
          type: 'AccountCreated',
          data: { owner: 'John Doe', initialBalance: 1000 },
        },
        {
          type: 'MoneyDeposited',
          data: { amount: 500 },
        },
        {
          type: 'MoneyWithdrawn',
          data: { amount: 200 },
        },
      ];

      let currentState = null;
      for (const event of events) {
        currentState = accountAggregate['applyEvent'](currentState, event);
      }

      expect(currentState).toMatchObject({
        owner: 'John Doe',
        balance: 1300, // 1000 + 500 - 200
      });
    });

    it('should throw error when withdrawing more than balance', () => {
      const state = {
        id: 'test-account',
        owner: 'John Doe',
        balance: 100,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      expect(() =>
        accountAggregate['applyEvent'](state, {
          type: 'MoneyWithdrawn',
          data: { amount: 200 },
        })
      ).toThrow('Insufficient funds');
    });
  });
});
