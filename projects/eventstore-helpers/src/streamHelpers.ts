import { EventStoreDBClient, StreamNotFoundError, jsonEvent, ResolvedEvent, START } from '@eventstore/db-client';
import { StreamConfig, Snapshot, BaseEvent, JSONType } from './types';

export class StreamHelper<S extends JSONType, E extends BaseEvent> {
  private client: EventStoreDBClient;
  private config: Required<StreamConfig<E>>;

  constructor(client: EventStoreDBClient, config: StreamConfig<E>) {
    this.client = client;
    this.config = {
      snapshotFrequency: config.snapshotFrequency ?? 0,
      snapshotPrefix: config.snapshotPrefix ?? '-snapshot',
      currentEventVersion: config.currentEventVersion ?? 1,
      eventMigrations: config.eventMigrations ?? [],
    };
  }

  private async migrateEventIfNeeded<T extends E>(event: T): Promise<T> {
    if (!event.version) {
      return event;
    }

    const eventVersion = event.version ?? 1;
    if (eventVersion < this.config.currentEventVersion) {
      let migratedEvent = { ...event } as T;
      
      for (const migration of this.config.eventMigrations) {
        if (
          migration.eventType === event.type &&
          eventVersion >= migration.fromVersion &&
          migration.toVersion <= this.config.currentEventVersion
        ) {
          migratedEvent = migration.migrate(migratedEvent) as T;
        }
      }
      
      return migratedEvent;
    }
    return event;
  }

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

  async appendEvent(streamId: string, event: E, expectedRevision?: bigint): Promise<void> {
    await this.client.appendToStream(streamId, jsonEvent(event), expectedRevision ? { expectedRevision } : undefined);
  }

  async getCurrentState(
    streamId: string,
    applyEvent: (state: S | null, event: E) => S
  ): Promise<{ state: S | null; version: number }> {
    try {
      const snapshot = await this.getLatestSnapshot(streamId);
      let state = snapshot?.state ?? null;
      let fromRevision: typeof START | bigint = snapshot ? BigInt(snapshot.version) : START;
      let version = snapshot?.version ?? 0;

      const events = await this.readEvents(streamId, fromRevision);
      
      for (const resolvedEvent of events) {
        if (resolvedEvent.event) {
          const eventData = resolvedEvent.event as unknown as E;
          const migratedEvent = await this.migrateEventIfNeeded(eventData);
          state = applyEvent(state, migratedEvent);
          version++;
        }
      }

      if (this.config.snapshotFrequency > 0 && version > 0 && version % this.config.snapshotFrequency === 0) {
        await this.createSnapshot(streamId, state, version);
      }

      return { state, version };
    } catch (error) {
      if (error instanceof StreamNotFoundError) {
        return { state: null, version: 0 };
      }
      throw error;
    }
  }

  private async createSnapshot(streamId: string, state: S | null, version: number): Promise<void> {
    if (!state) return;

    const snapshotEvent = jsonEvent({
      type: 'snapshot' as const,
      data: {
        state,
        version,
        timestamp: '2025-01-20T16:46:27-05:00'
      }
    });

    await this.client.appendToStream(
      `${streamId}${this.config.snapshotPrefix}`,
      snapshotEvent
    );
  }
}
