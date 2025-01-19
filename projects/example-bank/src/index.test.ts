import request from 'supertest';
import express from 'express';
import { EventStoreDBClient } from '@eventstore/db-client';
import { AccountAggregate } from './account';

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
        await mockAccountAggregate.deposit(req.params.id, amount);
        const account = await mockAccountAggregate.getAccount(req.params.id);
        res.json(account);
      } catch (error) {
        res.status(500).json({ error: (error as Error).message });
      }
    });

    app.post('/accounts/:id/withdraw', async (req, res) => {
      try {
        const { amount } = req.body;
        await mockAccountAggregate.withdraw(req.params.id, amount);
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
      const mockAccount = {
        id: 'test-account-id',
        owner: 'John Doe',
        balance: 1000,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockAccountAggregate.getAccount.mockResolvedValue(mockAccount);

      const response = await request(app).get('/accounts/test-account-id');

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        id: 'test-account-id',
        owner: 'John Doe',
        balance: 1000,
      });
    });

    it('should return 404 when account does not exist', async () => {
      mockAccountAggregate.getAccount.mockResolvedValue(null);

      const response = await request(app).get('/accounts/non-existent');

      expect(response.status).toBe(404);
      expect(response.body).toHaveProperty('error', 'Account not found');
    });
  });

  describe('POST /accounts/:id/deposit', () => {
    it('should deposit money and return updated account', async () => {
      const mockAccount = {
        id: 'test-account-id',
        owner: 'John Doe',
        balance: 1500,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockAccountAggregate.getAccount.mockResolvedValue(mockAccount);

      const response = await request(app)
        .post('/accounts/test-account-id/deposit')
        .send({ amount: 500 });

      expect(response.status).toBe(200);
      expect(mockAccountAggregate.deposit).toHaveBeenCalledWith('test-account-id', 500);
      expect(response.body).toMatchObject({
        id: 'test-account-id',
        balance: 1500,
      });
    });
  });

  describe('POST /accounts/:id/withdraw', () => {
    it('should withdraw money and return updated account', async () => {
      const mockAccount = {
        id: 'test-account-id',
        owner: 'John Doe',
        balance: 500,
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      mockAccountAggregate.getAccount.mockResolvedValue(mockAccount);

      const response = await request(app)
        .post('/accounts/test-account-id/withdraw')
        .send({ amount: 300 });

      expect(response.status).toBe(200);
      expect(mockAccountAggregate.withdraw).toHaveBeenCalledWith('test-account-id', 300);
      expect(response.body).toMatchObject({
        id: 'test-account-id',
        balance: 500,
      });
    });

    it('should return error when withdrawal fails', async () => {
      mockAccountAggregate.withdraw.mockRejectedValue(new Error('Insufficient funds'));

      const response = await request(app)
        .post('/accounts/test-account-id/withdraw')
        .send({ amount: 1000 });

      expect(response.status).toBe(500);
      expect(response.body).toHaveProperty('error', 'Insufficient funds');
    });
  });
});
