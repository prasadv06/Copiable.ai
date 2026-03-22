/* ═══════════════════════════════════════════════════════════ */
/*  Copiabel.ai — Dashboard Logic                              */
/*  Home/Copytrade Tabs, MetaMask Connect, Data Polling        */
/* ═══════════════════════════════════════════════════════════ */

const API = '';
let state = {
    connectedAddress: null,
    wdkAddress: null,
    wdkWalletId: null,
    isConnected: false,
};

let pollInterval = null;

// ─── Boot ───────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', () => {
    // Check localStorage for returning user
    const saved = localStorage.getItem('copyTradeUser');
    if (saved) {
        try {
            state = JSON.parse(saved);
            if (state.connectedAddress) {
                // Return user — show connected state
                updateNavState();
                ensureDashboardPolling();
            }
        } catch { /* ignore */ }
    }

    // Default: Show Home
    switchTab('homeSection');
    setupEventListeners();
});

function setupEventListeners() {
    // Navigation
    document.getElementById('navHome')?.addEventListener('click', () => switchTab('homeSection'));
    document.getElementById('navCopytrade')?.addEventListener('click', () => switchTab('copytradeSection'));
    document.getElementById('navVault')?.addEventListener('click', () => switchTab('vaultSection'));
    document.getElementById('btnHeroLaunch')?.addEventListener('click', () => switchTab('copytradeSection'));

    // Wallet Connect / Disconnect
    document.getElementById('btnNavConnect')?.addEventListener('click', connectMetaMask);
    document.getElementById('btnNavDisconnect')?.addEventListener('click', disconnectWallet);
    document.getElementById('btnConnectPrompt')?.addEventListener('click', connectMetaMask);
    document.getElementById('btnSkipConnect')?.addEventListener('click', skipToDemoMode);

    // Dashboard Actions
    document.getElementById('btnFollow')?.addEventListener('click', followTrader);
    document.getElementById('btnCreateWallet')?.addEventListener('click', createWallet);
    document.getElementById('btnSimulate')?.addEventListener('click', simulateTrade);
    document.getElementById('btnScanChain')?.addEventListener('click', scanBlockchain);
    document.getElementById('btnRefreshHistory')?.addEventListener('click', fetchTradeHistory);
    document.getElementById('btnClearLogs')?.addEventListener('click', () => {
        document.getElementById('reasoningLog').innerHTML = '<div class="empty-state">System idle. Ready for analysis.</div>';
    });
}

// ─── Tab Navigation ─────────────────────────────────────────

function switchTab(tabId) {
    // Update active nav link
    if (document.getElementById('navHome')) document.getElementById('navHome').classList.toggle('active', tabId === 'homeSection');
    if (document.getElementById('navCopytrade')) document.getElementById('navCopytrade').classList.toggle('active', tabId === 'copytradeSection');
    if (document.getElementById('navVault')) document.getElementById('navVault').classList.toggle('active', tabId === 'vaultSection');

    // Switch sections
    if (document.getElementById('homeSection')) document.getElementById('homeSection').style.display = tabId === 'homeSection' ? 'block' : 'none';
    if (document.getElementById('copytradeSection')) document.getElementById('copytradeSection').style.display = tabId === 'copytradeSection' && state.isConnected ? 'block' : 'none';
    if (document.getElementById('vaultSection')) document.getElementById('vaultSection').style.display = tabId === 'vaultSection' && state.isConnected ? 'block' : 'none';

    // Connect Prompts and internal Interfaces
    if (document.getElementById('copytradeConnectPrompt')) {
        const needsAuth = (tabId === 'copytradeSection' || tabId === 'vaultSection') && !state.isConnected;
        document.getElementById('copytradeConnectPrompt').style.display = needsAuth ? 'flex' : 'none';
    }

    // Reveal the inner grid if connected and on the copytrade tab
    if (document.getElementById('copytradeInterface')) {
        document.getElementById('copytradeInterface').style.display = (tabId === 'copytradeSection' && state.isConnected) ? 'block' : 'none';
    }

    if (tabId === 'homeSection' || !state.isConnected) {
        stopDashboardPolling();
    } else {
        ensureDashboardPolling();
        fetchAll(); // Immediate fetch on tab open
    }
}

