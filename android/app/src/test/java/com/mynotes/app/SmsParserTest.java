package com.mynotes.app;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertNull;
import static org.junit.Assert.assertTrue;

import org.json.JSONObject;
import org.junit.Test;

/**
 * Unit tests for {@link SmsParser}. Covers real Indian bank / UPI / card debit and
 * credit messages (must parse) plus OTPs, promotions, failed/pending transactions,
 * EMI/bill reminders and balance-enquiry notices (must be rejected).
 */
public class SmsParserTest {

    private static final long TS = 1_700_000_000_000L; // fixed timestamp

    private static JSONObject parse(String sender, String body) {
        return SmsParser.parseSms(sender, body, TS);
    }

    // ── Positive cases: genuine transactions ─────────────────────────────

    @Test
    public void hdfcDebitParsed() {
        JSONObject r = parse("AX-HDFCBK",
            "Rs.1,250.00 debited from a/c XX3456 on 24-07-24 to VPA swiggy@ybl. Avl Bal Rs.8,500.00");
        assertNotNull(r);
        assertEquals("expense", r.optString("type"));
        assertEquals(1250.0, r.optDouble("amount"), 0.001);
        assertEquals("3456", r.optString("accountLast4"));
        assertTrue(r.optString("vendor").toLowerCase().contains("swiggy"));
    }

    @Test
    public void sbiCreditParsed() {
        JSONObject r = parse("VM-SBIINB",
            "Your a/c no. XXXXXX7890 is credited by Rs.25,000.00 on 01-07-24 by transfer. Avl Bal Rs.40,000.00");
        assertNotNull(r);
        assertEquals("inflow", r.optString("type"));
        assertEquals(25000.0, r.optDouble("amount"), 0.001);
        assertEquals("7890", r.optString("accountLast4"));
    }

    @Test
    public void iciciCardSpendParsed() {
        JSONObject r = parse("AD-ICICIB",
            "INR 499 spent on ICICI Bank Card XX1234 at AMAZON on 10-Jul. Avl Limit INR 50000");
        assertNotNull(r);
        assertEquals("expense", r.optString("type"));
        assertEquals(499.0, r.optDouble("amount"), 0.001);
        assertEquals("1234", r.optString("accountLast4"));
        assertTrue(r.optString("vendor").toLowerCase().contains("amazon"));
    }

    @Test
    public void upiPaymentParsed() {
        JSONObject r = parse("VK-AXISBK",
            "Rs 200 debited via UPI to zomato@paytm on 12-07-2024. UPI Ref 401234567890.");
        assertNotNull(r);
        assertEquals("expense", r.optString("type"));
        assertEquals(200.0, r.optDouble("amount"), 0.001);
        assertTrue(r.optString("vendor").toLowerCase().contains("zomato"));
    }

    @Test
    public void salaryCreditParsed() {
        JSONObject r = parse("AX-KOTAKB",
            "Rs.75,000.00 credited to your a/c XX9012 towards SALARY on 30-06-24. Avbl Bal Rs 82,300.00");
        assertNotNull(r);
        assertEquals("inflow", r.optString("type"));
        assertEquals(75000.0, r.optDouble("amount"), 0.001);
        assertEquals("9012", r.optString("accountLast4"));
    }

    @Test
    public void amountNotConfusedWithBalance() {
        JSONObject r = parse("AX-HDFCBK",
            "Rs.150.00 debited from a/c XX1111 on 05-07. Avl Bal Rs.99,999.00");
        assertNotNull(r);
        assertEquals(150.0, r.optDouble("amount"), 0.001);
    }

    // ── Negative cases: must all be rejected (null) ──────────────────────

    @Test
    public void otpRejected() {
        assertNull(parse("VM-HDFCBK",
            "123456 is your OTP for txn of Rs.5000 at Amazon. Do not share it with anyone."));
    }

    @Test
    public void promoRejected() {
        assertNull(parse("VM-ICICIB",
            "Get a pre-approved personal loan offer of Rs.5,00,000! Lowest interest. Apply now."));
    }

    @Test
    public void cashbackOfferRejected() {
        assertNull(parse("BP-AMAZON",
            "Grab flat 50% off and cashback up to Rs.500 on your next order. Shop now!"));
    }

    @Test
    public void failedTransactionRejected() {
        assertNull(parse("AX-HDFCBK",
            "Your transaction of Rs.1200 at Flipkart has failed. Amount will be credited back."));
    }

    @Test
    public void pendingTransactionRejected() {
        assertNull(parse("AX-HDFCBK",
            "Payment of Rs.899 is pending and could not be processed due to insufficient balance."));
    }

    @Test
    public void emiReminderRejected() {
        assertNull(parse("VM-BAJAJF",
            "Reminder: Your EMI of Rs.3,499 is due on 05-Aug. Please pay to avoid late charges."));
    }

    @Test
    public void autopayReminderRejected() {
        assertNull(parse("AX-HDFCBK",
            "Rs.649 will be auto-debited from a/c XX3456 on 15-Jul for Netflix autopay mandate."));
    }

    @Test
    public void balanceEnquiryRejected() {
        assertNull(parse("VM-SBIINB",
            "The available balance in your a/c XX7890 is Rs.40,000.00 as on 24-07-24."));
    }

    @Test
    public void cardActivationRejected() {
        assertNull(parse("VM-ICICIB",
            "Your ICICI Bank Credit Card XX1234 has been activated successfully."));
    }

    @Test
    public void nonFinancialRejected() {
        assertNull(parse("+919812345678", "Hey, are we still meeting for lunch tomorrow?"));
    }

    @Test
    public void personalNumberWithoutBankSignalRejected() {
        // Money mentioned but from a personal number with no account/UPI signal.
        assertNull(parse("+919812345678", "I paid Rs.500 for the movie tickets yesterday."));
    }
}
