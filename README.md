# es-helpers

Helper functions for working with EventStoreDB streams and snapshots in TypeScript.

## Features

- Stream reading with snapshot support
- Automatic snapshot creation and management
- TypeScript support with full type definitions

## Installation

```bash
npm install es-helpers
```

## Usage

```typescript
import { EventStoreDBClient } from '@eventstore/db-client';
import { StreamHelper } from 'es-helpers';

// Create EventStoreDB client
const client = EventStoreDBClient.connectionString('esdb://localhost:2113?tls=false');

// Configure stream helper
const streamHelper = new StreamHelper(client, {
  streamPrefix: 'myapp',
  snapshotFrequency: 100 // Optional: create snapshot every 100 events
});

// Read from snapshot
const result = await streamHelper.readFromSnapshot('aggregate-123');
if (result) {
  console.log('Current state:', result.state);
  console.log('Current version:', result.version);
}

// Create snapshot
await streamHelper.createSnapshot('aggregate-123', state, version);
```

## License

MIT
