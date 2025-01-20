import express from 'express';
import { EventStoreDBClient } from '@eventstore/db-client';
import { AccountAggregate } from './account';

const app = express();
app.use(express.json());

const client = EventStoreDBClient.connectionString('esdb://localhost:2113?tls=false');
const accountAggregate = new AccountAggregate(client);

// Create a new account
app.post('/accounts', async (req, res) => {
  try {
    const { owner, initialBalance } = req.body;
    const accountId = Math.random().toString(36).substring(7);
    await accountAggregate.createAccount(accountId, owner, initialBalance);
    res.json({ accountId });
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Get account details
app.get('/accounts/:id', async (req, res) => {
  try {
    const account = await accountAggregate.getAccount(req.params.id);
    if (!account) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }
    res.json(account);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Deposit money
app.post('/accounts/:id/deposit', async (req, res) => {
  try {
    const { amount, userId } = req.body;
    await accountAggregate.deposit(req.params.id, amount, userId);
    const account = await accountAggregate.getAccount(req.params.id);
    res.json(account);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

// Withdraw money
app.post('/accounts/:id/withdraw', async (req, res) => {
  try {
    const { amount, userId } = req.body;
    await accountAggregate.withdraw(req.params.id, amount, userId);
    const account = await accountAggregate.getAccount(req.params.id);
    res.json(account);
  } catch (error) {
    res.status(500).json({ error: (error as Error).message });
  }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`Bank API listening at http://localhost:${port}`);
});
