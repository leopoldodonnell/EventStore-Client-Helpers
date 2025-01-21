import { JSONEventType } from '@eventstore/db-client';

export type JSONType = Record<string, unknown>;

export type EventMetadata = Record<string, unknown>;

export type BaseEvent<T extends string = string, D extends JSONType = JSONType> = {
  type: T;
  data: D;
  version?: number;
  metadata?: EventMetadata;
};

export type SnapshotEventType = JSONEventType<
  'snapshot',
  {
    state: JSONType;
    version: number;
    timestamp: string;
  }
>;

export type Snapshot<S> = {
  state: S;
  version: number;
  timestamp: string;
};

export type StreamConfig<E extends BaseEvent = BaseEvent> = {
  snapshotFrequency?: number;
  snapshotPrefix?: string;
  currentEventVersion?: number;
  eventMigrations?: EventMigration<E, E>[];
};

export type EventMigration<Source extends BaseEvent, Target extends BaseEvent = Source> = {
  fromVersion: number;
  toVersion: number;
  eventType: Source['type'];
  migrate: (event: Source) => Target;
};

export type JSONCompatible<T extends Record<string, unknown>> = {
  [P in keyof T]: T[P] extends Date ? string : T[P] extends Record<string, unknown> ? JSONCompatible<T[P]> : T[P];
};

// Helper type to extract event by type
export type ExtractEvent<Events, Type extends string> = Extract<Events, { type: Type }>;

// Helper type to extract event data by type
export type ExtractEventData<Events, Type extends string> = Extract<Events, { type: Type; data: any }>['data'];
