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
  const mockGetCurrentState = jest.fn();
  
  return {
    StreamHelper: jest.fn().mockImplementation(() => ({
      appendEvent: mockAppendEvent,
      getCurrentState: mockGetCurrentState,
    })),
  };
});

describe('AccountAggregate', () => {
  let client: EventStoreDBClient;
  let accountAggregate: AccountAggregate;
  let mockStreamHelper: jest.Mocked<StreamHelper<BankAccount, AccountEvent>>;

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
          version: 1,
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
          version: 1,
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
          version: 1,
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
    it('should apply events to calculate current state', async () => {
      const events: AccountEvent[] = [
        {
          type: 'AccountCreated',
          version: 1,
          data: { owner: 'John Doe', initialBalance: 1000 },
        },
        {
          type: 'MoneyDeposited',
          version: 1,
          data: { amount: 500 },
        },
        {
          type: 'MoneyWithdrawn',
          version: 1,
          data: { amount: 200 },
        },
      ];

      const state: BankAccount = {
        id: 'test-account',
        owner: 'John Doe',
        balance: 1300,
        createdAt: new Date(),
        updatedAt: new Date(),
        accountType: 'checking'
      };

      mockStreamHelper.getCurrentState.mockResolvedValue({ state, version: 1 });

      const account = await accountAggregate.getAccount('test-account');

      expect(account).toEqual(state);
    });

    it('should throw error when withdrawing more than balance', () => {
      const state: BankAccount = {
        id: 'test-account',
        owner: 'John Doe',
        balance: 100,
        createdAt: new Date(),
        updatedAt: new Date(),
        accountType: 'checking'
      };

      expect(() =>
        accountAggregate['applyEvent'](state, {
          type: 'MoneyWithdrawn',
          version: 1,
          data: { amount: 200 },
        })
      ).toThrow('Insufficient funds');
    });

    it('should apply events to calculate current state', async () => {
      const events = [
        {
          type: 'MoneyDeposited',
          version: 1,
          data: { amount: 500 },
        },
        {
          type: 'MoneyWithdrawn',
          version: 1,
          data: { amount: 200 },
        },
      ];

      mockStreamHelper.getCurrentState.mockResolvedValue({
        state: {
          id: '',
          owner: 'John Doe',
          balance: 300,
          createdAt: new Date('2025-01-20T09:52:01-05:00'),
          updatedAt: new Date('2025-01-20T09:52:01-05:00'),
          accountType: 'checking'
        },
        version: 2
      });

      const account = await accountAggregate.getAccount('test-account');

      expect(account).toEqual({
        id: '',
        owner: 'John Doe',
        balance: 300,
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
        accountType: 'checking'
      });
    });
  });
});
