import { registerPlugin, Capacitor } from '@capacitor/core';
import { appState } from '../stores/appState.svelte';

// ────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────
export interface SmsTransaction {
  id: string;
  amount: number;
  type: 'expense' | 'inflow';
  vendor: string;
  accountLast4?: string;
  date: string;
  time: string;
  timestamp: number;
  rawBody: string;
  sender: string;
  status: 'pending' | 'inserted' | 'dismissed';
  suggestedTagId?: string;
  autoMatched?: boolean;
}

export type ScanResult = {
  success: boolean;
  addedCount: number;
  totalScanned: number;
  message: string;
  isNative: boolean;
};

// ────────────────────────────────────────────────────────────────────────
// Plugin Registration (static, called ONCE at module load)
// ────────────────────────────────────────────────────────────────────────
interface SmsTransactionPluginApi {
  checkPermissions(): Promise<{ sms: string }>;
  requestPermissions(): Promise<{ sms: string }>;
  requestNotificationPermission(): Promise<{ notifications: string }>;
  scanInbox(opts: { limit: number }): Promise<{ transactions: any[]; count: number }>;
  addListener(event: string, cb: (data: any) => void): Promise<any>;
}

export const SmsTransactionPlugin = registerPlugin<SmsTransactionPluginApi>('SmsTransaction');

// ────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────
const STORAGE_KEY = 'mynotes_sms_transactions';
const SCAN_TIMEOUT_MS = 15_000;

// ────────────────────────────────────────────────────────────────────────
// Utility: check if running on native Android
// ────────────────────────────────────────────────────────────────────────
function isAndroidNative(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android';
  } catch {
    return false;
  }
}

// ────────────────────────────────────────────────────────────────────────
// Hard REJECT Patterns (mirrored from SmsParser.java)
// ────────────────────────────────────────────────────────────────────────
const REJECT_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  // OTP / verification codes
  {
    name: 'OTP',
    regex: /\botp\b|one[\s-]?time[\s-]?password|do not share|don't share|verification code|security code|is your (?:otp|code|password|pin)|(?:otp|code)\s*(?:is|:)\s*\d{3,8}/i,
  },
  // Marketing / promotional
  {
    name: 'PROMO',
    regex: /\boffer\b|cashback up to|upto \d|\bsale\b|discount|pre[\s-]?approved|apply now|\bwin\b|reward points|lowest interest|loan (?:offer|approved|of)|emi option|book now|\bhurry\b|limited period|%\s*off|\bcoupon\b|shop now|buy now|voucher|redeem|earn \d|congratulations/i,
  },
  // Failed / declined / pending / reversed
  {
    name: 'FAILED',
    regex: /\bfailed\b|declined|unsuccessful|could not be|not processed|not completed|will be (?:credited|debited|deducted)|has been requested|is pending|\bpending\b|reversal|reversed|timed out|transaction (?:cancelled|canceled)|insufficient (?:balance|funds)/i,
  },
  // Reminders / due dates / mandates
  {
    name: 'REMINDER',
    regex: /\bdue\b|reminder|pay your|payment is due|\boutstanding\b|\bautopay\b|e[\s-]?mandate|\bmandate\b|will be auto[\s-]?debited|\bscheduled\b|last date|kindly pay|please pay/i,
  },
  // Non-money notifications
  {
    name: 'MISC',
    regex: /card (?:activated|blocked|dispatched|delivered)|pin (?:changed|generated|set)|\bkyc\b|update your|\bregistered\b successfully|has been (?:activated|dispatched|delivered)|out for delivery|password (?:changed|reset)/i,
  },
  // PF / EPF / PPF / NPS / Gratuity
  {
    name: 'PF',
    regex: /\bpf\b|\bepf\b|\bppf\b|\bnps\b|provident\s+fund|pension\s+fund|pf\s+contribution|pf\s+balance|uan\s*\d|passbook.*(?:pf|epf)|employer.+contribution|\bgratuity\b/i,
  },
  // Orders / E-Commerce / Delivery tracking
  {
    name: 'ORDER',
    regex: /\border\b.*(?:placed|confirmed|shipped|dispatched|delivered|cancelled|returned)|order\s*(?:id|no\.?|number)|tracking\s*(?:id|no\.?|number|link|update)|your\s+(?:package|parcel|shipment)|\bawb\b|consignment|estimated\s+delivery|add(?:ed)?\s+to\s+(?:cart|bag|wishlist)|\binvoice\b/i,
  },
  // Points / Rewards / Loyalty (not real currency)
  {
    name: 'POINTS',
    regex: /(?:points?|coins?|stars?)\s+(?:credited|earned|added|received|redeemed|expir)|(?:credited|earned|added|received)\s+(?:\d+\s+)?(?:points?|coins?|stars?)|reward\s*points?|loyalty\s*points?|bonus\s*points?|cashback\s*(?:points?|coins?)|miles?\s+(?:credited|earned)|(?:super|edge|program|club)\s*(?:points?|coins?)/i,
  },
  // Bills / Invoices / Utility
  {
    name: 'BILL',
    regex: /\bbill\b\s*(?:generated|raised|of\s+rs|for\s+rs|amount|is\s+rs|ready)|(?:electricity|water|gas|broadband|internet|dth|telephone|postpaid)\s*(?:bill|recharge)|bill\s*(?:no|number|date|period)|total\s+(?:due|payable|amount\s+due)|pay\s+(?:your|the)\s+bill|view\s+(?:your\s+)?bill|\bbiller\b|billing\s+cycle|statement\s+(?:date|period|summary)|statement\s+is\s+ready|bill\s+generated/i,
  },
  // Insurance / SIP / Mutual Fund / Investment
  {
    name: 'INVESTMENT',
    regex: /\bsip\b|mutual\s*fund|\bnav\b|units?\s+allot|(?:policy|premium)\s+(?:no|number|due|renewal|amount)|insurance\s+(?:premium|policy|plan|renewal)|\bfolio\b|portfolio|maturity\s+(?:date|amount|proceeds)|fixed\s+deposit\s+(?:maturing|matured|booked)|\bfd\b\s+(?:maturing|booked)|(?:term|endowment|ulip|money.back)\s+(?:plan|policy)/i,
  },
  // Subscription / Plan renewals
  {
    name: 'SUBSCRIPTION',
    regex: /subscription\s+(?:renewed|activated|started|cancelled)|auto[\s-]?(?:renewal|renew)|plan\s+(?:activated|renewed|upgraded)|membership\s+(?:renewed|activated|expir)|trial\s+(?:started|ending|expired)/i,
  },
];