// ─── MetaMask Connect ───────────────────────────────────────

function updateNavState() {
    if (state.isConnected && state.connectedAddress) {
        document.getElementById('btnNavConnect').style.display = 'none';
        document.getElementById('navUserBadge').style.display = 'flex';
        document.getElementById('navUserAddr').textContent = truncAddr(state.connectedAddress);
    } else {
        document.getElementById('btnNavConnect').style.display = 'flex';
        document.getElementById('navUserBadge').style.display = 'none';
    }
}

async function connectMetaMask() {
    const errEls = [document.getElementById('connectError')]; // Can add more if needed

    if (typeof window.ethereum === 'undefined') {
        errEls.forEach(el => {
            if (el) {
                el.textContent = 'MetaMask is not installed. Install it from metamask.io or use Demo Mode.';
                el.style.display = 'block';
            }
        });
        return;
    }

    try {
        errEls.forEach(el => { if (el) el.style.display = 'none'; });
        const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
        const address = accounts[0];

        // Ensure Sepolia
        try {
            await window.ethereum.request({
                method: 'wallet_switchEthereumChain',
                params: [{ chainId: '0xaa36a7' }],
            });
        } catch (switchErr) {
            console.warn('Could not switch to Sepolia:', switchErr);
        }

        // Backend Sync
        const resp = await fetch(`${API}/api/wallets/connect`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ address }),
        });

        if (!resp.ok) throw new Error(await resp.text());
        const data = await resp.json();

        state.connectedAddress = data.connectedAddress;
        state.wdkAddress = data.wdkAddress;
        state.wdkWalletId = data.wdkWalletId;
        state.isConnected = true;

        localStorage.setItem('copyTradeUser', JSON.stringify(state));

        updateNavState();

        // If we are currently on the Copytrade tab looking at the prompt, switch to the interface
        if (document.getElementById('copytradeSection').style.display !== 'none') {
            switchTab('copytradeSection');
        }
    } catch (err) {
        errEls.forEach(el => {
            if (el) {
                el.textContent = `Connection error: ${err.message}`;
                el.style.display = 'block';
            }
        });
    }
}

function disconnectWallet() {
    state = {
        connectedAddress: null,
        wdkAddress: null,
        wdkWalletId: null,
        isConnected: false,
    };
    localStorage.removeItem('copyTradeUser');
    updateNavState();

    // If on copytrade tab, kick back to prompt
    if (document.getElementById('copytradeSection').style.display !== 'none') {
        switchTab('copytradeSection');
    }
}

