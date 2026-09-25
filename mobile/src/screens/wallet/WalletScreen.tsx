import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, ScrollView, Pressable, StyleSheet, TextInput, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useFocusEffect } from "@react-navigation/native";
import Ionicons from "@expo/vector-icons/Ionicons";
import { colors, fonts, radii, spacing } from "../../theme/tokens";
import { showAlert } from "../../lib/alert";
import { LoadError } from "../../components/LoadError";
import { useAppConfig } from "../../lib/appConfig";
import { getWallet, getLedger, requestWithdrawal, getPaystackBanks, resolvePaystackAccount } from "../../api/client";
import { depositViaPaystack } from "../../integrations/paystack";
import type { LedgerEntry, LedgerEntryType, PaystackBank, Wallet, WithdrawDestination } from "../../api/types";
import { WITHDRAWAL_MIN_CENTS } from "../../constants";

const DEPOSIT_PRESETS_CENTS = [1000, 2500, 5000, 10000, 25000];

function formatCents(cents: number) {
  return `${cents < 0 ? "-" : ""}R${Math.abs(cents / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

type LedgerTypeMeta = { label: string; icon: keyof typeof Ionicons.glyphMap };

const LEDGER_TYPE_META: Record<LedgerEntryType, LedgerTypeMeta> = {
  DEPOSIT: { label: "Deposit", icon: "arrow-down-circle-outline" },
  WITHDRAWAL: { label: "Withdrawal", icon: "arrow-up-circle-outline" },
  DISPUTE_REVERSAL: { label: "Dispute", icon: "alert-circle-outline" },
  ADJUSTMENT: { label: "Adjustment", icon: "construct-outline" },
  // Races. Labelled as entry fees and prizes, never stakes or payouts: an
  // entry fee is not a stake that might come back, and a prize is not a
  // share of a pot.
  RACE_ENTRY_FEE: { label: "Race entry", icon: "trophy-outline" },
  RACE_ENTRY_REFUND: { label: "Race refund", icon: "return-up-back-outline" },
  RACE_PRIZE: { label: "Race prize", icon: "medal-outline" },
  // Platform-side mirrors. A normal user never sees these — their ledger is
  // filtered to their own rows — but the platform account uses the same
  // screen, and a missing key here is exactly what blanked this screen once.
  RACE_ENTRY_REVENUE: { label: "Race revenue", icon: "receipt-outline" },
  RACE_PRIZE_EXPENSE: { label: "Prize paid", icon: "receipt-outline" },
  // StreakPot. Labelled as STAKES and POOL shares — the exact opposite
  // framing to races above, and deliberately so: this money can move to
  // another participant, which a race entry fee never does.
  STAKE_HOLD: { label: "Stake", icon: "water-outline" },
  STAKE_REFUND: { label: "Stake refund", icon: "return-up-back-outline" },
  STAKE_FORFEITED: { label: "Stake forfeited", icon: "close-circle-outline" },
  POOL_PAYOUT: { label: "Pool share", icon: "cash-outline" },
  REDEMPTION_FEE: { label: "Redemption", icon: "heart-circle-outline" },
  // Pilot sponsorship. Labelled plainly rather than as a "deposit": nobody
  // paid this in, and calling it one would misrepresent where it came from
  // on the one screen that is supposed to be the record of that.
  SPONSORED_CREDIT: { label: "Sponsored credit", icon: "gift-outline" },
  SPONSORED_CREDIT_EXPENSE: { label: "Sponsorship paid", icon: "receipt-outline" },
};

// Which model a row belongs to, shown as a small tag so a mixed history
// stays legible — "Stake" and "Race entry" are different kinds of
// commitment and the ledger is where that has to be unambiguous.
const MODEL_LABEL: Record<string, string> = {
  race: "Race",
  streakpot: "ASTA",
};

/**
 * Never let an unrecognised ledger type take the wallet down.
 *
 * LEDGER_TYPE_META is typed as exhaustive over LedgerEntryType, but that
 * union is a hand-maintained mirror of a server-side enum — so "exhaustive"
 * is only true until the backend adds a value and this file has not caught
 * up. That is not hypothetical: adding the race types above without updating
 * the union left the Record passing typecheck while the server sent
 * RACE_ENTRY_FEE, and `meta.icon` on undefined blank-screened the whole tab.
 *
 * A transaction history is the last screen that should fail closed — the
 * unknown row renders with its server-supplied description and a neutral
 * icon instead.
 */
function metaFor(type: LedgerEntryType): LedgerTypeMeta {
  return (
    LEDGER_TYPE_META[type] ?? {
      label: String(type)
        .toLowerCase()
        .split("_")
        .join(" ")
        .replace(/^./, (c) => c.toUpperCase()),
      icon: "ellipse-outline",
    }
  );
}

type PanelMode = "none" | "deposit" | "withdraw";

export function WalletScreen() {
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [entries, setEntries] = useState<LedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [panel, setPanel] = useState<PanelMode>("none");
  const config = useAppConfig();
  const hasLoaded = useRef(false);

  const load = useCallback(async () => {
    if (!hasLoaded.current) setLoading(true);
    setLoadError(null);
    const ledgerPromise = getLedger()
      .then((ledger) => {
        setEntries(ledger.entries);
      })
      .catch(() => {
        // The balance and withdrawal controls are more important than a
        // history refresh. Keep the existing rows instead of blanking the tab.
      });

    try {
      setWallet(await getWallet());
      hasLoaded.current = true;
      setLoadError(null);
    } catch (err) {
      setLoadError(err as Error);
    } finally {
      setLoading(false);
    }

    await ledgerPromise;
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  function handleDone(updated: Wallet) {
    setWallet(updated);
    setPanel("none");
    load();
  }

  return (
    <SafeAreaView style={styles.screen} edges={["top"]}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.header}>Wallet</Text>

        <View style={styles.balanceCard}>
          <Text style={styles.balanceLabel}>Available balance</Text>
          <Text style={styles.balanceValue}>{wallet ? formatCents(wallet.balanceCents) : "—"}</Text>
          <View style={styles.actionRow}>
            {/* No deposit during a sponsored pilot. Leaving the button up
                would invite someone to put their own money into something
                that is meant to cost them nothing — and the server refuses
                it anyway, so it could only ever produce an error. */}
            {config.depositsEnabled && (
              <Pressable style={[styles.actionButton, styles.actionButtonPrimary]} onPress={() => setPanel(panel === "deposit" ? "none" : "deposit")}>
                <Ionicons name="add" size={16} color={colors.bg} />
                <Text style={styles.actionButtonPrimaryText}>Deposit</Text>
              </Pressable>
            )}
            <Pressable
              style={[styles.actionButton, !config.depositsEnabled && styles.actionButtonPrimary]}
              onPress={() => setPanel(panel === "withdraw" ? "none" : "withdraw")}
            >
              <Ionicons name="arrow-up-outline" size={16} color={config.depositsEnabled ? colors.text : colors.bg} />
              <Text style={config.depositsEnabled ? styles.actionButtonText : styles.actionButtonPrimaryText}>Withdraw</Text>
            </Pressable>
          </View>
        </View>

        {!config.depositsEnabled && (
          <View style={styles.sponsorNote}>
            <Ionicons name="gift-outline" size={16} color={colors.sage} />
            <Text style={styles.sponsorNoteText}>
              ASTA is covering the pilot, so there is nothing to pay in — your balance is credited for you. Anything you win is
              yours to withdraw.
            </Text>
          </View>
        )}

        {panel === "deposit" && <DepositPanel onDone={handleDone} onCancel={() => setPanel("none")} />}
        {panel === "withdraw" && <WithdrawPanel balanceCents={wallet?.balanceCents ?? 0} onDone={handleDone} onCancel={() => setPanel("none")} />}

        <Text style={styles.sectionTitle}>History</Text>
        {loading && <ActivityIndicator color={colors.accent} style={{ marginTop: spacing.lg }} />}
        {/* This branch has to come before the empty state. A failed load
            leaves the balance as "—" and the ledger empty, and the empty
            state's wording ("No transactions yet") would then tell someone
            with a full history and a real balance that they have neither. */}
        {!loading && loadError && <LoadError error={loadError} onRetry={load} />}
        {!loading && !loadError && entries.length === 0 && <Text style={styles.emptyText}>No transactions yet — deposit to get started.</Text>}
        {entries.map((e) => {
          const meta = metaFor(e.type);
          const credit = e.amountCents >= 0;
          return (
            <View key={e.id} style={styles.ledgerRow}>
              <View style={styles.ledgerIconWrap}>
                <Ionicons name={meta.icon} size={16} color={colors.sub} />
              </View>
              <View style={styles.ledgerBody}>
                <View style={styles.ledgerTitleRow}>
                  <Text style={styles.ledgerTitle}>{meta.label}</Text>
                  {e.model && (
                    <View style={styles.modelTag}>
                      <Text style={styles.modelTagText}>{MODEL_LABEL[e.model] ?? e.model}</Text>
                    </View>
                  )}
                </View>
                <Text style={styles.ledgerSub} numberOfLines={1}>
                  {e.description} · {formatDate(e.createdAt)}
                  {e.status === "PENDING" ? " · Pending" : e.status === "FAILED" ? " · Failed" : ""}
                </Text>
              </View>
              <Text style={[styles.ledgerAmount, { color: credit ? colors.sage : colors.fail }]}>
                {credit ? "+" : ""}
                {formatCents(e.amountCents)}
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

function AmountChips({ value, onChange }: { value: number | null; onChange: (cents: number) => void }) {
  return (
    <View style={styles.chipRow}>
      {DEPOSIT_PRESETS_CENTS.map((c) => (
        <Pressable key={c} style={[styles.presetChip, value === c && styles.presetChipActive]} onPress={() => onChange(c)}>
          <Text style={[styles.presetChipText, value === c && styles.presetChipTextActive]}>R{c / 100}</Text>
        </Pressable>
      ))}
    </View>
  );
}

// Paystack's hosted checkout, opened in a browser session — the only place
// in the app real money moves (wallet/token model, see backend/API.md
// "Wallet"). No native card sheet; see mobile/src/integrations/paystack.ts.
function DepositPanel({ onDone, onCancel }: { onDone: (w: Wallet) => void; onCancel: () => void }) {
  const [amountCents, setAmountCents] = useState<number | null>(2500);
  const [customText, setCustomText] = useState("");
  const [busy, setBusy] = useState(false);

  const resolvedAmount = customText.trim() ? Math.round(parseFloat(customText) * 100) : amountCents;

  async function handleDeposit() {
    if (!resolvedAmount || resolvedAmount <= 0 || Number.isNaN(resolvedAmount)) {
      showAlert("Enter an amount", "Pick a preset or type a custom amount.");
      return;
    }
    setBusy(true);
    try {
      const result = await depositViaPaystack(resolvedAmount);
      if (result.status === "error") {
        showAlert("Couldn't deposit", result.message);
        return;
      }
      // Web: a top-level redirect to Paystack's checkout has already
      // started, so there's nothing to update — this page is unloading, and
      // PaystackCallbackScreen picks the flow up on the way back.
      if (result.status === "redirecting" || result.status === "cancelled") return;
      onDone(result.wallet);
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Deposit</Text>
      <AmountChips value={customText.trim() ? null : amountCents} onChange={(c) => { setAmountCents(c); setCustomText(""); }} />
      <TextInput keyboardAppearance="dark"
        style={styles.customInput}
        placeholder="Custom amount (R)"
        placeholderTextColor={colors.sub}
        keyboardType="decimal-pad"
        value={customText}
        onChangeText={setCustomText}
      />
      <View style={styles.panelActions}>
        <Pressable style={styles.panelCancelButton} onPress={onCancel} disabled={busy}>
          <Text style={styles.panelCancelText}>Cancel</Text>
        </Pressable>
        <Pressable style={styles.panelConfirmButton} onPress={handleDeposit} disabled={busy}>
          {busy ? <ActivityIndicator color={colors.bg} size="small" /> : <Text style={styles.panelConfirmText}>Deposit {resolvedAmount ? formatCents(resolvedAmount) : ""}</Text>}
        </Pressable>
      </View>
    </View>
  );
}

type WithdrawMethod = "PAYSTACK" | "PAYPAL" | "MANUAL";

// Real payout — Paystack Transfer or PayPal Payout, both test/sandbox (see
// backend/API.md "Wallet"). The wallet balance is held the moment this
// request is sent (see modules/wallet/service.ts requestWithdrawal), so a
// pending withdrawal always shows up in History even if the provider takes
// a few minutes to actually confirm it.
function WithdrawPanel({ balanceCents, onDone, onCancel }: { balanceCents: number; onDone: (w: Wallet) => void; onCancel: () => void }) {
  const config = useAppConfig();
  const hasLoaded = useRef(false);
  // With automated payouts off there is exactly one route out — an EFT a
  // person sends — so the panel doesn't offer choices the server refuses.
  const manualOnly = !config.automatedPayoutsEnabled;
  const [method, setMethod] = useState<WithdrawMethod>(manualOnly ? "MANUAL" : "PAYSTACK");

  // EFT destination state. Paystack cannot resolve South African account
  // names (its /bank/resolve rejects ZAR outright), so unlike the PAYSTACK
  // branch there is nothing to verify against — the admin sending the money
  // reads these three fields exactly as typed.
  const [eftBankName, setEftBankName] = useState("");
  const [eftAccountNumber, setEftAccountNumber] = useState("");
  const [eftAccountName, setEftAccountName] = useState("");
  const [customText, setCustomText] = useState("");
  const [busy, setBusy] = useState(false);

  // Paystack destination state
  const [banks, setBanks] = useState<PaystackBank[]>([]);
  const [banksLoading, setBanksLoading] = useState(false);
  const [bankQuery, setBankQuery] = useState("");
  const [showBankList, setShowBankList] = useState(false);
  const [selectedBank, setSelectedBank] = useState<PaystackBank | null>(null);
  const [accountNumber, setAccountNumber] = useState("");
  const [resolvedName, setResolvedName] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  // Paystack's account-resolve endpoint doesn't cover every market (it
  // doesn't support South Africa/ZAR at all, verified directly against
  // their API — see backend paystackService.ts resolveAccount) — when the
  // backend reports that specific unavailability, this switches from
  // "Verify account" to a plain typed name instead of blocking withdrawal
  // on a check Paystack can't actually perform here.
  const [manualNameEntry, setManualNameEntry] = useState(false);

  // PayPal destination state
  const [paypalEmail, setPaypalEmail] = useState("");

  useEffect(() => {
    setMethod((m) => (manualOnly ? "MANUAL" : m === "MANUAL" ? "PAYSTACK" : m));
  }, [manualOnly]);

  const resolvedAmount = customText.trim() ? Math.round(parseFloat(customText) * 100) : null;

  useEffect(() => {
    if (method !== "PAYSTACK" || banks.length > 0) return;
    setBanksLoading(true);
    getPaystackBanks()
      .then((r) => setBanks(r.banks))
      .catch(() => showAlert("Couldn't load banks", "Try again in a moment."))
      .finally(() => setBanksLoading(false));
  }, [method, banks.length]);

  // Changing the bank or account number invalidates whatever name was
  // already resolved — never let a stale resolved name from a *different*
  // account slip through to the actual withdrawal.
  function selectBank(bank: PaystackBank) {
    setSelectedBank(bank);
    setShowBankList(false);
    setBankQuery("");
    setResolvedName(null);
    setManualNameEntry(false);
  }
  function changeAccountNumber(v: string) {
    setAccountNumber(v);
    setResolvedName(null);
    setManualNameEntry(false);
  }

  async function handleResolve() {
    if (!selectedBank || !accountNumber.trim()) return;
    setResolving(true);
    try {
      const { accountName } = await resolvePaystackAccount(selectedBank.code, accountNumber.trim());
      setResolvedName(accountName);
    } catch (err: any) {
      if (err.code === "account_resolve_unavailable") {
        setManualNameEntry(true);
        setResolvedName("");
      } else {
        showAlert("Couldn't verify that account", err.message ?? "Check the bank and account number and try again.");
      }
    } finally {
      setResolving(false);
    }
  }

  async function handleWithdraw() {
    if (!resolvedAmount || resolvedAmount <= 0 || Number.isNaN(resolvedAmount)) {
      showAlert("Enter an amount", "Type how much to withdraw.");
      return;
    }
    if (resolvedAmount < WITHDRAWAL_MIN_CENTS) {
      showAlert("Below minimum", `Withdrawals must be at least ${formatCents(WITHDRAWAL_MIN_CENTS)}.`);
      return;
    }
    if (resolvedAmount > balanceCents) {
      showAlert("Not enough balance", "That's more than your available wallet balance.");
      return;
    }

    let destination: WithdrawDestination;
    if (method === "MANUAL") {
      if (!eftBankName.trim() || !eftAccountNumber.trim() || !eftAccountName.trim()) {
        showAlert("Fill in your bank details", "We send this one by hand, so we need the bank, the account number, and the name on the account.");
        return;
      }
      destination = {
        method: "MANUAL",
        bankName: eftBankName.trim(),
        accountNumber: eftAccountNumber.trim(),
        accountName: eftAccountName.trim(),
      };
    } else if (method === "PAYSTACK") {
      if (!selectedBank || !accountNumber.trim() || !resolvedName) {
        showAlert("Verify your account first", "Pick a bank, enter your account number, and tap Verify before withdrawing.");
        return;
      }
      destination = { method: "PAYSTACK", bankCode: selectedBank.code, accountNumber: accountNumber.trim(), accountName: resolvedName };
    } else {
      if (!paypalEmail.trim()) {
        showAlert("Enter your PayPal email", "That's where the payout will be sent.");
        return;
      }
      destination = { method: "PAYPAL", email: paypalEmail.trim() };
    }

    setBusy(true);
    try {
      const updated = await requestWithdrawal(resolvedAmount, destination);
      if (destination.method === "MANUAL") {
        // Deliberately not "paid" — the balance has left the wallet, but a
        // person still has to send it. Saying otherwise would have someone
        // watching their bank account for money nobody has transferred.
        showAlert(
          "Withdrawal requested",
          `${formatCents(resolvedAmount)} has been taken off your balance and we've been notified. It goes out by EFT to ${destination.accountName} — usually within a working day.`
        );
      }
      onDone(updated);
    } catch (err: any) {
      if (err.code === "payout_needs_otp") {
        showAlert("Can't complete this withdrawal", err.message);
      } else {
        showAlert("Couldn't withdraw", err.message ?? "Something went wrong");
      }
    } finally {
      setBusy(false);
    }
  }

  const filteredBanks = bankQuery.trim() ? banks.filter((b) => b.name.toLowerCase().includes(bankQuery.trim().toLowerCase())) : banks;
  const canSubmit =
    method === "MANUAL"
      ? eftBankName.trim().length > 1 && eftAccountNumber.trim().length > 3 && eftAccountName.trim().length > 1
      : method === "PAYSTACK"
        ? !!resolvedName
        : paypalEmail.trim().length > 0;

  return (
    <View style={styles.panel}>
      <Text style={styles.panelTitle}>Withdraw</Text>
      <Text style={styles.panelHint}>Minimum {formatCents(WITHDRAWAL_MIN_CENTS)} · available {formatCents(balanceCents)}</Text>

      {!manualOnly && (
        <View style={styles.methodRow}>
          <Pressable style={[styles.methodButton, method === "PAYSTACK" && styles.methodButtonActive]} onPress={() => setMethod("PAYSTACK")}>
            <Text style={[styles.methodButtonText, method === "PAYSTACK" && styles.methodButtonTextActive]}>Bank (Paystack)</Text>
          </Pressable>
          <Pressable style={[styles.methodButton, method === "PAYPAL" && styles.methodButtonActive]} onPress={() => setMethod("PAYPAL")}>
            <Text style={[styles.methodButtonText, method === "PAYPAL" && styles.methodButtonTextActive]}>PayPal</Text>
          </Pressable>
        </View>
      )}

      <TextInput keyboardAppearance="dark"
        style={styles.customInput}
        placeholder="Amount (R)"
        placeholderTextColor={colors.sub}
        keyboardType="decimal-pad"
        value={customText}
        onChangeText={setCustomText}
      />

      {method === "MANUAL" ? (
        <View style={{ gap: spacing.sm }}>
          <Text style={styles.panelHint}>
            We pay this one out by hand during the pilot, so it lands in your account rather than going through a card processor.
          </Text>
          <TextInput keyboardAppearance="dark"
            style={styles.customInput}
            placeholder="Bank (e.g. Capitec)"
            placeholderTextColor={colors.sub}
            value={eftBankName}
            onChangeText={setEftBankName}
          />
          <TextInput keyboardAppearance="dark"
            style={styles.customInput}
            placeholder="Account number"
            placeholderTextColor={colors.sub}
            keyboardType="number-pad"
            value={eftAccountNumber}
            onChangeText={setEftAccountNumber}
          />
          <TextInput keyboardAppearance="dark"
            style={styles.customInput}
            placeholder="Name on the account"
            placeholderTextColor={colors.sub}
            value={eftAccountName}
            onChangeText={setEftAccountName}
          />
          <Text style={styles.feeDisclosure}>
            Check these carefully — an EFT to a wrong account number can't be pulled back, and nobody verifies the name against the number.
          </Text>
        </View>
      ) : method === "PAYSTACK" ? (
        <View style={{ gap: spacing.sm }}>
          <Pressable style={styles.customInput} onPress={() => setShowBankList((v) => !v)}>
            <Text style={selectedBank ? styles.bankPickerValue : styles.bankPickerPlaceholder}>{selectedBank ? selectedBank.name : "Select your bank"}</Text>
          </Pressable>
          {showBankList && (
            <View style={styles.bankList}>
              <TextInput keyboardAppearance="dark"
                style={styles.bankSearchInput}
                placeholder="Search banks…"
                placeholderTextColor={colors.sub}
                value={bankQuery}
                onChangeText={setBankQuery}
                autoFocus
              />
              {banksLoading && <ActivityIndicator color={colors.accent} style={{ marginVertical: spacing.sm }} />}
              <ScrollView style={{ maxHeight: 180 }} nestedScrollEnabled>
                {filteredBanks.map((b) => (
                  <Pressable key={b.code} style={styles.bankListRow} onPress={() => selectBank(b)}>
                    <Text style={styles.bankListRowText}>{b.name}</Text>
                  </Pressable>
                ))}
                {!banksLoading && filteredBanks.length === 0 && <Text style={styles.panelHint}>No banks match "{bankQuery}".</Text>}
              </ScrollView>
            </View>
          )}

          <TextInput keyboardAppearance="dark"
            style={styles.customInput}
            placeholder="Account number"
            placeholderTextColor={colors.sub}
            keyboardType="number-pad"
            value={accountNumber}
            onChangeText={changeAccountNumber}
          />

          {manualNameEntry ? (
            <View style={{ gap: spacing.xs }}>
              <Text style={styles.panelHint}>Paystack can't auto-verify South African account names — enter the account holder's name yourself.</Text>
              <TextInput keyboardAppearance="dark"
                style={styles.customInput}
                placeholder="Account holder name"
                placeholderTextColor={colors.sub}
                value={resolvedName ?? ""}
                onChangeText={setResolvedName}
              />
            </View>
          ) : resolvedName ? (
            <View style={styles.resolvedRow}>
              <Ionicons name="checkmark-circle" size={16} color={colors.sage} />
              <Text style={styles.resolvedText}>Paying out to {resolvedName}</Text>
            </View>
          ) : (
            <Pressable
              style={[styles.verifyButton, (!selectedBank || !accountNumber.trim() || resolving) && styles.verifyButtonDisabled]}
              onPress={handleResolve}
              disabled={!selectedBank || !accountNumber.trim() || resolving}
            >
              {resolving ? <ActivityIndicator color={colors.text} size="small" /> : <Text style={styles.verifyButtonText}>Verify account</Text>}
            </Pressable>
          )}
        </View>
      ) : (
        <View style={{ gap: spacing.sm }}>
          <TextInput keyboardAppearance="dark"
            style={styles.customInput}
            placeholder="PayPal email"
            placeholderTextColor={colors.sub}
            keyboardType="email-address"
            autoCapitalize="none"
            value={paypalEmail}
            onChangeText={setPaypalEmail}
          />
          <Text style={styles.feeDisclosure}>PayPal may apply its own fees depending on your account and country — those are separate from ASTA and go to PayPal, not us.</Text>
        </View>
      )}

      <View style={styles.panelActions}>
        <Pressable style={styles.panelCancelButton} onPress={onCancel} disabled={busy}>
          <Text style={styles.panelCancelText}>Cancel</Text>
        </Pressable>
        <Pressable style={[styles.panelConfirmButton, !canSubmit && styles.panelConfirmButtonDisabled]} onPress={handleWithdraw} disabled={busy || !canSubmit}>
          {busy ? <ActivityIndicator color={colors.bg} size="small" /> : <Text style={styles.panelConfirmText}>Withdraw</Text>}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xxl },
  header: { fontFamily: fonts.display, textTransform: "uppercase", fontSize: 24, color: colors.text },
  balanceCard: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.xl, alignItems: "center", gap: spacing.sm },
  balanceLabel: { fontFamily: fonts.body, fontSize: 12, color: colors.sub },
  balanceValue: { fontFamily: fonts.bodyBold, fontSize: 36, color: colors.text },
  actionRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.sm, width: "100%" },
  actionButton: { flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 6, borderRadius: radii.md, borderWidth: 1, borderColor: colors.surfaceRaised, paddingVertical: spacing.md },
  actionButtonPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
  actionButtonText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.text },
  actionButtonPrimaryText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.bg },
  panel: { backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, gap: spacing.md },
  panelTitle: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.text },
  panelHint: { fontFamily: fonts.body, fontSize: 11, color: colors.sub, marginTop: -spacing.sm },
  chipRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  presetChip: { borderRadius: radii.pill, borderWidth: 1, borderColor: colors.surfaceRaised, paddingHorizontal: spacing.md, paddingVertical: 8 },
  presetChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  presetChipText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.sub },
  presetChipTextActive: { color: colors.bg },
  customInput: { backgroundColor: colors.surfaceRaised, borderRadius: radii.md, padding: spacing.md, fontFamily: fonts.body, fontSize: 14, color: colors.text },
  panelActions: { flexDirection: "row", gap: spacing.sm },
  panelCancelButton: { flex: 1, alignItems: "center", justifyContent: "center", borderRadius: radii.md, borderWidth: 1, borderColor: colors.surfaceRaised, paddingVertical: spacing.md },
  panelCancelText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.sub },
  panelConfirmButton: { flex: 2, alignItems: "center", justifyContent: "center", borderRadius: radii.md, backgroundColor: colors.accent, paddingVertical: spacing.md },
  panelConfirmButtonDisabled: { opacity: 0.5 },
  panelConfirmText: { fontFamily: fonts.bodyBold, fontSize: 13, color: colors.bg },
  methodRow: { flexDirection: "row", gap: spacing.sm },
  methodButton: { flex: 1, alignItems: "center", borderRadius: radii.md, borderWidth: 1, borderColor: colors.surfaceRaised, paddingVertical: spacing.sm },
  methodButtonActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  methodButtonText: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.sub },
  methodButtonTextActive: { color: colors.bg },
  bankPickerPlaceholder: { fontFamily: fonts.body, fontSize: 14, color: colors.sub },
  bankPickerValue: { fontFamily: fonts.body, fontSize: 14, color: colors.text },
  bankList: { backgroundColor: colors.surfaceRaised, borderRadius: radii.md, padding: spacing.sm, gap: spacing.xs },
  bankSearchInput: { backgroundColor: colors.surface, borderRadius: radii.sm, padding: spacing.sm, fontFamily: fonts.body, fontSize: 13, color: colors.text },
  bankListRow: { paddingVertical: spacing.sm, paddingHorizontal: spacing.xs, borderBottomWidth: 1, borderBottomColor: colors.surface },
  bankListRowText: { fontFamily: fonts.body, fontSize: 13, color: colors.text },
  resolvedRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs, backgroundColor: `${colors.sage}1a`, borderRadius: radii.md, padding: spacing.sm },
  resolvedText: { fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.sage, flexShrink: 1 },
  verifyButton: { alignItems: "center", justifyContent: "center", borderRadius: radii.md, borderWidth: 1, borderColor: colors.surfaceRaised, paddingVertical: spacing.sm },
  verifyButtonDisabled: { opacity: 0.5 },
  verifyButtonText: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.text },
  feeDisclosure: { fontFamily: fonts.body, fontSize: 11, color: colors.sub, lineHeight: 15 },
  sectionTitle: { fontFamily: fonts.display, textTransform: "uppercase", fontSize: 15, color: colors.text },
  sponsorNote: {
    flexDirection: "row",
    gap: spacing.sm,
    alignItems: "flex-start",
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
  },
  sponsorNoteText: { flex: 1, fontFamily: fonts.body, fontSize: 13, color: colors.sub, lineHeight: 18 },
  emptyText: { fontFamily: fonts.body, fontSize: 13, color: colors.sub, textAlign: "center", paddingVertical: spacing.lg },
  ledgerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md },
  ledgerIconWrap: { width: 32, height: 32, borderRadius: radii.pill, backgroundColor: colors.surfaceRaised, alignItems: "center", justifyContent: "center" },
  ledgerBody: { flex: 1 },
  ledgerTitleRow: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  ledgerTitle: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.text },
  modelTag: { backgroundColor: colors.surfaceRaised, borderRadius: radii.sm, paddingHorizontal: 6, paddingVertical: 1 },
  modelTagText: { fontFamily: fonts.bodyMedium, fontSize: 9, color: colors.sub, textTransform: "uppercase", letterSpacing: 0.4 },
  ledgerSub: { fontFamily: fonts.body, fontSize: 11, color: colors.sub },
  ledgerAmount: { fontFamily: fonts.bodyBold, fontSize: 14 },
});
