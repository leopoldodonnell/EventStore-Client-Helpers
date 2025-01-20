import { EventStoreDBClient, StreamNotFoundError, ResolvedEvent, START, ReadRevision, jsonEvent } from '@eventstore/db-client';
import { Snapshot, SnapshotEventType, StreamConfig, JSONEventType, EventMetadata } from './types';

export class StreamHelper<E extends JSONEventType, S = any, M extends EventMetadata = EventMetadata> {
  private client: EventStoreDBClient;
  private config: StreamConfig;

  constructor(client: EventStoreDBClient, config: StreamConfig) {
    this.client = client;
    this.config = config;
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
    metadata?: Partial<M>
  ): Promise<void> {
    const streamName = `${this.config.streamPrefix}-${aggregateId}`;
    const eventMetadata = metadata ? {
      ...metadata,
      timestamp: metadata.timestamp || new Date().toISOString(),
      correlationId: metadata.correlationId || crypto.randomUUID()
    } : undefined;

    const jsonEventData = jsonEvent({
      type: event.type,
      data: event.data,
      ...(eventMetadata && { metadata: eventMetadata })
    });

    await this.client.appendToStream(streamName, [jsonEventData]);
  }

  private async createSnapshot(aggregateId: string, state: S, version: number): Promise<void> {
    if (!this.config.snapshotFrequency) return;
    
    const snapshotStreamName = `${this.config.streamPrefix}-${aggregateId}-snapshot`;
    const snapshotEvent = jsonEvent<SnapshotEventType>({
      type: 'snapshot',
      data: {
        state,
        version,
        timestamp: new Date().toISOString()
      }
    });
    await this.client.appendToStream(snapshotStreamName, [snapshotEvent]);
  }

  async readFromSnapshot(
    aggregateId: string,
    applyEvent: (state: S | null, event: E) => S
  ): Promise<{ state: S; version: number } | null> {
    let currentState: S | null = null;
    let version = 0;

    // Try to get the latest snapshot
    const snapshot = await this.getLatestSnapshot(aggregateId);
    if (snapshot) {
      currentState = snapshot.state as S;
      version = snapshot.version;
    }

    // Read all events after the snapshot
    const streamName = `${this.config.streamPrefix}-${aggregateId}`;
    try {
      const events = await this.readEvents(streamName, version ? BigInt(version) : START);
      
      for (const resolvedEvent of events) {
        if (resolvedEvent.event) {
          const eventData = {
            type: resolvedEvent.event.type,
            data: resolvedEvent.event.data,
            metadata: resolvedEvent.event.metadata
          } as E;
          currentState = applyEvent(currentState, eventData);
          version++;

          // Create snapshot if we've reached the snapshot frequency
          if (this.config.snapshotFrequency && version % this.config.snapshotFrequency === 0 && currentState) {
            await this.createSnapshot(aggregateId, currentState, version);
          }
        }
      }

      if (!currentState) {
        return null;
      }

      return {
        state: currentState,
        version,
      };
    } catch (error) {
      if (error instanceof StreamNotFoundError && !currentState) {
        return null;
      }
      throw error;
    }
  }
}
