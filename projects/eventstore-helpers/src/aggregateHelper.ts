import { EventStoreDBClient, jsonEvent } from '@eventstore/db-client';
import { StreamHelper } from './streamHelpers';
import { BaseEvent, JSONType } from './types';

interface EntityReference {
  id: string;
  type: string;
  version: number;
}

interface AggregateEvent extends BaseEvent {
  affectedEntities?: EntityReference[];
}

interface AggregateConfig<E extends AggregateEvent> {
  snapshotFrequency?: number;
  snapshotPrefix?: string;
  currentEventVersion?: number;
  eventMigrations?: any[];
  aggregatePrefix?: string;
  entityPrefixes?: Record<string, string>;
}

/**
 * AggregateHelper extends StreamHelper to provide support for managing aggregate roots
 * and their related entities across multiple streams atomically.
 */
export class AggregateHelper<S extends JSONType, E extends AggregateEvent> extends StreamHelper<S, E> {
  private aggregateConfig: Required<AggregateConfig<E>>;
  private pendingEvents: Map<string, E[]> = new Map();
  private entityVersions: Map<string, number> = new Map();

  constructor(client: EventStoreDBClient, config: AggregateConfig<E>) {
    super(client, {
      snapshotFrequency: config.snapshotFrequency,
      snapshotPrefix: config.snapshotPrefix,
      currentEventVersion: config.currentEventVersion,
      eventMigrations: config.eventMigrations,
    });

    this.aggregateConfig = {
      ...config,
      aggregatePrefix: config.aggregatePrefix ?? 'aggregate-',
      entityPrefixes: config.entityPrefixes ?? {},
    };
  }

  /**
   * Starts a new transaction for the aggregate.
   * @param aggregateId - The ID of the aggregate root
   */
  async beginTransaction(aggregateId: string): Promise<void> {
    const streamId = this.getAggregateStreamId(aggregateId);
    this.pendingEvents.set(streamId, []);
  }

  /**
   * Adds an event to the pending transaction.
   * @param aggregateId - The ID of the aggregate root
   * @param event - The event to add
   * @param affectedEntities - List of entities affected by this event
   */
  async addEvent(
    aggregateId: string,
    event: Omit<E, 'affectedEntities'>,
    affectedEntities: EntityReference[] = []
  ): Promise<void> {
    const streamId = this.getAggregateStreamId(aggregateId);
    const pendingEvents = this.pendingEvents.get(streamId);
    
    if (!pendingEvents) {
      throw new Error('No active transaction. Call beginTransaction first.');
    }

    const fullEvent = {
      ...event,
      affectedEntities,
    } as E;

    pendingEvents.push(fullEvent);
    this.pendingEvents.set(streamId, pendingEvents);

    // Track affected entity versions
    for (const entity of affectedEntities) {
      const entityStreamId = this.getEntityStreamId(entity.type, entity.id);
      this.entityVersions.set(entityStreamId, entity.version);
    }
  }

  /**
   * Commits all pending events in the transaction atomically.
   * @param aggregateId - The ID of the aggregate root
   */
  async commitTransaction(aggregateId: string): Promise<void> {
    const streamId = this.getAggregateStreamId(aggregateId);
    const pendingEvents = this.pendingEvents.get(streamId);

    if (!pendingEvents || pendingEvents.length === 0) {
      return;
    }

    try {
      // Start a transaction
      const transaction = await this.client.startTransaction();

      // Append events to the aggregate stream
      await transaction.appendToStream(streamId, pendingEvents.map(event => 
        jsonEvent({
          type: event.type,
          data: event,
        })
      ));

      // Append events to each affected entity's stream
      for (const event of pendingEvents) {
        if (event.affectedEntities) {
          for (const entity of event.affectedEntities) {
            const entityStreamId = this.getEntityStreamId(entity.type, entity.id);
            await transaction.appendToStream(entityStreamId, [
              jsonEvent({
                type: event.type,
                data: event,
              })
            ]);
          }
        }
      }

      // Commit the transaction
      await transaction.commit();

      // Clear pending events
      this.pendingEvents.delete(streamId);
      this.entityVersions.clear();
    } catch (error) {
      // Rollback by clearing pending events
      this.pendingEvents.delete(streamId);
      this.entityVersions.clear();
      throw error;
    }
  }

  /**
   * Rolls back the current transaction.
   * @param aggregateId - The ID of the aggregate root
   */
  async rollbackTransaction(aggregateId: string): Promise<void> {
    const streamId = this.getAggregateStreamId(aggregateId);
    this.pendingEvents.delete(streamId);
    this.entityVersions.clear();
  }

  /**
   * Gets the stream ID for an aggregate root.
   */
  private getAggregateStreamId(aggregateId: string): string {
    return `${this.aggregateConfig.aggregatePrefix}${aggregateId}`;
  }

  /**
   * Gets the stream ID for an entity.
   */
  private getEntityStreamId(entityType: string, entityId: string): string {
    const prefix = this.aggregateConfig.entityPrefixes[entityType] ?? entityType;
    return `${prefix}-${entityId}`;
  }
}
