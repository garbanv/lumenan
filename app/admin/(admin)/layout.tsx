import { requireAdminPage } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

/**
 * Gate for every gated admin route.
 *
 * Each page also calls requireAdminPage() for the user object, so this is a
 * second line of defence rather than the only one: if someone adds a page here
 * and forgets the check, requests still never reach it.
 *
 * Deliberately NOT at app/admin/layout.tsx: /admin/no-access sits outside this
 * group, and a gate on the parent would make that page redirect to itself.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireAdminPage();
  return children;
}
