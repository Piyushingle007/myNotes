package com.mynotes.app;

import android.util.Log;
import org.json.JSONException;
import org.json.JSONObject;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Parses raw SMS bodies into structured financial transactions.
 *
 * The algorithm is intentionally conservative: it accepts a message ONLY when it
 * looks like a genuine, completed bank/UPI/card debit or credit for the user's own
 * account, and rejects everything else (OTPs, promotions, failed/pending/reversed
 * transactions, PF/EPF, orders, points/rewards, bills, insurance, subscriptions,
 * EMI/bill reminders and pure balance-enquiry notifications).
 *
 * Public contract (unchanged for callers): {@link #parseSms(String, String, long)}
 * returns a JSONObject with keys:
 *   id, amount, type, vendor, accountLast4, date, timestamp, rawBody, sender
 * or {@code null} when the SMS is not a real transaction.
 */
public class SmsParser {

    private static final String TAG = "SmsParser";

    // Minimum confidence required before a message is accepted as a transaction.
    private static final int CONFIDENCE_THRESHOLD = 3;

    // ═══════════════════════════════════════════════════════════════════════
    // KNOWN INDIAN BANK SENDER ID WHITELIST
    // ═══════════════════════════════════════════════════════════════════════
    // Indian bank SMS senders use DLT format: XX-HDFCBK (2-char telecom prefix + 6-char bank ID).
    // We extract the last 6 characters and match against this set for confidence boosting.
    private static final Set<String> KNOWN_BANK_SENDERS = new HashSet<>();
    static {
        // ── Public Sector Banks ──
        addSenders("SBIINB", "SBIBNK", "SBIPSG", "SBISMS", "SBIUPI", "SBISMS");      // SBI
        addSenders("PNBSMS", "PUNJNB", "PNBBNK");                                       // PNB
        addSenders("BOIIND", "BKOFIN", "BOISMS");                                        // Bank of India
        addSenders("BOBIMT", "BKOFBD", "BOBSMS", "BRBSMS");                              // Bank of Baroda
        addSenders("CANBNK", "CANARA", "CANBKN", "CANSMS");                              // Canara Bank
        addSenders("UCOBNK", "UCOBKN");                                                   // UCO Bank
        addSenders("IOBIND", "IOBBNK", "IOBSMS");                                        // Indian Overseas Bank
        addSenders("CBIIND", "CENTBK", "CBISMS");                                         // Central Bank of India
        addSenders("INDBNK", "INDBKN", "INDBKS");                                         // Indian Bank
        addSenders("BKOFMH", "MAHBNK", "BOMSMS");                                         // Bank of Maharashtra
        addSenders("PUNSNB", "PSBSMS");                                                    // Punjab & Sind Bank
        addSenders("UNBKIN", "UNIONB", "UBISMS");                                          // Union Bank of India

        // ── Private Sector Banks ──
        addSenders("HDFCBK", "HDFCBN", "HDFCSM", "HDFCRD");                              // HDFC Bank
        addSenders("ICICIB", "ICICIT", "ICICIS", "ICICSD", "ICICIP");                     // ICICI Bank
        addSenders("AXISBK", "AXSBNK", "AXISMS");                                         // Axis Bank
        addSenders("KOTAKB", "KOTKBK", "KOTKSM");                                         // Kotak Mahindra Bank
        addSenders("YESBNK", "YESBKL", "YESSMS");                                         // Yes Bank
        addSenders("IABORB", "IDBIBD", "IDBISM");                                         // IDBI Bank
        addSenders("FEDBKN", "FEDBNK", "FEDSMS");                                         // Federal Bank
        addSenders("INDUSB", "INDSMS", "INDUSD");                                         // IndusInd Bank
        addSenders("RBLBNK", "RBLSMS");                                                    // RBL Bank
        addSenders("BANDHN", "BNDHSM");                                                    // Bandhan Bank
        addSenders("IDFCFB", "IDFCBK", "IDFCSM");                                         // IDFC First Bank
        addSenders("DHNBNK");                                                               // Dhanlaxmi Bank
        addSenders("TMBLNK", "TMBBNK");                                                    // Tamilnad Mercantile Bank
        addSenders("CSBBNK", "CSBKRL");                                                    // CSB Bank (Catholic Syrian)
        addSenders("KVBANK", "KVBSMS");                                                    // Karur Vysya Bank
        addSenders("CITYUN", "CUBSMS");                                                    // City Union Bank
        addSenders("SVCBNK");                                                               // SVC Co-operative Bank
        addSenders("KTKBNK", "KRNBNK", "KTKSMS");                                         // Karnataka Bank
        addSenders("SOUINB", "SIBLNK", "SIBSMS");                                         // South Indian Bank
        addSenders("LAKSHV");                                                               // Lakshmi Vilas Bank
        addSenders("NAINIT");                                                               // Nainital Bank
        addSenders("JKBANK", "JKBSMS");                                                    // Jammu & Kashmir Bank
        addSenders("DCBBKL", "DCBSMS");                                                    // DCB Bank

        // ── Payments Banks / Small Finance Banks ──
        addSenders("PAYTMB", "PAYTMS", "PYTMSM");                                         // Paytm Payments Bank
        addSenders("AIRPAY", "AIRTLB", "AIRTLS");                                         // Airtel Payments Bank
        addSenders("JIOFIN", "JIOPAY", "JIOSMS");                                         // Jio Payments
        addSenders("FNOBNK", "FINOPB");                                                    // Fino Payments Bank
        addSenders("AABORB", "AUSFIN", "AUBANK");                                         // AU Small Finance Bank
        addSenders("EQITAS", "EQTSFB");                                                    // Equitas Small Finance Bank
        addSenders("UJJIVN", "UJJSFB");                                                    // Ujjivan Small Finance Bank
        addSenders("JANASG", "JANSFB");                                                    // Jana Small Finance Bank
        addSenders("SURYOD");                                                               // Suryoday Small Finance Bank
        addSenders("UTKARB");                                                               // Utkarsh Small Finance Bank
        addSenders("NESFIN");                                                               // NorthEast Small Finance Bank
        addSenders("CAPTLF");                                                               // Capital Small Finance Bank
        addSenders("ESFBNK");                                                               // ESAF Small Finance Bank

        // ── NBFCs / Wallets / Fintech ──
        addSenders("PHONPE", "PHNEPE", "PHNPSM");                                         // PhonePe
        addSenders("GOOGPE", "GGLPAY", "GGLSMS");                                         // Google Pay
        addSenders("AMAZPY", "AMZPAY");                                                    // Amazon Pay
        addSenders("MOBKWK");                                                               // Mobikwik
        addSenders("FREERC", "FRCRGE");                                                    // Freecharge
        addSenders("BAJFIN", "BAJFNC", "BAJFSM");                                         // Bajaj Finance / Finserv
        addSenders("HDFCSC", "HDFCSL", "HDFCLD");                                         // HDFC Securities / HDFC Ltd
        addSenders("ABORIG", "ABCLSM");                                                    // Aditya Birla Capital
        addSenders("TATCAP", "TATACL");                                                    // Tata Capital
        addSenders("LICIND", "LICHFL", "LICSMS");                                          // LIC / LIC Housing
        addSenders("MAHFIN", "MHFSMS");                                                    // Mahindra Finance
        addSenders("CHLAMD", "CHOLSM");                                                    // Cholamandalam
        addSenders("HROAFN");                                                               // Hero FinCorp
        addSenders("SHRIFL", "SHRFIN");                                                    // Shriram Finance
        addSenders("MABORB", "MUTHOT");                                                    // Muthoot Finance
        addSenders("MANAFN", "MNAPFN");                                                    // Manappuram Finance
        addSenders("PIRAML");                                                               // Piramal Finance
        addSenders("BHARPE", "BRTPSM");                                                    // BharatPe

        // ── UPI / Payment Networks ──
        addSenders("NPCIUP", "NPCISM");                                                    // NPCI (UPI)
        addSenders("UPIREF");                                                               // UPI Reference

        // ── Foreign Banks in India ──
        addSenders("CITIBK", "CITIND", "CITISM");                                          // Citibank
        addSenders("SCBANK", "STCBKN", "SCBSMS");                                         // Standard Chartered
        addSenders("HSBCBK", "HSBCIN", "HSBCSM");                                         // HSBC
        addSenders("DBSBNK", "DBSSMS");                                                    // DBS Bank
        addSenders("DEUTBK");                                                               // Deutsche Bank
        addSenders("BARCLY");                                                               // Barclays

        // ── Regional / Co-operative Banks / RRBs ──
        addSenders("SARASB", "SARSWT");                                                    // Saraswat Bank
        addSenders("COSMBN");                                                               // Cosmos Bank
        addSenders("APNABN");                                                               // Apna Sahakari Bank
        addSenders("ABHYUD");                                                               // Abhyudaya Co-op Bank
        addSenders("TJSBBN");                                                               // TJSB Bank
        addSenders("GPPBNK");                                                               // GP Parsik Bank
    }

    private static void addSenders(String... ids) {
        for (String id : ids) {
            KNOWN_BANK_SENDERS.add(id.toUpperCase(Locale.US));
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // Stage 1: Quick Pre-Check Keywords (cheap short-circuit)
    // ═══════════════════════════════════════════════════════════════════════
    private static final String[] FINANCIAL_KEYWORDS = {
        "debited", "credited", "spent", "paid", "deducted", "withdrawn",
        "transferred", "deposited", "received", "refunded", "payment",
        "debit", "credit", "upi", "neft", "imps", "rtgs",
        "rs.", "rs ", "inr", "₹", "rupees",
        "a/c", "acc", "card", "account",
        "sent to", "vpa"
    };

    // ═══════════════════════════════════════════════════════════════════════
    // Stage 2: Hard REJECT Patterns (run before any acceptance logic)
    // ═══════════════════════════════════════════════════════════════════════

    // OTP / verification codes
    private static final Pattern OTP_PATTERN = Pattern.compile(
        "\\botp\\b|one[\\s-]?time[\\s-]?password|do not share|don't share|" +
        "verification code|security code|is your (?:otp|code|password|pin|verification)|" +
        "\\buse\\s+\\d{4,8}\\b.*(?:otp|login|verify)|(?:otp|code)\\s*(?:is|:)\\s*\\d{3,8}",
        Pattern.CASE_INSENSITIVE
    );

    // Marketing / promotional / offers / loan pitches
    private static final Pattern PROMO_PATTERN = Pattern.compile(
        "\\boffer\\b|cashback up to|upto \\d|\\bsale\\b|discount|pre[\\s-]?approved|" +
        "apply now|\\bwin\\b|reward points|lowest interest|loan (?:offer|approved|of)|" +
        "emi option|book now|\\bhurry\\b|limited period|%\\s*off|\\bcoupon\\b|" +
        "shop now|buy now|voucher|redeem|earn \\d|congratulations",
        Pattern.CASE_INSENSITIVE
    );

    // Failed / declined / pending / reversed / not-yet-happened
    private static final Pattern FAILED_PATTERN = Pattern.compile(
        "\\bfailed\\b|declined|unsuccessful|could not be|not processed|not completed|" +
        "will be (?:credited|debited|deducted)|has been requested|is pending|\\bpending\\b|" +
        "reversal|reversed|timed out|transaction (?:cancelled|canceled)|" +
        "insufficient (?:balance|funds)",
        Pattern.CASE_INSENSITIVE
    );

    // Reminders / due dates / mandates
    private static final Pattern REMINDER_PATTERN = Pattern.compile(
        "\\bdue\\b|reminder|pay your|payment is due|\\boutstanding\\b|" +
        "\\bautopay\\b|e[\\s-]?mandate|\\bmandate\\b|will be auto[\\s-]?debited|" +
        "\\bscheduled\\b|last date|kindly pay|please pay",
        Pattern.CASE_INSENSITIVE
    );

    // Non-money notifications (card activation, PIN change, KYC, etc.)
    private static final Pattern MISC_NONTXN_PATTERN = Pattern.compile(
        "card (?:activated|blocked|dispatched|delivered)|pin (?:changed|generated|set)|" +
        "\\bkyc\\b|update your|\\bregistered\\b successfully|has been (?:activated|dispatched|delivered)|" +
        "out for delivery|password (?:changed|reset)",
        Pattern.CASE_INSENSITIVE
    );

    // ── NEW: PF / EPF / PPF / NPS / Gratuity ────────────────────────────
    private static final Pattern PF_PATTERN = Pattern.compile(
        "\\bpf\\b|\\bepf\\b|\\bppf\\b|\\bnps\\b|provident\\s+fund|pension\\s+fund|" +
        "pf\\s+contribution|pf\\s+balance|uan\\s*\\d|passbook.*(?:pf|epf)|" +
        "employer.+contribution|\\bgratuity\\b",
        Pattern.CASE_INSENSITIVE
    );

    // ── NEW: Orders / E-Commerce / Delivery tracking ────────────────────
    private static final Pattern ORDER_PATTERN = Pattern.compile(
        "\\border\\b.*(?:placed|confirmed|shipped|dispatched|delivered|cancelled|returned)|" +
        "order\\s*(?:id|no\\.?|number)|tracking\\s*(?:id|no\\.?|number|link|update)|" +
        "your\\s+(?:package|parcel|shipment)|" +
        "\\bawb\\b|consignment|estimated\\s+delivery|" +
        "add(?:ed)?\\s+to\\s+(?:cart|bag|wishlist)|\\binvoice\\b",
        Pattern.CASE_INSENSITIVE
    );

    // ── NEW: Points / Rewards / Loyalty (not real currency) ─────────────
    private static final Pattern POINTS_PATTERN = Pattern.compile(
        "(?:points?|coins?|stars?)\\s+(?:credited|earned|added|received|redeemed|expir)|" +
        "(?:credited|earned|added|received)\\s+(?:\\d+\\s+)?(?:points?|coins?|stars?)|" +
        "reward\\s*points?|loyalty\\s*points?|bonus\\s*points?|" +
        "cashback\\s*(?:points?|coins?)|miles?\\s+(?:credited|earned)|" +
        "(?:super|edge|program|club)\\s*(?:points?|coins?)",
        Pattern.CASE_INSENSITIVE
    );

    // ── NEW: Bills / Invoices / Utility ─────────────────────────────────
    private static final Pattern BILL_PATTERN = Pattern.compile(
        "\\bbill\\b\\s*(?:generated|raised|of\\s+rs|for\\s+rs|amount|is\\s+rs|ready)|" +
        "(?:electricity|water|gas|broadband|internet|dth|telephone|postpaid)\\s*(?:bill|recharge)|" +
        "bill\\s*(?:no|number|date|period)|" +
        "total\\s+(?:due|payable|amount\\s+due)|" +
        "pay\\s+(?:your|the)\\s+bill|view\\s+(?:your\\s+)?bill|" +
        "\\bbiller\\b|billing\\s+cycle|statement\\s+(?:date|period|summary)|" +
        "statement\\s+is\\s+ready|bill\\s+generated",
        Pattern.CASE_INSENSITIVE
    );

    // ── NEW: Insurance / SIP / Mutual Fund / Investment ─────────────────
    private static final Pattern INVESTMENT_PATTERN = Pattern.compile(
        "\\bsip\\b|mutual\\s*fund|\\bnav\\b|units?\\s+allot|" +
        "(?:policy|premium)\\s+(?:no|number|due|renewal|amount)|" +
        "insurance\\s+(?:premium|policy|plan|renewal)|" +
        "\\bfolio\\b|portfolio|maturity\\s+(?:date|amount|proceeds)|" +
        "fixed\\s+deposit\\s+(?:maturing|matured|booked)|\\bfd\\b\\s+(?:maturing|booked)|" +
        "(?:term|endowment|ulip|money.back)\\s+(?:plan|policy)",
        Pattern.CASE_INSENSITIVE
    );

    // ── NEW: Subscription / Plan renewals ───────────────────────────────
    private static final Pattern SUBSCRIPTION_PATTERN = Pattern.compile(
        "subscription\\s+(?:renewed|activated|started|cancelled)|" +
        "auto[\\s-]?(?:renewal|renew)|plan\\s+(?:activated|renewed|upgraded)|" +
        "membership\\s+(?:renewed|activated|expir)|" +
        "trial\\s+(?:started|ending|expired)",
        Pattern.CASE_INSENSITIVE
    );

    // ═══════════════════════════════════════════════════════════════════════
    // Stage 3: Transaction Verbs (debit vs credit)
    // ═══════════════════════════════════════════════════════════════════════
    private static final Pattern DEBIT_VERB = Pattern.compile(
        "debited|\\bdebit\\b|spent|\\bpaid\\b|purchase[d]?|sent to|deducted|withdrawn|" +
        "withdrawal|\\bdr\\b|paying|transferred to|payment of",
        Pattern.CASE_INSENSITIVE
    );

    private static final Pattern CREDIT_VERB = Pattern.compile(
        "credited|\\bcredit\\b|received|deposited|\\badded\\b|refund(?:ed)?|salary|" +
        "\\bcr\\b|cashback|has been credited|money received",
        Pattern.CASE_INSENSITIVE
    );

    // Currency context required near credit verbs to filter out "points credited"
    private static final Pattern CURRENCY_CONTEXT = Pattern.compile(
        "rs\\.?|\\binr\\b|₹|rupees?|\\bamt\\b|\\bamount\\b|a/c|acc|account|card",
        Pattern.CASE_INSENSITIVE
    );

    // ═══════════════════════════════════════════════════════════════════════
    // Stage 4: Amount Extraction
    // ═══════════════════════════════════════════════════════════════════════
    private static final Pattern AMOUNT_WITH_CURRENCY = Pattern.compile(
        "(?:rs\\.?|inr|₹)\\s*[:.]?\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)",
        Pattern.CASE_INSENSITIVE
    );
    private static final Pattern AMOUNT_NEAR_VERB = Pattern.compile(
        "(?:debited|credited|spent|paid|transferred|deposited|sent|received|deducted|withdrawn)" +
        "\\s*(?:by|for|of|with|to)?\\s*(?:rs\\.?|inr|₹)?\\s*[:.]?\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)",
        Pattern.CASE_INSENSITIVE
    );
    private static final Pattern BALANCE_CONTEXT = Pattern.compile(
        "(?:avl|avbl|available|avail|closing|current|a/c|acct|account)\\s*(?:bal|balance)",
        Pattern.CASE_INSENSITIVE
    );

    // ═══════════════════════════════════════════════════════════════════════
    // Stage 5: Vendor / Merchant Extraction
    // ═══════════════════════════════════════════════════════════════════════
    private static final Pattern VPA_PATTERN = Pattern.compile(
        "(?:to vpa|vpa|to|paid to|sent to|at|towards|info[:\\s]|merchant)\\s+" +
        "([a-z0-9][a-z0-9._\\-]{1,40}@[a-z]{2,15})",
        Pattern.CASE_INSENSITIVE
    );
    private static final Pattern MERCHANT_PATTERN = Pattern.compile(
        "(?:paid to|sent to|received from|at|towards|to)\\s+" +
        "([A-Za-z][A-Za-z0-9&.\\s\\-]{1,34})",
        Pattern.CASE_INSENSITIVE
    );

    // Account number (last 3-4 digits)
    private static final Pattern ACC_PATTERN = Pattern.compile(
        "(?:a/c|acc|account|ac|card)\\s*(?:no\\.?|number|ending|x)?\\s*[xX*]*\\s*([0-9]{3,4})\\b",
        Pattern.CASE_INSENSITIVE
    );

    // False-positive vendor fragments
    private static final String[] FALSE_VENDORS = {
        "your account", "upi ref", "avl bal", "your a/c", "ref no",
        "available balance", "bal", "ref", "avl", "txn", "block", "call",
        "sms block", "info", "vpa", "the amount", "your card", "your"
    };

    // Sender classification
    private static final Pattern PERSONAL_NUMBER = Pattern.compile("^\\+?\\d{10,13}$");

    // ═══════════════════════════════════════════════════════════════════════
    // PUBLIC API
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Parse a single SMS message body and return a JSONObject with transaction
     * data if it's a genuine financial transaction, or null otherwise.
     */
    public static JSONObject parseSms(String sender, String body, long timestamp) {
        if (body == null || body.trim().isEmpty()) {
            return null;
        }

        String cleanBody = body.replaceAll("\\n", " ").replaceAll("\\s+", " ").trim();
        String lowerBody = cleanBody.toLowerCase(Locale.US);

        // ── Stage 1: cheap keyword pre-check ─────────────────────────────
        if (!containsAny(lowerBody, FINANCIAL_KEYWORDS)) {
            return null;
        }

        // ── Stage 2: hard rejects (ALL categories) ──────────────────────
        if (OTP_PATTERN.matcher(cleanBody).find()) {
            Log.d(TAG, "REJECT [OTP]: " + preview(cleanBody));
            return null;
        }
        if (PROMO_PATTERN.matcher(cleanBody).find()) {
            Log.d(TAG, "REJECT [PROMO]: " + preview(cleanBody));
            return null;
        }
        if (FAILED_PATTERN.matcher(cleanBody).find()) {
            Log.d(TAG, "REJECT [FAILED]: " + preview(cleanBody));
            return null;
        }
        if (REMINDER_PATTERN.matcher(cleanBody).find()) {
            Log.d(TAG, "REJECT [REMINDER]: " + preview(cleanBody));
            return null;
        }
        if (MISC_NONTXN_PATTERN.matcher(cleanBody).find()) {
            Log.d(TAG, "REJECT [MISC]: " + preview(cleanBody));
            return null;
        }
        if (PF_PATTERN.matcher(cleanBody).find()) {
            Log.d(TAG, "REJECT [PF/EPF]: " + preview(cleanBody));
            return null;
        }
        if (ORDER_PATTERN.matcher(cleanBody).find()) {
            Log.d(TAG, "REJECT [ORDER]: " + preview(cleanBody));
            return null;
        }
        if (POINTS_PATTERN.matcher(cleanBody).find()) {
            Log.d(TAG, "REJECT [POINTS]: " + preview(cleanBody));
            return null;
        }
        if (BILL_PATTERN.matcher(cleanBody).find()) {
            Log.d(TAG, "REJECT [BILL]: " + preview(cleanBody));
            return null;
        }
        if (INVESTMENT_PATTERN.matcher(cleanBody).find()) {
            Log.d(TAG, "REJECT [INVESTMENT]: " + preview(cleanBody));
            return null;
        }
        if (SUBSCRIPTION_PATTERN.matcher(cleanBody).find()) {
            Log.d(TAG, "REJECT [SUBSCRIPTION]: " + preview(cleanBody));
            return null;
        }

        // ── Stage 3: must contain a genuine transaction verb ─────────────
        Matcher debitM = DEBIT_VERB.matcher(cleanBody);
        Matcher creditM = CREDIT_VERB.matcher(cleanBody);
        int debitIdx = debitM.find() ? debitM.start() : -1;
        int creditIdx = creditM.find() ? creditM.start() : -1;

        if (debitIdx == -1 && creditIdx == -1) {
            return null; // Keyword present but no completed-transaction verb
        }

        // ── Credit verb tightening: require currency context nearby ──────
        // If ONLY credit verb is found (no debit verb), check for currency context
        // within ±80 chars of the credit verb position to prevent "points credited" false positives
        if (debitIdx == -1 && creditIdx >= 0) {
            if (!hasCurrencyContextNear(cleanBody, creditIdx, 80)) {
                Log.d(TAG, "REJECT [CREDIT_NO_CURRENCY]: " + preview(cleanBody));
                return null;
            }
        }

        // ── Stage 4: amount (transaction amount, not balance) ────────────
        AmountMatch am = extractAmount(cleanBody);
        if (am == null || am.value <= 0.0) {
            Log.d(TAG, "REJECT [NO_AMOUNT]: " + preview(cleanBody));
            return null;
        }
        double amount = am.value;

        // ── Type detection: verb nearest the amount wins ─────────────────
        String type = resolveType(debitIdx, creditIdx, am.index);

        // ── Stage 5: vendor / merchant ───────────────────────────────────
        String vendor = extractVendor(cleanBody);

        // ── Account last 4 ───────────────────────────────────────────────
        String accountLast4 = "";
        Matcher accMatcher = ACC_PATTERN.matcher(cleanBody);
        if (accMatcher.find()) {
            accountLast4 = accMatcher.group(1);
        }

        // ── Stage 6: sender-aware confidence scoring ─────────────────────
        boolean hasVpaSignal = lowerBody.contains("upi") || lowerBody.contains("vpa")
                || lowerBody.contains("@");
        int confidence = 2; // verb + amount already established
        if (!accountLast4.isEmpty()) confidence++;
        if (!"Transaction".equals(vendor)) confidence++;
        if (hasVpaSignal) confidence++;

        // Known bank sender boost
        String senderSuffix = extractSenderSuffix(sender);
        boolean isKnownBank = isKnownBankSender(senderSuffix);
        if (isKnownBank) {
            confidence += 2; // strong signal — verified bank sender
        }

        boolean personalSender = sender != null && PERSONAL_NUMBER.matcher(sender.trim()).matches();
        if (personalSender && accountLast4.isEmpty() && !hasVpaSignal) {
            // A plain 10-digit number with no bank/UPI signal is unreliable
            Log.d(TAG, "REJECT [PERSONAL_SENDER]: " + preview(cleanBody));
            return null;
        }

        if (confidence < CONFIDENCE_THRESHOLD) {
            Log.d(TAG, "REJECT [LOW_CONF=" + confidence + "]: " + preview(cleanBody));
            return null;
        }

        // ── Build result JSON ────────────────────────────────────────────
        long ts = timestamp > 0 ? timestamp : System.currentTimeMillis();
        Date msgDate = new Date(ts);
        String dateStr = new SimpleDateFormat("yyyy-MM-dd", Locale.US).format(msgDate);
        String timeStr = new SimpleDateFormat("HH:mm", Locale.US).format(msgDate);
        try {
            JSONObject result = new JSONObject();
            String id = "sms_" + ts + "_" + (int)(Math.random() * 10000);
            result.put("id", id);
            result.put("amount", amount);
            result.put("type", type);
            result.put("vendor", vendor);
            result.put("accountLast4", accountLast4);
            result.put("date", dateStr);
            result.put("time", timeStr);
            result.put("timestamp", ts);
            result.put("rawBody", body);
            result.put("sender", sender != null ? sender : "Bank");

            Log.d(TAG, "✅ ACCEPT: " + type + " " + amount + " at " + vendor +
                        " [" + dateStr + "] conf=" + confidence +
                        " sender=" + (isKnownBank ? senderSuffix + "(BANK)" : sender));
            return result;
        } catch (JSONException e) {
            Log.e(TAG, "JSON build error", e);
            return null;
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // HELPER METHODS
    // ═══════════════════════════════════════════════════════════════════════

    private static boolean containsAny(String haystack, String[] needles) {
        for (String n : needles) {
            if (haystack.contains(n)) return true;
        }
        return false;
    }

    private static String preview(String s) {
        return s.substring(0, Math.min(80, s.length()));
    }

    /** Extract the 6-character bank sender suffix from an SMS address like "VM-HDFCBK". */
    private static String extractSenderSuffix(String sender) {
        if (sender == null || sender.trim().isEmpty()) return "";
        String s = sender.trim().toUpperCase(Locale.US);
        // Common format: XX-YYYYYY (2-char telecom prefix + hyphen + 6-char bank ID)
        int dashIdx = s.lastIndexOf('-');
        if (dashIdx >= 0 && dashIdx < s.length() - 1) {
            return s.substring(dashIdx + 1);
        }
        // Some senders are just the 6-char code without prefix
        if (s.length() >= 5 && s.length() <= 8 && s.matches("[A-Z0-9]+")) {
            return s;
        }
        return s;
    }

    /** Check if a sender suffix matches any known Indian bank sender ID. */
    private static boolean isKnownBankSender(String suffix) {
        if (suffix == null || suffix.isEmpty()) return false;
        return KNOWN_BANK_SENDERS.contains(suffix.toUpperCase(Locale.US));
    }

    /**
     * Check if there's a currency context indicator (Rs, INR, ₹, A/c, card, etc.)
     * within ±windowSize characters of the given position in the body.
     */
    private static boolean hasCurrencyContextNear(String body, int position, int windowSize) {
        int start = Math.max(0, position - windowSize);
        int end = Math.min(body.length(), position + windowSize);
        String window = body.substring(start, end);
        return CURRENCY_CONTEXT.matcher(window).find();
    }

    /** Holds a parsed amount and where in the body it was found. */
    private static final class AmountMatch {
        final double value;
        final int index;
        AmountMatch(double value, int index) {
            this.value = value;
            this.index = index;
        }
    }

    /**
     * Extract the transaction amount, preferring amounts tied to a debit/credit
     * verb and skipping any amount that sits inside a "balance" context.
     */
    private static AmountMatch extractAmount(String body) {
        // 1) Prefer an amount directly attached to a transaction verb.
        Matcher nearVerb = AMOUNT_NEAR_VERB.matcher(body);
        if (nearVerb.find()) {
            Double v = parseAmount(nearVerb.group(1));
            if (v != null && v > 0) return new AmountMatch(v, nearVerb.start(1));
        }

        // 2) Otherwise take the first currency-prefixed amount that is NOT a balance.
        Matcher cur = AMOUNT_WITH_CURRENCY.matcher(body);
        while (cur.find()) {
            int start = cur.start();
            int windowStart = Math.max(0, start - 30);
            String before = body.substring(windowStart, start);
            Double v = parseAmount(cur.group(1));
            if (v == null || v <= 0) continue;
            if (BALANCE_CONTEXT.matcher(before).find()) {
                continue; // skip balance figures
            }
            return new AmountMatch(v, cur.start(1));
        }

        // 3) Only a balance-looking amount was found
        return null;
    }

    private static Double parseAmount(String raw) {
        if (raw == null) return null;
        try {
            return Double.parseDouble(raw.replaceAll(",", ""));
        } catch (Exception e) {
            return null;
        }
    }

    /** Decide expense vs inflow using whichever verb sits closest to the amount. */
    private static String resolveType(int debitIdx, int creditIdx, int amountIdx) {
        if (debitIdx == -1) return "inflow";
        if (creditIdx == -1) return "expense";
        int dDist = Math.abs(debitIdx - amountIdx);
        int cDist = Math.abs(creditIdx - amountIdx);
        return dDist <= cDist ? "expense" : "inflow";
    }

    /** Extract a human-readable merchant/counterparty name, or "Transaction". */
    private static String extractVendor(String body) {
        // 1) UPI VPA gives the most reliable counterparty.
        Matcher vpa = VPA_PATTERN.matcher(body);
        if (vpa.find()) {
            String handle = vpa.group(1);
            String name = handle.split("@")[0].replaceAll("[._\\-]+", " ").trim();
            name = titleCase(name);
            if (isUsableVendor(name)) return name;
        }

        // 2) "paid to / at / towards <name>".
        Matcher merch = MERCHANT_PATTERN.matcher(body);
        while (merch.find()) {
            String candidate = merch.group(1).trim();
            candidate = cleanVendorCandidate(candidate);
            if (isUsableVendor(candidate)) return candidate;
        }

        return "Transaction";
    }

    private static String cleanVendorCandidate(String candidate) {
        candidate = candidate
            .replaceAll("(?i)\\b(?:on|via|ref|refno|upi|imps|neft|rtgs|txn|info|dated).*$", "")
            .replaceAll("\\d{4,}", " ")
            .replaceAll("[^A-Za-z0-9&.\\s\\-]", " ")
            .replaceAll("\\s+", " ")
            .trim();
        return candidate;
    }

    private static boolean isUsableVendor(String candidate) {
        if (candidate == null) return false;
        String c = candidate.trim();
        if (c.length() < 2) return false;
        String lc = c.toLowerCase(Locale.US);
        for (String fv : FALSE_VENDORS) {
            if (lc.equals(fv) || lc.startsWith(fv + " ") || lc.contains(" " + fv + " ")) return false;
        }
        if (c.matches(".*\\d{5,}.*")) return false;
        if (c.matches("^[0-9.\\s+\\-()]+$")) return false;
        return true;
    }

    private static String titleCase(String s) {
        if (s == null || s.isEmpty()) return s;
        String[] parts = s.split("\\s+");
        StringBuilder sb = new StringBuilder();
        for (String p : parts) {
            if (p.isEmpty()) continue;
            sb.append(Character.toUpperCase(p.charAt(0)));
            if (p.length() > 1) sb.append(p.substring(1));
            sb.append(' ');
        }
        return sb.toString().trim();
    }
}
