# masrouf

A tiny daily spending tracker. Type what you spent, pick a category, hit **log it**.

Entries are saved to a Google Sheet through an Apps Script web app. Put this in `.env.local`:

```
SHEETS_URL=<your Apps Script /exec URL>
```

The sheet needs an `Expenses` tab with the labels `Date, Time, Amount, Category, Note, ID` in row 1.

```bash
npm install
npm run dev
```
