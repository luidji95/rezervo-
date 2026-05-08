import AppShell from "@/components/layout/AppShell";

export default function MainAppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <AppShell>{children}</AppShell>;
}