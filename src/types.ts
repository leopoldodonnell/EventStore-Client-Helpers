import { JSONEventType, JSONType } from '@eventstore/db-client';

export type JSONCompatible<T> = {
  [P in keyof T]: T[P] extends Date ? string : T[P];
};

export interface Snapshot<T> {
  version: number;
  state: JSONCompatible<T>;
  timestamp: string;
  [key: string]: unknown;
}

export type SnapshotEventData<T> = {
  type: 'snapshot';
  data: Snapshot<T>;
  metadata?: unknown;
};

export interface StreamConfig {
  streamPrefix: string;
  snapshotFrequency?: number;
}
