# VAULT User Guide

VAULT keeps track of your money in one place: bank accounts, cards and cash, what you spend, what you expect to receive, your loans and your investments. This guide walks through each part of the app in the order you will meet it.

**One idea runs through all of it:** every change to a balance is recorded as an entry in a ledger, and entries are never erased. If you correct or undo something, VAULT adds a new entry that reverses the old one, and both stay visible. That is why every balance in VAULT can always be traced back to the entries behind it.

## Contents

1. [Getting started](#1-getting-started)
2. [Overview](#2-overview)
3. [Accounts and transfers](#3-accounts-and-transfers)
4. [Ledger](#4-ledger)
5. [Budget](#5-budget)
6. [Expenses](#6-expenses)
7. [Receivables](#7-receivables)
8. [Loans and payments](#8-loans-and-payments)
9. [Investments](#9-investments)
10. [Analytics and reports](#10-analytics-and-reports)
11. [Reminders](#11-reminders)
12. [Settings](#12-settings)
13. [FAQ](#13-faq)

---

## 1. Getting started

### Creating an account

Choose **Create an account** on the sign-in page and enter your name, email and a password of at least 10 characters. You will also pick a **secret question** and answer it. This is how you get back in if you forget your password, so choose something only you know and will still remember in a year. Capitals, spaces and punctuation in the answer don't matter.

If sign-up is turned off on your installation, ask the person who runs it to create an account for you.

### First-time setup

After signing up you will see a short setup screen:

- **Your name**
- **Main currency:** all totals and your net worth are shown in this currency.
- **Second currency (optional):** if your money lives in two countries, VAULT shows a quick conversion into this currency next to amounts.
- **Time zone:** decides when your day, and your month, begins.

You can change all of these later in [Settings](#12-settings).

### Forgot your password?

Choose **Forgot it?** on the sign-in page, enter your email, answer your secret question and set a new password. After five wrong answers, recovery is locked for 30 minutes.

If you never set a secret question, you can't recover the account yourself. Set one in **Settings → Secret question** now, while you still remember your password.

---

## 2. Overview

The Overview page is your home screen. At the top:

- **Net worth:** cash plus investments, minus what you owe on loans. The breakdown underneath shows each part.
- **In:** income booked this month.
- **Out:** spending this month, with one-time purchases shown separately and how much of your income you kept.
- **Runway:** how many months your cash would last at your current pace. Select it for the full projection in Analytics.

Below that:

- **Needs your attention:** scheduled income or payments that came due and are waiting for you to confirm.
- **Six months of cash flow:** money in and out, month by month.
- **Budget:** how much of this month's budget you have used.
- **Coming up:** scheduled income and payments for the next 60 days.
- **Accounts:** your balances at a glance.

The **Log expense** and **Transfer** buttons at the top are shortcuts for the two things you will do most.

---

## 3. Accounts and transfers

**Accounts** lists every place your money is kept, grouped by kind.

### Adding an account

Choose **Add account** and pick what you are adding:

| Kind | Use it for |
|---|---|
| Savings account / Current account | Bank accounts |
| Credit card | Spending you pay back later. Add a credit limit and VAULT warns you before you go over it. |
| Prepaid card | Cards you load first, such as meal or gift cards |
| Forex card | Foreign currency for travel or a stay abroad |
| Cash | Notes and coins on hand |
| Digital wallet | PayPal, Paytm, Revolut and the like |
| Fixed deposit | Money locked in a deposit |

The form adjusts to the kind you choose. Enter the **balance today** (for a credit card, the **amount owed today**). From then on VAULT works out the balance from the entries you record.

### Editing an account

Open the menu on an account card and choose **Edit details** to change its name, bank, number, credit limit or notes.

**Type and currency can't be changed** once the account has entries, because that would make its history wrong. If you picked the wrong one, close the account and add a new one.

**Correcting the opening balance:** if you mistyped it when adding the account, change it in the same dialog. VAULT asks you to confirm, then posts the difference as a dated **adjustment**. The original stays on the statement, so the change is always explained.

### Statements

Select an account to see its **statement**: every entry with a running balance. Filter by date, page through older entries, or download the statement as **CSV**.

### Transfers

A transfer moves money between your own accounts, such as paying a card bill, topping up a wallet or loading a forex card. It isn't income or spending, so it doesn't affect your budget.

1. Choose **Transfer** and pick the **From** and **To** accounts, the amount, the date and an optional note.
2. If the two accounts use different currencies, enter the amount that left and the amount that arrived.
3. Choose **Review transfer**, check the details, and confirm. Nothing moves until you confirm.

If you send an identical transfer between the same accounts within a few minutes, VAULT asks whether you really meant to send it twice.

Transfers are listed on the **Transfers** tab of the Accounts page. To undo one, choose **Reverse…**. The original and its reversal both stay on both statements.

### Archiving and closing

- **Archive (hide)** tucks an account away from your lists. Its balance still counts, and you can restore it at any time.
- **Close account…** retires it for good. If money is left in it, either **move it to another account** (recorded as a transfer) or **write it off** by typing the account's name to confirm. Closed accounts are never deleted. They stay under **Closed accounts** with their full statement and still appear in reports.

---

## 4. Ledger

The **Ledger** shows every entry ever recorded, across all your accounts, newest first. Use it to answer "what happened, and when?"

- **Search** descriptions, filter by account, or narrow by date.
- **Reversed** entries are struck through and sit next to the **Reversal** that undid them. **Adjustments** are opening-balance corrections.
- Download what you see as **CSV** or **Excel**.

Nothing in the ledger can be deleted. That is deliberate: it is what keeps every balance trustworthy.

---

## 5. Budget

The Budget page is where you decide what each category can spend this month and which account pays for it. Use the month switcher to move between months.

### Planning a month

1. Enter your **planned income** for the month. VAULT shows how much is still **left to budget** ("income not yet given a job").
2. Choose **Add line** and pick a category (or create one), an amount, and optionally the account it is paid from.
3. Tick **Repeat every month** for things like groceries. A repeating line carries forward into future months, never backwards.

The summary shows what you have **budgeted**, **spent** and have **left**. Select a line's amount to change it, choosing whether the change applies to **this month only** or **this month and later**.

### What's already counted

- **Scheduled payments** such as rent and loan EMIs appear inside their category automatically, marked as scheduled. Any still to be paid this month are listed under **Still to pay from scheduled payments**.
- Spending in a category that has no line shows under **Spending without a budget**, with a **Budget it** button.
- Past months you never planned stay empty rather than being filled in after the fact.

### Budget currency

The budget is planned in your **budget currency** (set in Settings). Each month keeps the currency it was planned in, even if you change the setting later.

The **Budget vs actual** report in Analytics compares plan and spending over several months.

---

## 6. Expenses

The Expenses page has two tabs.

### Monthly expenses

This tab is for everyday spending. Choose **Log expense** and enter:

- **Amount** and **date**. Back-dated expenses count toward the budget for their own month.
- **Category**, or create a new one on the spot.
- **Paid from:** the account, card or wallet the money left.
- An optional **description**.

The **Logged** list can be searched, filtered by category or account, and sorted by date or size.

### One-time purchases

This tab is for things that aren't part of normal monthly life: a laptop, a move, furniture for a new flat.

- One-time purchases are **kept out of your monthly budget**, spending breakdown and runway by default, so a big one-off doesn't distort them. Tick **Count toward the budget** for a purchase if you want it included.
- **Paid from** is optional. Leave it as *Not specified* if the money didn't come from an account you track. The purchase still counts as spending but doesn't change any balance.
- Put related purchases into a **group** (for example "Flat move") to see what the whole thing really cost. Groups can be renamed, archived or deleted.

### Editing and removing

Use the menu on an expense or purchase:

- **Edit…** books a correction: the original is reversed on the statement and the corrected version is recorded.
- **Remove…** returns the amount to the account. The entry stays on the statement, struck through, with its reversal next to it.

---

## 7. Receivables

**Receivables** is money you expect to receive: salary, a stipend, rent you collect, a refund, pocket money.

### Scheduling income

Choose **Schedule income** and fill in:

- **Name**, **amount** and the **account** it arrives in.
- **How often:** Once, Weekly, Monthly, Quarterly, Half-yearly, Yearly, or every N days.
- **First date** and an optional end date.
- **Upcoming dates:** a preview of the next few dates. Change any single date or amount that you already know will differ.
- **When it comes due:**
  - **Ask me to confirm** (recommended): the occurrence waits for you, and you confirm the amount and date it actually arrived.
  - **Credit automatically:** it is booked on the due date without asking. Use this only for income that always arrives exactly on time.

### When income comes due

Anything that has come due appears under **Waiting for confirmation** (and in **Needs your attention** on the Overview):

- **Confirm** credits the account with what actually arrived. Only then does it count in your balance and income.
- **Skip** records that it didn't arrive this time. No money moves, and the skipped occurrence stays in the history.

### Managing schedules

The **Schedules** list shows every income schedule and its next date. From each one's menu you can:

- change a single upcoming date or amount, or **reset it to regular**;
- **skip** an upcoming occurrence, and **restore** it later if needed;
- **edit** the schedule (past occurrences stay exactly as they were);
- **reverse** an occurrence that was already booked.

Quarterly and yearly schedules only appear in the months they fall in.

### Unscheduled money

For one-off money you weren't expecting, such as a refund, a prize or a gift, use **Money received**. It credits the account straight away.

---

## 8. Loans and payments

**Loans & payments** covers what you owe and the bills you pay regularly.

### Adding a loan

Choose **Add loan** and enter the name, currency, principal, interest rate, length in months, start date and the account EMIs are paid from. VAULT works out the **EMI** and how each one splits into principal and interest. The first EMI falls a month after the start date.

Leave **Track EMIs as scheduled payments** on, and each EMI from today onwards appears in that month's budget and in the scheduled payments list.

The outstanding principal of every active loan is subtracted from your **net worth**.

### The loan page

Select a loan to see:

- **Outstanding** balance, **EMI**, **paid so far** and **progress**.
- The full **amortisation** table: each due date, EMI, interest, principal and remaining balance.
- **Payments** recorded against the loan.

From here you can:

- **Record a payment:** for EMIs paid before you started using VAULT, or extra payments. Choose *Not from a tracked account* if it didn't come from one of your accounts.
- **Set up EMI schedule:** if you didn't when adding the loan.
- **Close loan:** when it is settled, for example paid off early. The schedule ends and future budgets stop including it. Payment history stays, and you can re-open it.
- **Delete:** only possible while no payments are recorded. Use it for a loan added by mistake.

### Scheduled payments

Rent, subscriptions, insurance and other regular bills go under **Schedule a payment**. The form works like [scheduling income](#scheduling-income), with a **budget category** so each payment lands in the right budget line. Choose **Ask me to confirm** (it shows as due until you confirm it was paid) or **Pay automatically**.

Due payments appear under **Due**. Confirm once paid, or skip it. To change one payment without touching the rest, use **Change date or amount…** on that occurrence.

---

## 9. Investments

Investments brings stocks, mutual funds, fixed deposits and other assets into one portfolio. The top of the page shows what you have **invested**, the **current value**, your **profit / loss** on what you still hold, and the profit or loss **realised from sales**. Every amount is shown in its own currency with "≈" conversions into your primary and secondary currencies.

### Stocks

Choose **Add stock** and start typing a company name or ticker. Use **Search in** to limit results to one exchange (NSE, BSE, NASDAQ, NYSE, LSE, Hong Kong, Tokyo or Toronto). Enter the quantity, the price you paid and the date you bought.

Buying more of the same stock later? Add it again: VAULT records it as a new purchase and recalculates the average price. Expand a holding to see each purchase and its return, or to edit or delete a single purchase.

Prices update automatically a few times each trading day. Use the refresh button to fetch them straight away.

### Mutual funds

Choose **Add fund** and enter the fund name, units, average NAV and purchase date. Add the fund's **AMFI scheme code** and VAULT fetches its NAV every day. Without the code, the value stays at what you paid.

### Fixed deposits

Add the bank, principal, interest rate, start date and maturity date to watch the interest build up until it matures.

### Other assets

Gold, bonds, cryptocurrency, property or anything else. Enter what you paid and what it is worth now, and update the value yourself when it changes.

Investments are tracked separately from your account ledger, so adding or deleting a holding doesn't change any account balance. Buying with money from an account? Log the expense or transfer for that account too.

### Selling and closing

Use the sell button on a holding's row (**Sell** for stocks and other assets, **Redeem** for mutual funds, **Close deposit** for fixed deposits):

- **Shares and fund units:** enter how many you sold and the price or NAV. You can sell part of a holding. The oldest purchases are sold first.
- **Fixed deposits:** VAULT suggests the payout from the interest earned up to the closing date. Enter what the bank actually paid, plus any penalty or tax deducted. Closing before maturity is recorded as an early closure.
- **Other assets:** enter the sale price.
- **Charges** (brokerage, exit load, fees) come off the proceeds.
- **Credit the money to:** pick the account the money went into. If its currency differs from the investment's, enter the amount that actually arrived.

Before you confirm, a preview shows what you receive, the cost of what you're selling and your profit or loss. The money is posted to the account as an **Investment sale** entry. It isn't counted as income, because it was already yours in another form.

### Sold & closed

The **Sold & closed** tab is your trade history: realised profit and loss, gains and losses, what you received and the charges paid. Filter by type and year, search, and download it as CSV. Select a trade to see every detail, including which purchases were sold, how long each was held and its share of the profit.

Recorded a sale by mistake? Open it and choose **Undo**. The money is taken back out of the account and the holding returns to your portfolio. Both the sale and its undo stay in the ledger.

---

## 10. Analytics and reports

### Analytics

**Analytics** explains where your money comes from, where it goes and how long it lasts. Choose a period of 3, 6 or 12 months. Sections:

- **Cash runway:** your cash projected forward from scheduled income and payments plus recent day-to-day spending.
- **Income:** money that actually arrived, by source. Scheduled income counts once you confirm it.
- **Expenses:** monthly spending by category, with one-time purchases shown separately.
- **Savings:** income minus spending each month.
- **Budget adherence:** spending against plan, month by month.
- **Account balances & net worth:** today's balances and net worth at each month-end. Months before VAULT started taking daily snapshots are rebuilt from the ledger, with investments at what you paid.
- **Upcoming commitments:** the next 60 days of scheduled income and payments.
- **Spending trends:** your top categories month by month, with this month compared to your average.

### Reports

The **Reports** tab turns the same numbers into files you can keep or share. Choose a report, a date range (and an account, where relevant), then download it as **CSV** or **PDF**:

- Income & expense summary
- Cash-flow history
- Savings
- Monthly spending by category
- One-time purchases
- Budget vs actual
- Recurring income & payments
- Account statement (from any date, back to when the account was opened)
- Full ledger export
- Activity log

**Everything (JSON)** downloads a complete copy of your data.

---

## 11. Reminders

The **bell** in the sidebar lists what needs you now: income about to arrive, bills coming up, and budget categories close to their limit. Dismiss a reminder once you have dealt with it.

Choose what you are reminded about in **Settings → Reminders**, including the percentage at which a budget category is flagged.

---

## 12. Settings

- **Profile:** your name and time zone. Your email is shown for reference.
- **Currencies:**
  - **Primary:** totals and net worth are shown in it.
  - **Secondary:** shown as "≈" next to amounts.
  - **Budget in:** the currency for newly planned months.

  Every account, card and loan keeps its own currency. These settings only change how totals and conversions are shown.
- **Exchange rates:** for each currency you hold, choose **Live** rates (refreshed automatically) or **Manual** and set your own.
- **Appearance:** Light, Dark or System.
- **Reminders:** what shows up under the bell.
- **Password:** changing it signs you out on every other device.
- **Secret question:** set or change the question used to recover your account.
- **Your data:** **Download everything (JSON)**, or **Delete my account**, which permanently erases your profile and all your data after you enter your password. Download a copy first if you might want it.

---

## 13. FAQ

**Why can't I delete an expense or transfer?**
You can undo it, but not erase it. Removing or reversing adds a matching reversal entry, so your statements always explain how a balance got where it is.

**Why can't I change an account's currency or type?**
Its past entries were recorded in that currency and type. Close the account and add a new one with the right settings.

**My salary didn't show up in my balance. Why?**
If the schedule is set to **Ask me to confirm**, it is waiting under **Receivables → Waiting for confirmation** (and in **Needs your attention** on the Overview). Confirm it and the money is credited.

**A quarterly payment is missing from this month. Is something broken?**
Probably not. Quarterly, half-yearly and yearly schedules only appear in the months they fall in.

**Why did my net worth drop when I added a loan?**
Net worth is what you own minus what you owe. The loan's outstanding principal is subtracted, and it shrinks as you pay EMIs.

**A big purchase isn't in my monthly spending. Where is it?**
If you logged it as a **one-time purchase**, it is kept out of monthly figures on purpose. Find it on the **One-time purchases** tab, or tick **Count toward the budget** for that purchase.

**How do I get my data out?**
**Settings → Your data → Download everything (JSON)** for a complete copy, or any report in **Analytics → Reports** as CSV or PDF. The Ledger page exports to Excel.
