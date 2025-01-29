import {
  AppendResult,
  DeleteResult,
  EventStoreDBClient,
  EventType,
  GetStreamMetadataResult,
  NO_STREAM,
  ResolvedEvent,
  StreamingRead
} from '@eventstore/db-client';
import crypto from 'crypto';
import { AccountAggregateV2 } from './accountAggregateV2';
import { BankAccount, BankAccountEvent, TransactionMetadata } from './types';
import { jest } from '@jest/globals';

jest.mock('@eventstore-helpers/core', () => {
  let pendingEvents: any[] = [];
  return {
    AggregateHelper: jest.fn().mockImplementation(function(this: any, ...args: any[]) {
      const client = args[0] as EventStoreDBClient;
      return {
        beginTransaction: jest.fn(),
        addEvent: jest.fn().mockImplementation(async (...args: unknown[]) => {
          pendingEvents.push(args[1]);
          return Promise.resolve();
        }),
        commitTransaction: jest.fn().mockImplementation(async (...args: unknown[]) => {
          await client.appendToStream(
            `account-${args[0]}`,
            pendingEvents.map(event => ({
              id: crypto.randomUUID(),
              contentType: 'application/json',
              type: event.type,
              data: event.data,
              metadata: event.metadata
            })),
            { expectedRevision: NO_STREAM }
          );
          pendingEvents = [];
          return Promise.resolve();
        }),
        rollbackTransaction: jest.fn().mockImplementation(() => {
          pendingEvents = [];
          return Promise.resolve();
        }),
        getCurrentState: jest.fn()
      };
    })
  };
});

jest.mock('@eventstore/db-client');

jest.mock('crypto', () => ({
  randomUUID: jest.fn()
    .mockReturnValueOnce('test-uuid')
    .mockReturnValueOnce('test-transaction-uuid')
}));

