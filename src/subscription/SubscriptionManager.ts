import { v4 as uuid } from 'uuid';
import type { Subscription } from '../agents/types.js';
import { logger } from '../utils/logger.js';

/**
 * SubscriptionManager — Manages user subscriptions to lead traders.
 *
 * Users can subscribe their wallet to a lead trader's address.
 * When the trader makes a trade, all active subscribers have their
 * trades mirrored by the AI agents.
 */
export class SubscriptionManager {
    private subscriptions: Map<string, Subscription> = new Map();

    /**
     * Subscribe a wallet to a lead trader.
     */
    subscribe(
        subscriberWalletId: string,
        traderAddress: string,
        maxTradeSize?: string
    ): Subscription {
        // Check for duplicate
        for (const sub of this.subscriptions.values()) {
            if (
                sub.subscriberWalletId === subscriberWalletId &&
                sub.traderAddress.toLowerCase() === traderAddress.toLowerCase() &&
                sub.active
            ) {
                logger.warn(`Wallet ${subscriberWalletId} already subscribed to ${traderAddress}`);
                return sub;
            }
        }

        const subscription: Subscription = {
            id: uuid(),
            subscriberWalletId,
            traderAddress: traderAddress.toLowerCase(),
            createdAt: new Date().toISOString(),
            active: true,
            maxTradeSize,
        };

        this.subscriptions.set(subscription.id, subscription);
        logger.info(`🔔 New subscription: wallet ${subscriberWalletId.slice(0, 8)}... → trader ${traderAddress.slice(0, 8)}...`);

        return subscription;
    }

    /**
     * Unsubscribe a wallet from a trader.
     */
    unsubscribe(subscriptionId: string): boolean {
        const sub = this.subscriptions.get(subscriptionId);
        if (!sub) return false;

        sub.active = false;
        logger.info(`🔕 Unsubscribed: ${subscriptionId}`);
        return true;
    }

    /**
     * Get all active subscribers for a trader address.
     */
    getSubscribers(traderAddress: string): Subscription[] {
        return Array.from(this.subscriptions.values()).filter(
            sub => sub.traderAddress === traderAddress.toLowerCase() && sub.active
        );
    }

    /**
     * Get all subscriptions for a wallet.
     */
    getWalletSubscriptions(walletId: string): Subscription[] {
        return Array.from(this.subscriptions.values()).filter(
            sub => sub.subscriberWalletId === walletId && sub.active
        );
    }

    /**
     * Get all active subscriptions.
     */
    getAllSubscriptions(): Subscription[] {
        return Array.from(this.subscriptions.values()).filter(sub => sub.active);
    }

    /**
     * Get all unique trader addresses being monitored.
     */
    getMonitoredTraders(): string[] {
        const traders = new Set<string>();
        for (const sub of this.subscriptions.values()) {
            if (sub.active) traders.add(sub.traderAddress);
        }
        return Array.from(traders);
    }
}
