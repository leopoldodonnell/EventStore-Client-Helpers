import { EventStoreDBClient, StreamNotFoundError, ResolvedEvent, START, ReadRevision, jsonEvent } from '@eventstore/db-client';
import { 
  Snapshot, 
  SnapshotEventType, 
  StreamConfig, 
  JSONEventType, 
  EventMetadata, 
  BaseEvent,
  EventMigration,
  JSONType
} from './types';

export class StreamHelper<S extends JSONType, E extends BaseEvent<string, JSONType>> {
  private client: EventStoreDBClient;
  private config: StreamConfig;

  constructor(client: EventStoreDBClient, config: StreamConfig) {
    this.client = client;
    this.config = {
      ...config,
      currentEventVersion: config.currentEventVersion ?? 1,
      eventMigrations: config.eventMigrations ?? [],
    };
  }

  private migrateEventIfNeeded(event: E & { version?: number }): E {
    if (!this.config.eventMigrations?.length || !this.config.currentEventVersion) {
      return event;
    }

    const eventVersion = event.version ?? 0;  // Default to 0 if version is undefined
    if (eventVersion < this.config.currentEventVersion) {
      // Find applicable migrations
      const eventMigrations = this.config.eventMigrations.filter(
        m => m.eventType === event.type && 
        (eventVersion >= m.fromVersion && m.toVersion <= this.config.currentEventVersion!)
      );

      // Apply migrations in sequence
      return eventMigrations.reduce((e, migration) => migration.migrate(e as any), {
        ...event,
        version: eventVersion, 
      } as E);
    }
    return event;
  }

  private async readEvents(streamName: string, fromRevision: ReadRevision = START): Promise<ResolvedEvent[]> {
    const events: ResolvedEvent[] = [];
    const readStream = this.client.readStream(streamName, { fromRevision });
    
    for await (const resolvedEvent of readStream) {
      events.push(resolvedEvent);
    }
    
    return events;
  }

  async getLatestSnapshot(aggregateId: string): Promise<Snapshot<S> | null> {
    const snapshotStreamName = `${this.config.streamPrefix}-${aggregateId}-snapshot`;
    try {
      const readStream = this.client.readStream(snapshotStreamName, {
        direction: 'backwards',
        fromRevision: 'end',
        maxCount: 1
      });

      for await (const resolvedEvent of readStream) {
        if (resolvedEvent?.event) {
          const snapshotEvent = resolvedEvent.event as unknown as SnapshotEventType;
          return snapshotEvent.data as Snapshot<S>;
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

  async appendEvent(
    aggregateId: string,
    event: E,
    expectedRevision?: bigint
  ): Promise<void> {
    const streamName = `${this.config.streamPrefix}-${aggregateId}`;
    const versionedEvent = {
      ...event,
      version: this.config.currentEventVersion,
    };

    await this.client.appendToStream(
      streamName,
      jsonEvent({
        type: versionedEvent.type,
        data: versionedEvent.data,
        metadata: versionedEvent.metadata,
      }),
      { expectedRevision }
    );

    // Check if we need to create a snapshot
    if (this.config.snapshotFrequency) {
      const events = await this.readEvents(streamName);
      if (events.length % this.config.snapshotFrequency === 0) {
        await this.createSnapshot(aggregateId, events);
      }
    }
  }

  async getCurrentState(
    aggregateId: string,
    applyEvent: (state: S | null, event: E) => NonNullable<S>
  ): Promise<{ state: S | null, version: number } | null> {
    const snapshot = await this.getLatestSnapshot(aggregateId);
    let state = snapshot?.state ?? null;
    let fromRevision: ReadRevision = snapshot ? BigInt(snapshot.version) + 1n : START;
    let version = snapshot?.version ?? 0;

    const streamName = `${this.config.streamPrefix}-${aggregateId}`;
    try {
      const events = await this.readEvents(streamName, fromRevision);

      for (const resolvedEvent of events) {
        if (resolvedEvent.event) {
          const event = resolvedEvent.event as unknown as E;
          const migratedEvent = this.migrateEventIfNeeded(event);
          state = applyEvent(state, migratedEvent);
          version++;
        }
      }

      return { state, version };
    } catch (error) {
      if (error instanceof StreamNotFoundError) {
        return null;
      }
      throw error;
    }
  }

  private async createSnapshot(
    aggregateId: string,
    events: ResolvedEvent[]
  ): Promise<void> {
    const snapshotStreamName = `${this.config.streamPrefix}-${aggregateId}-snapshot`;
    const snapshot: Snapshot<S> = {
      version: events.length,
      state: events.reduce((state, event) => {
        if (event.event) {
          const rawEvent = event.event as unknown as E;
          const migratedEvent = this.migrateEventIfNeeded(rawEvent);
          return this.applyEvent(state, migratedEvent);
        }
        return state;
      }, null as S | null) as S,
      timestamp: new Date().toISOString(),
    };

    await this.client.appendToStream(
      snapshotStreamName,
      jsonEvent({
        type: 'snapshot',
        data: snapshot,
      })
    );
  }

  private applyEvent(state: S | null, event: E): S {
    if (typeof event.data !== 'object' || !event.data) {
      throw new Error('Event data must be a non-null object');
    }
    return event.data as S;
  }
}
