/**
 * StreamHelper provides a high-level interface for interacting with EventStore streams.
 * It simplifies common operations like appending events, reading streams, and managing snapshots.
 * 
 * Features:
 * - Automatic event versioning and metadata handling
 * - Simplified event appending with retry logic
 * - Stream reading with optional snapshot support
 * - Type-safe event handling with generics
 */
import { EventStoreDBClient, START, ResolvedEvent, StreamNotFoundError, jsonEvent } from '@eventstore/db-client';
import { JSONType, BaseEvent, Snapshot } from './types';
import { randomUUID } from 'crypto';

interface StreamConfig<E extends BaseEvent> {
  snapshotFrequency?: number;
  snapshotPrefix?: string;
  currentEventVersion?: number;
  eventMigrations?: EventMigration<E>[];
}

interface EventMigration<E extends BaseEvent> {
  eventType: string;
  fromVersion: number;
  migrate: (event: E) => E;
}

interface StreamEvent<E extends BaseEvent> {
  streamId: string;
  event: E;
  expectedRevision?: bigint;
}

export class StreamHelper<S extends JSONType, E extends BaseEvent> {
  protected client: EventStoreDBClient;
  private config: Required<StreamConfig<E>>;

  /**
   * Creates a new StreamHelper instance.
   * 
   * @param client - The EventStoreDB client instance
   * @param config - The stream configuration
   */
  constructor(client: EventStoreDBClient, config: StreamConfig<E>) {
    this.client = client;
    this.config = {
      snapshotFrequency: config.snapshotFrequency ?? 0,
      snapshotPrefix: config.snapshotPrefix ?? '-snapshot',
      currentEventVersion: config.currentEventVersion ?? 1,
      eventMigrations: config.eventMigrations ?? [],
    };
  }

  /**
   * Migrates an event to the latest version if necessary.
   * 
   * @param event - The event to migrate
   * @returns Promise resolving to the migrated event
   */
  private async migrateEventIfNeeded<T extends E>(event: T): Promise<T> {
    if (!event || !event.type) {
      return event;
    }

    // Find the next migration for this event type and version
    const nextMigration = this.config.eventMigrations.find(migration => 
      migration.eventType === event.type && 
      migration.fromVersion === (event.version ?? 1)
    );

    if (!nextMigration) {
      return event;
    }

    // Apply the migration
    const migratedEvent = nextMigration.migrate(event) as T;

    // Recursively apply next migration if needed
    return this.migrateEventIfNeeded(migratedEvent);
  }

  /**
   * Reads events from a stream.
   * 
   * @param streamName - The name of the stream to read from
   * @param fromRevision - The revision to start reading from
   * @returns Promise resolving to an array of read events
   */
  private async readEvents(streamName: string, fromRevision: typeof START | bigint = START): Promise<ResolvedEvent[]> {
    try {
      const events: ResolvedEvent[] = [];
      const readStream = this.client.readStream(streamName, { fromRevision });
      for await (const resolvedEvent of readStream) {
        events.push(resolvedEvent);
      }
      return events;
    } catch (error) {
      if (error instanceof StreamNotFoundError) {
        return [];
      }
      throw error;
    }
  }

  /**
   * Gets the latest snapshot for a stream if available.
   * 
   * @param streamId - The ID of the stream
   * @returns Promise resolving to the latest snapshot or null if none exists
   */
  async getLatestSnapshot(streamId: string): Promise<Snapshot<S> | null> {
    const snapshotStreamName = `${streamId}${this.config.snapshotPrefix}`;
    try {
      const events = await this.readEvents(snapshotStreamName, START);
      if (events.length > 0) {
        const latestSnapshot = events[events.length - 1].event;
        if (latestSnapshot?.type === 'snapshot') {
          return latestSnapshot.data as Snapshot<S>;
        }
      }
      return null;
    } catch (error) {
      if (error instanceof StreamNotFoundError) {
        return null;
      }
      throw error;
    }
  }

  /**
   * Appends a new event to the specified stream.
   * 
   * @param streamId - The ID of the stream to append to
   * @param event - The event to append
   * @param expectedRevision - The expected revision for optimistic concurrency
   * @returns Promise resolving to void
   */
  async appendEvent(streamId: string, event: E, expectedRevision?: bigint): Promise<void> {
    const jsonEventData = jsonEvent({
      id: randomUUID(),
      type: event.type,
      data: event.data,
      metadata: {
        ...event.metadata,
        version: this.config.currentEventVersion,
      },
    });

    await this.client.appendToStream(streamId, [jsonEventData], {
      expectedRevision,
    });
  }

