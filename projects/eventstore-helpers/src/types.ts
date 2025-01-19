import { JSONType } from '@eventstore/db-client';

export { JSONType };

export interface StreamConfig {
  streamPrefix: string;
  snapshotFrequency?: number;
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

export interface JSONEventType {
  type: string;
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
