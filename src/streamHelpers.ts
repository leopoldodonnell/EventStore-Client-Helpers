import { EventStoreDBClient, StreamNotFoundError, jsonEvent, ResolvedEvent, START, ReadRevision } from '@eventstore/db-client';
import { JSONCompatible, Snapshot, SnapshotEventData, StreamConfig } from './types';

export class StreamHelper<T extends Record<string, unknown>> {
  private client: EventStoreDBClient;
  private config: StreamConfig;

  constructor(client: EventStoreDBClient, config: StreamConfig) {
    this.client = client;
    this.config = config;
  }

  private async readEvents(streamName: string, fromRevision: ReadRevision = START): Promise<ResolvedEvent[]> {
    const events: ResolvedEvent[] = [];
    const stream = this.client.readStream(streamName, { fromRevision });
    
    for await (const resolvedEvent of stream) {
      events.push(resolvedEvent);
    }
    
    return events;
  }

  async getLatestSnapshot(aggregateId: string): Promise<Snapshot<T> | null> {
    const snapshotStreamName = `${this.config.streamPrefix}-${aggregateId}-snapshot`;
    
    try {
      const events = await this.readEvents(snapshotStreamName);
      if (events.length === 0) return null;

      const lastEvent = events[events.length - 1];
      const snapshotEvent = lastEvent.event as unknown as SnapshotEventData<T>;
      return snapshotEvent?.data ?? null;
    } catch (error) {
      if (error instanceof StreamNotFoundError) {
        return null;
      }
      throw error;
    }
  }

  async createSnapshot(aggregateId: string, state: T, version: number): Promise<void> {
    const snapshotStreamName = `${this.config.streamPrefix}-${aggregateId}-snapshot`;
    const snapshot: Snapshot<T> = {
      state: Object.fromEntries(
        Object.entries(state).map(([key, value]) => [
          key,
          value instanceof Date ? value.toISOString() : value
        ])
      ) as JSONCompatible<T>,
      version,
      timestamp: new Date().toISOString()
    };

    const event = jsonEvent<SnapshotEventData<T>>({
      type: 'snapshot',
      data: snapshot
    });

    await this.client.appendToStream(snapshotStreamName, [event]);
  }

  async readFromSnapshot(aggregateId: string, applyEvent: (state: T, eventData: any) => T): Promise<{state: T, version: number} | null> {
    const snapshot = await this.getLatestSnapshot(aggregateId);
    if (!snapshot) {
      return null;
    }

    const streamName = `${this.config.streamPrefix}-${aggregateId}`;
    const events = await this.readEvents(streamName, BigInt(snapshot.version));

    let state = Object.fromEntries(
      Object.entries(snapshot.state).map(([key, value]) => [
        key,
        typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)
          ? new Date(value)
          : value
      ])
    ) as T;
    
    let version = snapshot.version;

    for (const { event } of events) {
      if (event) {
        state = applyEvent(state, event.data);
        version++;
      }
    }

    return { state, version };
  }
}
