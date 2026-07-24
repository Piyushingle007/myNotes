package com.mynotes.app;

import android.util.Log;
import org.json.JSONException;
import org.json.JSONObject;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Parses raw SMS bodies into structured financial transactions.
 *
 * The algorithm is intentionally conservative: it accepts a message ONLY when it
 * looks like a genuine, completed bank/UPI/card debit or credit for the user's own
 * account, and rejects everything else (OTPs, promotions, failed/pending/reversed
 * transactions, EMI/bill reminders and pure balance-enquiry notifications).
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

    // ── Stage 1: quick pre-check keywords (cheap short-circuit) ──────────
    private static final String[] FINANCIAL_KEYWORDS = {
        "debited", "credited", "spent", "paid", "deducted", "withdrawn",
        "transferred", "deposited", "received", "refunded", "payment",
        "debit", "credit", "upi", "neft", "imps", "rtgs",
        "rs.", "rs ", "inr", "₹", "rupees",
        "a/c", "acc", "card", "account",
        "sent to", "vpa"
    };

    // ── Stage 2: unconditional REJECT patterns (run before acceptance) ───
    // OTP / verification codes.
    private static final Pattern OTP_PATTERN = Pattern.compile(
        "\\botp\\b|one[\\s-]?time[\\s-]?password|do not share|don't share|" +
        "verification code|security code|is your (?:otp|code|password|pin|verification)|" +
        "\\buse\\s+\\d{4,8}\\b.*(?:otp|login|verify)|(?:otp|code)\\s*(?:is|:)\\s*\\d{3,8}",
        Pattern.CASE_INSENSITIVE
    );

    // Marketing / promotional / offers / loan pitches.
    private static final Pattern PROMO_PATTERN = Pattern.compile(
        "\\boffer\\b|cashback up to|upto \\d|\\bsale\\b|discount|pre[\\s-]?approved|" +
        "apply now|\\bwin\\b|reward points|lowest interest|loan (?:offer|approved|of)|" +
        "emi option|book now|\\bhurry\\b|limited period|%\\s*off|\\bcoupon\\b|" +
        "shop now|buy now|voucher|redeem|earn \\d|congratulations",
        Pattern.CASE_INSENSITIVE
    );

    // Failed / declined / pending / reversed / not-yet-happened transactions.
    private static final Pattern FAILED_PATTERN = Pattern.compile(
        "\\bfailed\\b|declined|unsuccessful|could not be|not processed|not completed|" +
        "will be (?:credited|debited|deducted)|has been requested|is pending|\\bpending\\b|" +
        "reversal|reversed|timed out|transaction (?:cancelled|canceled)|" +
        "insufficient (?:balance|funds)",
        Pattern.CASE_INSENSITIVE
    );

    // Reminders / due dates / mandates (a reminder is not a completed transaction).
    private static final Pattern REMINDER_PATTERN = Pattern.compile(
        "\\bdue\\b|reminder|pay your|payment is due|\\boutstanding\\b|" +
        "\\bautopay\\b|e[\\s-]?mandate|\\bmandate\\b|will be auto[\\s-]?debited|" +
        "\\bscheduled\\b|last date|kindly pay|please pay|bill generated|statement is ready",
        Pattern.CASE_INSENSITIVE
    );

    // Other non-money notifications (card activation, PIN change, delivery, KYC, etc.).
    private static final Pattern MISC_NONTXN_PATTERN = Pattern.compile(
        "card (?:activated|blocked|dispatched|delivered)|pin (?:changed|generated|set)|" +
        "\\bkyc\\b|update your|\\bregistered\\b successfully|has been (?:activated|dispatched|delivered)|" +
        "delivery|out for delivery|password (?:changed|reset)",
        Pattern.CASE_INSENSITIVE
    );

    // ── Stage 3: transaction verbs (debit vs credit), used for type + anchoring ──
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

    // ── Stage 4: amount extraction ──────────────────────────────────────
    // Currency-prefixed amount, e.g. "Rs.1,234.56", "INR 1234", "₹1,23,456", "Rs 500/-".
    private static final Pattern AMOUNT_WITH_CURRENCY = Pattern.compile(
        "(?:rs\\.?|inr|₹)\\s*[:.]?\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)",
        Pattern.CASE_INSENSITIVE
    );
    // Amount adjacent to a transaction verb without an explicit currency symbol.
    private static final Pattern AMOUNT_NEAR_VERB = Pattern.compile(
        "(?:debited|credited|spent|paid|transferred|deposited|sent|received|deducted|withdrawn)" +
        "\\s*(?:by|for|of|with|to)?\\s*(?:rs\\.?|inr|₹)?\\s*[:.]?\\s*([0-9][0-9,]*(?:\\.[0-9]{1,2})?)",
        Pattern.CASE_INSENSITIVE
    );
    // Anything that looks like a running/available balance — used to EXCLUDE that amount.
    private static final Pattern BALANCE_CONTEXT = Pattern.compile(
        "(?:avl|avbl|available|avail|closing|current|a/c|acct|account)\\s*(?:bal|balance)",
        Pattern.CASE_INSENSITIVE
    );

    // ── Stage 5: vendor / merchant extraction ───────────────────────────
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

    // ── Account number (last 3-4 digits) ────────────────────────────────
    private static final Pattern ACC_PATTERN = Pattern.compile(
        "(?:a/c|acc|account|ac|card)\\s*(?:no\\.?|number|ending|x)?\\s*[xX*]*\\s*([0-9]{3,4})\\b",
        Pattern.CASE_INSENSITIVE
    );

    // ── False-positive vendor fragments ─────────────────────────────────
    private static final String[] FALSE_VENDORS = {
        "your account", "upi ref", "avl bal", "your a/c", "ref no",
        "available balance", "bal", "ref", "avl", "txn", "block", "call",
        "sms block", "info", "vpa", "the amount", "your card", "your"
    };

    // ── Stage 6: sender classification ──────────────────────────────────
    private static final Pattern PERSONAL_NUMBER = Pattern.compile("^\\+?\\d{10,13}$");

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

        // ── Stage 2: hard rejects ────────────────────────────────────────
        if (OTP_PATTERN.matcher(cleanBody).find()
                || PROMO_PATTERN.matcher(cleanBody).find()
                || FAILED_PATTERN.matcher(cleanBody).find()
                || REMINDER_PATTERN.matcher(cleanBody).find()
                || MISC_NONTXN_PATTERN.matcher(cleanBody).find()) {
            Log.d(TAG, "Rejected non-transaction SMS: " + preview(cleanBody));
            return null;
        }

        // ── Stage 3: must contain a genuine transaction verb ─────────────
        Matcher debitM = DEBIT_VERB.matcher(cleanBody);
        Matcher creditM = CREDIT_VERB.matcher(cleanBody);
        int debitIdx = debitM.find() ? debitM.start() : -1;
        int creditIdx = creditM.find() ? creditM.start() : -1;

        if (debitIdx == -1 && creditIdx == -1) {
            return null; // Keyword present but no completed-transaction verb (e.g. balance enquiry)
        }

        // ── Stage 4: amount (transaction amount, not balance) ────────────
        AmountMatch am = extractAmount(cleanBody);
        if (am == null || am.value <= 0.0) {
            Log.d(TAG, "Financial SMS but no valid amount: " + preview(cleanBody));
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

        boolean personalSender = sender != null && PERSONAL_NUMBER.matcher(sender.trim()).matches();
        if (personalSender && accountLast4.isEmpty() && !hasVpaSignal) {
            // A plain 10-digit number talking about money, with no bank/UPI signal, is unreliable.
            Log.d(TAG, "Rejected low-trust personal-number SMS: " + preview(cleanBody));
            return null;
        }

        if (confidence < CONFIDENCE_THRESHOLD) {
            Log.d(TAG, "Rejected low-confidence(" + confidence + ") SMS: " + preview(cleanBody));
            return null;
        }

        // ── Build result JSON ────────────────────────────────────────────
        String dateStr = new SimpleDateFormat("yyyy-MM-dd", Locale.US)
            .format(new Date(timestamp > 0 ? timestamp : System.currentTimeMillis()));
        try {
            JSONObject result = new JSONObject();
            long ts = timestamp > 0 ? timestamp : System.currentTimeMillis();
            String id = "sms_" + ts + "_" + (int)(Math.random() * 10000);
            result.put("id", id);
            result.put("amount", amount);
            result.put("type", type);
            result.put("vendor", vendor);
            result.put("accountLast4", accountLast4);
            result.put("date", dateStr);
            result.put("timestamp", ts);
            result.put("rawBody", body);
            result.put("sender", sender != null ? sender : "Bank");

            Log.d(TAG, "✅ Parsed: " + type + " " + amount + " at " + vendor + " [" + dateStr + "] conf=" + confidence);
            return result;
        } catch (JSONException e) {
            Log.e(TAG, "JSON build error", e);
            return null;
        }
    }

    // ── Helpers ─────────────────────────────────────────────────────────

    private static boolean containsAny(String haystack, String[] needles) {
        for (String n : needles) {
            if (haystack.contains(n)) return true;
        }
        return false;
    }

    private static String preview(String s) {
        return s.substring(0, Math.min(80, s.length()));
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
        AmountMatch firstBalance = null;
        while (cur.find()) {
            int start = cur.start();
            // Look back a short window to see if this amount is a balance figure.
            int windowStart = Math.max(0, start - 30);
            String before = body.substring(windowStart, start);
            Double v = parseAmount(cur.group(1));
            if (v == null || v <= 0) continue;
            if (BALANCE_CONTEXT.matcher(before).find()) {
                if (firstBalance == null) firstBalance = new AmountMatch(v, cur.start(1));
                continue; // skip balance figures
            }
            return new AmountMatch(v, cur.start(1));
        }

        // 3) Only a balance-looking amount was found — not a spendable transaction amount.
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
        // Drop reference numbers, phone numbers and trailing bank noise.
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
        // Reject anything that is mostly digits / phone-number-like.
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
