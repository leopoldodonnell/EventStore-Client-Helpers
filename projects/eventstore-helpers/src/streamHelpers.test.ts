import { EventStoreDBClient, StreamNotFoundError, StreamingRead, ResolvedEvent, jsonEvent } from '@eventstore/db-client';
import { StreamHelper } from './streamHelpers';
import { Snapshot, SnapshotEventType, BaseEvent, EventMigration, JSONType } from './types';
import { EventEmitter } from 'events';

// Mock EventStoreDBClient and jsonEvent
jest.mock('@eventstore/db-client');

interface TestState {
  id: string;
  value: number;
  timestamp: string;
  [key: string]: unknown;
}

interface TestEvent extends BaseEvent<'valueUpdated', {
  value: number;
  [key: string]: unknown;
}> { }

// Test event application function
const applyEvent = (state: TestState | null, event: TestEvent): TestState => {
  if (!state) {
    return {
      id: '1',
      value: event.data.value,
      timestamp: '2025-01-21T07:04:17-05:00'
    };
  }
  return {
    ...state,
    value: state.value + event.data.value,
    timestamp: '2025-01-21T07:04:17-05:00'
  };
};

describe('StreamHelper', () => {
  let client: jest.Mocked<EventStoreDBClient>;
  let streamHelper: StreamHelper<TestState, TestEvent>;
  const mockConfig = {
    snapshotFrequency: 5,
    snapshotPrefix: '-snapshot',
  };

  beforeEach(() => {
    client = {
      readStream: jest.fn(),
      appendToStream: jest.fn(),
    } as any;
    streamHelper = new StreamHelper<TestState, TestEvent>(client, mockConfig);
  });

  describe('migrateEventIfNeeded', () => {
    it('should apply multiple migrations in sequence', async () => {
      const mockEvent: TestEvent = {
        type: 'valueUpdated',
        data: { value: 5 },
        version: 1
      };

      const migrations: EventMigration<TestEvent>[] = [
        {
          fromVersion: 1,
          toVersion: 2,
          eventType: 'valueUpdated',
          migrate: (event: TestEvent) => {
            if (event.type !== 'valueUpdated') {
              throw new Error('Invalid event type');
            }
            return {
              type: 'valueUpdated',
              data: { value: (event.data as { value: number }).value * 2 },
              version: 2
            };
          }
        },
        {
          fromVersion: 2,
          toVersion: 3,
          eventType: 'valueUpdated',
          migrate: (event: TestEvent) => {
            if (event.type !== 'valueUpdated') {
              throw new Error('Invalid event type');
            }
            return {
              type: 'valueUpdated',
              data: { value: (event.data as { value: number }).value + 1 },
              version: 3
            };
          }
        }
      ];

      const streamHelper = new StreamHelper<TestState, TestEvent>(client, {
        ...mockConfig,
        currentEventVersion: 3,
        eventMigrations: migrations
      });

      const result = await streamHelper['migrateEventIfNeeded'](mockEvent);
      expect(result.data.value).toBe(11); // (5 * 2) + 1
      expect(result.version).toBe(3);
    });

    it('should skip migrations when event version is current', async () => {
      const mockEvent: TestEvent = {
        type: 'valueUpdated',
        data: { value: 5 },
        version: 2
      };

      const migrations: EventMigration<TestEvent>[] = [
        {
          fromVersion: 1,
          toVersion: 2,
          eventType: 'valueUpdated',
          migrate: jest.fn()
        }
      ];

      const streamHelper = new StreamHelper<TestState, TestEvent>(client, {
        ...mockConfig,
        currentEventVersion: 2,
        eventMigrations: migrations
      });

      const result = await streamHelper['migrateEventIfNeeded'](mockEvent);
      expect(result).toBe(mockEvent);
      expect(migrations[0].migrate).not.toHaveBeenCalled();
    });

    it('should skip migrations for different event versions', async () => {
      const mockEvent: TestEvent = {
        type: 'valueUpdated',
        data: { value: 5 },
        version: 3
      };

      const migrations: EventMigration<TestEvent>[] = [
        {
          fromVersion: 1,
          toVersion: 2,
          eventType: 'valueUpdated',
          migrate: jest.fn()
        }
      ];

      const streamHelper = new StreamHelper<TestState, TestEvent>(client, {
        ...mockConfig,
        currentEventVersion: 2,
        eventMigrations: migrations
      });

      const result = await streamHelper['migrateEventIfNeeded'](mockEvent);
      expect(result).toBe(mockEvent);
      expect(migrations[0].migrate).not.toHaveBeenCalled();
    });
  });

  describe('getCurrentState', () => {
    it('should rebuild state from events when no snapshot exists', async () => {
      const mockEvent = {
        event: {
          type: 'valueUpdated',
          data: { value: 5 },
          version: 1
        }
      };

      client.readStream.mockImplementation(() => ({
        [Symbol.asyncIterator]: async function* () {
          yield mockEvent;
        }
      } as any));

      const result = await streamHelper.getCurrentState('test', applyEvent);
      expect(result.state?.value).toBe(5);
      expect(result.version).toBe(1);
    });
  });

  describe('getCurrentState with non-nullable return type', () => {
    it('should return null when stream not found and using non-nullable type', async () => {
      client.readStream.mockImplementation(() => ({
        [Symbol.asyncIterator]: async function* () {
          throw new StreamNotFoundError({
            code: 5,
            details: 'Stream not found',
            metadata: {} as any,
            name: 'StreamNotFoundError',
            message: 'Stream not found'
          });
        }
      } as any));

      const result = await streamHelper.getCurrentState('test', applyEvent);
      expect(result.state).toBeNull();
      expect(result.version).toBe(0);
    });
  });

  describe('snapshot creation', () => {
    it('should create snapshot when event count matches frequency', async () => {
      const mockEvents = Array(5).fill(null).map((_, i) => ({
        event: {
          type: 'valueUpdated',
          data: { value: 5 * (i + 1) },
          version: 1
        }
      }));

      client.readStream.mockImplementation(() => ({
        [Symbol.asyncIterator]: async function* () {
          for (const event of mockEvents) {
            yield event;
          }
        }
      } as any));

      client.appendToStream.mockResolvedValue({
        success: true,
        nextExpectedRevision: 1n,
        position: { commit: 1n, prepare: 1n }
      });

      await streamHelper.getCurrentState('test', applyEvent);

      const calls = client.appendToStream.mock.calls;
      expect(calls.length).toBe(1);
      expect(calls[0][0]).toBe('test-snapshot');
      
      const [event] = calls[0][1] as any[];
      expect(event).toBeDefined();
      expect(event.type).toBe('snapshot');
      expect(event.data).toEqual({
        state: {
          id: '1',
          value: 75,
          timestamp: expect.any(String)
        },
        version: 5,
        timestamp: expect.any(String)
      });
    });

    it('should not create snapshot when event count is below frequency', async () => {
      const mockEvents = Array(4).fill({
        event: {
          type: 'valueUpdated',
          data: { value: 5 },
          version: 1
        }
      });

      client.readStream.mockImplementation(() => ({
        [Symbol.asyncIterator]: async function* () {
          for (const event of mockEvents) {
            yield event;
          }
        }
      } as any));

      await streamHelper.getCurrentState('test', applyEvent);

      expect(client.appendToStream).not.toHaveBeenCalledWith(
        'test-snapshot',
        expect.any(Object)
      );
    });
  });
});
