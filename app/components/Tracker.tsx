"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { CATEGORIES, CURRENCY, type Category, type Expense } from "@/lib/expense-types";

const BUDGET_KEY = "masrouf.budget";
const DEFAULT_BUDGET = 100;
const QUICK_ADD = [5, 10, 20, 50];
const GAUGE_TICKS = 20;
const CHART_DAYS = 14;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function toTime(d: Date): string {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function shiftDays(key: string, delta: number): string {
  const date = fromDateKey(key);
  date.setDate(date.getDate() + delta);
  return toDateKey(date);
}

function money(n: number): string {
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function parseAmount(text: string): number {
  return Number(text.replace(",", "."));
}

function mood(total: number, budget: number): string {
  if (total === 0) return "Nothing spent yet. Keep it that way?";
  const ratio = total / budget;
  if (ratio < 0.5) return "Easy does it.";
  if (ratio < 0.8) return "Over halfway. Pace yourself.";
  if (ratio <= 1) return "Right at the edge.";
  return `Over by ${money(total - budget)} ${CURRENCY}. Tomorrow resets.`;
}

function errorText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export default function Tracker() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [today, setToday] = useState<string | null>(null);
  const [budget, setBudget] = useState(DEFAULT_BUDGET);
  const [budgetDraft, setBudgetDraft] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<Category>("food");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stamp, setStamp] = useState(0);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const amountRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;

    async function load() {
      try {
        const response = await fetch("/api/expenses", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error ?? "Could not load your expenses");
        if (active) setExpenses(data.expenses);
      } catch (err) {
        if (active) setError(errorText(err, "Could not load your expenses"));
      }
      if (!active) return;

      let stored = NaN;
      try {
        stored = Number(localStorage.getItem(BUDGET_KEY));
      } catch {
        // storage blocked; keep the default budget
      }
      if (stored > 0) setBudget(stored);
      setToday(toDateKey(new Date()));
    }

    void load();
    return () => {
      active = false;
    };
  }, []);

  // Roll over to the new day if the tab stays open past midnight.
  useEffect(() => {
    const refresh = () => setToday((current) => (current ? toDateKey(new Date()) : current));
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);

  const stats = useMemo(() => {
    if (!today) return null;

    const totals = new Map<string, number>();
    for (const expense of expenses) {
      totals.set(expense.date, (totals.get(expense.date) ?? 0) + expense.amount);
    }
    const spentOn = (date: string) => totals.get(date) ?? 0;

    const todayItems = expenses
      .filter((expense) => expense.date === today)
      .sort((a, b) => b.time.localeCompare(a.time));
    const todayTotal = spentOn(today);

    const days = Array.from({ length: CHART_DAYS }, (_, i) => {
      const date = shiftDays(today, i - (CHART_DAYS - 1));
      return { date, total: spentOn(date) };
    });
    const week = days.slice(-7).reduce((sum, day) => sum + day.total, 0);

    const firstDate = expenses.reduce((min, expense) => (expense.date < min ? expense.date : min), today);

    let span = 0;
    let recent = 0;
    for (let i = 0; i < 30; i++) {
      const date = shiftDays(today, -i);
      if (date < firstDate) break;
      span++;
      recent += spentOn(date);
    }

    let streak = 0;
    if (expenses.length > 0) {
      for (let i = 0; ; i++) {
        const date = shiftDays(today, -i);
        if (date < firstDate || spentOn(date) > budget) break;
        streak++;
      }
    }

    const weekStart = shiftDays(today, -6);
    const byCategory = new Map<Category, number>();
    for (const expense of expenses) {
      if (expense.date >= weekStart && expense.date <= today) {
        byCategory.set(expense.category, (byCategory.get(expense.category) ?? 0) + expense.amount);
      }
    }
    const leak = [...byCategory.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;

    return {
      todayItems,
      todayTotal,
      days,
      week,
      average: span ? recent / span : 0,
      streak,
      leak,
      chartMax: Math.max(budget, ...days.map((day) => day.total)) || 1,
    };
  }, [expenses, today, budget]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = parseAmount(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError("Type how much you spent first.");
      amountRef.current?.focus();
      return;
    }

    const now = new Date();
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/expenses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amount: value, category, note, date: toDateKey(now), time: toTime(now) }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Could not save");

      setExpenses((list) => [...list, data.expense]);
      setToday(toDateKey(now));
      setSelectedDay(null);
      setAmount("");
      setNote("");
      setStamp((n) => n + 1);
    } catch (err) {
      setError(errorText(err, "Could not save"));
    } finally {
      setSaving(false);
    }
  }

  async function remove(id: string) {
    const previous = expenses;
    setExpenses((list) => list.filter((expense) => expense.id !== id));
    setError(null);
    try {
      const response = await fetch(`/api/expenses?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? "Could not delete");
      }
    } catch (err) {
      setExpenses(previous);
      setError(errorText(err, "Could not delete"));
    }
  }

  function quickAdd(step: number) {
    setAmount((current) => {
      const base = parseAmount(current);
      return String(Math.round(((Number.isFinite(base) ? base : 0) + step) * 100) / 100);
    });
  }

  function saveBudget() {
    const value = parseAmount(budgetDraft ?? "");
    if (Number.isFinite(value) && value > 0) {
      setBudget(value);
      try {
        localStorage.setItem(BUDGET_KEY, String(value));
      } catch {
        // storage blocked; budget lasts for this visit only
      }
    }
    setBudgetDraft(null);
  }

  if (!today || !stats) {
    return (
      <div className="flex flex-1 items-center justify-center font-mono text-sm text-muted">
        opening the books…
      </div>
    );
  }

  const over = stats.todayTotal > budget;
  const filledTicks = Math.min(GAUGE_TICKS, Math.ceil((stats.todayTotal / budget) * GAUGE_TICKS));
  const shownDay = selectedDay ?? today;
  const shownTotal = stats.days.find((day) => day.date === shownDay)?.total ?? 0;
  const shownLabel =
    shownDay === today
      ? "today"
      : fromDateKey(shownDay).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-12 px-4 pb-16 pt-8">
      <header className="flex items-baseline justify-between">
        <span className="font-mono text-sm font-semibold tracking-tight">masrouf</span>
        <span className="text-sm text-muted">
          {fromDateKey(today).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" })}
        </span>
      </header>

      <section aria-label="Spent today">
        <p className="text-sm text-muted">spent today</p>
        <p
          key={stamp}
          className={`bump font-mono text-7xl font-semibold tracking-tighter tabular-nums ${over ? "text-accent" : ""}`}
        >
          {money(stats.todayTotal)}
          <span className="ml-2 text-2xl font-normal tracking-normal text-muted">{CURRENCY}</span>
        </p>

        <div className="mt-5 flex h-7 gap-1" aria-hidden>
          {Array.from({ length: GAUGE_TICKS }, (_, i) => (
            <span
              key={i}
              className={`flex-1 rounded-[2px] transition-colors duration-300 ${
                i < filledTicks ? (over ? "bg-accent" : "bg-ink") : "bg-line"
              }`}
              style={{ transitionDelay: `${i * 15}ms` }}
            />
          ))}
        </div>

        <div className="mt-3 flex items-baseline justify-between gap-4 text-sm">
          <span className={over ? "text-accent" : ""}>{mood(stats.todayTotal, budget)}</span>
          {budgetDraft === null ? (
            <button
              type="button"
              onClick={() => setBudgetDraft(String(budget))}
              className="shrink-0 font-mono text-muted underline decoration-dotted underline-offset-4 hover:text-ink"
            >
              limit {money(budget)}
            </button>
          ) : (
            <form
              className="flex shrink-0 items-baseline gap-1 font-mono"
              onSubmit={(event) => {
                event.preventDefault();
                saveBudget();
              }}
            >
              <label className="text-muted" htmlFor="budget">
                limit
              </label>
              <input
                id="budget"
                autoFocus
                inputMode="decimal"
                value={budgetDraft}
                onChange={(event) => setBudgetDraft(event.target.value.replace(/[^\d.,]/g, ""))}
                onBlur={saveBudget}
                className="w-16 border-b border-ink bg-transparent text-right text-base outline-none"
              />
            </form>
          )}
        </div>
      </section>

      <form onSubmit={submit} className="flex flex-col gap-5">
        <label className="flex items-baseline gap-3 border-b-2 border-ink pb-2">
          <span className="sr-only">Amount spent</span>
          <input
            ref={amountRef}
            inputMode="decimal"
            enterKeyHint="done"
            autoComplete="off"
            placeholder="0"
            value={amount}
            onChange={(event) => setAmount(event.target.value.replace(/[^\d.,]/g, ""))}
            className="w-full min-w-0 bg-transparent font-mono text-5xl font-semibold tabular-nums outline-none placeholder:text-line"
          />
          <span className="font-mono text-xl text-muted">{CURRENCY}</span>
        </label>

        <div className="flex gap-2">
          {QUICK_ADD.map((step) => (
            <button
              key={step}
              type="button"
              onClick={() => quickAdd(step)}
              className="flex-1 rounded-full border border-line py-2 font-mono text-sm transition hover:border-ink active:scale-95"
            >
              +{step}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Category">
          {CATEGORIES.map((name) => (
            <button
              key={name}
              type="button"
              role="radio"
              aria-checked={category === name}
              onClick={() => setCategory(name)}
              className={`rounded-full px-3.5 py-1.5 text-sm transition active:scale-95 ${
                category === name ? "bg-ink text-paper" : "border border-line text-muted hover:text-ink"
              }`}
            >
              {name}
            </button>
          ))}
        </div>

        <input
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={80}
          placeholder="what was it? (optional)"
          className="border-b border-line bg-transparent py-2 text-base outline-none placeholder:text-muted focus:border-ink"
        />

        <button
          type="submit"
          disabled={saving}
          className="h-14 rounded-full bg-ink text-lg font-semibold text-paper transition active:scale-[0.98] disabled:opacity-60"
        >
          {saving ? "writing it down…" : "log it"}
        </button>

        {error && (
          <p role="alert" className="text-sm text-accent">
            {error}
          </p>
        )}
      </form>

      <section className="relative" aria-label="Today's receipt">
        <div className="receipt bg-card px-5 pt-5 font-mono text-sm">
          <p className="text-center text-xs uppercase tracking-[0.25em] text-muted">today&apos;s receipt</p>
          <p className="mt-1 text-center text-xs text-muted">{today}</p>
          <hr className="dash my-4" />

          {stats.todayItems.length === 0 ? (
            <p className="py-4 text-center text-muted">nothing yet. impressive.</p>
          ) : (
            <ul>
              {stats.todayItems.map((expense) => (
                <li key={expense.id} className="row-in flex items-baseline gap-3 py-1.5">
                  <span className="text-muted">{expense.time}</span>
                  <span className="min-w-0 flex-1 truncate">
                    {expense.note || expense.category}
                    {expense.note && <span className="text-muted"> · {expense.category}</span>}
                  </span>
                  <span className="tabular-nums">{money(expense.amount)}</span>
                  <button
                    type="button"
                    onClick={() => void remove(expense.id)}
                    aria-label={`Delete ${money(expense.amount)} ${CURRENCY} ${expense.note || expense.category}`}
                    className="-my-1 px-1 text-muted hover:text-accent"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          )}

          <hr className="dash my-4" />
          <div className="flex justify-between font-semibold">
            <span>TOTAL</span>
            <span className="tabular-nums">
              {money(stats.todayTotal)} {CURRENCY}
            </span>
          </div>
          <div className="mt-1 flex justify-between text-muted">
            <span>left before limit</span>
            <span className="tabular-nums">{money(Math.max(0, budget - stats.todayTotal))}</span>
          </div>
        </div>

        {stamp > 0 && (
          <span
            key={stamp}
            aria-hidden
            className="stamp pointer-events-none absolute right-5 top-14 rounded border-2 border-accent px-3 py-1 font-mono text-sm font-bold uppercase tracking-[0.2em] text-accent"
          >
            logged
          </span>
        )}
      </section>

      <section aria-label="Last 14 days">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-sm text-muted">last {CHART_DAYS} days</h2>
          <p className="font-mono text-sm tabular-nums">
            {shownLabel} · {money(shownTotal)} {CURRENCY}
          </p>
        </div>

        <div className="relative flex h-32 items-end gap-1.5">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 border-t border-dashed border-muted"
            style={{ bottom: `${(budget / stats.chartMax) * 100}%` }}
          />
          {stats.days.map((day) => {
            const height = day.total > 0 ? Math.max((day.total / stats.chartMax) * 100, 4) : 2;
            const focused = day.date === shownDay;
            return (
              <button
                key={day.date}
                type="button"
                onClick={() => setSelectedDay(day.date)}
                aria-label={`${day.date}: ${money(day.total)} ${CURRENCY}`}
                aria-pressed={focused}
                className="flex h-full flex-1 items-end"
              >
                <span
                  className={`w-full rounded-[3px] transition-[height,opacity] duration-500 ${
                    day.total === 0 ? "bg-line" : day.total > budget ? "bg-accent" : "bg-ink"
                  } ${focused ? "opacity-100" : "opacity-35"}`}
                  style={{ height: `${height}%` }}
                />
              </button>
            );
          })}
        </div>
        <div className="mt-2 flex gap-1.5" aria-hidden>
          {stats.days.map((day) => (
            <span
              key={day.date}
              className={`flex-1 text-center font-mono text-[10px] ${day.date === today ? "text-ink" : "text-muted"}`}
            >
              {fromDateKey(day.date).toLocaleDateString("en-GB", { weekday: "narrow" })}
            </span>
          ))}
        </div>
        <p className="mt-2 text-xs text-muted">dashed line = your daily limit</p>
      </section>

      <section className="grid grid-cols-3 divide-x divide-line border-y border-line">
        {[
          { label: "this week", value: money(stats.week) },
          { label: "daily avg", value: money(stats.average) },
          { label: "under-limit streak", value: `${stats.streak}d` },
        ].map((stat) => (
          <div key={stat.label} className="px-3 py-4 first:pl-0 last:pr-0">
            <p className="font-mono text-xl font-semibold tabular-nums">{stat.value}</p>
            <p className="mt-0.5 text-xs text-muted">{stat.label}</p>
          </div>
        ))}
      </section>

      {stats.leak && (
        <p className="-mt-6 text-sm">
          <span className="text-muted">Biggest leak this week:</span> {stats.leak[0]},{" "}
          <span className="font-mono tabular-nums">
            {money(stats.leak[1])} {CURRENCY}
          </span>
          .
        </p>
      )}

      <footer className="flex items-center justify-between text-xs text-muted">
        <span>saved to data/expenses.xlsx</span>
        <a href="/api/expenses/export" className="underline underline-offset-4 hover:text-ink">
          download .xlsx
        </a>
      </footer>
    </div>
  );
}
