# masrouf

A tiny daily spending tracker. Type what you spent, pick a category, hit **log it**.

- Every entry is saved to `data/expenses.xlsx` (sheet **Expenses**).
- The **Daily** sheet totals each day with `SUMIF` formulas, so it stays correct if you edit rows in Excel.
- Set a daily limit by tapping "limit" under today's total.

```bash
npm install
npm run dev
```

Open http://localhost:3000, or the Network URL on your phone (same Wi-Fi).

`data/` is git-ignored so your spending never gets pushed.
