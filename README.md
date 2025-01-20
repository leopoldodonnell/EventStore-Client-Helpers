# es-helpers

Helper functions for working with EventStoreDB streams and snapshots in TypeScript.

## Features

- Stream reading with snapshot support
- Automatic snapshot creation and management
- Event metadata support for tracking and auditing
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
const result = await streamHelper.readFromSnapshot('aggregate-123', applyEvent);
if (result) {
  console.log('Current state:', result.state);
  console.log('Current version:', result.version);
}

// Append event with metadata
const event = {
  type: 'UserAction',
  data: { /* event data */ }
};

const metadata = {
  userId: 'user-123',
  transactionId: crypto.randomUUID(),
  source: 'web',
  // timestamp and correlationId will be auto-generated if not provided
};

await streamHelper.appendEvent('aggregate-123', event, metadata);

// Create snapshot
await streamHelper.createSnapshot('aggregate-123', state, version);
```

### Example: Bank Account with Transaction Tracking

```typescript
interface TransactionMetadata {
  userId: string;
  transactionId: string;
  source: string;
  timestamp?: string;
  correlationId?: string;
}

class AccountAggregate {
  async deposit(accountId: string, amount: number, userId: string): Promise<void> {
    const event = {
      type: 'MoneyDeposited',
      data: { amount }
    };

    const metadata: TransactionMetadata = {
      userId,
      transactionId: crypto.randomUUID(),
      source: 'web'
    };

    await this.streamHelper.appendEvent(accountId, event, metadata);
  }
}
```

In this example, each transaction is tracked with metadata including:
- Who performed the action (userId)
- A unique transaction ID
- The source of the transaction
- Automatic timestamp and correlation ID

This metadata can be used for:
- Audit trails
- Transaction tracing
- User activity monitoring
- System integration tracking

## License

MIT
