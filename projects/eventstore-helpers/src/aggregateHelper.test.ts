import { EventStoreDBClient } from '@eventstore/db-client';
import { AggregateHelper } from './aggregateHelper';
import { BaseEvent } from './types';

interface TestState {
  id: string;
  data: string;
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
  let mockClient: jest.Mocked<EventStoreDBClient>;
  let aggregateHelper: AggregateHelper<TestState, TestEvent>;
  let mockTransaction: any;

  beforeEach(() => {
    mockTransaction = {
      appendToStream: jest.fn().mockResolvedValue(undefined),
      commit: jest.fn().mockResolvedValue(undefined),
    };

    mockClient = {
      startTransaction: jest.fn().mockResolvedValue(mockTransaction),
    } as any;

    aggregateHelper = new AggregateHelper(mockClient, {
      aggregatePrefix: 'test-aggregate-',
      entityPrefixes: {
        item: 'test-item',
      },
    });
  });

  describe('transaction management', () => {
    it('should manage transaction lifecycle correctly', async () => {
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
      expect(mockClient.startTransaction).toHaveBeenCalled();
      expect(mockTransaction.appendToStream).toHaveBeenCalledTimes(2); // Once for aggregate, once for entity
      expect(mockTransaction.commit).toHaveBeenCalled();
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

      // Add new event should fail
      await expect(aggregateHelper.addEvent(aggregateId, event)).rejects.toThrow(
        'No active transaction'
      );
    });

    it('should handle transaction errors', async () => {
      const aggregateId = 'test-123';
      const event: Omit<TestEvent, 'affectedEntities'> = {
        type: 'TestEvent',
        version: 1,
        data: {
          value: 'test',
        },
      };

      mockTransaction.commit.mockRejectedValueOnce(new Error('Commit failed'));

      // Begin transaction
      await aggregateHelper.beginTransaction(aggregateId);

      // Add event
      await aggregateHelper.addEvent(aggregateId, event, [
        { id: 'item-1', type: 'item', version: 1 },
      ]);

      // Commit should fail
      await expect(aggregateHelper.commitTransaction(aggregateId)).rejects.toThrow(
        'Commit failed'
      );

      // Add new event should fail as transaction was rolled back
      await expect(aggregateHelper.addEvent(aggregateId, event)).rejects.toThrow(
        'No active transaction'
      );
    });
  });
});
