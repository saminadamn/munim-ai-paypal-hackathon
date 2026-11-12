import type { Metadata } from 'next';
import { PageTitle } from '../_ui/ui';
import { Inbox } from './inbox';

export const metadata: Metadata = { title: 'Inbox' };

export default function InboxPage() {
  return (
    <>
      <PageTitle
        title="Inbox"
        detail="Type it, or paste an email or a WhatsApp message. Munim reads it into an invoice; nothing reaches PayPal until you approve."
      />
      <Inbox />
    </>
  );
}