async function skipToDemoMode() {
    try {
        const resp = await fetch(`${API}/api/wallets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ label: 'Demo Sub', isLeadTrader: false }),
        });
        const data = await resp.json();

        state.connectedAddress = data.address; // fake it
        state.wdkAddress = data.address;
        state.wdkWalletId = data.id;
        state.isConnected = true;

        localStorage.setItem('copyTradeUser', JSON.stringify(state));
        updateNavState();

        if (document.getElementById('copytradeSection').style.display !== 'none') {
            switchTab('copytradeSection');
        }
    } catch (err) {
        console.error('Skip mode error:', err);
    }
}

// ─── Dashboard Polling ──────────────────────────────────────

function ensureDashboardPolling() {
    if (!pollInterval) {
        pollInterval = setInterval(fetchAll, 6000);
    }
}

function stopDashboardPolling() {
    if (pollInterval) {
        clearInterval(pollInterval);
        pollInterval = null;
    }
}

async function fetchAll() {
    if (!state.isConnected) return;
    fetchBlockchainInfo();
    fetchWallets();
    fetchMonitoringStatus();
    fetchTradeHistory();
    fetchReasoningLogs();
    updateMyWallet();
}

// ─── Data Fetching Methods ───────────────────────────────────

async function fetchBlockchainInfo() {
    try {
        const resp = await fetch(`${API}/api/blockchain/info`);
        if (!resp.ok) return;
        const data = await resp.json();
        document.getElementById('blockNum').textContent = `Block: ${data.blockNumber?.toLocaleString() || '...'}`;
        document.getElementById('gasPrice').textContent = `Gas: ${data.gasPriceGwei || '...'} gwei`;
    } catch { /* silent */ }
}

async function updateMyWallet() {
    const el = document.getElementById('vaultPortfolioInfo');
    const warnEl = document.getElementById('vaultFundWarning');
    if (!state.wdkAddress || !el) return;

    try {
        const resp = await fetch(`${API}/api/wallets/${state.wdkAddress}/balance`);
        if (!resp.ok) return;
        const bal = await resp.json();

        let html = `
            <div class="portfolio-table">
                <div class="portfolio-header">
                    <div>Token</div>
                    <div>Price</div>
                    <div>Balance</div>
                    <div>Value</div>
                </div>

                <div class="portfolio-row">
                    <div class="portfolio-token-col">
                        <div>
                            <div class="portfolio-token-name">Ethereum</div>
                            <div class="portfolio-token-symbol">ETH</div>
                        </div>
                    </div>
                    <div class="portfolio-price">$0</div>
                    <div class="portfolio-balance">${parseFloat(bal.ethBalance).toFixed(4)} ETH</div>
                    <div class="portfolio-value">$0.00</div>
                </div>
                
                <div class="portfolio-row">
                    <div class="portfolio-token-col">
                        <div>
                            <div class="portfolio-token-name">Tether</div>
                            <div class="portfolio-token-symbol">USDt</div>
                        </div>
                    </div>
                    <div class="portfolio-price">$0</div>
                    <div class="portfolio-balance">${parseFloat(bal.usdtBalance).toFixed(4)} USDt</div>
                    <div class="portfolio-value">$0.00</div>
                </div>

                <div class="portfolio-row">
                    <div class="portfolio-token-col">
                        <div>
                            <div class="portfolio-token-name">Wrapped ETH</div>
                            <div class="portfolio-token-symbol">WETH</div>
                        </div>
                    </div>
                    <div class="portfolio-price">$0</div>
                    <div class="portfolio-balance">${parseFloat(bal.wethBalance || 0).toFixed(4)} WETH</div>
                    <div class="portfolio-value">$0.00</div>
                </div>

                <div class="portfolio-row">
                    <div class="portfolio-token-col">
                        <div>
                            <div class="portfolio-token-name">Chainlink</div>
                            <div class="portfolio-token-symbol">LINK</div>
                        </div>
                    </div>
                    <div class="portfolio-price">$0</div>
                    <div class="portfolio-balance">${parseFloat(bal.linkBalance || 0).toFixed(4)} LINK</div>
                    <div class="portfolio-value">$0.00</div>
                </div>
        `;

        if (parseFloat(bal.usdcBalance || '0') > 0) {
            html += `
                <div class="portfolio-row">
                    <div class="portfolio-token-col">
                        <div>
                            <div class="portfolio-token-name">USDC</div>
                            <div class="portfolio-token-symbol">USDC</div>
                        </div>
                    </div>
                    <div class="portfolio-price">$0</div>
                    <div class="portfolio-balance">${parseFloat(bal.usdcBalance).toFixed(4)} USDC</div>
                    <div class="portfolio-value">$0.00</div>
                </div>
            `;
        }

        if (parseFloat(bal.aaveBalance || '0') > 0) {
            html += `
                <div class="portfolio-row">
                    <div class="portfolio-token-col">
                        <div>
                            <div class="portfolio-token-name">Aave</div>
                            <div class="portfolio-token-symbol">AAVE</div>
                        </div>
                    </div>
                    <div class="portfolio-price">$0</div>
                    <div class="portfolio-balance">${parseFloat(bal.aaveBalance).toFixed(4)} AAVE</div>
                    <div class="portfolio-value">$0.00</div>
                </div>
            `;
        }

        html += `
            </div>
            <div style="text-align: center; margin-top: 16px;">
                <a class="wallet-link" href="https://sepolia.etherscan.io/address/${state.wdkAddress}" target="_blank">Verify on Live Sepolia Testnet</a>
            </div>
        `;

        el.innerHTML = html;

        // Show warning if 0 ETH
        if (warnEl) {
            warnEl.style.display = parseFloat(bal.ethBalance) === 0 ? 'block' : 'none';
        }

        // Hydrate Side Column Smart Account Details
        const addressDisplay = document.getElementById('vaultAddressDisplay');
        if (addressDisplay && state.wdkAddress) {
            addressDisplay.textContent = state.wdkAddress;
        }
    } catch { /* silent */ }
}

async function followTrader() {
    const addr = document.getElementById('followAddress').value.trim();
    const label = document.getElementById('followLabel').value.trim();
    const resultEl = document.getElementById('followResult');

    if (!addr || !/^0x[a-fA-F0-9]{40}$/.test(addr)) {
        resultEl.innerHTML = '<p style="color: var(--danger); font-size: 0.75rem; margin-top: 8px;">Invalid address format</p>';
        return;
    }

    try {
        resultEl.innerHTML = '<p style="color: var(--accent-3); font-size: 0.75rem; margin-top: 8px;">Acquiring target...</p>';

        const resp = await fetch(`${API}/api/monitoring/follow`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                traderAddress: addr,
                followedBy: state.connectedAddress || state.wdkAddress,
                label: label || undefined,
            }),
        });

        if (!resp.ok) throw new Error(await resp.text());
        const data = await resp.json();

        resultEl.innerHTML = `
            <p style="color: var(--accent-2); font-size: 0.75rem; margin-top: 8px;">
                Target locked: <strong>${data.label}</strong>
            </p>
        `;

        document.getElementById('followAddress').value = '';
        document.getElementById('followLabel').value = '';
        fetchMonitoringStatus();
    } catch (err) {
        resultEl.innerHTML = `<p style="color: var(--danger); font-size: 0.75rem; margin-top: 8px;">${err.message}</p>`;
    }
}

async function fetchMonitoringStatus() {
    try {
        const resp = await fetch(`${API}/api/monitoring/status`);
        if (!resp.ok) return;
        const data = await resp.json();

        // Engine Badges
        const statusEl = document.getElementById('engineStatus');
        if (data.engineRunning) {
            statusEl.className = 'status-badge active';
            statusEl.innerHTML = '<span class="status-dot"></span><span>Active Sentinel</span>';
        } else {
            statusEl.className = 'status-badge';
            statusEl.innerHTML = '<span class="status-dot"></span><span>System Idle</span>';
        }

        const indicatorEl = document.getElementById('monitorIndicator');
        if (data.count > 0) {
            indicatorEl.className = 'monitor-indicator active';
            indicatorEl.innerHTML = `<span class="pulse-dot"></span> ${data.count} Target(s) Locked`;
        } else {
            indicatorEl.className = 'monitor-indicator';
            indicatorEl.textContent = '';
        }

        const statusArea = document.getElementById('monitorStatus');
        const followListArea = document.getElementById('followList');
        const traders = data.followedTraders || [];

        if (traders.length > 0) {
            if (document.getElementById('sectionStartCopyTrade')) document.getElementById('sectionStartCopyTrade').style.display = 'none';
            if (document.getElementById('sectionCurrentCopyTrade')) document.getElementById('sectionCurrentCopyTrade').style.display = 'block';
            if (document.getElementById('sectionAIAgents')) document.getElementById('sectionAIAgents').style.display = 'block';

            const html = traders.map(t => `
                <div class="follow-item" style="display: flex; align-items: center;">
                    <div class="follow-info" style="flex: 1;">
                        <div class="label">${t.label || 'Target'}</div>
                        <div class="addr">${truncAddr(t.traderAddress)}</div>
                    </div>
                    <div style="flex: 1; text-align: center;">
                        <div style="font-size: 0.7rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 2px;">Total PNL</div>
                        <div style="font-size: 0.8rem; color: var(--accent-3); font-weight: 500;">Coming Soon</div>
                    </div>
                    <div style="flex: 1; text-align: right;">
                        <a class="wallet-link" href="https://sepolia.etherscan.io/address/${t.traderAddress}" target="_blank" style="display: inline-flex; align-items: center; justify-content: flex-end; gap: 4px;">
                            <span style="font-size: 0.9rem;">&rarr;</span> Monitor
                        </a>
                    </div>
                </div>
            `).join('');

            statusArea.innerHTML = html;
            if (followListArea) followListArea.innerHTML = html;
        } else {
            if (document.getElementById('sectionStartCopyTrade')) document.getElementById('sectionStartCopyTrade').style.display = 'block';
            if (document.getElementById('sectionCurrentCopyTrade')) document.getElementById('sectionCurrentCopyTrade').style.display = 'none';
            if (document.getElementById('sectionAIAgents')) document.getElementById('sectionAIAgents').style.display = 'none';

            statusArea.innerHTML = '<div class="empty-state">No targets acquired. Input an address to begin.</div>';
            if (followListArea) followListArea.innerHTML = '';
        }
    } catch { /* silent */ }
}

async function fetchWallets() {
    try {
        const resp = await fetch(`${API}/api/wallets`);
        if (!resp.ok) return;
        const wallets = await resp.json();

        document.getElementById('walletCount').textContent = wallets.length;

        const list = document.getElementById('walletList');
        const select = document.getElementById('simulateTrader');

        if (wallets.length === 0) {
            list.innerHTML = '<div class="empty-state">No syndicate wallets found.</div>';
            return;
        }

        list.innerHTML = wallets.map(w => `
            <div class="wallet-item">
                <div>
                    <div class="wallet-label">${w.label} ${w.isLeadTrader ? '👑 (Lead)' : ''}</div>
                    <div class="wallet-addr mono-addr">${truncAddr(w.address)}</div>
                </div>
                <div style="text-align: right;">
                    <div class="wallet-balance" id="bal-${w.id}">...</div>
                </div>
            </div>
        `).join('');

        // Update select (if it still exists in the DOM)
        if (select) {
            const currentSelected = select.value;
            select.innerHTML = '<option value="">Select target...</option>';
            wallets.filter(w => w.isLeadTrader).forEach(w => {
                select.innerHTML += `<option value="${w.address}" ${currentSelected === w.address ? 'selected' : ''}>${w.label} (${truncAddr(w.address)})</option>`;
            });
        }

        // Balances
        wallets.forEach(async w => {
            try {
                const balResp = await fetch(`${API}/api/wallets/${w.address}/balance`);
                const bal = await balResp.json();
                const el = document.getElementById(`bal-${w.id}`);
                if (el) el.textContent = `${bal.ethBalance} ETH`;
            } catch { /* silent */ }
        });
    } catch { /* silent */ }
}

async function createWallet() {
    const label = document.getElementById('walletLabel').value.trim();
    const isLead = document.getElementById('isLeadTrader').checked;
    if (!label) return;

    try {
        const resp = await fetch(`${API}/api/wallets`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ label, isLeadTrader: isLead }),
        });
        if (resp.ok) {
            document.getElementById('walletLabel').value = '';
            document.getElementById('isLeadTrader').checked = false;
            fetchWallets();
        }
    } catch { /* silent */ }
}

async function simulateTrade() {
    const select = document.getElementById('simulateTrader');
    if (!select) return;
    let addr = select.value;

    if (!addr) {
        document.getElementById('scanResult').innerHTML = '<p style="color: var(--danger); font-size: 0.75rem; margin-top: 8px;">Target required</p>';
        return;
    }

    try {
        document.getElementById('scanResult').innerHTML = '<p style="color: var(--accent-3); font-size: 0.75rem; margin-top: 8px;">Simulating Neural Pipeline...</p>';

        const resp = await fetch(`${API}/api/trades/simulate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ traderAddress: addr }),
        });

        const data = await resp.json();
        const success = data.riskAssessment?.approved;

        document.getElementById('scanResult').innerHTML = `
            <p style="color: ${success ? 'var(--accent-2)' : 'var(--danger)'}; font-size: 0.8rem; margin-top: 8px; font-weight: 500;">
                ${success ? '✅ Override Complete' : '❌ Target Rejected'} — Risk Score: ${data.riskAssessment?.overallScore || 0}/100
            </p>
        `;

        fetchTradeHistory();
        fetchReasoningLogs();
    } catch (err) {
        document.getElementById('scanResult').innerHTML = `<p style="color: var(--danger); font-size: 0.75rem; margin-top: 8px;">❌ Error: ${err.message}</p>`;
    }
}

