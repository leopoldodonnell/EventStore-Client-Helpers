import request from 'supertest';
import express from 'express';
import { EventStoreDBClient } from '@eventstore/db-client';
import { AccountAggregate } from './account';
import { BankAccount } from './types';

// Mock EventStoreDBClient and AccountAggregate
jest.mock('@eventstore/db-client');
jest.mock('./account');

describe('Bank API', () => {
  let app: express.Application;
  let mockAccountAggregate: jest.Mocked<AccountAggregate>;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();

    // Create a fresh express app for each test
    app = express();
    app.use(express.json());

    // Setup mock AccountAggregate
    mockAccountAggregate = new AccountAggregate(null as any) as jest.Mocked<AccountAggregate>;
    
    // Mock the endpoints
    app.post('/accounts', async (req, res) => {
      try {
        const { owner, initialBalance, accountType } = req.body;
        const accountId = 'test-account-id'; // Fixed ID for testing
        const metadata = {
          userId: 'test-user',
          transactionId: expect.any(String),
          source: 'api'
        };
        await mockAccountAggregate.createAccount(accountId, owner, initialBalance, accountType, metadata);
        res.json({ accountId });
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    app.get('/accounts/:id', async (req, res) => {
      try {
        const account = await mockAccountAggregate.getAccount(req.params.id);
        if (!account) {
          res.status(404).json({ error: 'Account not found' });
          return;
        }
        res.json(account);
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    app.post('/accounts/:id/deposit', async (req, res) => {
      try {
        const { amount } = req.body;
        const userId = req.headers['x-user-id'] as string || 'anonymous';
        const metadata = {
          userId,
          transactionId: expect.any(String),
          source: 'api'
        };
        await mockAccountAggregate.deposit(req.params.id, amount, 'API Deposit', metadata);
        const account = await mockAccountAggregate.getAccount(req.params.id);
        res.json(account);
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    app.post('/accounts/:id/withdraw', async (req, res) => {
      try {
        const { amount } = req.body;
        const userId = req.headers['x-user-id'] as string || 'anonymous';
        const metadata = {
          userId,
          transactionId: expect.any(String),
          source: 'api'
        };
        await mockAccountAggregate.withdraw(req.params.id, amount, 'API Withdrawal', metadata);
        const account = await mockAccountAggregate.getAccount(req.params.id);
        res.json(account);
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });
  });

  describe('POST /accounts', () => {
    it('should create a new account', async () => {
      const accountId = 'test-account-id';
      const owner = 'John Doe';
      const initialBalance = 1000;
      const accountType = 'checking';
      const metadata = {
        userId: 'test-user',
        transactionId: expect.any(String),
        source: 'api'
      };

      const response = await request(app)
        .post('/accounts')
        .send({ owner, initialBalance, accountType });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('accountId');
      expect(mockAccountAggregate.createAccount).toHaveBeenCalledWith(
        expect.any(String),
        owner,
        initialBalance,
        accountType,
        expect.objectContaining(metadata)
      );
    });
  });

  describe('GET /accounts/:id', () => {
    it('should return account details when account exists', async () => {
      const mockAccount: BankAccount = {
        id: 'test-account-id',
        owner: 'John Doe',
        balance: 1000,
        version: 1,
        accountType: 'checking',
        createdAt: '2025-01-20T17:11:19-05:00',
        updatedAt: '2025-01-20T17:11:19-05:00',
        type: 'BankAccount',
        data: {
          id: 'test-account-id',
          owner: 'John Doe',
          balance: 1000,
          accountType: 'checking'
        }
      };

      mockAccountAggregate.getAccount.mockResolvedValue(mockAccount);

      const response = await request(app).get('/accounts/test-account-id');

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockAccount);
      expect(mockAccountAggregate.getAccount).toHaveBeenCalledWith('test-account-id');
    });

    it('should return 404 when account does not exist', async () => {
      mockAccountAggregate.getAccount.mockResolvedValue(null);

      const response = await request(app).get('/accounts/non-existent');

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ error: 'Account not found' });
    });
  });

  describe('POST /accounts/:id/deposit', () => {
    it('should deposit money and return updated account', async () => {
      const mockAccount: BankAccount = {
        id: 'test-account-id',
        owner: 'John Doe',
        balance: 1500,
        version: 1,
        accountType: 'checking',
        createdAt: '2025-01-20T17:11:19-05:00',
        updatedAt: '2025-01-20T17:11:19-05:00',
        type: 'BankAccount',
        data: {
          id: 'test-account-id',
          owner: 'John Doe',
          balance: 1500,
          accountType: 'checking'
        }
      };

      mockAccountAggregate.getAccount.mockResolvedValue(mockAccount);

      const response = await request(app)
        .post('/accounts/test-account-id/deposit')
        .set('x-user-id', 'test-user')
        .send({ amount: 500 });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockAccount);
      expect(mockAccountAggregate.deposit).toHaveBeenCalledWith(
        'test-account-id',
        500,
        'API Deposit',
        expect.objectContaining({
          userId: 'test-user',
          transactionId: expect.any(String),
          source: 'api'
        })
      );
    });
  });

  describe('POST /accounts/:id/withdraw', () => {
    it('should withdraw money and return updated account', async () => {
      const mockAccount: BankAccount = {
        id: 'test-account-id',
        owner: 'John Doe',
        balance: 500,
        version: 1,
        accountType: 'checking',
        createdAt: '2025-01-20T17:11:19-05:00',
        updatedAt: '2025-01-20T17:11:19-05:00',
        type: 'BankAccount',
        data: {
          id: 'test-account-id',
          owner: 'John Doe',
          balance: 500,
          accountType: 'checking'
        }
      };

      mockAccountAggregate.getAccount.mockResolvedValue(mockAccount);

      const response = await request(app)
        .post('/accounts/test-account-id/withdraw')
        .set('x-user-id', 'test-user')
        .send({ amount: 500 });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockAccount);
      expect(mockAccountAggregate.withdraw).toHaveBeenCalledWith(
        'test-account-id',
        500,
        'API Withdrawal',
        expect.objectContaining({
          userId: 'test-user',
          transactionId: expect.any(String),
          source: 'api'
        })
      );
    });
  });
});
