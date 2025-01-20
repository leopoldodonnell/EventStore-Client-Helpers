import { JSONType } from '@eventstore/db-client';

export { JSONType };

export interface StreamConfig {
  streamPrefix: string;
  snapshotFrequency?: number;
  eventMigrations?: EventMigration<any, any>[];
  currentEventVersion?: number;
}

export interface Snapshot<T> {
  version: number;
  state: T;
  timestamp: string;
  [key: string]: unknown;
}

export interface EventMetadata {
  correlationId?: string;
  timestamp?: string;
  [key: string]: unknown;
}

// Base interface for versioned events
export interface BaseEvent<T extends string, D> {
  type: T;
  version: number;
  data: D;
  metadata?: EventMetadata;
}

// Event migration interface
export interface EventMigration<From extends BaseEvent<string, any>, To extends BaseEvent<string, any>> {
  fromVersion: number;
  toVersion: number;
  eventType: From['type'];
  migrate: (event: From) => To;
}

export interface JSONEventType {
  type: string;
  version?: number;
  data: JSONType;
  metadata?: EventMetadata;
}

export interface SnapshotEventType extends JSONEventType {
  type: 'snapshot';
  data: Snapshot<any>;
}

export type JSONCompatible<T> = {
  [P in keyof T]: T[P] extends Date ? string : T[P];
}

// Helper type to extract event by type
export type ExtractEvent<Events, Type extends string> = Extract<Events, { type: Type }>;

// Helper type to extract event data by type
export type ExtractEventData<Events, Type extends string> = Extract<Events, { type: Type; data: any }>['data'];