// Currency context pattern (for credit verb tightening)
const CURRENCY_CONTEXT_RE = /rs\.?|\binr\b|₹|rupees?|\bamt\b|\bamount\b|a\/c|acc|account|card/i;

// ────────────────────────────────────────────────────────────────────────
// JavaScript SMS Parser (used for Paste SMS and as fallback)
// ────────────────────────────────────────────────────────────────────────
function parseTransactionFromText(smsText: string, sender: string = 'Manual'): SmsTransaction | null {
  if (!smsText || !smsText.trim()) return null;
  const cleaned = smsText.replace(/\n/g, ' ').replace(/\s+/g, ' ').trim();

  // ── Hard reject patterns ───────────────────────────────────────────
  for (const { name, regex } of REJECT_PATTERNS) {
    if (regex.test(cleaned)) {
      console.log(`[SmsParser] REJECT [${name}]: ${cleaned.substring(0, 80)}`);
      return null;
    }
  }

  // ── Amount extraction ──────────────────────────────────────────────
  const amountPatterns = [
    /(?:rs\.?|inr|₹|amt|amount)\s*[:.\-\s]?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
    /(?:debited|credited|spent|paid|transferred|deposited|sent|received|deducted)\s*(?:by|for|of|with|with\s+(?:inr|rs\.?|₹))?\s*[:.\-\s]?\s*([0-9,]+(?:\.[0-9]{1,2})?)/i,
    /([0-9,]+(?:\.[0-9]{1,2})?)\s*(?:debited|credited|spent|paid|transferred|deposited|sent|received)/i,
  ];

  let amount = 0;
  for (const pat of amountPatterns) {
    const m = cleaned.match(pat);
    if (m) {
      amount = parseFloat(m[1].replace(/,/g, ''));
      if (amount > 0) break;
    }
  }
  if (amount <= 0) return null;

  // ── Debit vs Credit detection ──────────────────────────────────────
  const debitMatch = /(debited|spent|paid|vpa|purchase|sent\s+to|deducted|withdrawn|debit|payment|\bdr\b|spent\s+on)/i.exec(cleaned);
  const creditMatch = /(credited|credit|received|deposited|added|refunded|salary|\bcr\b|cashback|money received)/i.exec(cleaned);

  const isDebit = !!debitMatch;
  const isCredit = !!creditMatch;

  if (!isDebit && !isCredit) return null;

  // ── Credit verb tightening: require currency context nearby ────────
  if (!isDebit && isCredit && creditMatch) {
    const creditPos = creditMatch.index;
    const windowStart = Math.max(0, creditPos - 80);
    const windowEnd = Math.min(cleaned.length, creditPos + 80);
    const window = cleaned.substring(windowStart, windowEnd);
    if (!CURRENCY_CONTEXT_RE.test(window)) {
      console.log(`[SmsParser] REJECT [CREDIT_NO_CURRENCY]: ${cleaned.substring(0, 80)}`);
      return null;
    }
  }

  // Debit takes precedence
  const type = isDebit ? 'expense' : 'inflow';

  // ── Vendor extraction ──────────────────────────────────────────────
  const vendorMatch = cleaned.match(/(?:at|towards|info|via|vpa|merchant|to\s+vpa|paid\s+to|sent\s+to)\s+([A-Za-z0-9\s._\-@]{2,35})/i);
  let vendor = vendorMatch ? vendorMatch[1].trim() : 'Transaction';
  const falseVendors = ['your account', 'upi ref', 'avl bal', 'your a/c', 'a/c', 'ref no', 'sms block'];
  if (falseVendors.some(fv => vendor.toLowerCase().includes(fv)) || /\d{5,}/.test(vendor)) {
    vendor = 'Transaction';
  }

  // ── Account last 4 digits ─────────────────────────────────────────
  const accMatch = cleaned.match(/(?:a\/c|acc|card|account)\s*(?:no\.?)?\s*[xX*]*([0-9]{3,4})/i);
  const accountLast4 = accMatch ? accMatch[1] : '';

  // ── Date extraction ────────────────────────────────────────────────
  const dateMatch = cleaned.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
  let dateStr: string;
  if (dateMatch) {
    const day = dateMatch[1].padStart(2, '0');
    const month = dateMatch[2].padStart(2, '0');
    const year = dateMatch[3].length === 2 ? '20' + dateMatch[3] : dateMatch[3];
    dateStr = `${year}-${month}-${day}`;
  } else {
    dateStr = new Date().toISOString().split('T')[0];
  }

  // ── Time extraction ─────────────────────────────────────────────────
  // Remove reference prefixes like UPI:12345, ref:12345, txn:12345 to prevent false time matches
  const bodyNoRefs = cleaned.replace(/(?:upi|ref|refno|txn|tx|id|acct|acc|card|http|https):[0-9A-Za-z]+/gi, ' ');
  const timeMatch = bodyNoRefs.match(/\b([01]?\d|2[0-3]):([0-5]\d)(?::[0-5]\d)?\s*(am|pm|hrs|hr)?\b/i);
  let timeStr: string;
  if (timeMatch) {
    let hours = parseInt(timeMatch[1], 10);
    const minutes = timeMatch[2];
    const ampmIndicator = (timeMatch[3] || '').toLowerCase();
    if (ampmIndicator === 'pm' && hours < 12) hours += 12;
    if (ampmIndicator === 'am' && hours === 12) hours = 0;
    timeStr = `${String(hours).padStart(2, '0')}:${minutes}`;
  } else {
    const now = new Date();
    timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  }

  return {
    id: `sms_${Date.now()}_${Math.floor(Math.random() * 10000)}`,
    amount,
    type,
    vendor,
    accountLast4,
    date: dateStr,
    time: timeStr,
    timestamp: Date.now(),
    rawBody: smsText.trim(),
    sender,
    status: 'pending',
  };
}

