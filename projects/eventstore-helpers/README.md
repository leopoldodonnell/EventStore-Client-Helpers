# EventStore Client Helpers

A TypeScript library that simplifies working with EventStoreDB by providing high-level abstractions for common event sourcing patterns.

Part of the [EventStore Client Helpers](../../README.md) project.

## Features

- **Stream Management**: Easy-to-use `StreamHelper` class for managing event streams
- **Automatic Snapshotting**: Configurable automatic snapshot creation for performance optimization
- **Event Versioning**: Built-in support for event versioning and migrations
- **Type Safety**: Full TypeScript support with generics for type-safe event handling
- **JSON Compatibility**: Automatic handling of JSON serialization/deserialization
- **State Rebuilding**: Efficient state rebuilding from events and snapshots

## Installation

```bash
npm install @eventstore-helpers/core
```

## Quick Start

```typescript
import { EventStoreDBClient } from '@eventstore/db-client';
import { StreamHelper, BaseEvent, StreamConfig } from '@eventstore-helpers/core';

// Define your events
interface AccountCreated extends BaseEvent<'AccountCreated'> {
  data: {
    owner: string;
    initialBalance: number;
  };
}

// Create EventStoreDB client
const client = EventStoreDBClient.connectionString('esdb://localhost:2113?tls=false');

// Configure stream helper
const config: StreamConfig = {
  snapshotFrequency: 5,
  snapshotPrefix: '-snapshot',
  currentEventVersion: 1
};

// Create stream helper instance
const streamHelper = new StreamHelper(client, config);

// Append events
await streamHelper.appendEvent('account-123', {
  type: 'AccountCreated',
  data: {
    owner: 'John Doe',
    initialBalance: 1000
  }
});

// Get current state
const { state } = await streamHelper.getCurrentState('account-123', (state, event) => {
  // Apply event to state
  return newState;
});
```

## Key Concepts

### Stream Helper

The `StreamHelper` class provides methods for:
- Appending events to streams
- Reading events from streams
- Managing snapshots
- Rebuilding aggregate state
- Handling event migrations

### Event Versioning

Support for event versioning with automatic migrations:

```typescript
const config: StreamConfig = {
  currentEventVersion: 2,
  eventMigrations: [{
    fromVersion: 1,
    toVersion: 2,
    eventType: 'AccountCreated',
    migrate: (event) => ({
      ...event,
      data: {
        ...event.data,
        accountType: 'checking'  // Add new field
      }
    })
  }]
};
```

### Snapshotting

Automatic snapshot creation after configured number of events:

```typescript
const config: StreamConfig = {
  snapshotFrequency: 5,  // Create snapshot every 5 events
  snapshotPrefix: '-snapshot'
};
```

## Example Application

See the [example-bank](../example-bank) project for a complete example of building an event-sourced banking application using this library.

## API Reference

### StreamHelper

#### Constructor
```typescript
constructor(client: EventStoreDBClient, config: StreamConfig)
```

#### Methods
- `appendEvent(streamId: string, event: E, expectedRevision?: bigint): Promise<void>`
- `getCurrentState(streamId: string, applyEvent: (state: S | null, event: E) => S): Promise<{ state: S | null; version: number }>`
- `getLatestSnapshot(streamId: string): Promise<Snapshot<S> | null>`
- `createSnapshot(streamId: string, state: S | null, version: number): Promise<void>`

### Types

- `BaseEvent<T, D>`: Base type for all events
- `StreamConfig`: Configuration options for StreamHelper
- `EventMigration`: Event migration definition
- `Snapshot`: Snapshot data structure
- `JSONType`: Type for JSON-compatible objects

## License

MIT
