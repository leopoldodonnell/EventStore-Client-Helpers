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
});
