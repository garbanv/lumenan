/**
 * Pass-through layout for /admin.
 *
 * The authorisation gate lives in the (admin) route group rather than here, so
 * that /admin/no-access can render its explanation without the gate redirecting
 * it to itself. Parentheses keep the grouped pages' URLs unchanged.
 */
export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return children;
}