describe('AccountAggregateV2', () => {
  let mockClient: EventStoreDBClient;
  let accountAggregate: AccountAggregateV2;

  beforeEach(() => {
    const mockReadStream = {
      [Symbol.asyncIterator]: () => ({
        next: () => Promise.resolve({ done: true, value: undefined })
      }),
      cancel: jest.fn(),
      on: jest.fn(),
      once: jest.fn(),
      off: jest.fn()
    } as unknown as StreamingRead<ResolvedEvent<EventType>>;

    const appendResult = {
      success: true,
      nextExpectedRevision: BigInt(1),
      position: { commit: BigInt(1), prepare: BigInt(1) }
    } as AppendResult;

    const metadataResult = {
      streamName: '$all',
      metadata: {},
      revision: BigInt(0)
    } as GetStreamMetadataResult;

    const deleteResult = {
      position: { commit: BigInt(1), prepare: BigInt(1) }
    } as DeleteResult;

    mockClient = {
      readStream: jest.fn().mockReturnValue(mockReadStream),
      appendToStream: jest.fn().mockReturnValue(Promise.resolve(appendResult)),
      getStreamMetadata: jest.fn().mockReturnValue(Promise.resolve(metadataResult)),
      setStreamMetadata: jest.fn().mockReturnValue(Promise.resolve(appendResult)),
      deleteStream: jest.fn().mockReturnValue(Promise.resolve(deleteResult))
    } as unknown as jest.Mocked<EventStoreDBClient>;

    accountAggregate = new AccountAggregateV2(mockClient);
  });

  it('should create a new account with initial balance', async () => {
    const owner = 'John Doe';
    const initialBalance = 1000;
    const accountType = 'checking';
    const metadata: TransactionMetadata = {
      userId: 'test-user',
      source: 'test',
      transactionId: 'test-transaction'
    };

    const accountId = await accountAggregate.createAccount(owner, initialBalance, accountType, metadata);

    expect(accountId).toBe('test-uuid');
    expect(mockClient.appendToStream).toHaveBeenCalledWith(
      'account-test-uuid',
      [
        expect.objectContaining({
          type: 'AccountCreated',
          data: expect.objectContaining({
            id: 'test-uuid',
            owner: 'John Doe',
            initialBalance: 1000,
            accountType: 'checking'
          }),
          metadata
        })
      ],
      expect.objectContaining({
        expectedRevision: NO_STREAM
      })
    );
  });

  it('should deposit money into an existing account', async () => {
    // Mock getCurrentState to return an existing account
    const mockState = {
      id: 'test-uuid',
      owner: 'John Doe',
      balance: 1000,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      accountType: 'checking',
      type: 'AccountCreated',
      data: {},
      metadata: {}
    };
    
    (accountAggregate as any).aggregateHelper.getCurrentState.mockResolvedValueOnce({
      state: mockState,
      version: 1
    });

    const metadata: TransactionMetadata = {
      userId: 'test-user',
      source: 'test',
      transactionId: 'test-transaction'
    };

    await accountAggregate.deposit('test-uuid', 500, 'Test deposit', metadata);

    expect(mockClient.appendToStream).toHaveBeenCalledWith(
      'account-test-uuid',
      [
        expect.objectContaining({
          type: 'MoneyDeposited',
          data: expect.objectContaining({
            amount: 500,
            description: 'Test deposit'
          }),
          metadata
        })
      ],
      expect.any(Object)
    );
  });

  it('should fail to deposit when account does not exist', async () => {
    (accountAggregate as any).aggregateHelper.getCurrentState.mockResolvedValueOnce({
      state: null,
      version: -1
    });

    await expect(accountAggregate.deposit('non-existent', 500)).rejects.toThrow('First event must be AccountCreated');
  });

  it('should withdraw money from an existing account', async () => {
    const mockState = {
      id: 'test-uuid',
      owner: 'John Doe',
      balance: 1000,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      accountType: 'checking',
      type: 'AccountCreated',
      data: {},
      metadata: {}
    };
    
    (accountAggregate as any).aggregateHelper.getCurrentState.mockResolvedValueOnce({
      state: mockState,
      version: 1
    });

    const metadata: TransactionMetadata = {
      userId: 'test-user',
      source: 'test',
      transactionId: 'test-transaction'
    };

    await accountAggregate.withdraw('test-uuid', 500, 'Test withdrawal', metadata);

    expect(mockClient.appendToStream).toHaveBeenCalledWith(
      'account-test-uuid',
      [
        expect.objectContaining({
          type: 'MoneyWithdrawn',
          data: expect.objectContaining({
            amount: 500,
            description: 'Test withdrawal'
          }),
          metadata
        })
      ],
      expect.any(Object)
    );
  });

  it('should fail to withdraw when account does not exist', async () => {
    (accountAggregate as any).aggregateHelper.getCurrentState.mockResolvedValueOnce({
      state: null,
      version: -1
    });

    await expect(accountAggregate.withdraw('non-existent', 500)).rejects.toThrow('First event must be AccountCreated');
  });

  it('should fail to withdraw when insufficient funds', async () => {
    const mockState = {
      id: 'test-uuid',
      owner: 'John Doe',
      balance: 100,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      accountType: 'checking',
      type: 'AccountCreated',
      data: {},
      metadata: {}
    };
    
    (accountAggregate as any).aggregateHelper.getCurrentState.mockResolvedValueOnce({
      state: mockState,
      version: 1
    });

    await expect(accountAggregate.withdraw('test-uuid', 500)).rejects.toThrow('Insufficient funds');
  });

  it('should get an existing account', async () => {
    const mockState = {
      id: 'test-uuid',
      owner: 'John Doe',
      balance: 1000,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      accountType: 'checking',
      type: 'AccountCreated',
      data: {},
      metadata: {}
    };
    
    (accountAggregate as any).aggregateHelper.getCurrentState.mockResolvedValueOnce({
      state: mockState,
      version: 1
    });

    const account = await accountAggregate.getAccount('test-uuid');
    expect(account).toEqual(mockState);
  });

  it('should return null for non-existent account', async () => {
    (accountAggregate as any).aggregateHelper.getCurrentState.mockResolvedValueOnce({
      state: null,
      version: -1
    });

    const account = await accountAggregate.getAccount('non-existent');
    expect(account).toBeNull();
  });

  describe('applyEvent', () => {
    it('should fail when AccountCreated is not the first event', () => {
      const event: BankAccountEvent = {
        type: 'AccountCreated',
        version: 1,
        data: {
          id: 'test-uuid',
          owner: 'John Doe',
          initialBalance: 1000,
          accountType: 'checking',
          timestamp: new Date().toISOString()
        }
      };

      const state = {
        id: 'test-uuid',
        owner: 'John Doe',
        balance: 1000,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        accountType: 'checking',
        type: 'AccountCreated',
        data: {},
        metadata: {}
      };

      expect(() => (accountAggregate as any).applyEvent(state, event)).toThrow('AccountCreated can only be the first event');
    });

    it('should fail when MoneyDeposited is the first event', () => {
      const event: BankAccountEvent = {
        type: 'MoneyDeposited',
        version: 1,
        data: {
          amount: 500,
          description: 'Test deposit',
          timestamp: new Date().toISOString()
        }
      };

      expect(() => (accountAggregate as any).applyEvent(null, event)).toThrow('First event must be AccountCreated');
    });

    it('should fail when MoneyWithdrawn is the first event', () => {
      const event: BankAccountEvent = {
        type: 'MoneyWithdrawn',
        version: 1,
        data: {
          amount: 500,
          description: 'Test withdrawal',
          timestamp: new Date().toISOString()
        }
      };

      expect(() => (accountAggregate as any).applyEvent(null, event)).toThrow('First event must be AccountCreated');
    });

    it('should throw on unknown event type', () => {
      const event = {
        type: 'UnknownEvent',
        version: 1,
        data: {}
      } as any;

      expect(() => (accountAggregate as any).applyEvent(null, event)).toThrow('Unknown event type: UnknownEvent');
    });
  });

  it('should rollback transaction on error during createAccount', async () => {
    const mockError = new Error('Test error');
    (accountAggregate as any).aggregateHelper.addEvent.mockRejectedValueOnce(mockError);

    await expect(accountAggregate.createAccount('John Doe', 1000)).rejects.toThrow(mockError);
    expect((accountAggregate as any).aggregateHelper.rollbackTransaction).toHaveBeenCalled();
  });

  it('should rollback transaction on error during deposit', async () => {
    const mockState = {
      id: 'test-uuid',
      owner: 'John Doe',
      balance: 1000,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      accountType: 'checking',
      type: 'AccountCreated',
      data: {},
      metadata: {}
    };
    
    (accountAggregate as any).aggregateHelper.getCurrentState.mockResolvedValueOnce({
      state: mockState,
      version: 1
    });

    const mockError = new Error('Test error');
    (accountAggregate as any).aggregateHelper.addEvent.mockRejectedValueOnce(mockError);

    await expect(accountAggregate.deposit('test-uuid', 500)).rejects.toThrow(mockError);
    expect((accountAggregate as any).aggregateHelper.rollbackTransaction).toHaveBeenCalled();
  });

  it('should rollback transaction on error during withdraw', async () => {
    const mockState = {
      id: 'test-uuid',
      owner: 'John Doe',
      balance: 1000,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      accountType: 'checking',
      type: 'AccountCreated',
      data: {},
      metadata: {}
    };
    
    (accountAggregate as any).aggregateHelper.getCurrentState.mockResolvedValueOnce({
      state: mockState,
      version: 1
    });

    const mockError = new Error('Test error');
    (accountAggregate as any).aggregateHelper.addEvent.mockRejectedValueOnce(mockError);

    await expect(accountAggregate.withdraw('test-uuid', 500)).rejects.toThrow(mockError);
    expect((accountAggregate as any).aggregateHelper.rollbackTransaction).toHaveBeenCalled();
  });
});
