// Munim's custom AG Studio widgets, registered through createWidgets (ag-studio-react) as the
// custom-widgets docs show. Both are data-less widgets: they read Munim's own API, so the queue is
// live after an approval rather than waiting for Studio's data to reload.

import type { AgDefaultWidgetDefinition, AgWidgetsConfig } from 'ag-studio';
import { createWidgets, type AgRegistry, type AgWidgetDefinition } from 'ag-studio-react';
import { ApprovalQueueWidget } from './approval-queue';
import { MunimTodayWidget } from './munim-today';

const icon = (path: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${path}</svg>`;

export const munimTodayWidget = {
  id: 'munim-today',
  label: 'Munim today',
  icon: icon('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>'),
  form: ({ createTitleSection }) => [createTitleSection()],
  comp: MunimTodayWidget,
  defaultSize: { width: 12, height: 10 },
  minSize: { width: 8, height: 7 },
  toolbar: ['delete'],
  ai: {
    label: 'Munim today',
    description: "Summary of Munim's work: last run, actions taken, money chased and collected, and an estimate of hours saved. Reads Munim's own API, takes no data mapping.",
    usage: 'Place once, near the top of a page about collections.',
  },
} satisfies AgWidgetDefinition<'munim-today'>;

export const approvalQueueWidget = {
  id: 'munim-approval-queue',
  label: 'Approval queue',
  icon: icon('<path d="M9 11l2 2 4-4"/><rect x="3" y="4" width="18" height="16" rx="2"/>'),
  form: ({ createTitleSection }) => [createTitleSection()],
  comp: ApprovalQueueWidget,
  defaultSize: { width: 12, height: 14 },
  minSize: { width: 8, height: 8 },
  toolbar: ['delete'],
  ai: {
    label: 'Approval queue',
    description: "Munim's proposed actions waiting for the owner, with Approve and Reject buttons. Approve executes the action through PayPal. Takes no data mapping.",
    usage: 'Place once, next to the Munim today widget.',
  },
} satisfies AgWidgetDefinition<'munim-approval-queue'>;

export interface MunimRegistry extends AgRegistry {
  widgets: readonly (AgDefaultWidgetDefinition | typeof munimTodayWidget | typeof approvalQueueWidget)[];
}

/** For AgStudio's `widgets` prop: the default widgets plus Munim's, in their own menu group. */
export const munimWidgets = (defaults: AgWidgetsConfig) =>
  createWidgets<MunimRegistry>({
    additionalTypes: [munimTodayWidget, approvalQueueWidget],
    menu: [...defaults.menu, { label: 'Munim', widgetIds: ['munim-today', 'munim-approval-queue'] }],
  });