// ────────────────────────────────────────────────────────────────────────
// SmsService (Svelte 5 Runes based)
// ────────────────────────────────────────────────────────────────────────
class SmsService {
  private transactions = $state<SmsTransaction[]>(this.loadStoredTransactions());
  private isScanning = $state(false);
  private hasPermission = $state<boolean | null>(null);
  private diagnosticLog = $state<string[]>([]);
  private isNativeAvailable = $state<boolean>(false);

  constructor() {
    this.isNativeAvailable = isAndroidNative();
    this.log(`Platform: ${this.isNativeAvailable ? 'Android Native' : 'Web/Browser'}`);

    if (typeof window !== 'undefined' && this.isNativeAvailable) {
      setTimeout(() => this.initNativeListener(), 1000);
    }
  }

  private log(msg: string) {
    const ts = new Date().toLocaleTimeString();
    this.diagnosticLog = [`[${ts}] ${msg}`, ...this.diagnosticLog.slice(0, 49)];
    console.log(`[SmsService] ${msg}`);
  }

  private loadStoredTransactions(): SmsTransaction[] {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return [];
      const parsed: SmsTransaction[] = JSON.parse(stored);
      return parsed.map(t => {
        let time = t.time;
        if (!time || time === '00:00') {
          if (t.timestamp && t.timestamp > 0) {
            const d = new Date(t.timestamp);
            const hh = String(d.getHours()).padStart(2, '0');
            const mm = String(d.getMinutes()).padStart(2, '0');
            time = `${hh}:${mm}`;
          } else {
            const now = new Date();
            time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
          }
        }
        return { ...t, time };
      });
    } catch {
      return [];
    }
  }

  private saveTransactions() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.transactions));
    } catch (e) {
      console.error('Failed to save SMS transactions', e);
    }
  }

  public get pendingTransactions(): SmsTransaction[] {
    return this.transactions.filter(t => t.status === 'pending');
  }

  public get allTransactions(): SmsTransaction[] {
    return this.transactions;
  }

  public get scanning(): boolean {
    return this.isScanning;
  }

  public get permissionGranted(): boolean | null {
    return this.hasPermission;
  }

  public get isNative(): boolean {
    return this.isNativeAvailable;
  }

  public get logs(): string[] {
    return this.diagnosticLog;
  }

  private async initNativeListener() {
    this.log('Initializing native SMS listener...');
    try {
      const result = await SmsTransactionPlugin.checkPermissions();
      this.hasPermission = result.sms === 'granted';
      this.log(`Permission check: ${result.sms}`);

      // Request notification permission for Android 13+
      try {
        await SmsTransactionPlugin.requestNotificationPermission();
        this.log('Notification permission requested');
      } catch (e: any) {
        this.log(`Notification permission request skipped: ${e?.message || String(e)}`);
      }

      await SmsTransactionPlugin.addListener('smsTransactionReceived', (data: any) => {
        this.log(`Real-time SMS received: ${data?.vendor || 'unknown'} ${data?.amount || 0}`);
        if (data && data.amount > 0) {
          const tx: SmsTransaction = {
            id: data.id || `sms_rt_${Date.now()}`,
            amount: Number(data.amount),
            type: data.type === 'inflow' ? 'inflow' : 'expense',
            vendor: data.vendor || 'Transaction',
            accountLast4: data.accountLast4 || '',
            date: data.date || new Date().toISOString().split('T')[0],
            time: data.time || (() => { const n = new Date(); return `${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`; })(),
            timestamp: data.timestamp || Date.now(),
            rawBody: data.rawBody || '',
            sender: data.sender || 'Bank',
            status: 'pending',
          };
          const added = this.addTransaction(tx);

          // Show in-app toast notification with action to navigate to SMS tab
          if (added) {
            const typeLabel = tx.type === 'inflow' ? 'inflow' : 'expense';
            const currencySymbol = '₹';
            appState.showToast(
              `${currencySymbol}${tx.amount.toLocaleString()} ${typeLabel} detected from ${tx.vendor}`,
              'info',
              6000,
              'Transaction Detected',
              false,
              {
                label: 'Review',
                callback: () => {
                  appState.activeTab = 'sms';
                },
              }
            );
          }
        }
      });
      this.log('Native SMS listener registered successfully');

      // Auto-scan inbox on app startup if permission is granted
      if (this.hasPermission) {
        this.log('Auto-scanning SMS inbox on startup...');
        try {
          await this.scanInbox();
          this.log('Auto-scan completed');
        } catch (scanErr: any) {
          this.log(`Auto-scan failed: ${scanErr?.message || String(scanErr)}`);
        }
      }
    } catch (e: any) {
      this.log(`Native init error: ${e?.message || String(e)}`);
      this.hasPermission = false;
    }
  }

  public async requestPermissions(): Promise<boolean> {
    if (!this.isNativeAvailable) {
      this.log('Cannot request permissions: not on native Android');
      return false;
    }

    this.log('Requesting SMS permissions...');
    try {
      const res = await SmsTransactionPlugin.requestPermissions();
      this.hasPermission = res.sms === 'granted';
      this.log(`Permission result: ${res.sms}`);

      // Also request notification permission alongside SMS
      if (this.hasPermission) {
        try {
          await SmsTransactionPlugin.requestNotificationPermission();
          this.log('Notification permission requested alongside SMS');
        } catch (e: any) {
          this.log(`Notification permission request skipped: ${e?.message || String(e)}`);
        }
      }

      return this.hasPermission;
    } catch (e: any) {
      this.log(`Permission request error: ${e?.message || String(e)}`);
      return false;
    }
  }

  public async scanInbox(options: { limit?: number } = {}): Promise<ScanResult> {
    this.isScanning = true;
    this.log('Starting inbox scan...');

    const result: ScanResult = {
      success: false,
      addedCount: 0,
      totalScanned: 0,
      message: '',
      isNative: this.isNativeAvailable,
    };

    try {
      if (!this.isNativeAvailable) {
        result.message = 'Not running on Android. Use "Paste SMS Text" to add transactions manually.';
        this.log(result.message);
        return result;
      }

      if (!this.hasPermission) {
        this.log('No SMS permission. Requesting...');
        const granted = await this.requestPermissions();
        if (!granted) {
          result.message = 'SMS permission denied. Please grant SMS access in Settings.';
          this.log(result.message);
          return result;
        }
      }

      this.log(`Calling native scanInbox(limit: ${options.limit ?? 200})...`);

      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Native scan timeout after ${SCAN_TIMEOUT_MS / 1000}s`)), SCAN_TIMEOUT_MS)
      );

      const res = await Promise.race([
        SmsTransactionPlugin.scanInbox({ limit: options.limit ?? 200 }),
        timeoutPromise,
      ]);

      this.log(`Native scan returned: ${res.count} transactions found, ${res.transactions?.length || 0} items in array`);
      result.totalScanned = res.count;

      if (res.transactions && Array.isArray(res.transactions) && res.transactions.length > 0) {
        const now = new Date();
        const currentYearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

        for (const item of res.transactions) {
          const itemDate = item.date || '';
          if (itemDate && !itemDate.startsWith(currentYearMonth)) {
            continue;
          }

          const added = this.addTransaction({
            id: item.id || `sms_${item.timestamp || Date.now()}_${Math.floor(Math.random() * 1000)}`,
            amount: Number(item.amount),
            type: item.type === 'inflow' ? 'inflow' : 'expense',
            vendor: item.vendor || 'Transaction',
            accountLast4: item.accountLast4 || '',
            date: item.date || new Date().toISOString().split('T')[0],
            time: item.time || (() => { const n = new Date(item.timestamp || Date.now()); return `${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}`; })(),
            timestamp: item.timestamp || Date.now(),
            rawBody: item.rawBody || '',
            sender: item.sender || 'Bank',
            status: 'pending',
          });
          if (added) result.addedCount++;
        }
      }

      result.success = true;
      result.message = result.addedCount > 0
        ? `Found ${result.addedCount} new transaction(s) this month!`
        : `Scanned ${result.totalScanned} messages — no new transactions to add.`;
      this.log(result.message);
      return result;
    } catch (e: any) {
      const errMsg = e?.message || String(e);
      result.message = `Scan failed: ${errMsg}`;
      this.log(`ERROR: ${errMsg}`);
      return result;
    } finally {
      this.isScanning = false;
    }
  }

  public parseCustomText(smsText: string): boolean {
    const tx = parseTransactionFromText(smsText, 'Manual Entry');
    if (!tx) {
      this.log('parseCustomText: no transaction detected in pasted text');
      return false;
    }
    this.log(`parseCustomText: detected ${tx.type} of ${tx.amount} at ${tx.vendor}`);
    return this.addTransaction(tx);
  }

  public deduplicateAgainstBoxes(boxes: any[]) {
    if (!boxes || boxes.length === 0 || this.transactions.length === 0) return;

    let updated = false;
    const newTxs = this.transactions.map(tx => {
      if (tx.status !== 'pending') return tx;

      const isDup = boxes.some(box => {
        if (!box.rows || !Array.isArray(box.rows)) return false;
        return box.rows.some((row: any) => {
          const rowTotal = row.total || 0;
          const rowAmt = Math.abs(rowTotal);
          const amtMatch = Math.abs(rowAmt - tx.amount) < 0.01;
          if (!amtMatch) return false;

          // Type must match: negative row.total = expense, positive = inflow
          const rowIsExpense = rowTotal < 0;
          const txIsExpense = tx.type === 'expense';
          if (rowIsExpense !== txIsExpense) return false;

          if (row.date && row.date !== '—') {
            return row.date === tx.date;
          }

          const labelLower = (row.label || '').toLowerCase();
          const vendorLower = (tx.vendor || '').toLowerCase();
          return labelLower.includes(vendorLower) || labelLower.includes(tx.date) || labelLower.includes(String(tx.amount));
        });
      });

      if (isDup) {
        updated = true;
        return { ...tx, status: 'inserted' as const, autoMatched: true };
      }

      return tx;
    });

    if (updated) {
      this.transactions = newTxs;
      this.saveTransactions();
      this.log('Deduplication: some transactions matched pre-added entries');
    }
  }

  public addTransaction(tx: SmsTransaction): boolean {
    const exists = this.transactions.some(
      t =>
        t.id === tx.id ||
        (t.rawBody && t.rawBody === tx.rawBody && Math.abs(t.amount - tx.amount) < 0.01) ||
        (t.amount === tx.amount && t.date === tx.date && t.vendor === tx.vendor && t.type === tx.type)
    );
    if (exists) return false;

    let time = tx.time;
    if (!time || time === '00:00') {
      if (tx.timestamp && tx.timestamp > 0) {
        const d = new Date(tx.timestamp);
        const hh = String(d.getHours()).padStart(2, '0');
        const mm = String(d.getMinutes()).padStart(2, '0');
        time = `${hh}:${mm}`;
      } else {
        const now = new Date();
        time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
      }
    }

    this.transactions = [{ ...tx, time }, ...this.transactions];
    this.saveTransactions();
    return true;
  }

  public updateTransaction(id: string, updates: Partial<SmsTransaction>) {
    this.transactions = this.transactions.map(t =>
      t.id === id ? { ...t, ...updates } : t
    );
    this.saveTransactions();
  }

  public markInserted(id: string) {
    this.transactions = this.transactions.map(t =>
      t.id === id ? { ...t, status: 'inserted' as const } : t
    );
    this.saveTransactions();
  }

  public dismissTransaction(id: string) {
    this.transactions = this.transactions.map(t =>
      t.id === id ? { ...t, status: 'dismissed' as const } : t
    );
    this.saveTransactions();
  }

  public clearAll() {
    this.transactions = [];
    this.saveTransactions();
    this.log('All transactions cleared');
  }

  public addMockTransactions() {
    const today = new Date().toISOString().split('T')[0];
    const mocks: SmsTransaction[] = [
      {
        id: 'mock_1',
        amount: 450.0,
        type: 'expense',
        vendor: 'Swiggy',
        accountLast4: '4321',
        date: today,
        time: '14:30',
        timestamp: Date.now() - 3600000,
        rawBody: 'Rs. 450.00 debited from A/c XX4321 at SWIGGY via UPI on ' + today,
        sender: 'HDFCBK',
        status: 'pending',
      },
      {
        id: 'mock_2',
        amount: 1250.0,
        type: 'expense',
        vendor: 'Amazon',
        accountLast4: '8812',
        date: today,
        time: '12:15',
        timestamp: Date.now() - 7200000,
        rawBody: 'INR 1,250.00 spent on your HDFC Bank Card XX8812 at AMAZON INDIA',
        sender: 'HDFCBK',
        status: 'pending',
      },
      {
        id: 'mock_3',
        amount: 25000.0,
        type: 'inflow',
        vendor: 'Salary Credit',
        accountLast4: '4321',
        date: today,
        time: '09:00',
        timestamp: Date.now() - 86400000,
        rawBody: 'Your A/c XX4321 is credited with INR 25,000.00 by Salary Direct Deposit',
        sender: 'ICICIB',
        status: 'pending',
      },
    ];

    let added = 0;
    mocks.forEach(m => {
      if (this.addTransaction(m)) added++;
    });
    this.log(`Added ${added} demo transactions`);
  }
}

export const smsService = new SmsService();
