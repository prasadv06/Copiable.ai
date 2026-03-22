import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Data shape for wdk-data.json — matches wdk-mcp convention.
 */
export interface StoreData {
    users: Record<string, UserRecord>;
    wallets: Record<string, WalletRecord>;
    subscriptions: SubscriptionRecord[];
    following: FollowRecord[];
    tradeHistory: TradeHistoryRecord[];
}

export interface UserRecord {
    connectedAddress: string;
    wdkWalletId: string;
    wdkAddress: string;
    seedPhrase: string;
    label: string;
    createdAt: string;
}

export interface WalletRecord {
    id: string;
    label: string;
    address: string;
    seedPhrase: string;
    isLeadTrader: boolean;
    createdAt: string;
    connectedAddress?: string;
}

export interface SubscriptionRecord {
    id: string;
    subscriberWalletId: string;
    traderAddress: string;
    maxTradeSize?: string;
    createdAt: string;
}

export interface FollowRecord {
    traderAddress: string;
    label: string;
    followedBy: string; // connected wallet address
    startedAt: string;
    active: boolean;
}

export interface TradeHistoryRecord {
    id: string;
    timestamp: string;
    traderAddress: string;
    txHash: string;
    type: string;
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
    status: string;
    executionResults: Array<{
        walletAddress: string;
        success: boolean;
        txHash?: string;
        reason?: string;
    }>;
}

/**
 * JsonStore — Persistent JSON file storage for WDK data.
 *
 * Stores all users, wallets, subscriptions, and trade history in
 * a local `wdk-data.json` file (same convention as wdk-mcp).
 * Data survives server restarts.
 */
export class JsonStore {
    private filePath: string;
    private data: StoreData;

    constructor(filePath?: string) {
        this.filePath = filePath || path.resolve(__dirname, '../../wdk-data.json');
        this.data = this.load();
        logger.info(`💾 JsonStore ready at: ${this.filePath} (${Object.keys(this.data.users).length} users, ${Object.keys(this.data.wallets).length} wallets)`);
    }

    // ─── Load / Save ────────────────────────────────────────────

    private load(): StoreData {
        try {
            if (fs.existsSync(this.filePath)) {
                const raw = fs.readFileSync(this.filePath, 'utf-8');
                const parsed = JSON.parse(raw);
                return {
                    users: parsed.users || {},
                    wallets: parsed.wallets || {},
                    subscriptions: parsed.subscriptions || [],
                    following: parsed.following || [],
                    tradeHistory: parsed.tradeHistory || [],
                };
            }
        } catch (error) {
            logger.warn(`⚠️ Failed to load store from ${this.filePath}: ${error}`);
        }

        return { users: {}, wallets: {}, subscriptions: [], following: [], tradeHistory: [] };
    }

    private save(): void {
        try {
            fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf-8');
        } catch (error) {
            logger.error(`❌ Failed to save store: ${error}`);
        }
    }

    // ─── Users ──────────────────────────────────────────────────

    getUser(connectedAddress: string): UserRecord | undefined {
        return this.data.users[connectedAddress.toLowerCase()];
    }

    setUser(user: UserRecord): void {
        this.data.users[user.connectedAddress.toLowerCase()] = user;
        this.save();
    }

    getAllUsers(): UserRecord[] {
        return Object.values(this.data.users);
    }

    // ─── Wallets ────────────────────────────────────────────────

    getWallet(id: string): WalletRecord | undefined {
        return this.data.wallets[id];
    }

    setWallet(wallet: WalletRecord): void {
        this.data.wallets[wallet.id] = wallet;
        this.save();
    }

    getAllWallets(): WalletRecord[] {
        return Object.values(this.data.wallets);
    }

    getWalletByAddress(address: string): WalletRecord | undefined {
        return Object.values(this.data.wallets).find(
            w => w.address.toLowerCase() === address.toLowerCase()
        );
    }

    // ─── Subscriptions ──────────────────────────────────────────

    addSubscription(sub: SubscriptionRecord): void {
        this.data.subscriptions.push(sub);
        this.save();
    }

    getSubscriptions(): SubscriptionRecord[] {
        return this.data.subscriptions;
    }

    removeSubscription(id: string): boolean {
        const before = this.data.subscriptions.length;
        this.data.subscriptions = this.data.subscriptions.filter(s => s.id !== id);
        this.save();
        return this.data.subscriptions.length < before;
    }

    // ─── Following (Live Monitoring) ────────────────────────────

    follow(record: FollowRecord): void {
        // Remove existing follow for same trader by same user
        this.data.following = this.data.following.filter(
            f => !(f.traderAddress.toLowerCase() === record.traderAddress.toLowerCase()
                && f.followedBy.toLowerCase() === record.followedBy.toLowerCase())
        );
        this.data.following.push(record);
        this.save();
    }

    unfollow(traderAddress: string, followedBy: string): boolean {
        const before = this.data.following.length;
        this.data.following = this.data.following.filter(
            f => !(f.traderAddress.toLowerCase() === traderAddress.toLowerCase()
                && f.followedBy.toLowerCase() === followedBy.toLowerCase())
        );
        this.save();
        return this.data.following.length < before;
    }

    getActiveFollows(): FollowRecord[] {
        return this.data.following.filter(f => f.active);
    }

    getAllFollows(): FollowRecord[] {
        return this.data.following;
    }

    // ─── Trade History ──────────────────────────────────────────

    addTradeHistory(entry: TradeHistoryRecord): void {
        this.data.tradeHistory.push(entry);
        // Keep last 500 entries
        if (this.data.tradeHistory.length > 500) {
            this.data.tradeHistory = this.data.tradeHistory.slice(-500);
        }
        this.save();
    }

    getTradeHistory(limit = 50): TradeHistoryRecord[] {
        return this.data.tradeHistory.slice(-limit);
    }

    // ─── Raw access ─────────────────────────────────────────────

    getRawData(): StoreData {
        return { ...this.data };
    }
}