async function scanBlockchain() {
    const select = document.getElementById('simulateTrader');
    let addr = select.value;

    if (!addr) {
        document.getElementById('scanResult').innerHTML = '<p style="color: var(--danger); font-size: 0.75rem; margin-top: 8px;">❌ Target required</p>';
        return;
    }

    try {
        document.getElementById('scanResult').innerHTML = '<p style="color: var(--accent-3); font-size: 0.75rem; margin-top: 8px;">⏳ Submitting Deep Scan...</p>';

        const resp = await fetch(`${API}/api/trades/scan`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ traderAddress: addr }),
        });

        const data = await resp.json();
        document.getElementById('scanResult').innerHTML = `
            <p style="font-size: 0.75rem; color: var(--text-secondary); margin-top: 8px;">
                🔍 Checked blocks ${data.fromBlock} → ${data.toBlock}. Found ${data.tradesFound || 0} event(s).
            </p>
        `;
    } catch (err) {
        document.getElementById('scanResult').innerHTML = `<p style="color: var(--danger); font-size: 0.75rem; margin-top: 8px;">❌ Error: ${err.message}</p>`;
    }
}

async function fetchReasoningLogs() {
    try {
        const resp = await fetch(`${API}/api/agents/reasoning`);
        if (!resp.ok) return;
        const data = await resp.json();
        const logs = data.logs || [];

        const el = document.getElementById('reasoningLog');
        if (!logs || logs.length === 0) return;

        let filteredLogs = [];
        let groupedTrades = [];
        let currentTrade = [];

        // Sort chronologically to group cleanly by Strategy detection events
        logs.sort((a, b) => a.timestamp.localeCompare(b.timestamp)).forEach(entry => {
            let rawMsg = entry.message || entry.reasoning || JSON.stringify(entry);
            rawMsg = rawMsg.replace(/UNKNOWN/g, 'ETH');
            let outputMsg = null;
            let agentOverride = entry.agent || 'SYSTEM';

            // Format agent names nicely
            if (agentOverride === 'StrategyAgent') agentOverride = 'Strategy Agent';
            if (agentOverride === 'RiskAgent') agentOverride = 'Risk Agent';
            if (agentOverride === 'ExecutionAgent') agentOverride = 'Execution Agent';
            if (agentOverride === 'ProfitAgent') agentOverride = 'Profit Agent';

            // 1. Trade Detected (Strategy Agent)
            if (rawMsg.includes('Trade detected from lead wallet:')) {
                const match = rawMsg.match(/Trade detected from lead wallet: (.+?) \u2192 (.+?),/);
                if (match) {
                    outputMsg = `<span style="color: var(--accent-3);">Trade Detected [ ${match[1]} \u2192 ${match[2]} ]</span>`;
                } else {
                    outputMsg = '<span style="color: var(--accent-3);">Trade Detected</span>';
                }
            }
            // 2. Risk Agent (Approve / Reject)
            else if (rawMsg.includes('APPROVED by Risk')) {
                const match = rawMsg.match(/Risk Score:\s*([0-9]+)\/100/);
                const scoreBadge = match ? `<span style="font-size:0.75rem; color: var(--text-muted); margin-left:8px;">[ Risk Score: ${match[1]}/100 ]</span>` : '';
                outputMsg = `<span style="color: var(--accent-2);">Trade Approved</span>${scoreBadge}`;
            } else if (rawMsg.includes('REJECTED by Risk')) {
                outputMsg = '<span style="color: var(--danger);">Trade Rejected</span>';
            }
            // 3. Execution Agent
            else if (rawMsg.includes('Executing mirrored trade')) {
                outputMsg = '<span style="color: var(--accent-2);">Trade Executed</span>';
            }
            // 4. Profit Agent
            else if (rawMsg.includes('Profit sharing complete:')) {
                const match = rawMsg.match(/Profit sharing complete:\s*([0-9.]+)\s*ETH distributed to lead trader/);
                if (match) {
                    outputMsg = `<span style="color: var(--accent-1);">${match[1]} ETH Distributed</span>`;
                } else {
                    outputMsg = '<span style="color: var(--accent-1);">Profit Distributed</span>';
                }
            }

            if (outputMsg) {
                // A new trade always begins with Strategy Agent
                if (agentOverride === 'Strategy Agent') {
                    if (currentTrade.length > 0) groupedTrades.push(currentTrade);
                    currentTrade = [];
                }

                currentTrade.push(`
                    <div class="agent-step" style="display: flex; flex-direction: column; min-width: max-content;">
                        <span class="reasoning-agent" style="margin-bottom: 2px;">[${agentOverride}]</span>
                        <span class="reasoning-text">${outputMsg}</span>
                    </div>
                `);
            }
        });

        if (currentTrade.length > 0) {
            groupedTrades.push(currentTrade);
        }

        // Reverse to show newest trades at the top
        groupedTrades.reverse();

        const rowsHtml = groupedTrades.map(steps => {
            return `
            <div class="reasoning-entry" style="display: flex; align-items: center; gap: 14px; overflow-x: auto; flex-wrap: nowrap; padding-bottom: 12px; margin-bottom: 4px;">
                ${steps.join('<span style="color: var(--text-muted); font-size: 1.1rem; padding: 0 4px; margin-top: 14px;">\u2192</span>')}
            </div>
            `;
        });

        if (rowsHtml.length === 0) {
            el.innerHTML = '<div class="empty-state">System idle. Ready for analysis.</div>';
        } else {
            el.innerHTML = rowsHtml.join('');
        }
    } catch { /* silent */ }
}

