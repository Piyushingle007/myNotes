package com.mynotes.app;

import android.util.Log;
import org.json.JSONException;
import org.json.JSONObject;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class SmsParser {

    private static final String TAG = "SmsParser";

    // ── Quick pre-check keywords (any of these must appear for financial SMS) ──
    private static final String[] FINANCIAL_KEYWORDS = {
        "debited", "credited", "spent", "paid", "deducted", "withdrawn",
        "transferred", "deposited", "received", "refunded", "payment",
        "debit", "credit", "upi", "neft", "imps",
        "rs.", "rs ", "inr", "₹", "rupees",
        "a/c", "acc", "card", "account",
        "sent to", "vpa"
    };

    // ── Amount extraction patterns ──────────────────────────────────────
    private static final Pattern[] AMOUNT_PATTERNS = {
        // Rs./INR/₹ followed by amount
        Pattern.compile(
            "(?:rs\\.?|inr|₹|amt|amount)\\s*[:.\\/\\-\\s]?\\s*([0-9,]+(?:\\.[0-9]{1,2})?)",
            Pattern.CASE_INSENSITIVE
        ),
        // Verb followed by amount: "debited by Rs 450" or "debited 450"
        Pattern.compile(
            "(?:debited|credited|spent|paid|transferred|deposited|sent|received|deducted|withdrawn)\\s*" +
            "(?:by|for|of|with)?\\s*(?:rs\\.?|inr|₹)?\\s*[:.\\/\\-\\s]?\\s*([0-9,]+(?:\\.[0-9]{1,2})?)",
            Pattern.CASE_INSENSITIVE
        ),
        // Amount before verb: "450.00 debited"
        Pattern.compile(
            "([0-9,]+(?:\\.[0-9]{1,2})?)\\s*(?:debited|credited|spent|paid|transferred|deposited|sent|received|has been)",
            Pattern.CASE_INSENSITIVE
        ),
    };

    // ── Type detection ──────────────────────────────────────────────────
    private static final Pattern DEBIT_PATTERN = Pattern.compile(
        "(?:debited|spent|paid|purchase|sent\\s+to|deducted|withdrawn|debit|payment|\\bdr\\b|spent\\s+on|paying)",
        Pattern.CASE_INSENSITIVE
    );

    private static final Pattern CREDIT_PATTERN = Pattern.compile(
        "(?:credited\\s+to\\s+your|credited\\s+with|received|deposited|added|refunded|salary|\\bcr\\b|cashback)",
        Pattern.CASE_INSENSITIVE
    );

    // ── Vendor extraction ───────────────────────────────────────────────
    private static final Pattern VENDOR_PATTERN = Pattern.compile(
        "(?:at|towards|info|via|vpa|merchant|to\\s+vpa|paid\\s+to|sent\\s+to)\\s+([A-Za-z0-9\\s._\\-@]{2,35})",
        Pattern.CASE_INSENSITIVE
    );

    // ── Account number ──────────────────────────────────────────────────
    private static final Pattern ACC_PATTERN = Pattern.compile(
        "(?:a/c|acc|card|account|ac)\\s*(?:no\\.?)?\\s*[xX*]*([0-9]{3,4})",
        Pattern.CASE_INSENSITIVE
    );

    // ── False positive vendor names & phone number patterns ─────────────
    private static final String[] FALSE_VENDORS = {
        "your account", "upi ref", "avl bal", "your a/c", "a/c", "ref no",
        "available balance", "bal", "ref", "avl", "txn", "block", "call", "sms block"
    };

    /**
     * Parse a single SMS message body and return a JSONObject with transaction
     * data if it's a financial message, or null if it's not.
     */
    public static JSONObject parseSms(String sender, String body, long timestamp) {
        if (body == null || body.trim().isEmpty()) {
            return null;
        }

        String cleanBody = body.replaceAll("\\n", " ").replaceAll("\\s+", " ").trim();
        String lowerBody = cleanBody.toLowerCase(Locale.US);

        // ── Quick pre-check: does this SMS contain ANY financial keyword? ──
        boolean hasFinancialKeyword = false;
        for (String kw : FINANCIAL_KEYWORDS) {
            if (lowerBody.contains(kw)) {
                hasFinancialKeyword = true;
                break;
            }
        }
        if (!hasFinancialKeyword) {
            return null; // Not a financial SMS - skip silently
        }

        // ── Detect debit/credit ─────────────────────────────────────────
        // Debit takes precedence: if an account is debited, it's an expense regardless of merchant credit notices
        boolean isDebit = DEBIT_PATTERN.matcher(cleanBody).find();
        boolean isCredit = CREDIT_PATTERN.matcher(cleanBody).find();

        if (!isDebit && !isCredit) {
            return null; // Has keyword but no transaction verb
        }

        String type;
        if (isDebit) {
            type = "expense";
        } else {
            type = "inflow";
        }

        // ── Extract amount ──────────────────────────────────────────────
        double amount = 0.0;
        for (Pattern pat : AMOUNT_PATTERNS) {
            Matcher m = pat.matcher(cleanBody);
            if (m.find()) {
                try {
                    String amtStr = m.group(1).replaceAll(",", "");
                    amount = Double.parseDouble(amtStr);
                    if (amount > 0) break;
                } catch (Exception ignored) {}
            }
        }

        if (amount <= 0.0) {
            Log.d(TAG, "Financial SMS but no amount extracted: " + cleanBody.substring(0, Math.min(80, cleanBody.length())));
            return null;
        }

        // ── Extract vendor (ignoring phone numbers & false positive codes) ──
        String vendor = "Transaction";
        Matcher vendorMatcher = VENDOR_PATTERN.matcher(cleanBody);
        if (vendorMatcher.find()) {
            String candidate = vendorMatcher.group(1).trim();
            boolean isFalsePositive = false;
            for (String fv : FALSE_VENDORS) {
                if (candidate.toLowerCase(Locale.US).contains(fv)) {
                    isFalsePositive = true;
                    break;
                }
            }
            // Reject if candidate is digits/phone number (5+ consecutive digits)
            if (candidate.matches(".*\\d{5,}.*") || candidate.matches("^[0-9.\\s+\\-()]+$")) {
                isFalsePositive = true;
            }

            if (!isFalsePositive && candidate.length() >= 2) {
                // Strip trailing phone numbers or digits if any
                vendor = candidate.replaceAll("\\d{4,}", "").replaceAll("\\s+", " ").trim();
                if (vendor.isEmpty()) vendor = "Transaction";
            }
        }

        // Fallback: If vendor is still generic "Transaction", try to extract merchant name from raw SMS
        if ("Transaction".equals(vendor)) {
            String cleanedBody = cleanBody
                .replaceAll("(?i)(?:call|sms block|dispute|http|https|upi:\\d+|block\\s+\\d+).*", "")
                .replaceAll("(?i)(?:debited|credited|spent|paid|transferred|deposited|sent|received|for|of|with|rs\\.?|inr|₹|\\d+(?:\\.\\d+)?)", " ")
                .replaceAll("(?i)\\b(?:account|acct|a/c|acc|card|upi|vpa|ref|no|val|bal|avl|avail)\\b", " ")
                .replaceAll("[^a-zA-Z\\s]", " ")
                .replaceAll("\\s+", " ")
                .trim();
            if (cleanedBody.length() >= 3 && !cleanedBody.matches("^\\d+$")) {
                String[] words = cleanedBody.split("\\s+");
                StringBuilder sb = new StringBuilder();
                for (int i = 0; i < Math.min(3, words.length); i++) {
                    if (words[i].length() >= 2) {
                        sb.append(words[i]).append(" ");
                    }
                }
                String extracted = sb.toString().trim();
                if (extracted.length() >= 3) {
                    vendor = extracted;
                }
            }
        }

        // ── Extract account last 4 digits ───────────────────────────────
        String accountLast4 = "";
        Matcher accMatcher = ACC_PATTERN.matcher(cleanBody);
        if (accMatcher.find()) {
            accountLast4 = accMatcher.group(1);
        }

        // ── Build date string ───────────────────────────────────────────
        String dateStr = new SimpleDateFormat("yyyy-MM-dd", Locale.US)
            .format(new Date(timestamp > 0 ? timestamp : System.currentTimeMillis()));

        // ── Build result JSON ───────────────────────────────────────────
        try {
            JSONObject result = new JSONObject();
            String id = "sms_" + (timestamp > 0 ? timestamp : System.currentTimeMillis()) + "_" + (int)(Math.random() * 10000);
            result.put("id", id);
            result.put("amount", amount);
            result.put("type", type);
            result.put("vendor", vendor);
            result.put("accountLast4", accountLast4);
            result.put("date", dateStr);
            result.put("timestamp", timestamp > 0 ? timestamp : System.currentTimeMillis());
            result.put("rawBody", body);
            result.put("sender", sender != null ? sender : "Bank");

            Log.d(TAG, "✅ Parsed: " + type + " " + amount + " at " + vendor + " [" + dateStr + "]");
            return result;
        } catch (JSONException e) {
            Log.e(TAG, "JSON build error", e);
            return null;
        }
    }
}
