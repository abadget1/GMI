import type { ReactNode } from "react";

/**
 * The market workstation owns its full responsive shell. Keeping this route
 * boundary deliberately small also makes it easy to add authenticated routes
 * around the dashboard later without coupling them to the template sidebar.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return children;
}
