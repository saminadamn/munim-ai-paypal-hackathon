import { PageSkeleton } from '@/app/(munim)/_ui/ui';

// Shown while the page reads from PayPal.
export default function Loading() {
  return <PageSkeleton stats={0} />;
}
