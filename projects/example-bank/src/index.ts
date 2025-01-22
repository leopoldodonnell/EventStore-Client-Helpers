import express from 'express';
import { EventStoreDBClient } from '@eventstore/db-client';
import { AccountAggregate } from './account';
import crypto from 'crypto';
import { StreamHelper } from '@eventstore-helpers/core';
import { migrations } from './migrations';
import { BankAccount, AccountEventV1, AccountEventV2 } from './types';

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
    const accountId = await accountAggregate.createAccount(owner, initialBalance, accountType);
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
    console.error('Error creating account:', error);
    res.status(500).json({ error: (error as Error).message });
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
    console.error('Error getting account:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Deposit money
app.post('/accounts/:id/deposit', async (req, res) => {
  try {
    const { amount, userId, description } = req.body;
    console.log('Depositing to account:', req.params.id, { amount, userId, description });
    
    // First verify account exists
    const account = await accountAggregate.getAccount(req.params.id);
    if (!account) {
      console.error('Account not found for deposit:', req.params.id);
      res.status(404).json({ error: 'Account not found' });
      return;
    }
    
    await accountAggregate.deposit(req.params.id, amount, userId, description);
    const updatedAccount = await accountAggregate.getAccount(req.params.id);
    console.log('Account after deposit:', updatedAccount);
    res.json(updatedAccount);
  } catch (error) {
    console.error('Error depositing money:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

// Withdraw money
app.post('/accounts/:id/withdraw', async (req, res) => {
  try {
    const { amount, userId, description } = req.body;
    console.log('Withdrawing money from account:', req.params.id, { amount, userId, description });
    
    // First verify account exists
    const account = await accountAggregate.getAccount(req.params.id);
    if (!account) {
      console.error('Account not found for withdrawal:', req.params.id);
      res.status(404).json({ error: 'Account not found' });
      return;
    }
    
    await accountAggregate.withdraw(req.params.id, amount, userId, description);
    const updatedAccount = await accountAggregate.getAccount(req.params.id);
    console.log('Account after withdrawal:', updatedAccount);
    res.json(updatedAccount);
  } catch (error) {
    console.error('Error withdrawing money:', error);
    res.status(500).json({ error: (error as Error).message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Bank API listening at http://localhost:${port}`);
});
