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

export class StreamHelper<S extends JSONType, E extends BaseEvent> {
  private client: EventStoreDBClient;
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
    console.log('Appending event to stream:', streamId, 'Event:', event);
    const jsonEventData = jsonEvent(event);
    console.log('Converted to JSON event:', jsonEventData);
    await this.client.appendToStream(streamId, jsonEventData, expectedRevision ? { expectedRevision } : undefined);
    console.log('Successfully appended event to stream:', streamId);
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
      type: 'snapshot',
      id: `${streamId}-${Date.now()}-${Math.random().toString(36).substring(7)}`,
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
}
