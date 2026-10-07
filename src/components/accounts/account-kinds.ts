import { CreditCard, Landmark, Wallet, Globe, Ticket, PiggyBank } from "lucide-react";

export const ACCOUNT_KINDS = [
  { type: "SAVINGS", label: "Savings account", group: "bank", icon: Landmark, hint: "Where your pay lands" },
  { type: "CURRENT", label: "Current account", group: "bank", icon: Landmark, hint: "Everyday banking" },
  { type: "CREDIT_CARD", label: "Credit card", group: "credit", icon: CreditCard, hint: "Spending you pay back later" },
  { type: "PREPAID_CARD", label: "Prepaid card", group: "prepaid", icon: Ticket, hint: "A card you load up first, like a meal or gift card" },
  { type: "FOREX_CARD", label: "Forex card", group: "prepaid", icon: Globe, hint: "Foreign currency for travel or a stay abroad" },
  { type: "CASH_WALLET", label: "Cash", group: "wallet", icon: Wallet, hint: "Notes and coins on hand" },
  { type: "DIGITAL_WALLET", label: "Digital wallet", group: "wallet", icon: Wallet, hint: "PayPal, Paytm, Revolut and the like" },
  { type: "FIXED_DEPOSIT", label: "Fixed deposit", group: "other", icon: PiggyBank, hint: "Money locked in a deposit" },
] as const;

export const ACCOUNT_GROUPS = [
  { key: "bank", label: "Bank accounts" },
  { key: "credit", label: "Credit cards" },
  { key: "prepaid", label: "Prepaid & forex cards" },
  { key: "wallet", label: "Cash & wallets" },
  { key: "other", label: "Other" },
] as const;

export function kindOf(type: string) {
  return ACCOUNT_KINDS.find((k) => k.type === type) ?? { type, label: type === "LOAN" ? "Loan account" : type, group: "other" as const, icon: Landmark, hint: "" };
}

export const isCredit = (type: string) => type === "CREDIT_CARD" || type === "LOAN";
