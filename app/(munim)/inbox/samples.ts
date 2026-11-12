import type { InvoiceSource } from '@/lib/munim/invoice-form';

export const TABS: { source: InvoiceSource; label: string; placeholder: string }[] = [
  { source: 'chat', label: 'Type it', placeholder: 'e.g. Bill Dan Okafor $1,200 for October website maintenance, due in 30 days' },
  { source: 'email', label: 'Paste email', placeholder: 'Paste the whole thread; Munim uses what the client confirmed.' },
  { source: 'whatsapp', label: 'Paste WhatsApp', placeholder: 'Paste the chat; Hindi and Hinglish are fine.' },
];

export const SAMPLES: Record<InvoiceSource, string> = {
  chat: 'Bill Acme Studio $400 for the landing page redesign, due in 7 days',
  email: `From: Priya Menon <priya@brightleaf.example.com>
To: you
Subject: Re: March launch - final scope

Hi,

Thanks for the call. Confirming the three deliverables we agreed:
1. Homepage hero copy - $350
2. Product descriptions for 3 products - $90 each
3. Launch email sequence (2 emails) - $240 for both

Please invoice Brightleaf Studio, net 15 works for us.

Thanks,
Priya

> On Tue, you wrote:
> Happy to take this on. Send me the final list and I'll invoice once you confirm.`,
  whatsapp: `[10:42] Rohit Sharma: bhai 2 logo variations aur ek banner bana do, total $450, payment next friday tak kar dena
[10:44] You: done bhai, kal tak bhej deta hoon
[10:45] Rohit Sharma: ok, invoice rohit@sharmatraders.example.com pe bhej dena`,
};
