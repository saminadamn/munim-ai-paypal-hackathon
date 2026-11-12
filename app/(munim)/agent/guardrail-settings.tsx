import type { Settings } from '@/lib/db';
import { saveSettings } from '../_ui/actions';
import { Button, Card } from '../_ui/ui';

// The limits Munim works within. Code enforces them after the model answers (applyGuardrails in
// lib/munim/collect.ts); the model never sees them as suggestions.
export function GuardrailSettings({ settings: s }: { settings: Settings }) {
  return (
    <Card title="Guardrails">
      <form action={saveSettings} className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input name="maxRemindersPerInvoice" label="Reminders per invoice, at most" defaultValue={s.maxRemindersPerInvoice} type="number" />
          <Input name="minDaysBetweenReminders" label="Days between reminders, at least" defaultValue={s.minDaysBetweenReminders} type="number" />
          <Input name="approvalThreshold" label="Ask me first above this amount due" defaultValue={s.approvalThreshold} type="number" />
          <Input name="demoOffsetDays" label="Demo clock: days ahead of today" defaultValue={s.demoOffsetDays} type="number" />
          <Input name="businessName" label="Business name" defaultValue={s.businessName} />
          <Input name="ownerName" label="Owner name" defaultValue={s.ownerName} />
        </div>
        <label className="flex items-center gap-3 text-sm">
          <input type="checkbox" name="quietWeekends" defaultChecked={s.quietWeekends} className="size-4 accent-[var(--pp-blue)]" />
          Quiet weekends: hold automatic reminders until Monday
        </label>
        <p className="text-xs text-pp-muted">
          Always: part-payment offers and hand-offs wait for you. Never: a firmer tone before a reminder has been ignored, reminders more than 3 days before the due
          date, more than 2 a day per invoice (PayPal&apos;s limit), or messages over 80 words or that mention fees, discounts or legal action.
        </p>
        <div>
          <Button type="submit">Save guardrails</Button>
        </div>
      </form>
    </Card>
  );
}

function Input({ name, label, defaultValue, type = 'text' }: { name: string; label: string; defaultValue: string | number; type?: string }) {
  return (
    <label className="block text-xs font-semibold uppercase tracking-wider text-pp-muted">
      {label}
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        className="mt-1 block h-10 w-full rounded border border-pp-border px-3 text-sm font-normal normal-case tracking-normal text-pp-ink outline-none focus:border-pp-blue"
      />
    </label>
  );
}
