import { EventStoreDBClient, StreamNotFoundError, StreamingRead, ResolvedEvent, jsonEvent } from '@eventstore/db-client';
import { StreamHelper } from './streamHelpers';
import { Snapshot, SnapshotEventType, JSONEventType } from './types';
import { EventEmitter } from 'events';

// Mock EventStoreDBClient and jsonEvent
jest.mock('@eventstore/db-client');

interface TestState {
  id: string;
  value: number;
  timestamp: Date;
  [key: string]: unknown;
}

interface TestEvent extends JSONEventType {
  type: 'valueUpdated';
  data: { value: number };
}

describe('StreamHelper', () => {
  let client: jest.Mocked<EventStoreDBClient>;
  let streamHelper: StreamHelper<TestEvent, TestState>;
  const mockConfig = {
    streamPrefix: 'test',
    snapshotFrequency: 5,
  };

  beforeEach(() => {
    client = new EventStoreDBClient({ endpoint: 'localhost:2113' }) as jest.Mocked<EventStoreDBClient>;
    streamHelper = new StreamHelper<TestEvent, TestState>(client, mockConfig);
    (jsonEvent as jest.Mock).mockImplementation((event) => ({
      ...event,
      id: 'mock-id'
    }));
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getLatestSnapshot', () => {
    it('should return null when no snapshot exists', async () => {
      client.readStream.mockImplementation(() => {
        throw new StreamNotFoundError();
      });

      const result = await streamHelper.getLatestSnapshot('test-id');
      expect(result).toBeNull();
    });

    it('should return the latest snapshot when it exists', async () => {
      const mockSnapshot: Snapshot<TestState> = {
        state: { id: '1', value: 10, timestamp: new Date('2025-01-18T20:11:45.000Z') },
        version: 5,
        timestamp: '2025-01-18T20:11:45.000Z'
      };

      const mockSnapshotEvent: SnapshotEventType = {
        type: 'snapshot',
        data: mockSnapshot
      };

      // Mock snapshot stream
      client.readStream.mockImplementationOnce(() => {
        const eventEmitter = new EventEmitter();
        const stream = {
          [Symbol.asyncIterator]: async function* () {
            yield {
              event: mockSnapshotEvent
            };
          },
          cancel: jest.fn(),
          ...eventEmitter,
        };
        return stream as unknown as StreamingRead<ResolvedEvent<SnapshotEventType>>;
      });

      // Mock events after snapshot
      const mockEvent: TestEvent = {
        type: 'valueUpdated',
        data: { value: 15 }
      };

      client.readStream.mockImplementationOnce(() => {
        const eventEmitter = new EventEmitter();
        const stream = {
          [Symbol.asyncIterator]: async function* () {
            yield {
              event: mockEvent
            };
          },
          cancel: jest.fn(),
          ...eventEmitter,
        };
        return stream as unknown as StreamingRead<ResolvedEvent<TestEvent>>;
      });

      const result = await streamHelper.getLatestSnapshot('test-id');
      expect(result).toEqual(mockSnapshot);
    });
  });

  describe('appendEvent', () => {
    it('should append an event to the stream', async () => {
      const event: TestEvent = {
        type: 'valueUpdated',
        data: { value: 42 }
      };

      const expectedEvent = {
        ...event,
        id: 'mock-id'
      };

      await streamHelper.appendEvent('test', event);

      expect(jsonEvent).toHaveBeenCalledWith(event);
      expect(client.appendToStream).toHaveBeenCalledWith(
        'test-test',
        [expectedEvent]
      );
    });

    const testEvent: TestEvent = {
      type: 'valueUpdated',
      data: { value: 42 }
    };

    it('should append event without metadata', async () => {
      await streamHelper.appendEvent('test-id', testEvent);
      
      expect(client.appendToStream).toHaveBeenCalledWith(
        'test-test-id',
        [expect.any(Object)]
      );
      expect(jsonEvent).toHaveBeenCalledWith(
        expect.not.objectContaining({
          metadata: expect.anything()
        })
      );
    });

    it('should append event with metadata when provided', async () => {
      const metadata = {
        correlationId: 'test-correlation',
        customField: 'test-value'
      };

      await streamHelper.appendEvent('test-id', testEvent, metadata);
      
      expect(client.appendToStream).toHaveBeenCalledWith(
        'test-test-id',
        [expect.any(Object)]
      );
      expect(jsonEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          type: testEvent.type,
          data: testEvent.data,
          metadata: expect.objectContaining({
            correlationId: metadata.correlationId,
            customField: metadata.customField,
            timestamp: expect.any(String)
          })
        })
      );
    });
  });

  describe('readFromSnapshot', () => {
    const applyEvent = (state: TestState | null, event: TestEvent): TestState => {
      if (!state) {
        return {
          id: '1',
          value: event.data.value,
          timestamp: new Date()
        };
      }
      return {
        ...state,
        value: state.value + event.data.value,
        timestamp: new Date()
      };
    };

    it('should rebuild state from events when no snapshot exists', async () => {
      // Mock no snapshot exists
      client.readStream.mockImplementationOnce(() => {
        throw new StreamNotFoundError();
      });

      // Mock events in the main stream
      const mockEvent: TestEvent = {
        type: 'valueUpdated',
        data: { value: 42 }
      };

      client.readStream.mockImplementationOnce(() => {
        const eventEmitter = new EventEmitter();
        const stream = {
          [Symbol.asyncIterator]: async function* () {
            yield {
              event: mockEvent
            };
          },
          cancel: jest.fn(),
          ...eventEmitter,
        };
        return stream as unknown as StreamingRead<ResolvedEvent<TestEvent>>;
      });

      const result = await streamHelper.readFromSnapshot('test-id', applyEvent);
      
      expect(result).toBeTruthy();
      expect(result?.state.value).toBe(42);
    });

    it('should rebuild state from snapshot and subsequent events', async () => {
      // Mock snapshot exists
      const mockSnapshot: Snapshot<TestState> = {
        state: { id: '1', value: 10, timestamp: new Date('2025-01-18T20:11:45.000Z') },
        version: 5,
        timestamp: '2025-01-18T20:11:45.000Z'
      };

      const mockSnapshotEvent: SnapshotEventType = {
        type: 'snapshot',
        data: mockSnapshot
      };

      // Mock snapshot stream
      client.readStream.mockImplementationOnce(() => {
        const eventEmitter = new EventEmitter();
        const stream = {
          [Symbol.asyncIterator]: async function* () {
            yield {
              event: mockSnapshotEvent
            };
          },
          cancel: jest.fn(),
          ...eventEmitter,
        };
        return stream as unknown as StreamingRead<ResolvedEvent<SnapshotEventType>>;
      });

      // Mock events after snapshot
      const mockEvent: TestEvent = {
        type: 'valueUpdated',
        data: { value: 15 }
      };

      client.readStream.mockImplementationOnce(() => {
        const eventEmitter = new EventEmitter();
        const stream = {
          [Symbol.asyncIterator]: async function* () {
            yield {
              event: mockEvent
            };
          },
          cancel: jest.fn(),
          ...eventEmitter,
        };
        return stream as unknown as StreamingRead<ResolvedEvent<TestEvent>>;
      });

      const result = await streamHelper.readFromSnapshot('test-id', applyEvent);
      
      expect(result).toBeTruthy();
      expect(result?.state.value).toBe(25);
      expect(result?.version).toBe(6);
    });

    it('should create new snapshots at configured frequency', async () => {
      // Mock initial state
      client.readStream.mockImplementationOnce(() => {
        throw new StreamNotFoundError();
      });

      // Mock 5 events in the stream
      const mockEvent: TestEvent = {
        type: 'valueUpdated',
        data: { value: 10 }
      };

      client.readStream.mockImplementationOnce(() => {
        const eventEmitter = new EventEmitter();
        const stream = {
          [Symbol.asyncIterator]: async function* () {
            for (let i = 1; i <= 5; i++) {
              yield {
                event: mockEvent
              };
            }
          },
          cancel: jest.fn(),
          ...eventEmitter,
        };
        return stream as unknown as StreamingRead<ResolvedEvent<TestEvent>>;
      });

      await streamHelper.readFromSnapshot('test-id', applyEvent);

      // Verify snapshot was created after 5 events
      expect(client.appendToStream).toHaveBeenCalledWith(
        'test-test-id-snapshot',
        expect.arrayContaining([
          expect.objectContaining({
            type: 'snapshot',
            data: expect.objectContaining({
              state: expect.objectContaining({ value: 50 }),
              version: 5,
            }),
          }),
        ])
      );
    });
  });
});
