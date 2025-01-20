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
        const { owner, initialBalance } = req.body;
        const accountId = 'test-account-id'; // Fixed ID for testing
        await mockAccountAggregate.createAccount(accountId, owner, initialBalance);
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
        await mockAccountAggregate.deposit(req.params.id, amount, userId);
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
        await mockAccountAggregate.withdraw(req.params.id, amount, userId);
        const account = await mockAccountAggregate.getAccount(req.params.id);
        res.json(account);
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });
  });

  describe('POST /accounts', () => {
    it('should create a new account', async () => {
      const response = await request(app)
        .post('/accounts')
        .send({ owner: 'John Doe', initialBalance: 1000 });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('accountId');
      expect(mockAccountAggregate.createAccount).toHaveBeenCalledWith(
        'test-account-id',
        'John Doe',
        1000
      );
    });
  });

  describe('GET /accounts/:id', () => {
    it('should return account details when account exists', async () => {
      const mockAccount: BankAccount = {
        id: 'test-account-id',
        owner: 'John Doe',
        balance: 1000,
        accountType: 'checking',
        createdAt: new Date('2025-01-20T12:28:19.061Z'),
        updatedAt: new Date('2025-01-20T12:28:19.061Z'),
      };

      mockAccountAggregate.getAccount.mockResolvedValue(mockAccount);

      const response = await request(app).get('/accounts/test-account-id');

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        ...mockAccount,
        createdAt: mockAccount.createdAt.toISOString(),
        updatedAt: mockAccount.updatedAt.toISOString()
      });
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
        accountType: 'checking',
        createdAt: new Date('2025-01-20T12:28:19.072Z'),
        updatedAt: new Date('2025-01-20T12:28:19.072Z'),
      };

      mockAccountAggregate.getAccount.mockResolvedValue(mockAccount);

      const response = await request(app)
        .post('/accounts/test-account-id/deposit')
        .set('x-user-id', 'test-user')
        .send({ amount: 500 });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        ...mockAccount,
        createdAt: mockAccount.createdAt.toISOString(),
        updatedAt: mockAccount.updatedAt.toISOString()
      });
      expect(mockAccountAggregate.deposit).toHaveBeenCalledWith(
        'test-account-id',
        500,
        'test-user'
      );
    });
  });

  describe('POST /accounts/:id/withdraw', () => {
    it('should withdraw money and return updated account', async () => {
      const mockAccount: BankAccount = {
        id: 'test-account-id',
        owner: 'John Doe',
        balance: 500,
        accountType: 'checking',
        createdAt: new Date('2025-01-20T12:28:19.075Z'),
        updatedAt: new Date('2025-01-20T12:28:19.075Z'),
      };

      mockAccountAggregate.getAccount.mockResolvedValue(mockAccount);

      const response = await request(app)
        .post('/accounts/test-account-id/withdraw')
        .set('x-user-id', 'test-user')
        .send({ amount: 500 });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({
        ...mockAccount,
        createdAt: mockAccount.createdAt.toISOString(),
        updatedAt: mockAccount.updatedAt.toISOString()
      });
      expect(mockAccountAggregate.withdraw).toHaveBeenCalledWith(
        'test-account-id',
        500,
        'test-user'
      );
    });
  });
});
