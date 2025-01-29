import express from 'express';
import { EventStoreDBClient } from '@eventstore/db-client';
import { AccountAggregate } from './account';
import crypto from 'crypto';
import { StreamHelper } from '@eventstore-helpers/core';
import { migrations } from './migrations';
import { BankAccount, AccountEventV1, AccountEventV2 } from './types';
import { v4 as uuidv4 } from 'uuid';

const app = express();
app.use(express.json());

const client = EventStoreDBClient.connectionString('esdb://admin:changeit@localhost:2113?tls=false');
const streamHelper = new StreamHelper<BankAccount, AccountEventV1 | AccountEventV2>(client, {
  snapshotFrequency: 5,
  currentEventVersion: 1,
  eventMigrations: migrations as any // TODO: Improve type safety here
});
const accountAggregate = new AccountAggregate(streamHelper);

// Create a new account
app.post('/accounts', async (req, res) => {
  try {
    const { owner, initialBalance, accountType } = req.body;
    console.log('Creating account with:', { owner, initialBalance, accountType });
    const accountId = crypto.randomUUID();
    const metadata = {
      userId: 'system',
      source: 'api',
      transactionId: crypto.randomUUID()
    };
    await accountAggregate.createAccount(accountId, owner, initialBalance, accountType, metadata);
    console.log('Account created with ID:', accountId);
    
    // Add delay to ensure event is processed
    await new Promise(resolve => setTimeout(resolve, 100));
    
    const account = await accountAggregate.getAccount(accountId);
    console.log('Retrieved account:', account);
    
    if (!account) {
      console.error('Account not found after creation');
      res.status(500).json({ error: 'Account not found after creation' });
      return;
    }
    
    res.json(account);
  } catch (error) {
    if (error instanceof Error) {
      console.error('Error creating account:', error);
      res.status(500).json({ error: error.message });
    } else {
      console.error('Unknown error creating account:', error);
      res.status(500).json({ error: 'An unknown error occurred' });
    }
  }
});

// Get account details
app.get('/accounts/:id', async (req, res) => {
  try {
    console.log('Getting account:', req.params.id);
    const account = await accountAggregate.getAccount(req.params.id);
    console.log('Retrieved account:', account);
    
    if (!account) {
      console.log('Account not found:', req.params.id);
      res.status(404).json({ error: 'Account not found' });
      return;
    }
    res.json(account);
  } catch (error) {
    if (error instanceof Error) {
      console.error('Error getting account:', error);
      res.status(500).json({ error: error.message });
    } else {
      console.error('Unknown error getting account:', error);
      res.status(500).json({ error: 'An unknown error occurred' });
    }
  }
});

// Deposit money
app.post('/accounts/:id/deposit', async (req, res) => {
  try {
    const { amount } = req.body;
    const userId = req.headers['x-user-id'] as string || 'anonymous';
    const metadata = {
      userId,
      transactionId: uuidv4(),
      source: 'api'
    };

    await accountAggregate.deposit(req.params.id, amount, 'API Deposit', metadata);
    const account = await accountAggregate.getAccount(req.params.id);
    res.json({ success: true, account });
  } catch (error) {
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(400).json({ error: 'An unknown error occurred' });
    }
  }
});

// Withdraw money
app.post('/accounts/:id/withdraw', async (req, res) => {
  try {
    const { amount } = req.body;
    const userId = req.headers['x-user-id'] as string || 'anonymous';
    const metadata = {
      userId,
      transactionId: uuidv4(),
      source: 'api'
    };

    await accountAggregate.withdraw(req.params.id, amount, 'API Withdrawal', metadata);
    const account = await accountAggregate.getAccount(req.params.id);
    res.json({ success: true, account });
  } catch (error) {
    if (error instanceof Error) {
      res.status(400).json({ error: error.message });
    } else {
      res.status(400).json({ error: 'An unknown error occurred' });
    }
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Bank API listening at http://localhost:${port}`);
});