async function fetchTradeHistory() {
    try {
        const resp = await fetch(`${API}/api/trades/history`);
        if (!resp.ok) return;
        const data = await resp.json();
        const history = data.history || [];

        const el = document.getElementById('tradeHistory');
        if (!history || history.length === 0) {
            el.innerHTML = '<div class="empty-state">Ledger empty.</div>';
            return;
        }

        const headerHtml = `
            <div class="trade-table-header">
                <div>PAIR</div>
                <div>SIZE</div>
                <div>TIMESTAMP</div>
                <div>TX HASH</div>
                <div style="text-align: right;">STATUS</div>
            </div>
        `;

        const rowsHtml = history.slice(-10).reverse().map(h => {
            const pair = `${(h.tradeEvent?.tokenIn?.symbol || '?').replace(/UNKNOWN/g, 'ETH')} \u2192 ${(h.tradeEvent?.tokenOut?.symbol || '?').replace(/UNKNOWN/g, 'ETH')}`;
            const size = `${h.tradeEvent?.amountIn || '?'} ${(h.tradeEvent?.tokenIn?.symbol || '').replace(/UNKNOWN/g, 'ETH')}`;
            const time = h.tradeEvent?.timestamp ? new Date(h.tradeEvent.timestamp).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '...';
            const txLink = h.tradeEvent?.txHash ? `<a class="wallet-link" href="https://sepolia.etherscan.io/tx/${h.tradeEvent.txHash}" target="_blank">View TX</a>` : '-';
            const statusLabel = `<span class="trade-status ${(h.status || '').toLowerCase()}" style="display:inline-block; margin:0;">${h.status || '...'}</span>`;

            return `
            <div class="trade-table-row">
                <div class="trade-cell-pair">${pair}</div>
                <div style="font-size: 0.8rem; color: var(--accent-1); font-weight: 600;">${size}</div>
                <div class="trade-cell-time">${time}</div>
                <div class="trade-cell-tx">${txLink}</div>
                <div style="text-align: right;">${statusLabel}</div>
            </div>
            `;
        }).join('');

        el.innerHTML = headerHtml + rowsHtml;
    } catch { /* silent */ }
}

// ─── Helpers ────────────────────────────────────────────────

function truncAddr(addr) {
    if (!addr) return '...';
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

window.copyVaultAddress = function (btn) {
    if (state.wdkAddress) {
        navigator.clipboard.writeText(state.wdkAddress).then(() => {
            const originalText = btn.textContent;
            btn.textContent = 'Copied!';
            btn.style.background = 'rgba(52, 211, 153, 0.2)';
            btn.style.color = '#34d399';
            setTimeout(() => {
                btn.textContent = originalText;
                btn.style.background = 'rgba(255,255,255,0.1)';
                btn.style.color = '#fff';
            }, 2000);
        }).catch(err => console.error('Clipboard write failed', err));
    }
};
