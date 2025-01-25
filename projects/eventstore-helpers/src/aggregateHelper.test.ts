import { EventStoreDBClient as Client } from '@eventstore/db-client';
import { AggregateHelper } from './aggregateHelper';
import { BaseEvent } from './types';

interface TestState {
  id: string;
  data: string;
  [key: string]: unknown;
}

interface TestEvent extends BaseEvent {
  data: {
    value: string;
  };
  affectedEntities?: Array<{
    id: string;
    type: string;
    version: number;
  }>;
}

describe('AggregateHelper', () => {
  let mockClient: any;
  let aggregateHelper: AggregateHelper<TestState, TestEvent>;

  beforeEach(() => {
    mockClient = {
      readStream: jest.fn().mockReturnValue({
        [Symbol.asyncIterator]: () => ({
          next: jest.fn().mockResolvedValue({ done: true, value: undefined }),
        }),
      }),
      appendToStream: jest.fn().mockResolvedValue({ success: true, nextExpectedRevision: BigInt(1) }),
      getStreamMetadata: jest.fn().mockResolvedValue({}),
      setStreamMetadata: jest.fn().mockResolvedValue({}),
      deleteStream: jest.fn().mockResolvedValue({}),
    };

    aggregateHelper = new AggregateHelper(mockClient, {
      aggregatePrefix: 'test-aggregate-',
      entityPrefixes: {
        item: 'test-item-',
      },
    });
  });

  describe('transaction management', () => {
    it('should handle transaction flow', async () => {
      const aggregateId = 'test-123';
      const event: Omit<TestEvent, 'affectedEntities'> = {
        type: 'TestEvent',
        version: 1,
        data: {
          value: 'test',
        },
      };

      // Begin transaction
      await aggregateHelper.beginTransaction(aggregateId);

      // Add event
      await aggregateHelper.addEvent(aggregateId, event, [
        { id: 'item-1', type: 'item', version: 1 },
      ]);

      // Commit transaction
      await aggregateHelper.commitTransaction(aggregateId);

      // Verify transaction flow
      expect(mockClient.appendToStream).toHaveBeenCalled();
    });

    it('should handle transaction rollback', async () => {
      const aggregateId = 'test-123';
      const event: Omit<TestEvent, 'affectedEntities'> = {
        type: 'TestEvent',
        version: 1,
        data: {
          value: 'test',
        },
      };

      // Begin transaction
      await aggregateHelper.beginTransaction(aggregateId);

      // Add event
      await aggregateHelper.addEvent(aggregateId, event, [
        { id: 'item-1', type: 'item', version: 1 },
      ]);

      // Rollback transaction
      await aggregateHelper.rollbackTransaction(aggregateId);

      // Verify no events were appended
      expect(mockClient.appendToStream).not.toHaveBeenCalled();
    });

    it('should handle commit failure', async () => {
      const aggregateId = 'test-123';
      const event: Omit<TestEvent, 'affectedEntities'> = {
        type: 'TestEvent',
        version: 1,
        data: {
          value: 'test',
        },
      };

      mockClient.appendToStream.mockRejectedValueOnce(new Error('Append failed'));

      // Begin transaction
      await aggregateHelper.beginTransaction(aggregateId);

      // Add event
      await aggregateHelper.addEvent(aggregateId, event, [
        { id: 'item-1', type: 'item', version: 1 },
      ]);

      // Attempt to commit transaction
      await expect(aggregateHelper.commitTransaction(aggregateId)).rejects.toThrow('Append failed');
    });
  });
});