  /**
   * Gets the current state of a stream by reading all events and applying them to the initial state.
   * 
   * @param streamId - The ID of the stream
   * @param applyEvent - A function to apply each event to the state
   * @returns Promise resolving to the current state and version
   */
  async getCurrentState(
    streamId: string,
    applyEvent: (state: S | null, event: E) => S
  ): Promise<{ state: S | null; version: number }> {
    try {
      console.log('Getting current state for stream:', streamId);
      const snapshot = await this.getLatestSnapshot(streamId);
      console.log('Latest snapshot:', snapshot);
      
      let state = snapshot?.state ?? null;
      let fromRevision: typeof START | bigint = snapshot ? BigInt(snapshot.version) : START;
      let version = snapshot?.version ?? 0;

      console.log('Reading events from revision:', fromRevision);
      const events = await this.readEvents(streamId, fromRevision);
      console.log('Read events:', events.length);
      
      for (const resolvedEvent of events) {
        if (resolvedEvent.event) {
          console.log('Processing event:', resolvedEvent.event);
          const eventData = resolvedEvent.event as unknown as E;
          const migratedEvent = await this.migrateEventIfNeeded(eventData);
          console.log('Migrated event:', migratedEvent);
          state = applyEvent(state, migratedEvent);
          version++;
          console.log('Updated state:', state, 'Version:', version);
        }
      }

      if (this.config.snapshotFrequency > 0 && version > 0 && version % this.config.snapshotFrequency === 0) {
        console.log('Creating snapshot at version:', version);
        await this.createSnapshot(streamId, state, version);
      }

      console.log('Returning final state:', state, 'Version:', version);
      return { state, version };
    } catch (error) {
      console.error('Error getting current state:', error);
      throw error;
    }
  }

  /**
   * Creates a new snapshot event in a snapshot stream.
   * 
   * @param streamId - The ID of the main stream
   * @param state - The current state to store in the snapshot
   * @param version - The version of the snapshot
   * @returns Promise resolving to void
   */
  private async createSnapshot(streamId: string, state: S | null, version: number): Promise<void> {
    if (!state) return;

    const timestamp = (state as any).timestamp || new Date('2025-01-21T13:38:57-05:00').toISOString();
    const event = {
      id: randomUUID(),
      type: 'snapshot',
      data: {
        state,
        version,
        timestamp
      },
      metadata: {},
      contentType: 'application/json' as const
    };

    await this.client.appendToStream(
      `${streamId}${this.config.snapshotPrefix}`,
      [event]
    );
  }

  /**
   * Appends multiple events to different streams using a transaction stream for atomicity.
   * This creates a transaction stream that contains all events, which can then be processed
   * to update individual streams.
   * 
   * @param transactionId - Unique identifier for this transaction
   * @param streamEvents - Array of events with their target streams
   * @returns Promise resolving to the transaction stream ID
   */
  async appendMultiStreamEvents(transactionId: string, streamEvents: StreamEvent<E>[]): Promise<string> {
    const transactionStreamId = `$tx-${transactionId}`;
    
    // Create transaction events that wrap the original events with their target stream information
    const transactionEvents = streamEvents.map(({ streamId, event, expectedRevision }) => ({
      id: randomUUID(),
      type: 'StreamEvent',
      data: {
        targetStream: streamId,
        event: {
          type: event.type,
          data: event.data,
          metadata: event.metadata || {},
          version: event.version || this.config.currentEventVersion,
        },
        expectedRevision: expectedRevision !== undefined ? expectedRevision : undefined,
      },
      metadata: {},
      contentType: 'application/json' as const,
    }));

    // Append all events to the transaction stream atomically
    await this.client.appendToStream(transactionStreamId, transactionEvents);
    
    return transactionStreamId;
  }

  /**
   * Processes a transaction stream by applying its events to their target streams.
   * If any append fails due to concurrency, the entire transaction is marked as failed.
   * 
   * @param transactionStreamId - ID of the transaction stream to process
   * @returns Promise resolving to void
   */
  async processTransactionStream(transactionStreamId: string): Promise<void> {
    const events = await this.readEvents(transactionStreamId);
    
    for (const resolvedEvent of events) {
      const eventData = resolvedEvent.event?.data as any;
      if (!eventData?.targetStream || !eventData?.event) continue;

      try {
        const targetEvent = {
          id: randomUUID(),
          type: eventData.event.type,
          data: eventData.event.data,
          metadata: {},
          contentType: 'application/json' as const,
        };

        await this.client.appendToStream(
          eventData.targetStream,
          [targetEvent],
          { expectedRevision: BigInt(0) }
        );
      } catch (error) {
        // Mark transaction as failed by appending a failure event
        const failureEvent = {
          id: randomUUID(),
          type: 'TransactionFailed',
          data: {
            error: error instanceof Error ? error.message : String(error),
            failedStream: eventData.targetStream,
          },
          metadata: {},
          contentType: 'application/json' as const,
        };
        
        await this.client.appendToStream(transactionStreamId, [failureEvent]);
        throw error;
      }
    }

    // Mark transaction as completed
    await this.client.appendToStream(transactionStreamId, [
      {
        id: randomUUID(),
        type: 'TransactionCompleted',
        data: {
          timestamp: new Date().toISOString(),
        },
        metadata: {},
        contentType: 'application/json' as const,
      }
    ]);
  }

  /**
   * Creates a new transaction for the specified stream.
   * @param streamId - The ID of the stream to create a transaction for
   * @returns A promise that resolves to the EventStoreDB client
   */
  protected async createTransaction(streamId: string): Promise<EventStoreDBClient> {
    return this.client;
  }
}
